# SELENIC lunar data resource guide

Use the resources for different purposes. They are complementary, not interchangeable.

## Quick recommendation

| Resource | Use it for | When to open it | Does SELENIC use it directly? |
|---|---|---|---|
| [NASA Moon Trek WMTS](https://trek.nasa.gov/moon/) | LRO WAC global image tiles for the interactive 3D globe | Loaded by the globe to texture the lunar sphere | Yes. Imagery only; it is not an elevation model. |
| [LROC / Lunaserv WMS browser](https://data.lroc.im-ldi.com/lroc/) | Browse LRO camera imagery, WAC products, shaded relief and illumination-related layers | During site exploration, to inspect the selected region and learn what imagery/layers are available | External link only. SELENIC opens the map viewer in a new tab instead of embedding it because the external Content Security Policy can block framing. |
| [PDS Lunar ODE](https://ode.rsl.wustl.edu/moon/) | Search, inspect metadata, and download LOLA/LRO products | When you need a numeric elevation grid for terrain-horizon analysis or product metadata for a source note | Yes, as an explicit download/upload workflow. The user downloads a DEM and uploads it into the app; the app does not automatically fetch ODE data. |

## 1. NASA Moon Trek WMTS — 3D globe image texture

Viewer: https://trek.nasa.gov/moon/  
WMTS catalogue: https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon

The 3D globe requests the LRO WAC Global Mosaic v2 image tiles from the NASA Solar System Treks WMTS. The frontend assembles a small set of equirectangular tiles into a texture for the Three.js sphere. It uses the official tile service rather than scraping the Moon Trek application.

The WMTS API describes the REST tile URL pattern and the global equirectangular scheme. SELENIC tries the current `trek.nasa.gov/tiles` endpoint and a legacy JPL Trek endpoint, with a labelled local fallback if both fail.

**Scientific limitation:** this is a surface image texture. The displayed sphere is not displaced by LOLA elevation, so it is not a true topographic 3D terrain model. For full terrain analysis, open the full Moon Trek viewer or use a verified LOLA/LROC DEM in Terrain Analysis. Cite the exact map product (LRO WAC Mosaic Global 303ppd v02), NASA/JPL Solar System Treks, the WMTS API documentation and the access date in the submission.


### NASA LRO 3D topographic model (optional future mesh asset)

NASA Goddard's Scientific Visualization Studio published downloadable Moon models made with LRO imagery and topographic data for web interactives, AR, and animation on January 29, 2026:

https://svs.gsfc.nasa.gov/14959/

The page lists `Moon_NASA_LRO_8k_Topo_Small.glb` (77.7 MB) and a larger 298.9 MB topographic model. The smaller GLB is an actual color-map-plus-height-map model and is a stronger candidate than an image-textured smooth sphere if SELENIC later adds an optional detailed mesh. The asset is not the same thing as the Moon Trek WMTS tiles. It is **not bundled or loaded by v0.7** because of its size and because a proper coordinate-orientation check is required before site markers can be placed accurately on it. Do not claim the current globe uses this GLB.

NASA credits the asset to NASA's Goddard Space Flight Center and lists its producers/data analysts on the source page. Retain the source-page credit and NASA media usage guidance if integrating it later.


## 2. LROC WMS — inspect imagery and surface context

WMS browser: https://data.lroc.im-ldi.com/lroc/  
LROC project: https://lroc.im-ldi.com/  
Curated downloads: https://lroc.im-ldi.com/images/downloads

The LROC map browser exposes lunar image and map layers, including WAC global imagery, normalized reflectance, color shaded relief, and polar illumination/topography-related layers. Its map is useful to inspect the context around a candidate site and to explain why terrain and illumination matter.

Recommended use sequence:

1. Open SELENIC's **Terrain & Sources** workspace.
2. Open the LROC project website for mission, camera and education context, then use the **Open LROC map viewer** action in SELENIC. The viewer opens in a new tab and is not embedded in the app.
3. Find the lunar south-pole region and inspect available WAC global, shaded relief and illumination layers.
4. Compare the visual landforms with the candidate coordinates.
5. If you need quantitative terrain, use the curated download catalogue rather than treating a WMS screenshot as an elevation model.

A useful high-latitude source family in the curated catalogue is **WAC GLD100 topography with LOLA 30 m DTM poleward of 75° latitude**. The published catalogue describes a large, multi-gigabyte package. Do not download a global package just for this prototype if a regional tile/crop will cover both candidate sites and the requested horizon radius.

A WMS map image is not directly accepted by the terrain endpoint. The endpoint expects a georeferenced numeric GeoTIFF DEM. In v0.7, upload the file once; the endpoint accepts 2–5 sites and reuses the uploaded bytes for each site profile. The v0.7 frontend supports 2–5 editable study points.

## 3. PDS Lunar ODE — find the numeric terrain model

URL: https://ode.rsl.wustl.edu/moon/

ODE is the data-search and download source. Search for Lunar Reconnaissance Orbiter (LRO) / Lunar Orbiter Laser Altimeter (LOLA) products. The ODE tools can search by product/instrument and geographic coverage, and product labels provide essential metadata.

### Prefer gridded LOLA GDR for a DEM workflow

- **LOLA RDR:** individual reduced altimetry observations. Useful for finding observations, checking data coverage or independent spot checks. RDR is not itself a ready-to-use raster DEM.
- **LOLA GDR:** Gridded Data Records. These are resampled/binned gridded products assembled from altimetry. Some GDR maps are distributed in IMG or JPEG 2000 formats with labels rather than GeoTIFF, so a projection-preserving conversion may be required before upload. A suitable GDR map grid is the more natural starting point for local terrain profiles.

ODE's documentation notes that GDR products can meet many needs and should be reviewed before relying on point-level RDR queries. SELENIC's prefilled RDR query link is an exploration aid; it does not create a DEM or automatically populate the upload box.

### Recommended download-to-upload workflow

1. In ODE, open product search and set the target body to the Moon.
2. Filter to LRO and LOLA, then search the available GDR/gridded topography products and check the coverage map/footprint.
3. Choose a product whose coverage contains both candidate sites **and** the maximum profile radius around each site.
4. Read the product label/metadata before download. Record its projection, lunar body-fixed coordinate frame, longitude convention, vertical datum, elevation units, pixel spacing, and no-data value.
5. If available, download a regional subset. Keep the source product ID and label with your project notes.
6. Export/convert to a georeferenced GeoTIFF only if the conversion preserves the lunar CRS and vertical reference. Some PDS products are distributed as IMG/label or ISIS formats, not direct GeoTIFFs; use a compatible GIS/ISIS/GDAL workflow and verify the output metadata.
7. In SELENIC, upload the GeoTIFF, select the correct elevation unit, choose a profile radius that fits within the tile, set observer height above the DEM surface, and confirm the metadata only after checking it.
8. Review each site's sample coverage. SELENIC rejects any profile that has less than 70% valid DEM samples in any azimuth direction; choose a larger or better-centered DEM if rejected.
9. Compare the terrain-adjusted sampled estimate to the geometric result. Keep the original DEM label and source/product ID with the exported CSV and report.

**Do not simply assign an Earth coordinate system to a lunar raster.** A terrestrial `EPSG:4326` DEM is intentionally rejected by the current processor because Earth's ellipsoid is not the Moon.

## Data lineage in the current app

```text
JPL Horizons API
  -> Sun/Earth apparent azimuth and elevation time series
  -> geometric zero-degree horizon windows

User downloads a lunar DEM from LROC/PDS ODE
  -> user verifies lunar CRS, vertical datum and elevation units
  -> uploads GeoTIFF to SELENIC
  -> backend samples 360-degree local DEM obstruction profile
  -> backend computes finite-disc, terrain-aware visibility and decision metrics
  -> CSV includes source, profile and horizon diagnostics

NASA Moon Trek WMTS
  -> LRO WAC global image tiles
  -> assembled into a Three.js globe texture (imagery only; no height displacement)

```

## Citation / credit notes for the project report

Cite the exact source product and version used, not only the portal homepage. For the globe preview, identify the LRO WAC Global Mosaic v2 WMTS layer and record the access date. For a user-supplied DEM, preserve the PDS product ID/label, instrument, lunar coordinate reference system, longitude convention, vertical datum, elevation units, pixel spacing, no-data value and access date. For ephemerides, cite the JPL Horizons API and record the query interval, target IDs and retrieval date. SELENIC does not bundle a validated terrain product or a precomputed Horizons snapshot in v0.7.

## External viewer behavior

The LROC map viewer is opened in a new tab, not embedded. Its Content Security Policy may deny third-party framing and cause a browser `cspBlocked` page. SELENIC uses an inline NASA/JPL Moon Trek WMTS imagery preview and external links for the full LROC and Moon Trek viewers. The inline preview is imagery only, not a numeric DEM.

## JPL Horizons API endpoint

SELENIC sends observer-ephemeris requests to `https://ssd.jpl.nasa.gov/api/horizons.api`, the GET endpoint specified by JPL's official API documentation. The human-readable API reference is hosted at https://ssd-api.jpl.nasa.gov/doc/horizons.html. These are different hosts for different purposes. The application's `/api/health` route only reports backend status; use `/api/diagnostics/horizons` to make an actual JPL request.
