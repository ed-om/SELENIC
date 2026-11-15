from __future__ import annotations

from datetime import datetime, timedelta
import math
from typing import Any

from .models import EphemerisPoint, HorizonBin, MissionSimulationInputs, MissionSimulationRequest

SOLAR_DISC_RADIUS_DEG = 0.2666
EARTH_DISC_RADIUS_DEG = 0.95  # nominal; varies with Earth-Moon distance
STEFAN_BOLTZMANN = 5.670374419e-8
MODEL_ID = "SELENIC-LPS-1.0"


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Every ephemeris timestamp must include a timezone")
    return parsed


def _normalize_azimuth(value: float) -> float:
    return value % 360.0


def _disc_visible_fraction(margin_deg: float, radius_deg: float) -> float:
    if margin_deg >= radius_deg:
        return 1.0
    if margin_deg <= -radius_deg:
        return 0.0
    x = max(-1.0, min(1.0, margin_deg / radius_deg))
    return 0.5 + (math.asin(x) + x * math.sqrt(max(0.0, 1.0 - x * x))) / math.pi


def _interpolate_angle(a: float, b: float, fraction: float) -> float:
    delta = (b - a + 180.0) % 360.0 - 180.0
    return _normalize_azimuth(a + delta * fraction)


def _interpolate_horizon(profile: list[HorizonBin] | None, azimuth: float) -> float:
    if not profile:
        return 0.0
    ordered = profile  # sorted once at simulation start
    query = _normalize_azimuth(azimuth)
    for index, left in enumerate(ordered):
        right = ordered[(index + 1) % len(ordered)]
        left_az = left.azimuth_deg
        right_az = right.azimuth_deg if index < len(ordered) - 1 else right.azimuth_deg + 360.0
        query_unwrapped = query if query >= left_az else query + 360.0
        if left_az <= query_unwrapped <= right_az:
            span = right_az - left_az
            if span <= 0:
                return left.horizon_elevation_deg
            fraction = (query_unwrapped - left_az) / span
            return left.horizon_elevation_deg * (1 - fraction) + right.horizon_elevation_deg * fraction
    return ordered[0].horizon_elevation_deg


def _sun_incidence_cosine(sun_azimuth_deg: float, sun_elevation_deg: float, tilt_deg: float, panel_azimuth_deg: float) -> float:
    """Dot product of Sun direction and panel normal; azimuth is north=0°, east=90°."""
    elev = math.radians(sun_elevation_deg)
    tilt = math.radians(tilt_deg)
    delta_az = math.radians(sun_azimuth_deg - panel_azimuth_deg)
    return max(0.0, math.sin(elev) * math.cos(tilt) + math.cos(elev) * math.sin(tilt) * math.cos(delta_az))


def _load_factor(profile: str, elapsed_hours: float) -> float:
    """Transparent 24 h *mission operations* pattern, not a lunar day model."""
    phase = elapsed_hours % 24.0
    if profile == "crew_cycle":
        return 1.20 if 7.0 <= phase < 21.0 else 0.75
    if profile == "peak_operations":
        return 1.65 if 10.0 <= phase < 14.0 else 0.85
    return 1.0


def _visibility(
    azimuth: float,
    elevation: float,
    profile: list[HorizonBin] | None,
    angular_radius: float,
) -> float:
    horizon = _interpolate_horizon(profile, azimuth)
    return _disc_visible_fraction(elevation - horizon, angular_radius)


