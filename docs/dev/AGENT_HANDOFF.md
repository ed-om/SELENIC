# SELENIC — Lunar Landing Intelligence
## Coding-agent handoff / current product specification

**Version:** 0.9.0  
**NASA Space Apps Challenge 2026:** Lunar Landing Site Navigator  
**Team identity:** SELENIC  
**Product:** SELENIC — Lunar Landing Intelligence  
**Developer credit:** Designed & built by Edom  
**Build constraint:** One student developer; prioritize correctness, clarity, accessible design, and a complete demo over feature count.

## Product goal

Build an intuitive tool that lets mission planners, educators, students, and the public compare lunar south-pole candidate sites and landing dates. The core job is to make the Sun and Earth positions relative to a local horizon easy to understand, and to communicate the difference between geometric visibility and terrain-obstructed visibility.

SELENIC is an independent educational/research prototype, not NASA software, not endorsed by NASA, and not certified for mission operations.

## Design direction

- White/off-white dominant application shell with black, charcoal, and neutral grey only. No neon, saturated highlight colours, or cyberpunk styling.
- Typography: Manrope for body and controls; Space Grotesk for display headings; IBM Plex Mono for technical metadata and coordinates. Provide system-font fallbacks.
- Readable body text starts at 15–16 px; avoid microcopy below 12 px. Form controls and buttons should be at least 44–48 px high.
- Use generous vertical spacing and one primary task per workspace. Avoid a dense one-screen dashboard.
- The globe may sit on a near-black stage to create a sense of space; the rest of the app stays light.
- Use subtle, purposeful animations and respect `prefers-reduced-motion`.
- The tour must not dim or blur the page. It scrolls to the relevant section, outlines it, draws a directional arrow, and places a floating callout near it.
- Footer credit: “Designed & built by Edom” plus “Independent project · Not affiliated with NASA”. This is an authorship credit, not an endorsement claim.

## Current workspaces

1. **Overview** — simple introduction and links to the three primary workflows.
2. **Site Explorer** — edit two candidate Moon-fixed coordinates and inspect markers on an interactive 3D reference globe.
3. **Compare Sites** — choose a UTC analysis interval, run JPL Horizons, compare Sun/Earth positions, inspect horizon diagrams, and export CSV.
4. **Mission Planner** — inspect time-series elevation plots, use the Horizon Flip, daily visibility scan and adjustable candidate ranking.
5. **Terrain & Sources** — upload a verified lunar DEM, calculate local horizon profiles, and open NASA/JPL and PDS data sources.
6. **Terrain Analysis** — upload a user-provided, metadata-verified lunar GeoTIFF and calculate sampled local obstruction profiles.
The separate Data Library and Field Guide tabs are no longer in primary navigation; their essential data-source links are consolidated into Terrain & Sources.

## Frontend

- React 18, TypeScript, Vite, Three.js, `lucide-react`, CSS.
- `VITE_API_BASE_URL` sets the FastAPI origin; defaults to same-origin `/api`; Vite proxies `/api` to `127.0.0.1:8000` during development.
- The Three.js globe loads the NASA/JPL Solar System Treks LRO WAC Global Mosaic v2 WMTS tiles and applies them as an image texture. If cross-origin requests fail, the app uses a locally generated monochrome fallback and must show the fallback status.
- The WAC image texture is not topography. The sphere currently has smooth geometry; do not describe it as a LOLA height-displaced mesh. Markers are positioned using entered latitude and east-positive longitude.
- A direct external link opens the full NASA Moon Trek viewer for advanced 3D and data exploration.
- Tour is a four-step opt-in walkthrough; it never opens automatically, uses `data-tour-target` anchors, scrolls the page to the active target, draws an outline and arrow, and does not dim or blur the rest of the application.
- CSV must retain timestamps, coordinate metadata, source/live/demo status, horizon model, and any terrain profile diagnostics.

## Backend

- Python + FastAPI.
- `GET /` returns a compact HTML service landing page linking to the frontend, `/docs`, and `/api/health`.
- `GET /favicon.ico` returns HTTP 204 to avoid browser favicon 404 noise.
- `GET /api/health` reports service state and declared calculation/data modes.
- `POST /api/compare` accepts two to five sites, a timezone-aware UTC start, duration up to 720 hours, and sampling interval, subject to a 2,000-row limit; it requests Sun and Earth ephemerides for each submitted site.
- `POST /api/ephemeris` handles a single site.
- `POST /api/terrain/profiles` accepts one user-provided GeoTIFF for 2–5 sites and returns per-site azimuth DEM obstruction estimates. `POST /api/terrain/profile` remains as a single-site compatibility route.
- `POST /api/visibility/summary` accepts sampled ephemeris points plus a verified skyline profile and returns finite-disc visibility, joint-window, darkness, events, and possible eclipse metrics.

## Ephemeris calculation

The Horizons integration requests:
- Sun: object ID `10`.
- Earth: object ID `399`.
- Moon observer: body ID `301`, with user-defined topocentric lunar coordinates.
- Observer table quantity `4`: apparent azimuth/elevation.

