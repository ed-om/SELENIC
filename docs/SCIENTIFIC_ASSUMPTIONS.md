# Scientific model, data provenance, and limitations

This document describes the current SELENIC prototype. It distinguishes source data, calculated quantities, user-supplied terrain, and visual aids.

## 1. Live ephemeris: JPL Horizons

The backend requests observer ephemerides from the JPL Horizons API for:

- Sun, object ID `10`.
- Earth, object ID `399`.
- Observer: a user-defined topocentric site on the Moon, body ID `301`, through a custom lunar coordinate observer.
- Observer-table quantity `4`: apparent azimuth and elevation.

The frontend marks results as **Live · JPL Horizons** or **JPL Horizons · Cache** only when the backend returns two non-demo site results. It starts empty and never substitutes synthetic curves after an error. An illustrative preview can be loaded only by an explicit user action and is never presented as NASA data.

References:

- https://ssd-api.jpl.nasa.gov/doc/horizons.html
- https://ssd.jpl.nasa.gov/horizons/manual.html

## 2. Geometric visibility

For each sampled timestamp the backend records the Sun's and Earth's apparent azimuth/elevation relative to the observer's reference horizon. The app classifies a body as above the geometric horizon when elevation is at least 0 degrees. Approximate time-above-horizon duration is calculated from adjacent samples with linear interpolation across a threshold crossing.

The solar elevation index is a geometric exposure proxy. It is not itself irradiance, watts, solar-array output, battery state, or a power-system prediction. The separate Simulate workspace performs a simplified, user-assumption-driven scenario; its limits are documented below.

Earth above a horizon is a first-order line-of-sight indicator. It does not establish antenna pointing feasibility, RF link margin, data rate, or a complete communications window.

## 3. Terrain data sources and how they are used

### LROC WMS browser

The frontend links to the LROC WMS browser in a separate tab; it does not embed the external viewer:

https://data.lroc.im-ldi.com/lroc/

The viewer exposes LROC layers such as WAC global imagery, normalized reflectance, color shaded relief, and illumination/topography-related layers. It is used as an external map-inspection and visual-reference tool. The external WMS display is not automatically ingested into SELENIC's 3D globe or terrain-processing pipeline.

### LROC curated polar topography

The LROC curated-download catalogue lists the WAC GLD100 topography product with LOLA 30 m DTM coverage poleward of 75° latitude:

https://lroc.im-ldi.com/images/downloads

This product family is multi-gigabyte. Prefer a regional subset/tile around the study sites and requested profile radius. Confirm the exact product release, projection, vertical reference, units, no-data value, and coverage before processing.

### PDS Lunar Orbital Data Explorer (ODE)

PDS Lunar ODE supports searching and downloading lunar orbital products, including LRO/LOLA datasets:

https://ode.rsl.wustl.edu/moon/

A crucial product distinction:

- **LOLA RDR (Reduced Data Record):** individual altimetry observations. The RDR query tool is useful for finding point observations or checking data availability; RDR is not itself a gridded elevation DEM.
- **LOLA GDR (Gridded Data Record):** gridded products assembled from altimetry observations. A suitable map-projected GDR elevation grid is a more natural starting point for a terrain profile.

ODE's documentation recommends reviewing available GDR products for many needs before relying on point-level RDR queries. Consult product labels and documentation before downloading.

References:

- https://ode.rsl.wustl.edu/moon/tools.aspx
- https://ode.rsl.wustl.edu/moon/

## 4. Terrain profile endpoint

`POST /api/terrain/profile` accepts a user-supplied `.tif` or `.tiff` lunar DEM GeoTIFF. The request includes site metadata and profile options. The backend currently:

1. Limits the upload to 100 MiB.
2. Requires the user to affirm that the product's lunar coordinate reference, elevation units, and vertical datum have been checked.
3. Requires a raster CRS and at least a 3 × 3 raster.
4. Uses the CRS ellipsoid if available to reject obviously Earth-sized coordinate reference systems. When a projected CRS does not expose a geodetic CRS, it falls back to a 1,737,400 m mean-radius lunar sphere; this fallback is not proof of correct product metadata.
5. Transforms the entered Moon-fixed longitude/latitude into raster coordinates. For geographic lunar GeoTIFFs using 0–360° east longitude, it can adjust negative longitude coordinates to the 0–360 convention when raster bounds indicate that convention.
6. Samples radial terrain rays over azimuth, with geodesic forward coordinates and a spherical lunar-curvature correction.
7. Calculates the maximum apparent terrain obstruction elevation along each ray.
8. Rejects a profile if any azimuth has less than 70% valid DEM sample coverage. Missing directions must not be interpreted as unobstructed sky.
9. Returns raster metadata, filename, profile parameters, coverage, and warnings.

The backend `POST /api/visibility/summary` interpolates between azimuth bins and compares the Sun/Earth apparent elevation with the terrain horizon at each body's azimuth. It models finite angular discs, integrates visible fractions, estimates joint Sun-and-Earth visibility, and flags possible Earth-on-Sun occultation samples. These are sampled prototype estimates, not certified line-of-sight calculations.