def simulate_mission(payload: MissionSimulationRequest) -> dict[str, Any]:
    points = payload.points
    inputs = payload.inputs
    times = [_parse_time(point.timestamp_utc) for point in points]
    deltas = [(times[i + 1] - times[i]).total_seconds() for i in range(len(times) - 1)]
    total_span_seconds = (times[-1] - times[0]).total_seconds()
    if total_span_seconds > 720 * 3600:
        raise ValueError("Mission simulation intervals longer than 720 hours are not supported")
    if any(delta <= 0 for delta in deltas):
        raise ValueError("Ephemeris timestamps must be strictly increasing")
    if any(delta > 6 * 3600 for delta in deltas):
        raise ValueError("Ephemeris gaps over six hours are not supported by this simulation; request a finer Horizons cadence")

    profile = sorted(payload.profile, key=lambda item: item.azimuth_deg) if payload.profile else None
    terrain_applied = bool(profile)
    # Rated array power is defined at 1,000 W/m² and STC cell temperature 25°C.
    array_area_m2 = (inputs.solar_array_rated_kw * 1000.0) / (inputs.cell_efficiency_stc * 1000.0) if inputs.solar_array_rated_kw > 0 else 0.0
    battery_capacity = inputs.battery_capacity_kwh
    reserve_kwh = battery_capacity * inputs.minimum_battery_percent / 100.0
    battery_kwh = battery_capacity * inputs.initial_battery_percent / 100.0
    minimum_battery_kwh = battery_kwh
    panel_temp_k = inputs.initial_panel_temperature_k
    initial_panel_temp_k = panel_temp_k

    total_demand = 0.0
    total_solar = 0.0
    total_unmet = 0.0
    curtailed_energy = 0.0
    battery_discharge_energy = 0.0
    earth_visible_hours = 0.0
    joint_visible_hours = 0.0
    hours_below_reserve = 0.0
    longest_dark_hours = 0.0
    current_dark_hours = 0.0
    simulated_seconds = 0.0
    integration_steps = 0
    peak_solar_kw = 0.0
    peak_charge_kw = 0.0
    peak_discharge_kw = 0.0
    min_panel_temp_k = panel_temp_k
    max_panel_temp_k = panel_temp_k
    first_shortfall: str | None = None
    initial_sun_fraction = _visibility(
        points[0].sun.azimuth_deg, points[0].sun.elevation_deg, profile, SOLAR_DISC_RADIUS_DEG
    )
    initial_incidence = _sun_incidence_cosine(
        points[0].sun.azimuth_deg, points[0].sun.elevation_deg,
        inputs.array_tilt_deg, inputs.array_azimuth_deg,
    )
    initial_plane_irradiance = (
        inputs.solar_irradiance_w_m2 / (inputs.solar_distance_au ** 2)
        * initial_incidence * initial_sun_fraction
    )
    initial_temp_factor = max(
        0.0, 1.0 + inputs.pv_temperature_coefficient_per_c * (panel_temp_k - 273.15 - 25.0)
    )
    initial_solar_bus_kw = (
        inputs.solar_array_rated_kw * (initial_plane_irradiance / 1000.0)
        * initial_temp_factor * inputs.array_degradation_factor
        * inputs.mppt_efficiency * inputs.power_bus_efficiency
    )
    series: list[dict[str, Any]] = [{
        "timestamp_utc": points[0].timestamp_utc,
        "battery_percent": inputs.initial_battery_percent,
        "solar_bus_power_kw": max(0.0, initial_solar_bus_kw),
        "load_kw": inputs.load_kw * _load_factor(inputs.load_profile, 0.0),
        "battery_charge_kw": 0.0,
        "battery_discharge_kw": 0.0,
        "unmet_load_kw": 0.0,
        "panel_temperature_c": panel_temp_k - 273.15,
        "sun_visible_percent": initial_sun_fraction * 100,
        "earth_visible_percent": _visibility(points[0].earth.azimuth_deg, points[0].earth.elevation_deg, profile, EARTH_DISC_RADIUS_DEG) * 100,
    }]

    for index, (left, right, interval_seconds) in enumerate(zip(points[:-1], points[1:], deltas)):
        substeps = max(1, math.ceil(interval_seconds / payload.integration_step_seconds))
        dt = interval_seconds / substeps
        solar_energy_this_interval = 0.0
        load_energy_this_interval = 0.0
        unmet_energy_this_interval = 0.0
        discharge_energy_this_interval = 0.0
        earth_hours_this_interval = 0.0
        joint_hours_this_interval = 0.0
        sun_hours_this_interval = 0.0
        panel_temp_sum = 0.0
        power_sum = 0.0
        load_sum = 0.0
        charge_power_sum = 0.0
        discharge_power_sum = 0.0
        unmet_power_sum = 0.0

        for substep in range(substeps):
            fraction = (substep + 0.5) / substeps
            elapsed_hours = simulated_seconds / 3600.0 + (dt / 2.0) / 3600.0
            sun_az = _interpolate_angle(left.sun.azimuth_deg, right.sun.azimuth_deg, fraction)
            earth_az = _interpolate_angle(left.earth.azimuth_deg, right.earth.azimuth_deg, fraction)
            sun_el = left.sun.elevation_deg + (right.sun.elevation_deg - left.sun.elevation_deg) * fraction
            earth_el = left.earth.elevation_deg + (right.earth.elevation_deg - left.earth.elevation_deg) * fraction
            sun_fraction = _visibility(sun_az, sun_el, profile, SOLAR_DISC_RADIUS_DEG)
            earth_fraction = _visibility(earth_az, earth_el, profile, EARTH_DISC_RADIUS_DEG)
            cosine_incidence = _sun_incidence_cosine(sun_az, sun_el, inputs.array_tilt_deg, inputs.array_azimuth_deg)
            distance_factor = 1.0 / (inputs.solar_distance_au ** 2)
            plane_irradiance = inputs.solar_irradiance_w_m2 * distance_factor * cosine_incidence * sun_fraction

            temp_c = panel_temp_k - 273.15
            temp_factor = max(0.0, 1.0 + inputs.pv_temperature_coefficient_per_c * (temp_c - 25.0))
            raw_array_kw = inputs.solar_array_rated_kw * (plane_irradiance / 1000.0) * temp_factor * inputs.array_degradation_factor
            bus_solar_kw = raw_array_kw * inputs.mppt_efficiency * inputs.power_bus_efficiency
            bus_solar_kw = max(0.0, bus_solar_kw)

            # One-node panel thermal model: absorbed solar flux minus electrical
            # extraction, two-sided thermal radiation, and mount conduction.
            if array_area_m2 > 0:
                absorbed_w_m2 = inputs.panel_absorptivity * plane_irradiance
                electrical_w_m2 = inputs.cell_efficiency_stc * plane_irradiance * temp_factor
                radiated_w_m2 = inputs.panel_emissivity * STEFAN_BOLTZMANN * 2.0 * (panel_temp_k**4 - inputs.radiative_sink_temperature_k**4)
                conducted_w_m2 = inputs.mount_thermal_conductance_w_m2k * (panel_temp_k - inputs.support_temperature_k)
                net_heat_w_m2 = absorbed_w_m2 - electrical_w_m2 - radiated_w_m2 - conducted_w_m2
                panel_temp_k += (net_heat_w_m2 / inputs.panel_areal_heat_capacity_j_m2k) * dt
                panel_temp_k = max(50.0, min(500.0, panel_temp_k))

            load_kw = inputs.load_kw * _load_factor(inputs.load_profile, elapsed_hours)
            net_kw = bus_solar_kw - load_kw
            charge_kw = 0.0
            discharge_kw = 0.0
            unmet_kw = 0.0
            dt_hours = dt / 3600.0
            if net_kw >= 0:
                requested_charge_kw = min(net_kw, inputs.maximum_charge_rate_c * battery_capacity)
                available_capacity_kwh = max(0.0, battery_capacity - battery_kwh)
                requested_input_kwh = requested_charge_kw * dt_hours
                storable_kwh = min(requested_input_kwh * inputs.battery_charge_efficiency, available_capacity_kwh)
                battery_kwh += storable_kwh
                actual_input_kwh = storable_kwh / inputs.battery_charge_efficiency if inputs.battery_charge_efficiency > 0 else 0.0
                charge_kw = actual_input_kwh / max(dt_hours, 1e-12)
                curtailed_energy += max(0.0, (bus_solar_kw - load_kw) * dt_hours - actual_input_kwh)
            else:
                requested_kw = -net_kw
                max_discharge_kw = inputs.maximum_discharge_rate_c * battery_capacity
                available_battery_kwh = max(0.0, battery_kwh - reserve_kwh)
                deliverable_by_energy_kw = available_battery_kwh * inputs.battery_discharge_efficiency / max(dt_hours, 1e-12)
                discharge_kw = min(requested_kw, max_discharge_kw, deliverable_by_energy_kw)
                energy_removed = (discharge_kw * dt_hours) / inputs.battery_discharge_efficiency
                battery_kwh -= energy_removed
                unmet_kw = max(0.0, requested_kw - discharge_kw)
                unmet_kwh = unmet_kw * dt_hours
                if unmet_kwh > 1e-10 and first_shortfall is None:
                    shortfall_time = times[0] + timedelta(seconds=simulated_seconds + dt / 2.0)
                    first_shortfall = shortfall_time.isoformat().replace("+00:00", "Z")
                total_unmet += unmet_kwh
                unmet_energy_this_interval += unmet_kwh
                discharge_energy_this_interval += discharge_kw * dt_hours
                battery_discharge_energy += energy_removed

            battery_kwh = min(battery_capacity, max(reserve_kwh, battery_kwh))
            minimum_battery_kwh = min(minimum_battery_kwh, battery_kwh)
            if battery_kwh <= reserve_kwh + 1e-8:
                hours_below_reserve += dt_hours
            if sun_fraction < 0.05:
                current_dark_hours += dt_hours
                longest_dark_hours = max(longest_dark_hours, current_dark_hours)
            else:
                current_dark_hours = 0.0

            demand_kwh = load_kw * dt_hours
            solar_kwh = bus_solar_kw * dt_hours
            total_demand += demand_kwh
            total_solar += solar_kwh
            solar_energy_this_interval += solar_kwh
            load_energy_this_interval += demand_kwh
            earth_visible_hours += earth_fraction * dt_hours
            joint_visible_hours += sun_fraction * earth_fraction * dt_hours
            earth_hours_this_interval += earth_fraction * dt_hours
            joint_hours_this_interval += sun_fraction * earth_fraction * dt_hours
            sun_hours_this_interval += sun_fraction * dt_hours
            peak_solar_kw = max(peak_solar_kw, bus_solar_kw)
            peak_charge_kw = max(peak_charge_kw, charge_kw)
            peak_discharge_kw = max(peak_discharge_kw, discharge_kw)
            min_panel_temp_k = min(min_panel_temp_k, panel_temp_k)
            max_panel_temp_k = max(max_panel_temp_k, panel_temp_k)
            panel_temp_sum += panel_temp_k
            power_sum += bus_solar_kw
            load_sum += load_kw
            charge_power_sum += charge_kw
            discharge_power_sum += discharge_kw
            unmet_power_sum += unmet_kw
            simulated_seconds += dt
            integration_steps += 1

        interval_hours = interval_seconds / 3600.0
        series.append({
            "timestamp_utc": right.timestamp_utc,
            "battery_percent": battery_kwh / battery_capacity * 100.0,
            "solar_bus_power_kw": power_sum / substeps,
            "load_kw": load_sum / substeps,
            "battery_charge_kw": charge_power_sum / substeps,
            "battery_discharge_kw": discharge_power_sum / substeps,
            "unmet_load_kw": unmet_power_sum / substeps,
            "panel_temperature_c": panel_temp_sum / substeps - 273.15,
            "sun_visible_percent": sun_hours_this_interval / max(interval_hours, 1e-12) * 100.0,
            "earth_visible_percent": earth_hours_this_interval / max(interval_hours, 1e-12) * 100.0,
        })

    simulated_hours = simulated_seconds / 3600.0
    if simulated_hours <= 0:
        raise ValueError("No valid ephemeris intervals were available to simulate")
    served_energy = max(0.0, total_demand - total_unmet)
    notes = [
        "The backend integrates the electrical and panel-thermal states at the configured fixed time step, linearly interpolating the supplied JPL Horizons azimuth/elevation samples between observations.",
        "Solar input is a direct-beam lunar-vacuum model: configurable solar irradiance divided by heliocentric distance squared, projected onto a fixed-tilt/fixed-azimuth array, then reduced by finite-Sun visibility against the selected geometric or DEM skyline.",
        "Array electrical output is referenced to the user-entered rated kW at 1,000 W/m² and 25°C. Cell temperature derating uses the entered power-temperature coefficient; MPPT and DC-bus efficiencies are applied after the array model.",
        "Panel temperature uses a one-node transient heat balance with absorbed solar flux, electrical extraction, two-sided radiation to an effective sink temperature, and conductive coupling to a support temperature. The effective sink and support temperatures are user model assumptions, not a full lunar thermal-radiation view-factor model.",
        "The battery enforces charge and discharge C-rate limits, charge/discharge efficiencies and a minimum state-of-charge reserve. The model does not resolve cell electrochemistry, voltage/current curves, cell imbalance, battery thermal runaway or ageing.",
        "The crew-cycle and peak-operations options apply a repeating 24-hour mission operations schedule. This is an assumed workload schedule, not the Moon's 29.5-day synodic cycle.",
        "Earth visibility is a geometric disc-visibility opportunity metric only. Antenna pointing, RF link budget, data rate, relay availability and terrain diffraction are not simulated.",
        "Joint Sun/Earth opportunity hours integrate the product of the two finite-disc visible fractions; this is a continuous geometric opportunity index, not a binary RF communications window.",
    ]
    if not terrain_applied:
        notes.append("No DEM skyline was supplied. The model used a zero-degree geometric horizon; terrain obstruction is not inferred from imagery.")
    else:
        notes.append("The supplied azimuth-binned DEM skyline was used to reduce direct solar and Earth disc visibility. Accuracy remains limited by the source DEM, its datum/resolution/coverage and the terrain ray-sampling method.")

    return {
        "model_id": MODEL_ID,
        "status": "completed",
        "terrain_applied": terrain_applied,
        "integration_step_seconds": payload.integration_step_seconds,
        "simulated_hours": simulated_hours,
        "integration_steps": integration_steps,
        "array_area_m2_derived": array_area_m2,
        "total_demand_kwh": total_demand,
        "solar_energy_to_bus_kwh": total_solar,
        "unmet_energy_kwh": total_unmet,
        "curtailed_solar_energy_kwh": curtailed_energy,
        "energy_coverage_percent": min(100.0, max(0.0, served_energy / max(total_demand, 1e-12) * 100.0)),
        "minimum_battery_percent": minimum_battery_kwh / battery_capacity * 100.0,
        "ending_battery_percent": battery_kwh / battery_capacity * 100.0,
        "hours_at_minimum_soc": hours_below_reserve,
        "longest_sun_obscured_interval_hours": longest_dark_hours,
        "earth_visible_hours": earth_visible_hours,
        "joint_sun_earth_visible_hours": joint_visible_hours,
        "peak_solar_bus_power_kw": peak_solar_kw,
        "peak_battery_charge_kw": peak_charge_kw,
        "peak_battery_discharge_kw": peak_discharge_kw,
        "battery_equivalent_full_cycles": battery_discharge_energy / max(battery_capacity, 1e-12),
        "minimum_panel_temperature_c": min_panel_temp_k - 273.15,
        "maximum_panel_temperature_c": max_panel_temp_k - 273.15,
        "initial_panel_temperature_c": initial_panel_temp_k - 273.15,
        "first_energy_shortfall_utc": first_shortfall,
        "series": series,
        "notes": notes,
    }
