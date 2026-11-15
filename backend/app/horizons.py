from __future__ import annotations

import asyncio
import csv
import io
import json
import math
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from .models import (
    AnalysisMetrics,
    AnalysisRequest,
    AnalysisResult,
    BodyPosition,
    EphemerisPoint,
    SiteInput,
)

# JPL documents this GET endpoint at ssd.jpl.nasa.gov; the API docs page is hosted on ssd-api.jpl.nasa.gov.
HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
TARGETS = {"sun": "10", "earth": "399"}
# Keep outbound traffic polite: a two-site comparison needs four target queries.
# One or two in-flight requests are enough and reduce transient service throttling.
_HORIZONS_SEMAPHORE = asyncio.Semaphore(2)
_TRANSIENT_HTTP_STATUSES = {429, 500, 502, 503, 504}
_CACHE_LOCK = asyncio.Lock()
_CACHE_TTL_SECONDS = 24 * 60 * 60
_CACHE_STALE_SECONDS = 30 * 24 * 60 * 60


def _cache_path() -> Path:
    configured = os.getenv("SELENIC_CACHE_DB")
    return Path(configured) if configured else Path(__file__).resolve().parents[1] / "data" / "horizons_cache.sqlite3"


def _cache_key(request: AnalysisRequest) -> str:
    payload = {
        "site": request.site.model_dump(mode="json"),
        "start_utc": request.start_utc.astimezone(timezone.utc).isoformat(),
        "duration_hours": request.duration_hours,
        "step_minutes": request.step_minutes,
        "targets": TARGETS,
        "cache_schema": 1,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _read_cache_sync(key: str, max_age_seconds: int) -> tuple[str, int] | None:
    path = _cache_path()
    if not path.exists():
        return None
    try:
        with sqlite3.connect(path, timeout=2) as connection:
            row = connection.execute(
                "SELECT result_json, fetched_at FROM horizons_cache WHERE cache_key = ?", (key,)
            ).fetchone()
        if not row:
            return None
        age = max(0, int(datetime.now(timezone.utc).timestamp()) - int(row[1]))
        return (row[0], age) if age <= max_age_seconds else None
    except sqlite3.Error:
        return None


def _write_cache_sync(key: str, result_json: str) -> None:
    path = _cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path, timeout=2) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS horizons_cache (cache_key TEXT PRIMARY KEY, result_json TEXT NOT NULL, fetched_at INTEGER NOT NULL)"
            )
            connection.execute(
                "INSERT INTO horizons_cache(cache_key, result_json, fetched_at) VALUES (?, ?, ?) "
                "ON CONFLICT(cache_key) DO UPDATE SET result_json=excluded.result_json, fetched_at=excluded.fetched_at",
                (key, result_json, int(datetime.now(timezone.utc).timestamp())),
            )
            connection.commit()
    except sqlite3.Error:
        # A cache failure must never prevent a live ephemeris request succeeding.
        return


class HorizonsError(RuntimeError):
    """Raised when Horizons cannot provide a usable observer ephemeris."""