### Important processing caveats

- The checkbox is a user attestation, not independent validation of the DEM's datum or provenance.
- A GeoTIFF that has merely been relabeled with a lunar CRS is invalid. It must preserve the actual source projection and coordinate conventions.
- Product elevation units and vertical datum must be checked in source product labels. A DEM with unknown vertical datum must not be processed as trusted terrain.
- If a dataset is distributed as ISIS cube, IMG plus detached label, or another format, convert it to GeoTIFF with a toolchain that preserves lunar projection information. Do not assign an Earth EPSG code.
- One uploaded file must cover both sites and the full requested profile radius. Each azimuth ray needs at least 70% coverage.
- Radial sampling is discrete; narrow ridges or small-scale features can fall between samples.
- The implementation uses a spherical mean lunar radius of 1,737,400 m and a simple curvature correction.
- The implementation is not a full ray-traced DEM horizon engine; it does not independently validate against LOLA control points or a trusted terrain-horizon product.
- A real terrain mask is not applied inside the JPL Horizons endpoint. The separate visibility-summary endpoint combines the returned ephemeris samples with the uploaded terrain profile. The Sun angular radius is approximated as 0.267°; Earth uses a nominal 0.95° radius that varies with Earth-Moon distance.

## 5. 3D Moon reference globe and NASA Moon Trek imagery

The Three.js globe uses the NASA/JPL Solar System Treks WMTS service to request the **LRO WAC Mosaic Global 303ppd v02** image tiles. The frontend assembles the low-zoom equirectangular tiles into a texture for the interactive sphere. It does not scrape the Moon Trek application. The full Moon Trek portal is also linked from the globe for deeper exploration.

The texture is genuine lunar imagery, but the current Three.js sphere geometry is smooth. The WAC mosaic is **not** a height field and does not displace the mesh. Site markers are positioned from the user's entered latitude and east-positive longitude on the spherical reference globe. They are not draped onto locally accurate terrain.

If the NASA tile service is unavailable, the globe falls back to a locally generated monochrome reference texture and reports that fallback state in the UI. The app must not label fallback imagery as NASA data.

Do not use the globe surface to infer slope, hazards, local terrain horizon, or site elevation. Those require an appropriate numeric lunar DEM and a validated terrain workflow. Moon Trek itself provides richer 3D Globe and analysis features; SELENIC links to that portal rather than claiming to reproduce all of its analysis tools.

References:

- NASA Moon Trek: https://trek.nasa.gov/moon/
- NASA/JPL Trek WMTS documentation: https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon
- LRO WAC Mosaic Global 303ppd v02, served through the Moon Trek tile service.
- Optional future 3D topographic mesh reference: NASA GSFC SVS, https://svs.gsfc.nasa.gov/14959/. The small 8k topographic GLB is 77.7 MB and is not loaded by this version.

## 6. Data output and CSV

The CSV includes ephemeris source/status and geometric quantities. When a terrain profile has been uploaded, the CSV also includes the profile horizon angle sampled at the nearest azimuth bin, clear-of-profile booleans, and DEM filename. This is a nearest-bin diagnostic, not continuous line-of-sight proof.

## 7. Time-stepped lunar electrical power-system simulation (SELENIC-LPS-1.0)

The Simulate workspace calls `POST /api/simulate`. Unlike the previous v0.8 interval calculator, the v0.9 backend maintains thermal and battery states and integrates them at a fixed internal time step (default 300 seconds). It linearly interpolates the selected site's JPL Horizons Sun/Earth azimuth and elevation between samples. Ephemeris intervals must be strictly increasing and no more than six hours apart. The UI uses live/cached JPL results only; demo data are rejected.

### 7.1 Reference irradiance constant

The UI/API default uses 1,361 W/m² as a nominal total solar irradiance reference at 1 AU. NASA Goddard notes that TSI varies over time and gives 1,361.6 ± 0.3 W/m² for the 2019 solar minimum; this SELENIC input is a rounded scenario baseline, not a live solar-activity observation. The configured distance-to-Sun input scales irradiance by inverse-square distance.

Reference: https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science

### 7.2 Direct solar input and array orientation

The incident direct-beam flux is modeled as:

`G_POA = S_0 / d_AU² × max(0, n_panel · s_sun) × f_visible`

where `S_0` defaults to 1,361 W/m², `d_AU` defaults to 1.0 AU, the dot product is calculated from panel tilt/azimuth and the interpolated Sun direction, and `f_visible` is a finite-Sun-disc visibility fraction relative to the geometric horizon or supplied DEM horizon. No atmosphere is applied. The model does not infer local slope from the smooth globe or from imagery. If no DEM profile is selected, the horizon is 0°.

Array rated output is entered in kWp at 1,000 W/m² and 25°C. The first-order DC array output is:

`P_array = P_rated × (G_POA / 1000) × f_temp × f_degradation`

`f_temp = max(0, 1 + γ × (T_cell − 25°C))`