The frontend starts with no ephemeris data. A failed JPL request must keep the error visible and preserve any prior result; never swap to synthetic data automatically. Synthetic preview curves are removed from the user workflow; only live or explicitly cached Horizons results are presented as analysis.

## Terrain processing contract

`POST /api/terrain/profile` form fields:
- `file`: lunar DEM GeoTIFF, `.tif` or `.tiff`.
- `site_json`: `SiteInput` JSON.
- `max_distance_km`: 1–100.
- `azimuth_step_deg`: 2, 5, 10, or 15.
- `elevation_unit`: `m` or `km`.
- `observer_height_m`: 0–100.
- `vertical_datum_confirmed`: explicit user metadata attestation.

Processor requirements:
- Enforce the 100 MiB upload limit before fully buffering.
- Require a raster CRS and metadata confirmation.
- Reject recognized Earth-sized coordinate reference systems.
- Do not relabel terrestrial CRS values as lunar CRS.
- Do not treat missing data as open sky.
- Require the minimum valid sample coverage threshold for each azimuth ray.
- Return product filename, CRS, raster dimensions, sample coverage, parameters, warnings, and profile bins.
- Terrain-adjusted visibility is computed by the separate `/api/visibility/summary` endpoint from the uploaded profile and time-series samples; it is not applied inside the Horizons service.

## Data sources and attribution

- **JPL Horizons:** live Sun/Earth ephemeris. https://ssd-api.jpl.nasa.gov/doc/horizons.html
- **JPL Horizons request endpoint:** `https://ssd.jpl.nasa.gov/api/horizons.api` (the official GET endpoint host is `ssd.jpl.nasa.gov`).
- **NASA Moon Trek:** https://trek.nasa.gov/moon/
- **NASA/JPL Solar System Treks WMTS docs:** https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon
- **LRO WAC Mosaic Global 303ppd v02:** image texture loaded from the Moon Trek WMTS. It is not an elevation grid.
- **LROC:** https://lroc.im-ldi.com/ and https://data.lroc.im-ldi.com/lroc/ for imagery, shaded relief, and curated products.
- **PDS Lunar ODE:** https://ode.rsl.wustl.edu/moon/ for LOLA/LRO product discovery and downloads.

For every actual DEM used in a scientific result or submission, record its exact product ID, label, version, access date, map projection, longitude convention, elevation units, vertical datum, pixel spacing, and no-data value. Prefer gridded LOLA GDR or an appropriate LROC polar DEM. LOLA RDR is point-altimetry data, not a ready-made gridded DEM.

## Local development

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
uvicorn app.main:app --reload --port 8000
```

Frontend, in another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`. The backend landing page is at `http://localhost:8000/`; API docs are at `http://localhost:8000/docs`.

Production frontend:

```bash
cd frontend
npm run build
npm run preview
```

## Verification status at v0.7 packaging

- Backend automated tests: 27 passed, including root, favicon, health, single/multi-site terrain uploads, JPL error-detail, visibility-summary, cache, and endpoint-regression checks.
- TypeScript/TSX syntax parsing: passed for all frontend source files.
- ZIP archive integrity: checked during packaging.
- Full Vite production build: not verified in the packaging environment because npm dependency installation timed out in the packaging environment; npm packages were not present locally.
- Live JPL Horizons and NASA WMTS requests: not runtime-verified in the packaging environment due external DNS/network restrictions. Use visible fallback/status labels and verify in a normal browser connection.

## Critical scientific limitations

- NASA WAC imagery is texture only; sphere geometry is not elevation-displaced.
- The full Moon Trek portal offers richer 3D globe and analysis capabilities; SELENIC opens it as an external link rather than embedding it or claiming full feature parity.
- The terrain processor requires manual user download/verification/upload of a suitable lunar DEM. It does not fetch ODE data automatically.
- Terrain profiles are radial sampled obstruction estimates, not full ray tracing or mission-grade horizon certification.
- Geometric visibility uses apparent elevation relative to 0°. The terrain profile can adjust the horizon estimate.
- Solar elevation is not electrical power or irradiance.
- Earth visibility above terrain is not a full radio-frequency link budget.
- No landing safety, thermal, dust, descent, or equipment performance certification is modeled.

## Final quality bar

The product must make the official challenge task clear within one minute: choose two lunar candidate sites, choose a UTC time interval, compare Sun and Earth positions, inspect local horizon assumptions, and understand the limits of each result. Prefer fewer well-tested capabilities over a long list of non-functional controls.


## v0.5 reliability and onboarding changes (carried forward)

