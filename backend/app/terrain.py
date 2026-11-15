from __future__ import annotations

import math
from io import BytesIO
from typing import Any

import numpy as np
import rasterio
from pyproj import CRS, Geod, Transformer
from rasterio.io import MemoryFile

from .models import SiteInput

LUNAR_MEAN_RADIUS_M = 1_737_400.0


class TerrainDataError(ValueError):
    """Raised when an uploaded lunar DEM cannot safely support a horizon profile."""


def _valid_sample(value: Any, nodata: float | int | None) -> bool:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(number):
        return False
    if nodata is not None and math.isclose(number, float(nodata), rel_tol=0.0, abs_tol=1e-8):
        return False
    return True


def build_terrain_profile(
    content: bytes,
    filename: str,
    site: SiteInput,
    *,
    max_distance_km: float = 20.0,
    azimuth_step_deg: int = 5,
    elevation_unit: str = "m",
    observer_height_m: float = 1.5,
    vertical_datum_confirmed: bool = False,
) -> dict[str, Any]:
    """Derive a local terrain horizon from a georeferenced lunar DEM GeoTIFF.

    The profile is a sampled radial obstruction profile, not a certified line-of-sight
    or mission analysis product. Caller must confirm the DEM's lunar coordinate and
    vertical-datum metadata before processing.
    """
    if not content:
        raise TerrainDataError("The uploaded DEM is empty.")
    if len(content) > 100 * 1024 * 1024:
        raise TerrainDataError("DEM files must be 100 MB or smaller for this local processing endpoint.")
    if not vertical_datum_confirmed:
        raise TerrainDataError("Confirm that the DEM uses a documented lunar coordinate reference and known elevation units before processing.")
    if elevation_unit not in {"m", "km"}:
        raise TerrainDataError("Elevation units must be meters or kilometers.")
    if not (1.0 <= max_distance_km <= 100.0):
        raise TerrainDataError("Maximum profile distance must be between 1 and 100 km.")
    if azimuth_step_deg not in {2, 5, 10, 15}:
        raise TerrainDataError("Azimuth step must be 2, 5, 10 or 15 degrees.")
    if not (0.0 <= observer_height_m <= 100.0):
        raise TerrainDataError("Observer height must be between 0 and 100 meters above the local DEM surface.")
    if not filename.lower().endswith((".tif", ".tiff")):
        raise TerrainDataError("Upload a GeoTIFF (.tif or .tiff) lunar elevation model.")

    try:
        with MemoryFile(content) as memory_file:
            with memory_file.open() as dataset:
                if dataset.count < 1:
                    raise TerrainDataError("The GeoTIFF contains no raster band.")
                if dataset.crs is None:
                    raise TerrainDataError("The GeoTIFF has no coordinate reference system. Export a georeferenced lunar DEM.")
                if dataset.width < 3 or dataset.height < 3:
                    raise TerrainDataError("The DEM is too small to calculate a terrain horizon.")

                # Prefer the GeoTIFF's own lunar geodetic CRS. If the projected CRS
                # does not expose one, use a lunar sphere rather than Earth/WGS84.
                geographic_crs = dataset.crs.geodetic_crs
                if geographic_crs is None:
                    geographic_crs = CRS.from_proj4(
                        f"+proj=longlat +a={LUNAR_MEAN_RADIUS_M} +b={LUNAR_MEAN_RADIUS_M} +no_defs +type=crs"
                    )
                # rasterio.crs.CRS does not expose the ellipsoid property directly;
                # normalize it through pyproj before validating the body radius.
                pyproj_geographic_crs = CRS.from_wkt(geographic_crs.to_wkt())
                ellipsoid = pyproj_geographic_crs.ellipsoid
                semi_major = getattr(ellipsoid, "semi_major_metre", None) if ellipsoid else None
                if semi_major and abs(float(semi_major) - LUNAR_MEAN_RADIUS_M) > 5_000:
                    raise TerrainDataError(
                        "The GeoTIFF CRS does not appear to use a lunar-sized reference body. Do not upload terrestrial DEMs."
                    )
                transformer = Transformer.from_crs(geographic_crs, dataset.crs, always_xy=True)
                longitude = ((site.longitude_east_deg + 180.0) % 360.0) - 180.0

                def transform_coordinates(longitudes: list[float], latitudes: list[float]):
                    xs, ys = transformer.transform(longitudes, latitudes)
                    # Some lunar geographic GeoTIFFs use 0..360 east longitude.
                    # Convert transformed negative longitudes only when the raster
                    # metadata clearly indicates that convention.
                    if dataset.crs.is_geographic and dataset.bounds.left >= 0 and dataset.bounds.right > 180:
                        xs = np.where(np.asarray(xs) < 0, np.asarray(xs) + 360.0, xs)
                    return xs, ys

                center_x_values, center_y_values = transform_coordinates([longitude], [site.latitude_deg])
                center_x, center_y = float(center_x_values[0]), float(center_y_values[0])
                center_values = list(dataset.sample([(center_x, center_y)], indexes=1, masked=True))
                if not center_values or np.ma.is_masked(center_values[0][0]):
                    raise TerrainDataError("The selected site is outside the uploaded DEM coverage or falls on a no-data cell.")
                ground_elevation = float(center_values[0][0])

                unit_scale = 1000.0 if elevation_unit == "km" else 1.0
                ground_elevation_m = ground_elevation * unit_scale
                geod = Geod(a=LUNAR_MEAN_RADIUS_M, b=LUNAR_MEAN_RADIUS_M)
                max_distance_m = max_distance_km * 1000.0
                # Fixed maximum sample count keeps upload processing predictable;
                # include enough points to identify broad local crater rims/ridges.
                sample_count = min(300, max(40, int(max_distance_m / 150.0)))
                distances = np.linspace(max(100.0, max_distance_m / sample_count), max_distance_m, sample_count)
                azimuths = list(range(0, 360, azimuth_step_deg))
                no_data = dataset.nodata
                profile: list[dict[str, float | int]] = []
                total_valid = 0
                total_attempted = 0

                for azimuth in azimuths:
                    lon_values: list[float] = []
                    lat_values: list[float] = []
                    for distance in distances:
                        lon2, lat2, _ = geod.fwd(longitude, site.latitude_deg, float(azimuth), float(distance))
                        lon_values.append(lon2)
                        lat_values.append(lat2)
                    xs, ys = transform_coordinates(lon_values, lat_values)
                    samples = dataset.sample(list(zip(xs, ys)), indexes=1, masked=True)
                    max_angle = -90.0
                    valid_count = 0
                    for distance, sample in zip(distances, samples):
                        total_attempted += 1
                        if np.ma.is_masked(sample[0]) or not _valid_sample(sample[0], no_data):
                            continue
                        terrain_m = float(sample[0]) * unit_scale
                        # Spherical curvature lowers distant terrain relative to the
                        # local tangent plane. This is a small-angle approximation.
                        curvature_drop_m = (float(distance) ** 2) / (2.0 * LUNAR_MEAN_RADIUS_M)
                        apparent_angle = math.degrees(
                            math.atan2(terrain_m - ground_elevation_m - observer_height_m - curvature_drop_m, float(distance))
                        )
                        max_angle = max(max_angle, apparent_angle)
                        valid_count += 1
                        total_valid += 1
                    ray_coverage = valid_count / len(distances) if len(distances) else 0.0
                    profile.append({
                        "azimuth_deg": float(azimuth),
                        "horizon_elevation_deg": round(max_angle, 4) if valid_count else 0.0,
                        "valid_samples": valid_count,
                        "coverage_fraction": round(ray_coverage, 4),
                    })

                coverage = total_valid / total_attempted if total_attempted else 0.0
                minimum_ray_coverage = min((float(item["coverage_fraction"]) for item in profile), default=0.0)
                if minimum_ray_coverage < 0.70:
                    raise TerrainDataError(
                        "At least one azimuth direction has less than 70% DEM coverage along the requested profile radius. Use a larger or better-centered DEM tile; missing directions must not be treated as open sky."
                    )

                transform = dataset.transform
                return {
                    "site": site.model_dump(),
                    "source": "User-supplied lunar DEM GeoTIFF",
                    "filename": filename,
                    "crs": str(dataset.crs),
                    "width": dataset.width,
                    "height": dataset.height,
                    "band": 1,
                    "elevation_unit_input": elevation_unit,
                    "observer_ground_elevation_m": round(ground_elevation_m, 3),
                    "observer_height_above_dem_m": observer_height_m,
                    "max_distance_km": max_distance_km,
                    "azimuth_step_deg": azimuth_step_deg,
                    "lunar_radius_assumption_m": LUNAR_MEAN_RADIUS_M,
                    "coverage_fraction": round(coverage, 4),
                    "minimum_azimuth_coverage_fraction": round(minimum_ray_coverage, 4),
                    "profile": profile,
                    "model": "Radial DEM obstruction profile with spherical lunar curvature correction",
                    "warnings": [
                        "This profile is derived from the GeoTIFF uploaded by the user; SELENIC does not independently certify its provenance or vertical datum.",
                        "The uploaded DEM must use a lunar body-fixed coordinate reference and elevation units consistent with its metadata.",
                        "Every azimuth ray is required to have at least 70% DEM sample coverage; uncovered directions are rejected rather than represented as open sky.",
                        "The radial sampling is discrete; narrow ridges and small-scale terrain may be missed between sample rays.",
                        "The lunar curvature correction uses a spherical mean radius of 1,737.4 km.",
                        "This is a prototype visibility mask, not a certified mission-planning or communications safety product.",
                    ],
                    "raster_transform": [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f],
                }
    except TerrainDataError:
        raise
    except (rasterio.errors.RasterioError, ValueError, TypeError, OverflowError) as exc:
        raise TerrainDataError(f"Could not read or process this GeoTIFF: {exc.__class__.__name__}.") from exc
