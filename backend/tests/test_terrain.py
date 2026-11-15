import json
from io import BytesIO

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app.models import SiteInput
from app.terrain import TerrainDataError, build_terrain_profile


def make_test_dem() -> bytes:
    crs = "+proj=longlat +a=1737400 +b=1737400 +no_defs +type=crs"
    data = np.zeros((220, 3000), dtype=np.float32)
    # A gentle, deterministic ridge in one band makes the profile non-flat.
    data[90:105, :] = 15.0
    buffer = BytesIO()
    with rasterio.open(
        buffer,
        "w",
        driver="GTiff",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype="float32",
        crs=crs,
        transform=from_origin(0, -88.0, 0.01, 0.01),
        nodata=-9999,
    ) as dataset:
        dataset.write(data, 1)
    return buffer.getvalue()


def test_terrain_profile_requires_datum_confirmation():
    site = SiteInput(id="a", name="Test", latitude_deg=-89.2, longitude_east_deg=15, altitude_km=0)
    with pytest.raises(TerrainDataError, match="Confirm"):
        build_terrain_profile(make_test_dem(), "test.tif", site)


def test_terrain_profile_rejects_non_geotiff():
    site = SiteInput(id="a", name="Test", latitude_deg=-89.2, longitude_east_deg=15, altitude_km=0)
    with pytest.raises(TerrainDataError, match="GeoTIFF"):
        build_terrain_profile(b"not-a-tiff", "terrain.csv", site, vertical_datum_confirmed=True)


def test_terrain_profile_returns_azimuth_bins_and_metadata():
    site = SiteInput(id="a", name="Test", latitude_deg=-89.2, longitude_east_deg=15, altitude_km=0)
    result = build_terrain_profile(
        make_test_dem(),
        "lunar-test-dem.tif",
        site,
        max_distance_km=5,
        azimuth_step_deg=15,
        vertical_datum_confirmed=True,
    )
    assert result["filename"] == "lunar-test-dem.tif"
    assert result["coverage_fraction"] > 0.15
    assert len(result["profile"]) == 24
    assert result["profile"][0]["azimuth_deg"] == 0
    assert "1737400" in result["crs"]


def test_terrain_profile_rejects_earth_sized_crs():
    data = np.zeros((100, 100), dtype=np.float32)
    buffer = BytesIO()
    with rasterio.open(
        buffer,
        "w",
        driver="GTiff",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_origin(0, -88.0, 0.01, 0.01),
        nodata=-9999,
    ) as dataset:
        dataset.write(data, 1)
    site = SiteInput(id="a", name="Test", latitude_deg=-88.5, longitude_east_deg=0, altitude_km=0)
    with pytest.raises(TerrainDataError, match="lunar-sized"):
        build_terrain_profile(
            buffer.getvalue(),
            "earth-dem.tif",
            site,
            max_distance_km=5,
            azimuth_step_deg=15,
            vertical_datum_confirmed=True,
        )


def test_terrain_profile_has_minimum_coverage_per_azimuth():
    site = SiteInput(id="a", name="Test", latitude_deg=-89.2, longitude_east_deg=15, altitude_km=0)
    result = build_terrain_profile(
        make_test_dem(),
        "lunar-test-dem.tif",
        site,
        max_distance_km=5,
        azimuth_step_deg=15,
        vertical_datum_confirmed=True,
    )
    assert result["minimum_azimuth_coverage_fraction"] >= 0.70
    assert all(item["coverage_fraction"] >= 0.70 for item in result["profile"])


def test_terrain_profile_http_endpoint_accepts_lunar_geotiff():
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    response = client.post(
        "/api/terrain/profile",
        files={"file": ("lunar-test-dem.tif", make_test_dem(), "image/tiff")},
        data={
            "site_json": SiteInput(
                id="a", name="Test", latitude_deg=-89.2, longitude_east_deg=15, altitude_km=0
            ).model_dump_json(),
            "max_distance_km": "5",
            "azimuth_step_deg": "15",
            "elevation_unit": "m",
            "observer_height_m": "1.5",
            "vertical_datum_confirmed": "true",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["filename"] == "lunar-test-dem.tif"
    assert len(payload["profile"]) == 24
    assert payload["minimum_azimuth_coverage_fraction"] >= 0.70



def test_multi_site_terrain_endpoint_accepts_one_upload_for_two_sites():
    from fastapi.testclient import TestClient

    from app.main import app

    sites = [
        SiteInput(id="a", name="Test A", latitude_deg=-89.2, longitude_east_deg=15, altitude_km=0),
        SiteInput(id="b", name="Test B", latitude_deg=-89.1, longitude_east_deg=15.5, altitude_km=0),
    ]
    response = TestClient(app).post(
        "/api/terrain/profiles",
        files={"file": ("lunar-test-dem.tif", make_test_dem(), "image/tiff")},
        data={
            "sites_json": json.dumps([site.model_dump() for site in sites]),
            "max_distance_km": "5",
            "azimuth_step_deg": "15",
            "elevation_unit": "m",
            "observer_height_m": "1.5",
            "vertical_datum_confirmed": "true",
        },
    )
    assert response.status_code == 200, response.text
    profiles = response.json()["profiles"]
    assert len(profiles) == 2
    assert [profile["site"]["id"] for profile in profiles] == ["a", "b"]
    assert all(profile["filename"] == "lunar-test-dem.tif" for profile in profiles)


def test_api_root_returns_a_friendly_service_page():
    from fastapi.testclient import TestClient

    from app.main import app

    response = TestClient(app).get("/")
    assert response.status_code == 200
    assert "SELENIC API" in response.text
    assert "localhost:5173" in response.text
    assert "/docs" in response.text


def test_favicon_request_does_not_return_404():
    from fastapi.testclient import TestClient

    from app.main import app

    response = TestClient(app).get("/favicon.ico")
    assert response.status_code == 204