def parse_horizons_csv(payload: dict[str, Any]) -> list[tuple[datetime, float, float]]:
    """Parse CSV observer rows from a JPL Horizons JSON response.

    For QUANTITIES=4, the final two numeric cells in each data row are apparent
    azimuth and elevation in degrees. The parser intentionally fails closed on
    malformed/ambiguous rows rather than manufacturing coordinates.
    """
    if payload.get("error"):
        raise HorizonsError(str(payload["error"]))
    result = payload.get("result")
    if not isinstance(result, str):
        raise HorizonsError("Horizons response did not contain a text result")
    if "$$SOE" not in result or "$$EOE" not in result:
        raise HorizonsError("Horizons response did not contain an ephemeris data block")

    block = result.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    parsed: list[tuple[datetime, float, float]] = []
    for raw_line in block.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            columns = next(csv.reader([line], skipinitialspace=True))
        except (csv.Error, StopIteration):
            continue
        if not columns:
            continue

        timestamp_text = columns[0].strip().strip('"')
        timestamp = _parse_horizons_time(timestamp_text)
        if timestamp is None:
            continue

        numeric: list[float] = []
        for cell in columns[1:]:
            try:
                value = float(cell.strip().strip('"'))
                if math.isfinite(value):
                    numeric.append(value)
            except (TypeError, ValueError):
                continue
        if len(numeric) < 2:
            continue
        azimuth, elevation = numeric[-2], numeric[-1]
        if not (-360.0 <= azimuth <= 720.0 and -90.5 <= elevation <= 90.5):
            continue
        parsed.append((timestamp, azimuth % 360.0, elevation))

    if not parsed:
        raise HorizonsError("No valid azimuth/elevation rows could be parsed from Horizons")
    parsed.sort(key=lambda row: row[0])
    return parsed


def _parse_horizons_time(value: str) -> datetime | None:
    formats = (
        "%Y-%b-%d %H:%M:%S.%f",
        "%Y-%b-%d %H:%M:%S",
        "%Y-%b-%d %H:%M",
        "%Y-%b-%d %H",
    )
    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def build_horizons_params(target_id: str, site: SiteInput, request: AnalysisRequest) -> dict[str, str]:
    """Build a Horizons observer-table request for a custom lunar surface site."""
    start = request.start_utc.astimezone(timezone.utc)
    stop = start + timedelta(hours=request.duration_hours)
    site_coord = (
        f"{site.longitude_east_deg:.6f},"
        f"{site.latitude_deg:.6f},"
        f"{site.altitude_km:.4f}"
    )
    return {
        "format": "json",
        "COMMAND": f"'{target_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{site_coord}'",
        "START_TIME": f"'{start.strftime('%Y-%m-%d %H:%M')}'",
        "STOP_TIME": f"'{stop.strftime('%Y-%m-%d %H:%M')}'",
        "STEP_SIZE": f"'{request.step_minutes} m'",
        "QUANTITIES": "'4'",
        "CSV_FORMAT": "'YES'",
        "TIME_TYPE": "'UT'",
    }


