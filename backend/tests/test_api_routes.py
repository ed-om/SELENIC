from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_api_root_is_a_friendly_service_page():
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "SELENIC API" in response.text
    assert "Open SELENIC frontend" in response.text


def test_favicon_request_does_not_return_not_found():
    response = client.get("/favicon.ico")
    assert response.status_code == 204


def test_health_reports_backend_and_separate_jpl_diagnostic():
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "SELENIC API"
    assert payload["terrain_profile_service"] == "available"
    assert payload["terrain_mask_applied_to_ephemeris"] is False
    assert payload["jpl_connectivity"].startswith("not_checked")


def test_horizons_diagnostic_surfaces_jpl_error_details(monkeypatch):
    from app import main
    from app.horizons import HorizonsError

    async def failing_diagnostic():
        raise HorizonsError("JPL Horizons returned HTTP 400 for Sun: Invalid observer request")

    monkeypatch.setattr(main, "diagnose_horizons", failing_diagnostic)
    response = client.get("/api/diagnostics/horizons")
    assert response.status_code == 502
    assert "HTTP 400" in response.json()["detail"]
    assert "Invalid observer request" in response.json()["detail"]


def test_visibility_summary_endpoint_returns_finite_disc_decision_metrics():
    payload = {
        "points": [
            {
                "timestamp_utc": "2026-11-14T00:00:00Z",
                "sun": {"azimuth_deg": 0, "elevation_deg": 2},
                "earth": {"azimuth_deg": 180, "elevation_deg": 5},
            },
            {
                "timestamp_utc": "2026-11-14T01:00:00Z",
                "sun": {"azimuth_deg": 10, "elevation_deg": -2},
                "earth": {"azimuth_deg": 190, "elevation_deg": -2},
            },
        ],
        "profile": [
            {"azimuth_deg": 0, "horizon_elevation_deg": 0},
            {"azimuth_deg": 90, "horizon_elevation_deg": 0},
            {"azimuth_deg": 180, "horizon_elevation_deg": 0},
            {"azimuth_deg": 270, "horizon_elevation_deg": 0},
        ],
    }
    response = client.post("/api/visibility/summary", json=payload)
    assert response.status_code == 200
    result = response.json()
    assert result["sun_visible_disc_hours"] > 0
    assert result["earth_visible_disc_hours"] > 0
    assert "joint_sun_and_earth_hours" in result
    assert "best_joint_window" in result
    assert result["angular_radii_assumed_deg"]["sun"] == 0.267


def test_compare_request_accepts_up_to_five_sites():
    from app.models import CompareRequest
    from datetime import datetime, timezone

    sites = [
        {"id": f"s{i}", "name": f"Site {i}", "latitude_deg": -89.0, "longitude_east_deg": float(i)}
        for i in range(5)
    ]
    payload = CompareRequest(sites=sites, start_utc=datetime(2026, 11, 14, tzinfo=timezone.utc))
    assert len(payload.sites) == 5


def test_mission_simulation_endpoint_runs_time_stepped_eps_model():
    payload = {
        "points": [
            {"timestamp_utc": f"2026-11-14T{hour:02d}:00:00Z", "sun": {"azimuth_deg": 0, "elevation_deg": 35}, "earth": {"azimuth_deg": 180, "elevation_deg": 15}}
            for hour in range(3)
        ],
        "inputs": {
            "load_kw": 2,
            "solar_array_rated_kw": 8,
            "battery_capacity_kwh": 24,
            "initial_battery_percent": 75,
            "minimum_battery_percent": 20,
            "array_tilt_deg": 15,
            "array_azimuth_deg": 0,
            "load_profile": "steady",
        },
    }
    response = client.post("/api/simulate", json=payload)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["model_id"] == "SELENIC-LPS-1.0"
    assert result["integration_steps"] == 24
    assert result["status"] == "completed"
    assert len(result["series"]) == 3
    assert "maximum_panel_temperature_c" in result
    assert result["peak_battery_charge_kw"] >= 0


def test_mission_simulation_endpoint_rejects_initial_charge_below_reserve():
    payload = {
        "points": [
            {"timestamp_utc": f"2026-11-14T{hour:02d}:00:00Z", "sun": {"azimuth_deg": 0, "elevation_deg": 10}, "earth": {"azimuth_deg": 180, "elevation_deg": 10}}
            for hour in range(2)
        ],
        "inputs": {
            "load_kw": 1,
            "solar_array_rated_kw": 3,
            "battery_capacity_kwh": 10,
            "initial_battery_percent": 10,
            "minimum_battery_percent": 20,
        },
    }
    response = client.post("/api/simulate", json=payload)
    assert response.status_code == 422
    assert "at or above" in response.text
