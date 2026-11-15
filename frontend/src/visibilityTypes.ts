export type VisibilitySummary = {
  sun_visible_disc_hours: number
  earth_visible_disc_hours: number
  joint_sun_and_earth_hours: number
  longest_continuous_dark_interval: { start_utc: string; end_utc: string; hours: number } | null
  best_joint_window: { start_utc: string; end_utc: string; hours: number } | null
  events: { body: string; event: string; timestamp_utc: string }[]
  earth_eclipses_sun_possible: boolean
  earth_eclipses_sun_sample_times_utc: string[]
  total_eclipse_possible: boolean
  total_eclipse_sample_times_utc: string[]
  angular_radii_assumed_deg: { sun: number; earth_nominal: number }
  model_notes: string[]
}
