from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models import (
    BodyPosition,
    EphemerisPoint,
    HorizonBin,
    MissionSimulationInputs,
    MissionSimulationRequest,
)
from app.simulation import simulate_mission


def ephemeris(elevations, *, sun_azimuth=0, earth_elevation=20):
    start = datetime(2026, 11, 14, tzinfo=timezone.utc)
    points = []
    for index, elevation in enumerate(elevations):
        timestamp = (start + timedelta(hours=index)).isoformat().replace('+00:00', 'Z')
        points.append(EphemerisPoint(
            timestamp_utc=timestamp,
            sun=BodyPosition(azimuth_deg=sun_azimuth, elevation_deg=elevation),
            earth=BodyPosition(azimuth_deg=180, elevation_deg=earth_elevation),
        ))
    return points


def run(points, **overrides):
    values = {
        "load_kw": 2,
        "solar_array_rated_kw": 10,
        "battery_capacity_kwh": 30,
        "initial_battery_percent": 80,
    }
    values.update(overrides)
    inputs = MissionSimulationInputs(**values)
    return simulate_mission(MissionSimulationRequest(points=points, inputs=inputs, integration_step_seconds=300))


def flat_horizon():
    return [HorizonBin(azimuth_deg=az, horizon_elevation_deg=0) for az in (0, 90, 180, 270)]


def test_simulation_charges_battery_in_direct_sunlight_and_reports_thermal_state():
    result = run(ephemeris([45, 45, 45]))
    assert result['status'] == 'completed'
    assert result['integration_steps'] == 24
    assert result['solar_energy_to_bus_kwh'] > result['total_demand_kwh']
    assert result['ending_battery_percent'] >= 80
    assert result['maximum_panel_temperature_c'] > result['minimum_panel_temperature_c']
    assert result['series'][0]['solar_bus_power_kw'] > 0
    assert result['series'][1]['battery_charge_kw'] > 0
    assert result['peak_battery_charge_kw'] > 0
    assert result['model_id'] == 'SELENIC-LPS-1.0'


def test_simulation_reports_energy_shortfall_during_long_dark_interval():
    result = run(
        ephemeris([-30, -30, -30]),
        solar_array_rated_kw=0,
        load_kw=10,
        battery_capacity_kwh=5,
        initial_battery_percent=50,
        minimum_battery_percent=20,
    )
    assert result['solar_energy_to_bus_kwh'] == pytest.approx(0)
    assert result['unmet_energy_kwh'] > 0
    assert result['energy_coverage_percent'] < 100
    assert result['first_energy_shortfall_utc'] is not None


def test_terrain_ridge_reduces_solar_generation():
    points = ephemeris([8, 8, 8], sun_azimuth=0)
    inputs = MissionSimulationInputs(
        load_kw=1,
        solar_array_rated_kw=10,
        battery_capacity_kwh=30,
        initial_battery_percent=80,
        array_tilt_deg=0,
    )
    flat = simulate_mission(MissionSimulationRequest(points=points, inputs=inputs))
    ridge = simulate_mission(MissionSimulationRequest(
        points=points,
        inputs=inputs,
        profile=[HorizonBin(azimuth_deg=az, horizon_elevation_deg=10) for az in (0, 90, 180, 270)],
    ))
    assert flat['solar_energy_to_bus_kwh'] > ridge['solar_energy_to_bus_kwh']
    assert ridge['terrain_applied'] is True


def test_array_orientation_changes_direct_beam_generation():
    points = ephemeris([30, 30, 30], sun_azimuth=90)
    horizontal = run(points, array_tilt_deg=0)
    facing_sun = run(points, array_tilt_deg=30, array_azimuth_deg=90)
    assert facing_sun['solar_energy_to_bus_kwh'] > horizontal['solar_energy_to_bus_kwh']


def test_temperature_coefficient_changes_power_output():
    points = ephemeris([60, 60, 60])
    nominal = run(points, pv_temperature_coefficient_per_c=0, initial_panel_temperature_k=360)
    temperature_sensitive = run(points, pv_temperature_coefficient_per_c=-0.01, initial_panel_temperature_k=360)
    assert nominal['solar_energy_to_bus_kwh'] > temperature_sensitive['solar_energy_to_bus_kwh']


