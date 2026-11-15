# SELENIC — Lunar Landing Intelligence

**Version:** 0.9.0  
**NASA Space Apps Challenge 2026:** Lunar Landing Site Navigator  
**Tagline:** *Plan against the horizon.*

![SELENIC — Plan against the horizon](frontend/public/selenic-og.jpg)

SELENIC is an independent lunar south-polar exploration and decision-support prototype. It compares Sun and Earth observer ephemerides from JPL Horizons, then combines those time samples with a user-verified lunar digital elevation model (DEM) to estimate how local ridges and crater rims change visibility.

> **No fabricated mission data:** the app opens without an ephemeris result. A failed JPL request shows the error and leaves previous results intact. Synthetic preview curves have been removed from the user workflow; analyses require live or explicitly cached JPL Horizons results.

**Live demo:** no public deployment URL is bundled with this source release. The local Vite address is not a public demo link. See deployment notes below before sharing the project with judges.

## What it does

- Requests live apparent Sun/Earth azimuth and elevation for lunar surface observer coordinates from JPL Horizons.
- Compares geometric visibility with a terrain skyline derived from an uploaded, metadata-verified lunar GeoTIFF.
- Plots the DEM skyline together with Sun and Earth azimuth/elevation tracks.
- Computes finite-disc visibility fractions, sampled joint Sun-and-Earth visibility, longest continuous darkness, a best sampled joint window, rise/set markers, and possible Earth-on-Sun occultation samples.
- Supports analysis intervals from 6 hours up to 30 days, with a 2,000-sample request limit and a persistent SQLite cache for exact repeated queries.
- Exports ephemeris, terrain-profile provenance fields, and summary metrics in CSV metadata comments.
- Runs a backend time-stepped lunar electrical power-system (EPS) simulation driven by sampled Sun/Earth ephemerides: fixed-orientation PV array incidence, finite-disc/DEM solar obstruction, panel thermal state and temperature derating, MPPT/DC-bus losses, time-varying mission load schedules, battery charge/discharge efficiency and C-rate limits, reserve protection, unmet load, and thermal/power time series.

## Product areas

| Workspace | Purpose |
|---|---|
| Overview | Explains the south-polar horizon problem and provides the interactive reference globe. |
| Sites | Edit 2–5 study-point coordinates and inspect their positions on the reference globe. The defaults are illustrative study points, not official Artemis candidate sites. |
| Analyze | Select a UTC analysis start, duration and cadence; request JPL Horizons data; compare the local Sun/Earth sky. |
| Mission Planner | Scrub the ephemeris timeline; use the Horizon Flip, daily visibility scan and adjustable candidate ranking. Terrain-aware metrics require a verified DEM. |
| Simulate | Run SELENIC-LPS-1.0, a 5-minute time-step conceptual lunar EPS model with editable load, PV-array rating/orientation, battery capacity/reserve/C-rates, mission load schedule and optional DEM shading. Inspect battery SOC, DC-bus power balance, panel temperature, unmet demand and export the time series as CSV. |
| Terrain & Sources | Upload a verified lunar GeoTIFF, calculate azimuth-binned local horizon profiles and open trusted data portals. |

The guided tour is opt-in and takes five steps. It does not interrupt the first visit.

## Data sources and their roles

