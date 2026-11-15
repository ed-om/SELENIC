# SELENIC v0.9 — verification checklist

## Backend

- [ ] `cd backend && pytest -q` passes.
- [ ] `GET /api/health` reports API status without making a JPL request.
- [ ] `GET /api/diagnostics/horizons` makes a live test observation and surfaces JPL errors.
- [ ] `POST /api/compare` accepts 2–5 sites and validates a timezone-aware UTC start.
- [ ] Durations from 6 to 720 hours are accepted when the request contains no more than 2,000 rows.
- [ ] A 720-hour request at 15-minute cadence is rejected; 30-minute cadence is accepted.
- [ ] Repeating an exact request returns the cached JPL result and sets `is_cached=true`.
- [ ] With JPL unavailable, an exact request in the allowed stale period returns a cache warning and `is_cached=true`; no unrelated site/date cache is used.
- [ ] `POST /api/terrain/profile` rejects missing/insufficient DEM coverage rather than treating missing data as open sky.
- [ ] `POST /api/terrain/profiles` accepts one upload and returns a separate profile for each of 2–5 sites.
- [ ] `POST /api/visibility/summary` evaluates finite-disc Sun/Earth visibility against the supplied skyline, calculates joint visibility/darkness metrics, and emits sampled events/eclipses.
- [ ] Earth angular radius and all sampled-model limitations are present in visibility output.
- [ ] `docker build -t selenic-api ./backend` succeeds on a network-enabled Docker host.

## Frontend

- [ ] Run `npm install && npm run build` from `frontend/`.
- [ ] First visit opens with no invented ephemeris data and no auto-starting tour.
- [ ] Guided tour opens only after the user selects the Guided tour control and contains four steps.
- [ ] API state shows online/offline without using a "Preview mode" label as an API health indicator.
- [ ] A failed JPL request leaves previous results unchanged and displays the error.
- [ ] Synthetic preview data are not offered in the user workflow.
- [ ] Analysis controls offer up to 30 days and prevent sample counts above 2,000.
- [ ] Cached JPL results are labelled as cached.
- [ ] Terrain upload displays coverage and source metadata for each site.
- [ ] Mission Windows shows the terrain skyline with separately labelled Sun/Earth tracks when a DEM profile and live ephemerides are available.
- [ ] Decision metrics show finite-disc Sun/Earth visibility, joint hours, longest darkness, best sampled joint interval, and possible Earth-on-Sun eclipse samples when the backend summary is available.
- [ ] CSV starts with source/cache/terrain/decision metadata comments and includes the sample rows.
- [ ] Mobile width (390 px) has no horizontal page overflow.

## Sources and presentation

- [ ] Verify the exact official challenge statement and judging rubric; this repository does not embed them.
- [ ] Verify all live JPL and NASA WMTS calls on the intended presentation network.
- [ ] Deploy frontend and backend; set `VITE_API_BASE_URL` and `SELENIC_CORS_ORIGINS`; verify from a clean browser profile.
- [ ] Add a working public URL, presentation screenshots and a 90-second recording before submission.
- [ ] If real DEM data are used, record product ID, release, access date, CRS, datum, units, spacing and no-data value.
- [ ] Do not claim the bundled default study points are official Artemis sites or that the app includes precomputed real terrain horizons.
- [ ] Do not claim NASA endorsement, certified mission accuracy, RF performance, power output or slope/hazard assessment.
- [ ] Keep Apache-2.0 license and relevant source/product attribution.


## v0.7 mission decision UI checks

- [ ] Sites workspace supports 2–5 editable candidates; add/remove resets stale results.
- [ ] Horizon Flip shows geometric values without a DEM and terrain-adjusted values only after a profile is loaded.
- [ ] Daily visibility scan is clearly scoped to the selected analysis interval (maximum 30 days).
- [ ] Site ranking updates when the three criterion weights or mission-profile presets change.
- [ ] Ranking labels distinguish terrain-adjusted inputs from geometric-only inputs.
- [ ] Main navigation contains Overview, Sites, Analyze, Mission Planner, and Terrain & Sources.
- [ ] Mobile layout has no horizontal overflow in the heatmap or weight controls.
- [ ] No synthetic preview data is loaded or offered in the primary user workflow.
- [ ] Validation against an independent published illumination product remains explicitly marked as not implemented.


## v0.8 regression and simulation checks

- [ ] Run a successful live comparison with at least two sites, then open Mission Planner; the daily heatmap renders without a React crash.
- [ ] Confirm the frontend uses the native JavaScript `Map` constructor for daily heatmap grouping and the Lucide icon is referenced as `MapIcon` only.
- [ ] Open Simulate after a successful comparison; confirm the selected site defaults to the first result.
- [ ] Change each mission preset and confirm the assumed load, array, battery, initial charge and efficiency values update.
- [ ] Change user inputs and confirm the simulation metrics and battery chart recalculate.
- [ ] Verify the optional DEM toggle is disabled when no profile exists and applies the selected site's terrain profile when available.
- [ ] Change site coordinates or analysis interval after comparison; confirm simulation is blocked until a fresh comparison is run.
- [ ] Confirm synthetic/demo results are not accepted as mission simulation inputs.
- [ ] Export simulation CSV and verify it includes the scenario assumptions and sampled battery/power/Earth-visibility series.
- [ ] Confirm the UI labels assumptions and model limitations; do not present simulation as certified power-system or communications performance.


## v0.9 time-stepped lunar EPS simulation checks

- [ ] `POST /api/simulate` accepts real ephemeris samples and returns `model_id=SELENIC-LPS-1.0`.
- [ ] Simulation rejects demo ephemeris in the frontend, non-monotonic timestamps and source gaps over six hours.
- [ ] The backend integrates panel temperature and battery state at the configured internal time step.
- [ ] Solar array incidence responds to array tilt and azimuth.
- [ ] Solar array output responds to the temperature coefficient and panel temperature.
- [ ] A local DEM skyline reduces the direct solar beam when it blocks the Sun; absent DEM uses only the geometric horizon.
- [ ] MPPT/DC bus losses, battery charge/discharge efficiencies, charge/discharge C-rate limits and minimum SOC reserve affect the result.
- [ ] Unmet energy appears when generation plus allowed battery discharge cannot serve the load.
- [ ] Crew-cycle and peak-operations load schedules change power demand over elapsed mission hours and are clearly identified as assumed schedules.
- [ ] Frontend requires an explicit Run simulation action and displays SOC, power balance, panel temperature, unmet energy and model notes.
- [ ] Simulation CSV includes scenario inputs and time-series values.
- [ ] No claim is made that software tests validate the model against flight hardware or certify a mission design.

- [ ] First plotted solar-power sample uses the initial ephemeris rather than an artificial zero.
- [ ] Power chart and CSV separately report battery charging and battery discharging at the DC bus.
- [ ] Battery charge C-rate and charge efficiency each change the battery trajectory as expected.
- [ ] Low-angle south-polar array presets use a steep tilt and initialize azimuth from the first near-visible Sun sample; user can override both.