- Replaced automatic onboarding with a four-step tour that opens only when the user selects Guided tour.
- Tour callouts remain undimmed, show a visible section outline and directional arrow, retry locating the target during route transitions, and provide a centered fallback callout if a target cannot be found.
- Removed the Student / Curious Explorer / Scientist explanation-level switch; the Field Guide now uses one concise shared explanation set.
- Removed the embedded LROC viewer iframe. The Data Library uses Moon Trek WMTS image-tile previews and opens the LROC / Moon Trek viewers in a new tab, avoiding third-party Content Security Policy frame restrictions.
- Added `/api/diagnostics/horizons`, a small real Sun query to test JPL connectivity separately from backend health. `/api/health` deliberately reports JPL connectivity as not checked until that endpoint is called.
- Horizons HTTP error bodies are surfaced in API errors, rather than reducing failures to `HTTPStatusError`. Requests are throttled with a process-wide semaphore and transient 429/5xx/network failures are retried.
- Increased browser request timeouts to allow the server retry window to complete.
- Added API root and favicon route tests.
- Removed duplicate footer markup.

### v0.5 verification limits

Backend unit tests and route checks are run from `backend/`. Frontend TSX syntax is checked independently. A full Vite production build still requires a successful `npm install` on a machine with registry access. No live JPL observation can be claimed unless `/api/diagnostics/horizons` returns `status: ok` on the user's machine.


### v0.5 reliability corrections bundled in the release ZIP

- Confirmed the official request endpoint remains `https://ssd.jpl.nasa.gov/api/horizons.api`. The API reference document is hosted on `ssd-api.jpl.nasa.gov`, which is not the JSON request endpoint. Added an endpoint regression test.

- Kept the walkthrough strictly opt-in; tour completion is not persisted in browser storage.
- Hardened the two-row navigation grid against legacy responsive declarations that could compress the brand/actions/navigation into an uneven header.
- Removed stale iframe-specific CSS; external LROC viewers remain open-in-new-tab only.


## v0.7 changes

- Start with an empty ephemeris state; JPL failures do not replace prior results with mock data. Synthetic preview is no longer offered in the user workflow.
- Support up to 720-hour windows subject to a 2,000-sample row cap; the API comparison model accepts 2–5 sites.
- Cache exact Horizons requests in SQLite for 24 hours and allow explicitly marked exact-query stale-cache fallback for up to 30 days.
- Add `/api/visibility/summary` for finite-disc terrain visibility, joint Sun/Earth hours, longest darkness, sampled best joint window, rise/set markers and possible Earth-on-Sun occultation samples. Occultation flags require both discs to be at least partly visible above the local skyline.
- Add a terrain skyline/Sun/Earth track plot and semantic track colours. Add Open Graph metadata, a compressed social-preview image and a favicon.
- Add one-upload multi-site terrain processing (`/api/terrain/profiles`) for 2–5 locations. Default frontend API requests to same-origin `/api` and configure Vite development proxying. Add backend Dockerfile.
- Public data documentation contains NASA/JPL and PDS resources only; there are no precomputed DEM horizons or real Horizons snapshots bundled. The API accepts 2–5 sites, while the current frontend workflow still presents two editable study points.


## v0.7 implementation notes

- Candidate editor supports 2–5 locations, matching the backend comparison request bounds.
- Horizon Flip contrasts flat geometric visibility with terrain-adjusted sampled hours when a DEM profile is available.
- Daily heatmap summarizes only the selected interval (maximum 30 days); do not describe it as a six-month or annual forecast.
- Ranking is a relative decision aid using Sun, Earth and darkness metrics; mission presets change weights only. It does not calculate slope, roughness, power or RF performance.
- Independent published illumination validation, precomputed verified terrain presets, long-range ephemeris scan and mission-system simulation remain future work.
- Verification in this packaging environment: 27 backend tests pass; all six frontend TS/TSX source files transpile without syntax errors. npm dependency installation timed out, so Vite production build and browser interaction checks remain unverified.


## v0.8 implementation notes

- Mission Planner runtime crash: `Map` from `lucide-react` was imported into the module scope under the same identifier as the native JavaScript `Map` constructor. The daily visibility heatmap called `new Map()` and attempted to instantiate a React `forward_ref` component. Import the icon as `MapIcon`; keep native `Map` available for collections.
- The Simulate workspace is implemented in `frontend/src/simulation.ts` and in `App.tsx`. The model integrates a simple load/solar/battery balance over adjacent ephemeris samples. It optionally applies the selected site's DEM horizon. All mission profile presets are illustrative assumptions and must not be described as real vehicle or habitat specifications.
- The simulation assumes a horizontal array, a rated output at normal incidence, constant load, ideal battery energy storage and aggregate efficiency. It does not model thermal, degradation, dust, charge/discharge rate, detailed photovoltaic response, antenna link budget or certification.


## v0.9 implementation notes

- `backend/app/simulation.py` implements the SELENIC-LPS-1.0 time-stepped lunar electrical power system model.
- `POST /api/simulate` accepts the selected JPL Horizons series and optional azimuth-binned DEM skyline.
- The model returns DC-bus solar output, load, battery charge/discharge, SOC, panel temperature, unmet load and finite-disc Sun/Earth visibility.
- The source package is a conceptual research model, not mission-certified software. See `docs/SCIENTIFIC_ASSUMPTIONS.md` for equations and assumptions.
