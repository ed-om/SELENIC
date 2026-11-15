export type Site = {
  id: string
  name: string
  latitude_deg: number
  longitude_east_deg: number
  altitude_km: number
}

export type BodyPosition = {
  azimuth_deg: number
  elevation_deg: number
}

export type EphemerisPoint = {
  timestamp_utc: string
  sun: BodyPosition
  earth: BodyPosition
}

export type AnalysisResult = {
  site: Site
  source: string
  ephemeris_model: string
  is_demo: boolean
  is_cached?: boolean
  start_utc: string
  duration_hours: number
  step_minutes: number
  horizon_model: string
  terrain_mask_applied: boolean
  warnings: string[]
  points: EphemerisPoint[]
  metrics: {
    sunlight_hours_sampled: number
    earth_visibility_hours_sampled: number
    peak_solar_elevation_deg: number
    peak_earth_elevation_deg: number
    solar_elevation_index_percent: number
  }
}