def _http_error_detail(response: httpx.Response) -> str:
    """Return the useful Horizons error text instead of a generic HTTPStatusError."""
    detail = ""
    try:
        payload = response.json()
        if isinstance(payload, dict):
            for key in ("error", "message", "result"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    detail = value.strip()
                    break
    except ValueError:
        pass
    if not detail:
        detail = response.text.strip()
    # Avoid flooding the API response with a complete proxy or HTML error page.
    return " ".join(detail.split())[:900] or response.reason_phrase or "No error detail supplied"


async def fetch_body(
    client: httpx.AsyncClient,
    target_id: str,
    site: SiteInput,
    request: AnalysisRequest,
) -> list[tuple[datetime, float, float]]:
    params = build_horizons_params(target_id, site, request)
    target_name = "Sun" if target_id == TARGETS["sun"] else "Earth" if target_id == TARGETS["earth"] else target_id

    for attempt in range(3):
        try:
            async with _HORIZONS_SEMAPHORE:
                response = await client.get(HORIZONS_URL, params=params)
            if response.status_code in _TRANSIENT_HTTP_STATUSES and attempt < 2:
                await asyncio.sleep(1.0 + attempt * 1.5)
                continue
            if response.is_error:
                detail = _http_error_detail(response)
                raise HorizonsError(
                    f"JPL Horizons returned HTTP {response.status_code} for {target_name} at "
                    f"{site.latitude_deg:.4f}° lat, {site.longitude_east_deg:.4f}°E: {detail}"
                )
            try:
                payload = response.json()
            except ValueError as exc:
                raise HorizonsError(
                    f"JPL Horizons returned a non-JSON response for {target_name}: "
                    f"{response.text[:400]}"
                ) from exc
            try:
                return parse_horizons_csv(payload)
            except HorizonsError as exc:
                raise HorizonsError(f"JPL Horizons could not produce {target_name} azimuth/elevation data: {exc}") from exc
        except HorizonsError:
            raise
        except httpx.TimeoutException as exc:
            if attempt < 2:
                await asyncio.sleep(1.0 + attempt * 1.5)
                continue
            raise HorizonsError(f"Timed out connecting to JPL Horizons while requesting {target_name} data") from exc
        except httpx.HTTPError as exc:
            if attempt < 2:
                await asyncio.sleep(1.0 + attempt * 1.5)
                continue
            raise HorizonsError(
                f"Could not connect to JPL Horizons while requesting {target_name} data: "
                f"{exc.__class__.__name__}: {str(exc)[:300]}"
            ) from exc
    raise HorizonsError(f"JPL Horizons request for {target_name} failed after three attempts")


async def diagnose_horizons() -> dict[str, Any]:
    """Run one small real query so users can distinguish backend health from JPL reachability."""
    site = SiteInput(
        id="diagnostic-site",
        name="SELENIC diagnostic site",
        latitude_deg=-89.5,
        longitude_east_deg=0.0,
        altitude_km=0.0,
    )
    request = AnalysisRequest(
        site=site,
        start_utc=datetime.now(timezone.utc).replace(second=0, microsecond=0),
        duration_hours=6,
        step_minutes=60,
    )
    timeout = httpx.Timeout(45.0, connect=12.0)
    async with httpx.AsyncClient(
        timeout=timeout,
        headers={"User-Agent": "SELENIC-Lunar-Research-Prototype/0.7"},
    ) as client:
        rows = await fetch_body(client, TARGETS["sun"], site, request)
    first = rows[0]
    return {
        "status": "ok",
        "service": "JPL Horizons API",
        "target_tested": "Sun",
        "observer": {
            "latitude_deg": site.latitude_deg,
            "longitude_east_deg": site.longitude_east_deg,
            "altitude_km": site.altitude_km,
        },
        "sample_count": len(rows),
        "first_sample": {
            "timestamp_utc": first[0].isoformat().replace("+00:00", "Z"),
            "azimuth_deg": first[1],
            "elevation_deg": first[2],
        },
        "note": "This is a connectivity and response-format check, not a mission analysis.",
    }


def _positive_duration(points: list[EphemerisPoint], body: str, max_gap_minutes: int) -> float:
    """Estimate time above 0° using linear zero-crossing interpolation."""
    total_hours = 0.0
    for left, right in zip(points, points[1:]):
        t0 = datetime.fromisoformat(left.timestamp_utc.replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(right.timestamp_utc.replace("Z", "+00:00"))
        interval_hours = (t1 - t0).total_seconds() / 3600.0
        if interval_hours <= 0 or interval_hours > max_gap_minutes / 60.0 * 1.6:
            continue
        y0 = getattr(left, body).elevation_deg
        y1 = getattr(right, body).elevation_deg
        if y0 >= 0 and y1 >= 0:
            fraction = 1.0
        elif y0 < 0 and y1 < 0:
            fraction = 0.0
        elif y0 < 0 <= y1:
            fraction = y1 / (y1 - y0) if y1 != y0 else 0.0
        else:
            fraction = y0 / (y0 - y1) if y0 != y1 else 0.0
        total_hours += interval_hours * max(0.0, min(1.0, fraction))
    return round(total_hours, 2)


def calculate_metrics(points: list[EphemerisPoint], step_minutes: int) -> AnalysisMetrics:
    if not points:
        raise HorizonsError("No points returned for metric calculation")
    sun_elevations = [p.sun.elevation_deg for p in points]
    earth_elevations = [p.earth.elevation_deg for p in points]
    # This is a geometric direct-beam elevation proxy, not electrical power.
    mean_sin = sum(max(0.0, math.sin(math.radians(e))) for e in sun_elevations) / len(sun_elevations)
    return AnalysisMetrics(
        sunlight_hours_sampled=_positive_duration(points, "sun", step_minutes),
        earth_visibility_hours_sampled=_positive_duration(points, "earth", step_minutes),
        peak_solar_elevation_deg=round(max(sun_elevations), 2),
        peak_earth_elevation_deg=round(max(earth_elevations), 2),
        solar_elevation_index_percent=round(mean_sin * 100.0, 1),
    )


async def analyze_site(request: AnalysisRequest) -> AnalysisResult:
    cache_key = _cache_key(request)
    async with _CACHE_LOCK:
        cached = _read_cache_sync(cache_key, _CACHE_TTL_SECONDS)
    if cached:
        cached_result = AnalysisResult.model_validate_json(cached[0])
        return cached_result.model_copy(update={"is_cached": True})

    timeout = httpx.Timeout(45.0, connect=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": "SELENIC-Lunar-Research-Prototype/0.7"}) as client:
            # Separate target requests share the same observer, date range, and cadence.
            sun_rows, earth_rows = await asyncio.gather(
                fetch_body(client, TARGETS["sun"], request.site, request),
                fetch_body(client, TARGETS["earth"], request.site, request),
            )
    except (HorizonsError, httpx.HTTPError) as exc:
        async with _CACHE_LOCK:
            stale = _read_cache_sync(cache_key, _CACHE_STALE_SECONDS)
        if stale:
            cached_result = AnalysisResult.model_validate_json(stale[0])
            warnings = list(cached_result.warnings) + [
                f"JPL Horizons was unavailable; this exact-query result was served from persistent cache ({stale[1] // 3600} hours old)."
            ]
            return cached_result.model_copy(update={"is_cached": True, "warnings": warnings})
        if isinstance(exc, HorizonsError):
            raise
        raise HorizonsError(f"Could not reach JPL Horizons: {exc}") from exc

    earth_by_time = {row[0]: row for row in earth_rows}
    points: list[EphemerisPoint] = []
    for timestamp, sun_az, sun_el in sun_rows:
        earth_row = earth_by_time.get(timestamp)
        if earth_row is None:
            continue
        _, earth_az, earth_el = earth_row
        points.append(
            EphemerisPoint(
                timestamp_utc=timestamp.isoformat().replace("+00:00", "Z"),
                sun=BodyPosition(azimuth_deg=round(sun_az, 3), elevation_deg=round(sun_el, 3)),
                earth=BodyPosition(azimuth_deg=round(earth_az, 3), elevation_deg=round(earth_el, 3)),
            )
        )

    if len(points) < 2:
        raise HorizonsError("Sun and Earth ephemeris samples did not align; try a different interval")

    metrics = calculate_metrics(points, request.step_minutes)
    result = AnalysisResult(
        site=request.site,
        source="JPL Horizons API",
        ephemeris_model="JPL DE441 (Horizons solar-system solution)",
        is_demo=False,
        is_cached=False,
        start_utc=request.start_utc.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        duration_hours=request.duration_hours,
        step_minutes=request.step_minutes,
        horizon_model="Reference-ellipsoid geometric horizon",
        terrain_mask_applied=False,
        warnings=[
            "Local LOLA terrain horizon masking is not applied; crater rims and nearby relief may change actual visibility.",
            "Sun-above-horizon duration is a geometric exposure proxy, not a solar-array power or thermal model.",
            "Earth-above-horizon duration is a geometric visibility proxy, not a communications link-budget or antenna-pointing assessment.",
            "Values are sampled at the selected cadence; short events may fall between samples.",
        ],
        points=points,
        metrics=metrics,
    )
    async with _CACHE_LOCK:
        _write_cache_sync(cache_key, result.model_dump_json())
    return result