def test_battery_c_rate_limits_discharge_and_preserves_reserve():
    result = run(
        ephemeris([-20, -20, -20]),
        solar_array_rated_kw=0,
        load_kw=10,
        battery_capacity_kwh=10,
        initial_battery_percent=80,
        minimum_battery_percent=30,
        maximum_discharge_rate_c=0.1,
    )
    assert result['minimum_battery_percent'] >= 30 - 1e-8
    assert result['peak_battery_discharge_kw'] <= 1.0 + 1e-8
    assert result['unmet_energy_kwh'] > 0


def test_rejects_non_monotonic_or_large_ephemeris_gaps():
    points = ephemeris([10, 10, 10])
    points[1] = points[0]
    inputs = MissionSimulationInputs(load_kw=1, solar_array_rated_kw=2, battery_capacity_kwh=5, initial_battery_percent=70)
    with pytest.raises(ValueError, match='strictly increasing'):
        simulate_mission(MissionSimulationRequest(points=points, inputs=inputs))

    points = ephemeris([10, 10, 10])
    points[2] = EphemerisPoint(
        timestamp_utc='2026-11-15T08:00:00Z',
        sun=points[2].sun,
        earth=points[2].earth,
    )
    with pytest.raises(ValueError, match='gaps over six hours'):
        simulate_mission(MissionSimulationRequest(points=points, inputs=inputs))


def test_input_rejects_initial_battery_below_reserve():
    with pytest.raises(ValueError, match='at or above minimum'):
        MissionSimulationInputs(
            load_kw=1,
            solar_array_rated_kw=2,
            battery_capacity_kwh=5,
            initial_battery_percent=10,
            minimum_battery_percent=20,
        )


def test_simulation_reports_zero_battery_charge_when_no_solar_surplus():
    result = run(
        ephemeris([-30, -30, -30]),
        solar_array_rated_kw=0,
        load_kw=2,
        battery_capacity_kwh=20,
        initial_battery_percent=80,
    )
    assert all(point['battery_charge_kw'] == pytest.approx(0) for point in result['series'])
    assert result['series'][0]['solar_bus_power_kw'] == pytest.approx(0)


def test_battery_charge_c_rate_caps_charge_and_curtails_excess_solar():
    result = run(
        ephemeris([60, 60, 60]),
        load_kw=1,
        solar_array_rated_kw=20,
        battery_capacity_kwh=10,
        initial_battery_percent=50,
        minimum_battery_percent=10,
        maximum_charge_rate_c=0.1,
    )
    assert max(point['battery_charge_kw'] for point in result['series']) <= 1.0 + 1e-8
    assert result['curtailed_solar_energy_kwh'] > 0
    assert result['ending_battery_percent'] > 50


def test_battery_charge_efficiency_changes_ending_state_of_charge():
    points = ephemeris([60, 60, 60])
    lower_efficiency = run(points, battery_capacity_kwh=200, initial_battery_percent=50, battery_charge_efficiency=0.60)
    higher_efficiency = run(points, battery_capacity_kwh=200, initial_battery_percent=50, battery_charge_efficiency=0.95)
    assert higher_efficiency['ending_battery_percent'] > lower_efficiency['ending_battery_percent']


def test_first_energy_shortfall_timestamp_uses_absolute_simulation_elapsed_time():
    result = run(
        ephemeris([-30, -30, -30]),
        solar_array_rated_kw=0,
        load_kw=2,
        battery_capacity_kwh=10,
        initial_battery_percent=50,
        minimum_battery_percent=20,
        maximum_discharge_rate_c=1.0,
    )
    assert result['first_energy_shortfall_utc'] is not None
    shortfall = datetime.fromisoformat(result['first_energy_shortfall_utc'].replace('Z', '+00:00'))
    assert datetime(2026, 11, 14, 1, 0, tzinfo=timezone.utc) < shortfall < datetime(2026, 11, 14, 2, 0, tzinfo=timezone.utc)


def test_rejects_simulation_intervals_longer_than_thirty_days():
    points = ephemeris([10, 10])
    points[1] = EphemerisPoint(
        timestamp_utc='2026-12-14T01:00:00Z',
        sun=points[1].sun,
        earth=points[1].earth,
    )
    inputs = MissionSimulationInputs(load_kw=1, solar_array_rated_kw=2, battery_capacity_kwh=5, initial_battery_percent=70)
    with pytest.raises(ValueError, match='longer than 720 hours'):
        simulate_mission(MissionSimulationRequest(points=points, inputs=inputs))
