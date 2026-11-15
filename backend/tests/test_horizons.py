from datetime import datetime, timezone

import pytest

from app.horizons import (
    _http_error_detail,
    build_horizons_params,
    calculate_metrics,
    parse_horizons_csv,
)
from app.models import AnalysisRequest, BodyPosition, EphemerisPoint, SiteInput


def test_builds_custom_moon_observer_request():
    request = AnalysisRequest(
        site=SiteInput(
            id="x",
            name="Candidate X",
            latitude_deg=-89.2,
            longitude_east_deg=15,
            altitude_km=0,
        ),
        start_utc=datetime(2026, 11, 14, tzinfo=timezone.utc),
        duration_hours=24,
        step_minutes=30,
    )
    params = build_horizons_params("10", request.site, request)
    assert params["CENTER"] == "'coord@301'"
    assert params["SITE_COORD"] == "'15.000000,-89.200000,0.0000'"
    assert params["QUANTITIES"] == "'4'"
    assert params["COMMAND"] == "'10'"


def test_parses_horizons_csv_rows():
    fixture = {
        "result": """Target body name: Sun (10)\n$$SOE\n2026-Nov-14 00:00, , 120.0, 8.5\n2026-Nov-14 00:30, , 125.0, -1.5\n$$EOE\n"""
    }
    rows = parse_horizons_csv(fixture)
    assert len(rows) == 2
    assert rows[0][1:] == (120.0, 8.5)
    assert rows[1][1:] == (125.0, -1.5)


def test_interpolates_duration_above_horizon():
    points = [
        EphemerisPoint(
            timestamp_utc=f"2026-11-14T{hour:02d}:00:00Z",
            sun=BodyPosition(azimuth_deg=0, elevation_deg=elev),
            earth=BodyPosition(azimuth_deg=0, elevation_deg=elev),
        )
        for hour, elev in [(0, -10), (1, 10), (2, 10)]
    ]
    metrics = calculate_metrics(points, 60)
    assert metrics.sunlight_hours_sampled == pytest.approx(1.5)
    assert metrics.earth_visibility_hours_sampled == pytest.approx(1.5)


def test_http_error_detail_preserves_jpl_message():
    import httpx

    response = httpx.Response(400, json={"error": "Invalid custom observer coordinates"})
    assert _http_error_detail(response) == "Invalid custom observer coordinates"


def test_uses_the_official_jpl_horizons_api_hostname():
    from app.horizons import HORIZONS_URL

    assert HORIZONS_URL == "https://ssd.jpl.nasa.gov/api/horizons.api"


def test_analysis_request_allows_month_length_windows_with_bounded_rows():
    request = AnalysisRequest(
        site=SiteInput(id="month", name="Month window", latitude_deg=-89, longitude_east_deg=0),
        start_utc=datetime(2026, 11, 14, tzinfo=timezone.utc),
        duration_hours=720,
        step_minutes=30,
    )
    assert request.duration_hours == 720


def test_analysis_request_rejects_more_than_two_thousand_samples():
    with pytest.raises(ValueError, match="2,000 samples"):
        AnalysisRequest(
            site=SiteInput(id="month", name="Month window", latitude_deg=-89, longitude_east_deg=0),
            start_utc=datetime(2026, 11, 14, tzinfo=timezone.utc),
            duration_hours=720,
            step_minutes=15,
        )


def test_persistent_horizons_cache_round_trips_exact_query(monkeypatch, tmp_path):
    from app import horizons

    monkeypatch.setenv("SELENIC_CACHE_DB", str(tmp_path / "cache.sqlite3"))
    request = AnalysisRequest(
        site=SiteInput(id="cache", name="Cache site", latitude_deg=-89, longitude_east_deg=10),
        start_utc=datetime(2026, 11, 14, tzinfo=timezone.utc),
        duration_hours=24,
        step_minutes=30,
    )
    key = horizons._cache_key(request)
    horizons._write_cache_sync(key, '{"source":"test"}')
    cached = horizons._read_cache_sync(key, horizons._CACHE_TTL_SECONDS)
    assert cached is not None
    assert cached[0] == '{"source":"test"}'
    assert horizons._read_cache_sync("different-query", horizons._CACHE_TTL_SECONDS) is None
