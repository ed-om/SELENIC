
from __future__ import annotations

import asyncio
import logging
import os
from datetime import timezone
from html import escape

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from pydantic import TypeAdapter, ValidationError

from .horizons import HorizonsError, analyze_site, diagnose_horizons
from .models import (
    AnalysisRequest,
    AnalysisResult,
    CompareRequest,
    MissionSimulationRequest,
    SiteInput,
    VisibilitySummaryRequest,
)
from .visibility import summarize_visibility
from .simulation import simulate_mission

logger = logging.getLogger("selenic.api")

app = FastAPI(
    title="SELENIC API",
    version="0.9.0",
    description=(
        "Lunar-site ephemeris, terrain-aware visibility, user-supplied lunar DEM "
        "profiles, and a time-stepped lunar EPS simulator."
    ),
)


# Production frontend and local development origins.
PRODUCTION_FRONTEND_ORIGIN = "https://selenic.vercel.app"

LOCAL_DEVELOPMENT_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)

# Additional origins can be supplied through Vercel environment variables.
configured_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("SELENIC_CORS_ORIGINS", "").split(",")
    if origin.strip()
]

allowed_origins = list(
    dict.fromkeys(
        [
            PRODUCTION_FRONTEND_ORIGIN,
            *LOCAL_DEVELOPMENT_ORIGINS,
            *configured_origins,
        ]
    )
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    max_age=600,
)


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def service_home() -> HTMLResponse:
    """A friendly landing page for people who open the API host directly."""
    frontend_url = os.getenv(
        "SELENIC_FRONTEND_URL", PRODUCTION_FRONTEND_ORIGIN
    )

    html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SELENIC API</title><style>