where `γ` is the power-temperature coefficient (default −0.0035 per °C). MPPT (default 96%) and power-bus (default 98%) efficiencies are applied to derive the DC-bus solar power. The UI displays those baseline assumptions.

### 7.3 One-node PV-panel thermal dynamics

Panel temperature is updated each integration step using an areal heat balance:

`C_A × dT/dt = α × G_POA − q_electric − 2 ε σ (T⁴ − T_sink⁴) − h_mount (T − T_support)`

`C_A` is the panel areal heat capacity, `α` the absorptivity, `ε` the emissivity, `σ` the Stefan–Boltzmann constant, and `h_mount` the effective mount conductance. Default parameter values are included in the frontend request and can be changed through the API input schema. The factor of two represents two radiating faces with one shared effective sink temperature. This is a transparent lumped node approximation, not a complete lunar thermal view-factor or habitat thermal model.

Derived array area uses the rated power and STC cell efficiency assumption (default 28%). Thermal state and power are integrated together, so PV output temperature derating changes with the simulated panel temperature.

### 7.4 Battery and DC-bus dynamics

The model balances bus solar power against the selected mission load schedule. Surplus power charges the battery subject to maximum charge C-rate, charge efficiency and remaining capacity. A deficit draws from the battery subject to maximum discharge C-rate, discharge efficiency and the configured minimum state-of-charge reserve. Any remaining deficit is recorded as unmet load. The crew-cycle and peak-operations schedules repeat every 24 elapsed mission hours; these are user assumptions, not lunar daylight cycles.

The result includes solar energy to the bus, load energy, unmet energy, curtailed solar energy, energy coverage, minimum and ending battery SOC, hours at reserve, peak solar/charge/discharge power, equivalent full battery discharge cycles, panel temperature range, and a timestamped series of SOC, power, load, panel temperature and Sun/Earth visibility. Series rows are emitted at source ephemeris sample times; power, load and panel-temperature values are interval means over the preceding ephemeris interval, while battery SOC is the interval-end state. The first row reports the instantaneous initial solar output and starting SOC. Internal integration occurs more frequently at the configured step.

### 7.5 Model verification and boundaries

Backend tests verify time integration, solar array orientation, terrain skyline suppression, panel temperature-coefficient response, battery charge/discharge C-rate and reserve constraints, unmet load, invalid timestamps and API validation. These are software/model-consistency tests, not validation against flight hardware or published lunar surface power-system telemetry.

No publicly distributable third-party lunar simulator was bundled. NASA/JPL describes the Lunar Surface Operations Simulator (LSOS) as a JPL-developed simulator with vehicle, terrain, power, thermal and life-support dynamics, but SELENIC cannot import that internal software as a public package. The LES3 GitHub project describes detailed lunar EPS/environmental models but currently says the simulator software is not publicly available. Those tools are references for future validation or collaboration, not dependencies in this release:

- JPL Lunar Surface Operations Simulator (LSOS): https://robotics.jpl.nasa.gov/what-we-do/research-tasks/lunar-surface-operations-simulator-lsos/
- Lunar Energy System Simulation Software (LES3) project/status: https://github.com/Spo-ck/Lunar-Energy-System-Simulation-Software

Important limitations:

- Solar distance is a user assumption (1.0 AU by default), not an additional Horizons range observable in the current comparison response.
- Only direct solar beam is used for PV generation. Lunar albedo and Earthshine are not credited as electrical generation.
- Fixed planar array orientation is modeled; no sun-tracking mechanism, gimbal limits, actuator power, or self-shadowing by hardware is included.
- The panel thermal node omits detailed front/back view factors, surface-to-surface terrain radiation, radiative spectra, dust, degradation and transient structural conduction.
- The battery is a constrained energy-state model, not an electrochemical cell model: no voltage/current curves, cell imbalance, internal resistance, thermal runaway, state-of-health, cycle ageing or thermal management.
- The load schedule is a generic assumed profile; no real mission load telemetry or environment-control/life-support system model is supplied.
- Earth visibility is only a finite-disc geometric opportunity metric. RF link budget, antenna gain/pointing, relay spacecraft, data rate and communication protocol behavior are not simulated.
- Results depend on Horizons cadence and the source DEM's provenance, datum, resolution, coverage and the radial terrain sampler. The model is conceptual and not validated for mission-critical design.

Joint Sun/Earth opportunity is an integral of the product of the finite-disc visible fractions, not a binary RF communications window. The simulation is intended for exploration, relative scenario comparison and educational power-budget reasoning. It is not a certified engineering prediction or landing/site suitability certification.

## 8. Not modeled

- Mission-grade power-system design, thermal environment, dust effects, or operational certification.
- Antenna pattern, spacecraft antenna pointing, RF link budget, data rate, atmospheric effects, or relay satellite availability.
- Thermal environment, dust, surface hazards, descent trajectory, landing dynamics, or hardware limitations.
- Uncertainty propagation, validation against all mission-grade reference products, or certification.

SELENIC is a research and educational prototype, not certified mission-planning software and not affiliated with or endorsed by NASA.