| Source | Use in SELENIC | Important distinction |
|---|---|---|
| [JPL Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html) | Live apparent Sun/Earth azimuth and elevation from a custom lunar observer | Ephemeris only; Horizons does not apply the local DEM skyline. |
| [NASA/JPL Moon Trek WMTS](https://trek.nasa.gov/moon/) | LRO WAC Global Mosaic v2 image tiles for the 3D reference globe | Imagery only; the smooth globe is not a height-displaced terrain model. |
| [LROC / Lunaserv](https://data.lroc.im-ldi.com/lroc/) | External lunar imagery and surface-context inspection | A map viewer is not a numeric elevation raster. |
| [LROC curated downloads](https://lroc.im-ldi.com/images/downloads) | Find WAC/GLD100 and polar topography products | Confirm the exact product label, projection, datum, units, resolution and coverage before use. |
| [PDS Lunar ODE](https://ode.rsl.wustl.edu/moon/) | Search and download LRO/LOLA products | Prefer suitable gridded LOLA GDR or LROC topography; LOLA RDR point observations are not a ready-made DEM. |

See [`docs/DATA_RESOURCES.md`](docs/DATA_RESOURCES.md) for product distinctions and a projection-preserving upload workflow.

## Scientific model and current limits

### Ephemeris

The FastAPI backend requests observer tables from JPL Horizons for Sun (`10`) and Earth (`399`) at a user-defined topocentric lunar observer (`301`) using apparent azimuth/elevation quantity `4`. Analysis starts are timezone-aware and normalized to UTC.

### Terrain and visibility

The terrain endpoint accepts a user-supplied GeoTIFF, checks for geospatial metadata and likely lunar scale, samples radial profiles by azimuth, and rejects directions with insufficient coverage. The `/api/visibility/summary` endpoint then compares sampled Sun/Earth directions to the terrain skyline and approximates each body's finite angular disc.

The current visibility model uses a 0.267° Sun angular radius and a nominal 0.95° Earth angular radius. The real Earth apparent radius varies with distance; the app labels this approximation. Joint hours integrate the product of the Sun and Earth visible-disc fractions as a geometric overlap proxy, not as certified communications availability or delivered solar power. The best joint window and event timestamps are cadence-dependent sampled estimates.

### What is not included

- No precomputed, provenance-verified DEM horizons or real Horizons snapshot are bundled in this release. The app does not claim terrain-aware results until a compatible DEM is uploaded. The daily scan only summarizes the user-selected analysis interval (up to 30 days), not a 6–12 month forecast.
- The default study-point coordinates are editable placeholders, not published Artemis landing-site recommendations.
- No independent comparison against a published LRO/LROC illumination product is implemented yet; therefore the Validation Lab remains future work.
- The mission simulation is now a time-stepped conceptual EPS model (SELENIC-LPS-1.0), not a hardware-validated or flight-qualified power-system model. It interpolates Horizons angles and integrates at a 5-minute step. It models direct lunar solar irradiance with a configurable distance assumption, fixed-tilt/fixed-azimuth PV incidence, finite-disc and optional DEM shadowing, PV temperature derating, a one-node transient panel heat balance, MPPT/DC-bus losses, time-varying assumed load profiles, and battery efficiency/C-rate/reserve constraints. It does not model PV I-V curves, electrochemical cell voltage/thermal/ageing, detailed multi-view thermal radiation or dust evolution. Earth visibility remains a geometric opportunity metric, not an RF link budget. See `docs/SCIENTIFIC_ASSUMPTIONS.md` for equations and limits.
- No slope/hazard score, full-year heat calendar, true polar-stereographic site map, antenna pointing model, thermal model or landing certification is provided.
- The radial terrain sampler is not full 3D ray tracing; narrow ridges can fall between samples.
- This is a research and education prototype, not NASA software, not endorsed by NASA, and not certified for mission operations.

Read [`docs/SCIENTIFIC_ASSUMPTIONS.md`](docs/SCIENTIFIC_ASSUMPTIONS.md) before interpreting results.

## Run locally

### 1. Backend

Python 3.10+ is recommended. The repository includes a local SQLite cache; its default file is created at `backend/data/horizons_cache.sqlite3` and can be redirected with `SELENIC_CACHE_DB`.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
pytest -q
uvicorn app.main:app --reload --port 8000
```

The backend health endpoint is `http://localhost:8000/api/health`; interactive API docs are at `http://localhost:8000/docs`.

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`. By default, Vite proxies `/api` to `http://127.0.0.1:8000`, so no localhost API URL is hard-coded into the production bundle. To host the API separately, create `frontend/.env` with `VITE_API_BASE_URL=https://your-api-host.example` and configure the backend `SELENIC_CORS_ORIGINS` to allow the frontend origin.

### 3. Production frontend build

```bash
cd frontend
npm run build
npm run preview
```

### 4. Containerized backend

```bash
docker build -t selenic-api ./backend
docker run --rm -p 8000:8000 -v selenic-cache:/var/lib/selenic -e SELENIC_CORS_ORIGINS=https://your-frontend.example selenic-api
```

The frontend is a static Vite site and can be deployed to a static host. Configure `VITE_API_BASE_URL` at build time if the API is hosted separately. This source archive does not include a live deployment URL or deployment credentials.

## API summary

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | API-process status and declared source/terrain modes. It does not call JPL. |
| `GET /api/diagnostics/horizons` | Runs a small outbound JPL test observation. |
| `POST /api/ephemeris` | Analyze one site. |
| `POST /api/compare` | Analyze 2–5 sites over a shared UTC interval. |
| `POST /api/terrain/profile` | Build a local DEM horizon profile for one site (single-site compatibility route). |
| `POST /api/terrain/profiles` | Upload one DEM once and build profiles for 2–5 sites. |
| `POST /api/visibility/summary` | Compute finite-disc terrain visibility and decision metrics from ephemeris points plus a horizon profile. |
| `POST /api/simulate` | Run the time-stepped lunar EPS simulation from ephemeris points, power-system inputs and an optional terrain skyline. |

`duration_hours` is limited to 6–720, and each request is limited to 2,000 samples. Exact-query Horizons responses are cached for 24 hours in SQLite. If JPL is unavailable, an exact matching result up to 30 days old may be returned with `is_cached=true` and an explanatory warning; the UI identifies cached results.

## Tests and verification

```bash
cd backend && pytest -q
cd ../frontend && npm run build
```

The v0.9 source package upgrades Simulate to the backend time-stepped SELENIC-LPS-1.0 lunar EPS model. The panel power chart includes solar generation, mission load, battery charging and battery discharge. Run `pytest -q` in `backend` and `npm install && npm run build` in `frontend` before deployment. Live JPL connectivity, NASA WMTS tile availability and browser behavior should be checked from the target network/environment.

## 90-second demo flow

1. **0–10 s:** “At the Moon’s south pole the Sun stays low. The horizon decides what a site can see.” Show the reference globe and editable study points.
2. **10–30 s:** choose a UTC interval of one or two weeks and run the live JPL comparison.
3. **30–50 s:** with a verified DEM already prepared, show the skyline with Sun and Earth tracks crossing behind ridges.
4. **50–65 s:** show the Mission Planner's terrain-adjusted visibility and candidate ranking.
5. **65–85 s:** open Simulate; run a preset, then point to battery SOC, power flow, panel temperature and any unmet energy.
6. **85–90 s:** state clearly that this is a transparent conceptual EPS model, not flight-hardware validation or mission certification.

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
