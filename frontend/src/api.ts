import type { AnalysisResult, Site } from './types'
import type { VisibilitySummary } from './visibilityTypes'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export type TerrainProfilePoint = {
  azimuth_deg: number
  horizon_elevation_deg: number
  valid_samples: number
}

export type TerrainProfile = {
  site: Site
  source: string
  filename: string
  crs: string
  width: number
  height: number
  band: number
  elevation_unit_input: 'm' | 'km'
  observer_ground_elevation_m: number
  observer_height_above_dem_m: number
  max_distance_km: number
  azimuth_step_deg: number
  lunar_radius_assumption_m: number
  coverage_fraction: number
  minimum_azimuth_coverage_fraction: number
  profile: (TerrainProfilePoint & { coverage_fraction: number })[]
  model: string
  warnings: string[]
}

export type HorizonsDiagnostic = {
  status: 'ok'
  service: string
  target_tested: string
  observer: { latitude_deg: number; longitude_east_deg: number; altitude_km: number }
  sample_count: number
  first_sample: { timestamp_utc: string; azimuth_deg: number; elevation_deg: number }
  note: string
}

export async function diagnoseHorizons(): Promise<HorizonsDiagnostic> {
  const response = await fetch(`${API_BASE}/api/diagnostics/horizons`, {
    method: 'GET',
    signal: AbortSignal.timeout(150000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = typeof payload.detail === 'string' ? payload.detail : `JPL diagnostic failed (${response.status})`
    throw new Error(detail)
  }
  return payload as HorizonsDiagnostic
}

export async function checkApi(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3500) })
    return response.ok
  } catch {
    return false
  }
}

export async function fetchComparison(
  sites: Site[],
  date: string,
  startTime: string,
  durationHours: number,
  stepMinutes: number,
): Promise<AnalysisResult[]> {
  const response = await fetch(`${API_BASE}/api/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({
      sites,
      start_utc: `${date}T${startTime}:00Z`,
      duration_hours: durationHours,
      step_minutes: stepMinutes,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.detail || `Analysis request failed (${response.status})`)
  return payload.results as AnalysisResult[]
}

export async function fetchTerrainProfile(
  file: File,
  site: Site,
  options: { maxDistanceKm: number; azimuthStep: number; elevationUnit: 'm' | 'km'; observerHeightM: number },
): Promise<TerrainProfile> {
  const form = new FormData()
  form.append('file', file)
  form.append('site_json', JSON.stringify(site))
  form.append('max_distance_km', String(options.maxDistanceKm))
  form.append('azimuth_step_deg', String(options.azimuthStep))
  form.append('elevation_unit', options.elevationUnit)
  form.append('observer_height_m', String(options.observerHeightM))
  form.append('vertical_datum_confirmed', 'true')
  const response = await fetch(`${API_BASE}/api/terrain/profile`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(120000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.detail || `Terrain processing failed (${response.status})`)
  return payload as TerrainProfile
}


export async function fetchTerrainProfiles(
  file: File,
  sites: Site[],
  options: { maxDistanceKm: number; azimuthStep: number; elevationUnit: 'm' | 'km'; observerHeightM: number },
): Promise<TerrainProfile[]> {
  const form = new FormData()
  form.append('file', file)
  form.append('sites_json', JSON.stringify(sites))
  form.append('max_distance_km', String(options.maxDistanceKm))
  form.append('azimuth_step_deg', String(options.azimuthStep))
  form.append('elevation_unit', options.elevationUnit)
  form.append('observer_height_m', String(options.observerHeightM))
  form.append('vertical_datum_confirmed', 'true')
  const response = await fetch(`${API_BASE}/api/terrain/profiles`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(180000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.detail || `Terrain processing failed (${response.status})`)
  return payload.profiles as TerrainProfile[]
}


export async function fetchVisibilitySummary(
  result: AnalysisResult,
  profile: TerrainProfile,
): Promise<VisibilitySummary> {
  const response = await fetch(`${API_BASE}/api/visibility/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ points: result.points, profile: profile.profile }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.detail || `Visibility summary failed (${response.status})`)
  return payload as VisibilitySummary
}
