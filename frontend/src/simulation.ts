import type { AnalysisResult } from './types'
import type { TerrainProfile } from './api'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export type MissionPreset = 'solar-outpost' | 'crew-exploration' | 'communications-relay'
export type MissionLoadProfile = 'steady' | 'crew_cycle' | 'peak_operations'

export type MissionSimulationInputs = {
  load_kw: number
  solar_array_rated_kw: number
  battery_capacity_kwh: number
  initial_battery_percent: number
  minimum_battery_percent: number
  array_tilt_deg: number
  array_azimuth_deg: number
  load_profile: MissionLoadProfile
  cell_efficiency_stc: number
  pv_temperature_coefficient_per_c: number
  panel_absorptivity: number
  panel_emissivity: number
  panel_areal_heat_capacity_j_m2k: number
  initial_panel_temperature_k: number
  radiative_sink_temperature_k: number
  support_temperature_k: number
  mount_thermal_conductance_w_m2k: number
  solar_irradiance_w_m2: number
  solar_distance_au: number
  mppt_efficiency: number
  power_bus_efficiency: number
  array_degradation_factor: number
  battery_charge_efficiency: number
  battery_discharge_efficiency: number
  maximum_charge_rate_c: number
  maximum_discharge_rate_c: number
}

export type SimulationPoint = {
  timestamp_utc: string
  battery_percent: number
  solar_bus_power_kw: number
  load_kw: number
  battery_charge_kw: number
  battery_discharge_kw: number
  unmet_load_kw: number
  panel_temperature_c: number
  sun_visible_percent: number
  earth_visible_percent: number
}

export type MissionSimulation = {
  model_id: string
  status: 'completed'
  terrain_applied: boolean
  integration_step_seconds: number
  simulated_hours: number
  integration_steps: number
  array_area_m2_derived: number
  total_demand_kwh: number
  solar_energy_to_bus_kwh: number
  unmet_energy_kwh: number
  curtailed_solar_energy_kwh: number
  energy_coverage_percent: number
  minimum_battery_percent: number
  ending_battery_percent: number
  hours_at_minimum_soc: number
  longest_sun_obscured_interval_hours: number
  earth_visible_hours: number
  joint_sun_earth_visible_hours: number
  peak_solar_bus_power_kw: number
  peak_battery_charge_kw: number
  peak_battery_discharge_kw: number
  battery_equivalent_full_cycles: number
  minimum_panel_temperature_c: number
  maximum_panel_temperature_c: number
  initial_panel_temperature_c: number
  first_energy_shortfall_utc: string | null
  series: SimulationPoint[]
  notes: string[]
}

export async function requestMissionSimulation(
  result: AnalysisResult,
  profile: TerrainProfile | undefined,
  inputs: MissionSimulationInputs,
): Promise<MissionSimulation> {
  if (result.is_demo) throw new Error('Mission simulation requires real JPL Horizons ephemeris, not demo data.')
  const response = await fetch(`${API_BASE}/api/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      points: result.points,
      profile: profile?.profile.map(point => ({
        azimuth_deg: point.azimuth_deg,
        horizon_elevation_deg: point.horizon_elevation_deg,
      })) ?? null,
      inputs,
      integration_step_seconds: 300,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.detail || `Mission simulation failed (${response.status})`)
  return payload as MissionSimulation
}