:root{color-scheme:light;font-family:Manrope,Inter,system-ui,sans-serif;color:#171717;background:#f7f7f5}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px}
main{width:min(680px,100%);padding:clamp(28px,6vw,56px);border:1px solid #e3e3df;border-radius:18px;background:#fff;box-shadow:0 18px 60px #0000000a}
.kicker{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#777}h1{font-size:clamp(36px,7vw,58px);line-height:1;margin:18px 0 12px;letter-spacing:-.06em}p{font-size:16px;line-height:1.7;color:#555}.links{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid #222;border-radius:8px;color:#fff;background:#191919;text-decoration:none;font-weight:650}a.secondary{color:#222;background:#fff;border-color:#ddd}.status{margin-top:25px;padding-top:18px;border-top:1px solid #eee;color:#777;font-size:13px}</style></head>
<body><main><span class="kicker">SELENIC · LUNAR LANDING INTELLIGENCE</span><h1>API service</h1>
<p>The SELENIC backend is running. The interactive application is served separately by the frontend development server.</p>
<div class="links"><a href="__FRONTEND_URL__">Open SELENIC frontend</a><a class="secondary" href="/docs">API documentation</a><a class="secondary" href="/api/health">Health status</a></div>
<div class="status">This is the API service root, not the application homepage. Keep the frontend and backend terminals running while developing locally.</div>
</main></body></html>"""

    return HTMLResponse(
        content=html.replace(
            "__FRONTEND_URL__", escape(frontend_url, quote=True)
        )
    )


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "SELENIC API",
        "ephemeris_source": "JPL Horizons API",
        "ephemeris_model_note": "Horizons uses JPL DE441 for the Sun, Moon, and Earth.",
        "jpl_connectivity": "not_checked; call /api/diagnostics/horizons for a live test",
        "terrain_mask_applied_to_ephemeris": False,
        "terrain_profile_service": "available",
        "mission_simulation": "SELENIC-LPS-1.0; time-stepped panel thermal and battery EPS model",
        "terrain_input": "user-supplied lunar GeoTIFF; provenance and vertical datum must be verified",
    }


@app.get("/api/diagnostics/horizons")
async def horizons_diagnostics() -> dict[str, object]:
    """Check outbound reachability and a small real observer query against JPL."""
    try:
        return await diagnose_horizons()
    except HorizonsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/ephemeris", response_model=AnalysisResult)
async def ephemeris(payload: AnalysisRequest) -> AnalysisResult:
    try:
        return await analyze_site(payload)
    except HorizonsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/compare")
async def compare(payload: CompareRequest) -> dict[str, object]:
    shared_start = payload.start_utc

    if shared_start.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail="start_utc must include a timezone",
        )

    shared_start = shared_start.astimezone(timezone.utc)

    requests = [
        AnalysisRequest(
            site=site,
            start_utc=shared_start,
            duration_hours=payload.duration_hours,
            step_minutes=payload.step_minutes,
        )
        for site in payload.sites
    ]

    try:
        results = await asyncio.gather(
            *(analyze_site(item) for item in requests)
        )
    except HorizonsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "results": [
            result.model_dump(mode="json")
            for result in results
        ]
    }


@app.post("/api/terrain/profiles")
async def terrain_profiles(
    file: UploadFile = File(...),
    sites_json: str = Form(...),
    max_distance_km: float = Form(20.0),
    azimuth_step_deg: int = Form(5),
    elevation_unit: str = Form("m"),
    observer_height_m: float = Form(1.5),
    vertical_datum_confirmed: bool = Form(False),
) -> dict[str, object]:
    """Upload one DEM once and create profiles for 2–5 sites."""

    # Load native geospatial libraries only when terrain processing is requested.
    try:
        from .terrain import TerrainDataError, build_terrain_profile
    except Exception as exc:
        logger.exception("Terrain dependencies could not be loaded")
        raise HTTPException(
            status_code=503,
            detail=(
                "Terrain processing is unavailable in this deployment. "
                "Check NumPy, Rasterio/GDAL, and PyProj dependencies."
            ),
        ) from exc

    try:
        sites = TypeAdapter(list[SiteInput]).validate_json(sites_json)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail="sites_json must be a JSON array of valid lunar site objects",
        ) from exc

    if not 2 <= len(sites) <= 5:
        raise HTTPException(
            status_code=422,
            detail="Provide between two and five sites",
        )

    if len({site.id for site in sites}) != len(sites):
        raise HTTPException(
            status_code=422,
            detail="Every site must have a unique id",
        )

    try:
        content = await file.read(100 * 1024 * 1024 + 1)
        filename = file.filename or "uploaded-dem.tif"

        profiles = [
            build_terrain_profile(
                content,
                filename,
                site,
                max_distance_km=max_distance_km,
                azimuth_step_deg=azimuth_step_deg,
                elevation_unit=elevation_unit,
                observer_height_m=observer_height_m,
                vertical_datum_confirmed=vertical_datum_confirmed,
            )
            for site in sites
        ]

        return {"profiles": profiles}

    except TerrainDataError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    finally:
        await file.close()


@app.post("/api/visibility/summary")
async def visibility_summary(
    payload: VisibilitySummaryRequest,
) -> dict[str, object]:
    """Return finite-disc and terrain-aware sampled visibility metrics."""
    try:
        return summarize_visibility(payload.points, payload.profile)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/simulate")
def mission_simulation(
    payload: MissionSimulationRequest,
) -> dict[str, object]:
    """Run the lunar surface solar-array and battery-system simulation."""
    try:
        return simulate_mission(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/terrain/profile")
async def terrain_profile(
    file: UploadFile = File(...),
    site_json: str = Form(...),
    max_distance_km: float = Form(20.0),
    azimuth_step_deg: int = Form(5),
    elevation_unit: str = Form("m"),
    observer_height_m: float = Form(1.5),
    vertical_datum_confirmed: bool = Form(False),
) -> dict[str, object]:
    """Create a local horizon profile from a supplied lunar DEM."""

    try:
        from .terrain import TerrainDataError, build_terrain_profile
    except Exception as exc:
        logger.exception("Terrain dependencies could not be loaded")
        raise HTTPException(
            status_code=503,
            detail=(
                "Terrain processing is unavailable in this deployment. "
                "Check NumPy, Rasterio/GDAL, and PyProj dependencies."
            ),
        ) from exc

    try:
        site = SiteInput.model_validate_json(site_json)

        # Enforce the upload limit before buffering the entire file.
        content = await file.read(100 * 1024 * 1024 + 1)

        return build_terrain_profile(
            content,
            file.filename or "uploaded-dem.tif",
            site,
            max_distance_km=max_distance_km,
            azimuth_step_deg=azimuth_step_deg,
            elevation_unit=elevation_unit,
            observer_height_m=observer_height_m,
            vertical_datum_confirmed=vertical_datum_confirmed,
        )

    except TerrainDataError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid site metadata: {exc}",
        ) from exc

    finally:
        await file.close()
