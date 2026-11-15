import { useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowRight, Check, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, Compass, Database, Download, ExternalLink, FileImage, Globe2, Info,
  BatteryCharging, Layers3, Map as MapIcon, Pause, Play, RadioTower, RotateCcw, Satellite,
  Search, Sun, X
} from 'lucide-react'
import { checkApi, diagnoseHorizons, fetchComparison, fetchTerrainProfiles, fetchVisibilitySummary } from './api'
import type { TerrainProfile } from './api'
import MoonGlobe from './MoonGlobe'
import type { AnalysisResult, BodyPosition, Site } from './types'
import type { VisibilitySummary } from './visibilityTypes'
import { requestMissionSimulation, type MissionLoadProfile, type MissionPreset, type MissionSimulation, type MissionSimulationInputs } from './simulation'

const initialSites: Site[] = [
  { id: 'study-point-a', name: 'South-polar study point A', latitude_deg: -89.2, longitude_east_deg: 15, altitude_km: 0 },
  { id: 'study-point-b', name: 'South-polar study point B', latitude_deg: -88.6, longitude_east_deg: 42, altitude_km: 0 },
]
const today = new Date().toISOString().slice(0, 10)
type Page = 'overview' | 'sites' | 'compare' | 'windows' | 'simulation' | 'data' | 'terrain' | 'learn'

const navItems: { id: Page; label: string; icon: typeof Compass }[] = [
  { id: 'overview', label: 'Overview', icon: Compass },
  { id: 'sites', label: 'Sites', icon: Globe2 },
  { id: 'compare', label: 'Analyze', icon: Activity },
  { id: 'windows', label: 'Mission planner', icon: Clock3 },
  { id: 'simulation', label: 'Simulate', icon: BatteryCharging },
  { id: 'terrain', label: 'Terrain & sources', icon: Layers3 },
]

function formatAngle(value: number) { return `${value > 0 ? '+' : ''}${value.toFixed(1)}°` }
function formatUtc(value: string) {
  return new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC'
}

function HorizonInstrument({ sun, earth }: { sun: BodyPosition; earth: BodyPosition }) {
  const point = (position: BodyPosition) => {
    const radius = Math.max(0, Math.min(105, ((90 - position.elevation_deg) / 90) * 84))
    const angle = (position.azimuth_deg * Math.PI) / 180
    return { x: 112 + Math.sin(angle) * radius, y: 112 - Math.cos(angle) * radius }
  }
  const a = point(sun); const b = point(earth)
  return <svg className="horizon-svg" viewBox="0 0 224 224" role="img" aria-label={`Sun elevation ${sun.elevation_deg.toFixed(1)} degrees; Earth elevation ${earth.elevation_deg.toFixed(1)} degrees`}>
    <circle cx="112" cy="112" r="84" fill="#fafafa" stroke="#c9c9c9" strokeDasharray="3 5" />
    <circle cx="112" cy="112" r="56" fill="none" stroke="#e0e0e0" strokeDasharray="2 6" />
    <circle cx="112" cy="112" r="28" fill="none" stroke="#e7e7e7" strokeDasharray="2 5" />
    <path d="M112 19V205M19 112H205" stroke="#d9d9d9" strokeWidth=".8" />
    <text x="112" y="11" textAnchor="middle" className="dome-label">ZENITH</text>
    <text x="112" y="219" textAnchor="middle" className="dome-label">HORIZON · 0°</text>
    <text x="8" y="115" className="dome-cardinal">W</text><text x="207" y="115" className="dome-cardinal">E</text>
    <g transform={`translate(${a.x} ${a.y})`}><circle r="11" fill="#fff" stroke="#171717" strokeWidth="1.6"/><path d="M0 -16V-20M0 16V20M-16 0H-20M16 0H20" stroke="#171717" strokeWidth="1.5"/></g>
    <g transform={`translate(${b.x} ${b.y})`}><circle r="10" fill="#777" stroke="#fff" strokeWidth="1.4"/><path d="M-4 -1Q0 -5 4 -1Q2 4 -2 4Z" fill="#fff"/></g>
  </svg>
}

function ElevationChart({ result, activeIndex }: { result: AnalysisResult; activeIndex: number }) {
  const width = 760, height = 224, left = 44, right = 16, top = 18, bottom = 34
  const innerW = width - left - right, innerH = height - top - bottom
  const y = (v: number) => top + ((90 - Math.max(-90, Math.min(90, v))) / 180) * innerH
  const x = (i: number) => left + (result.points.length <= 1 ? 0 : (i / (result.points.length - 1)) * innerW)
  const path = (key: 'sun' | 'earth') => result.points.map((point, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(point[key].elevation_deg).toFixed(1)}`).join(' ')
  const current = result.points[Math.min(activeIndex, result.points.length - 1)]
  const activeX = x(Math.min(activeIndex, result.points.length - 1))
  return <svg className="elevation-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Sun and Earth elevation angles over time">
    {[60, 30, 0, -30, -60].map(tick => <g key={tick}><line x1={left} x2={width-right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? '#777' : '#dedede'} strokeDasharray={tick === 0 ? '5 4' : '2 6'} /><text x="4" y={y(tick)+4} className="axis-label">{tick}°</text></g>)}
    <path d={path('sun')} fill="none" stroke="#171717" strokeWidth="2.8" strokeLinecap="round"/>
    <path d={path('earth')} fill="none" stroke="#929292" strokeWidth="2.8" strokeDasharray="7 5" strokeLinecap="round"/>
    <line x1={activeX} x2={activeX} y1={top} y2={height-bottom} stroke="#777" strokeDasharray="4 4"/>
    {current && <><circle cx={activeX} cy={y(current.sun.elevation_deg)} r="4.5" fill="#171717"/><circle cx={activeX} cy={y(current.earth.elevation_deg)} r="4.5" fill="#929292"/></>}
    <text x={left} y={height-8} className="axis-label">START</text><text x={width-right} y={height-8} textAnchor="end" className="axis-label">+{result.duration_hours}H · UTC</text>
  </svg>
}

function SimulationBatteryChart({ data, reservePercent }: { data: MissionSimulation['series']; reservePercent: number }) {
  const width = 760, height = 230, left = 48, right = 18, top = 18, bottom = 34
  const innerWidth = width - left - right
  const innerHeight = height - top - bottom
  const x = (index: number) => left + (data.length <= 1 ? 0 : index / (data.length - 1) * innerWidth)
  const y = (percent: number) => top + (100 - Math.max(0, Math.min(100, percent))) / 100 * innerHeight
  const line = data.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.battery_percent).toFixed(1)}`).join(' ')
  const fill = `${line} L${x(data.length - 1)},${height - bottom} L${x(0)},${height - bottom} Z`
  return <div className="simulation-chart-wrap">
    <div className="simulation-chart-legend"><span><i className="simulation-battery-key"/> Battery state of charge</span><span><i className="simulation-reserve-key"/> Configured reserve</span></div>
    <svg className="simulation-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Modeled battery state of charge through the selected analysis interval">
      {[0,20,40,60,80,100].map(value=><g key={value}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} stroke="#dce5e9" strokeDasharray="2 5"/><text x="7" y={y(value)+4} className="axis-label">{value}%</text></g>)}
      <line x1={left} x2={width-right} y1={y(reservePercent)} y2={y(reservePercent)} stroke="#d58b43" strokeDasharray="5 4"/>
      <path d={fill} className="simulation-battery-area"/><path d={line} className="simulation-battery-line"/>
      <text x={left} y={height-8} className="axis-label">START · UTC</text><text x={width-right} y={height-8} textAnchor="end" className="axis-label">END · UTC</text>
    </svg>
  </div>
}


function SimulationPowerChart({ data }: { data: MissionSimulation['series'] }) {
  const width = 760, height = 230, left = 48, right = 18, top = 18, bottom = 34
  const maxValue = Math.max(1, ...data.flatMap(point => [point.solar_bus_power_kw, point.load_kw, point.battery_charge_kw, point.battery_discharge_kw])) * 1.12
  const x = (index: number) => left + (data.length <= 1 ? 0 : index / (data.length - 1) * (width - left - right))
  const y = (value: number) => top + (maxValue - value) / maxValue * (height - top - bottom)
  const path = (key: 'solar_bus_power_kw' | 'load_kw' | 'battery_charge_kw' | 'battery_discharge_kw') => data.map((point,index)=>`${index?'L':'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ')
  return <div className="simulation-chart-wrap">
    <div className="simulation-chart-legend"><span><i className="simulation-power-solar"/> Solar to bus</span><span><i className="simulation-power-load"/> Mission load</span><span><i className="simulation-power-charge"/> Battery charge</span><span><i className="simulation-power-battery"/> Battery discharge</span></div>
    <svg className="simulation-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Modeled solar bus power, mission load, battery charging and battery discharge over time">
      {[0,0.25,0.5,0.75,1].map(frac=><g key={frac}><line x1={left} x2={width-right} y1={y(maxValue*frac)} y2={y(maxValue*frac)} stroke="#dce5e9" strokeDasharray="2 5"/><text x="7" y={y(maxValue*frac)+4} className="axis-label">{(maxValue*frac).toFixed(1)}</text></g>)}
      <path d={path('solar_bus_power_kw')} className="simulation-power-line solar"/><path d={path('load_kw')} className="simulation-power-line load"/><path d={path('battery_charge_kw')} className="simulation-power-line charge"/><path d={path('battery_discharge_kw')} className="simulation-power-line battery"/>
      <text x={left} y={height-8} className="axis-label">START · UTC</text><text x={width-right} y={height-8} textAnchor="end" className="axis-label">END · UTC</text>
    </svg><div className="simulation-chart-units">Power at DC bus · kW</div>
  </div>
}

function exportSimulationCsv(simulation: MissionSimulation, siteName: string, preset: MissionPreset, inputs: MissionSimulationInputs) {
  const rows = [
    ['# SELENIC v0.9.0 · time-stepped lunar electrical power-system simulation'],
    [`# model=${simulation.model_id}`, `site=${siteName}`, `mission_profile=${preset}`, `load_profile=${inputs.load_profile}`, `base_load_kw=${inputs.load_kw}`, `array_rated_kwp=${inputs.solar_array_rated_kw}`, `array_tilt_deg=${inputs.array_tilt_deg}`, `array_azimuth_deg=${inputs.array_azimuth_deg}`, `battery_capacity_kwh=${inputs.battery_capacity_kwh}`, `initial_battery_percent=${inputs.initial_battery_percent}`, `minimum_battery_percent=${inputs.minimum_battery_percent}`, `solar_distance_au=${inputs.solar_distance_au}`, `terrain_applied=${simulation.terrain_applied}`, `integration_step_seconds=${simulation.integration_step_seconds}`],
    ['timestamp_utc','battery_state_of_charge_percent','solar_power_to_bus_kw','mission_load_kw','battery_charge_kw','battery_discharge_kw','unmet_load_kw','panel_temperature_c','sun_visible_disc_percent','earth_visible_disc_percent'],
    ...simulation.series.map(point=>[point.timestamp_utc,point.battery_percent.toFixed(4),point.solar_bus_power_kw.toFixed(4),point.load_kw.toFixed(4),point.battery_charge_kw.toFixed(4),point.battery_discharge_kw.toFixed(4),point.unmet_load_kw.toFixed(4),point.panel_temperature_c.toFixed(3),point.sun_visible_percent.toFixed(4),point.earth_visible_percent.toFixed(4)]),
  ]
  const csv = rows.map(row=>row.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  const anchor = document.createElement('a'); anchor.href=url; anchor.download=`selenic-lunar-eps-simulation-${new Date().toISOString().slice(0,10)}.csv`; anchor.click(); URL.revokeObjectURL(url)
}

function SiteEditor({ site, label, onChange }: { site: Site; label: string; onChange: (site: Site) => void }) {
  return <section className="site-editor">
    <header className="site-editor-head"><span className={`site-token token-${label.toLowerCase()==="a"?"a":"b"}`}>{label}</span><div><h3>{site.name}</h3><p>Study location · not an official recommendation</p></div></header>
    <label>Site name<input value={site.name} onChange={e => onChange({ ...site, name: e.target.value })}/></label>
    <div className="form-grid two"><label>Latitude · degrees<input type="number" min={-90} max={90} step="0.01" value={site.latitude_deg} onChange={e => onChange({ ...site, latitude_deg: Number(e.target.value) })}/></label><label>East longitude · degrees<input type="number" min={0} max={359.99} step="0.01" value={site.longitude_east_deg} onChange={e => onChange({ ...site, longitude_east_deg: Number(e.target.value) })}/></label></div>
    <label>Altitude above reference ellipsoid · km<input type="number" min={-5} max={20} step="0.01" value={site.altitude_km} onChange={e => onChange({ ...site, altitude_km: Number(e.target.value) })}/></label>
    <p className="field-help">Moon-fixed coordinates. East-positive longitude. Sample coordinates are not official landing recommendations.</p>
  </section>
}

function exportCsv(results: AnalysisResult[], profiles: Record<string, TerrainProfile>, summaries: Record<string, VisibilitySummary>) {
  const header = ['site_id','site_name','latitude_deg','longitude_east_deg','altitude_km','timestamp_utc','sun_azimuth_deg','sun_elevation_deg','earth_azimuth_deg','earth_elevation_deg','source','is_demo','horizon_model','terrain_mask_applied','sun_terrain_horizon_deg','earth_terrain_horizon_deg','sun_clear_of_dem_horizon','earth_clear_of_dem_horizon','terrain_dem_filename']
  const rows = results.flatMap(result => result.points.map(point => {
    const terrain = profiles[result.site.id]
    const threshold = (az: number) => terrain ? terrain.profile[Math.round((((az % 360) + 360) % 360) / terrain.azimuth_step_deg) % terrain.profile.length]?.horizon_elevation_deg ?? 0 : ''
    const sunHorizon = terrain ? threshold(point.sun.azimuth_deg) : ''
    const earthHorizon = terrain ? threshold(point.earth.azimuth_deg) : ''
    return [result.site.id,result.site.name,result.site.latitude_deg,result.site.longitude_east_deg,result.site.altitude_km,point.timestamp_utc,point.sun.azimuth_deg,point.sun.elevation_deg,point.earth.azimuth_deg,point.earth.elevation_deg,result.source,result.is_demo,result.horizon_model,Boolean(terrain),sunHorizon,earthHorizon,terrain ? point.sun.elevation_deg >= Number(sunHorizon) : '',terrain ? point.earth.elevation_deg >= Number(earthHorizon) : '',terrain?.filename ?? '']
  }))
  const metadata = ['# SELENIC v0.9.0 · sampled lunar observer ephemeris export', ...results.map(result => `# ${result.site.name}: ${result.source}; ${result.start_utc}; ${result.duration_hours} h; ${result.step_minutes} min; cache=${Boolean(result.is_cached)}`), ...results.flatMap(result => { const profile = profiles[result.site.id]; const summary = summaries[result.site.id]; return [profile ? `# terrain ${result.site.id}: file=${profile.filename}; CRS=${profile.crs}; units=${profile.elevation_unit_input}; pixel=${profile.width}x${profile.height}; max_radius_km=${profile.max_distance_km}; azimuth_step_deg=${profile.azimuth_step_deg}; coverage=${profile.coverage_fraction}; weakest_azimuth_coverage=${profile.minimum_azimuth_coverage_fraction}` : `# terrain ${result.site.id}: none`, summary ? `# visibility ${result.site.id}: sun_disc_h=${summary.sun_visible_disc_hours}; earth_disc_h=${summary.earth_visible_disc_hours}; joint_h=${summary.joint_sun_and_earth_hours}; longest_dark_h=${summary.longest_continuous_dark_interval?.hours ?? 'n/a'}; best_joint_h=${summary.best_joint_window?.hours ?? 'n/a'}; earth_eclipse=${summary.earth_eclipses_sun_possible}; total_eclipse=${summary.total_eclipse_possible}; events=${JSON.stringify(summary.events)}` : `# visibility ${result.site.id}: not calculated`] })]
  const csv = [...metadata,header,...rows].map(row => typeof row === 'string' ? row : row.map(value => `"${String(value).replace(/"/g,'""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `selenic-comparison-${new Date().toISOString().slice(0,10)}.csv`; anchor.click(); URL.revokeObjectURL(url)
}

function horizonAt(profile: TerrainProfile, azimuth: number) {
  const step = profile.azimuth_step_deg
  const normalized = ((azimuth % 360) + 360) % 360
  const position = normalized / step
  const low = Math.floor(position) % profile.profile.length
  const high = (low + 1) % profile.profile.length
  const f = position - Math.floor(position)
  return profile.profile[low].horizon_elevation_deg * (1-f) + profile.profile[high].horizon_elevation_deg * f
}

function terrainAdjustedHours(result: AnalysisResult, profile: TerrainProfile, body: 'sun' | 'earth') {
  let total = 0
  for (const [i, left] of result.points.slice(0,-1).entries()) {
    const right = result.points[i+1]
    const m0 = left[body].elevation_deg - horizonAt(profile, left[body].azimuth_deg)
    const m1 = right[body].elevation_deg - horizonAt(profile, right[body].azimuth_deg)
    const hours = (new Date(right.timestamp_utc).getTime() - new Date(left.timestamp_utc).getTime()) / 3600000
    if (!(hours > 0)) continue
    if (m0 >= 0 && m1 >= 0) total += hours
    else if (m0 < 0 && m1 < 0) continue
    else if (m0 < 0) total += hours * (m1 / (m1-m0))
    else total += hours * (m0 / (m0-m1))
  }
  return Math.max(0, total)
}

function TerrainPlot({ data }: { data: TerrainProfile }) {
  const W = 760, H = 210, pad = 36
  const points = data.profile
  const min = Math.min(-5, ...points.map(p => p.horizon_elevation_deg))
  const max = Math.max(10, ...points.map(p => p.horizon_elevation_deg))
  const coord = (i: number, v: number) => `${pad + (i / Math.max(1, points.length-1)) * (W-pad*2)},${H-pad - ((v-min)/(max-min || 1))*(H-pad*2)}`
  const path = points.map((p,i) => `${i?'L':'M'}${coord(i,p.horizon_elevation_deg)}`).join(' ')
  return <div className="terrain-plot-wrap"><svg className="terrain-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Terrain horizon elevation by azimuth"><line x1={pad} x2={W-pad} y1={H-pad} y2={H-pad} stroke="#bbb"/><line x1={pad} x2={W-pad} y1={pad} y2={pad} stroke="#e5e5e5" strokeDasharray="4 6"/><path d={path} fill="none" stroke="#242424" strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round"/><text x={pad} y={H-8} className="axis-label">0° · N</text><text x={W/2} y={H-8} className="axis-label" textAnchor="middle">180° · S</text><text x={W-pad} y={H-8} className="axis-label" textAnchor="end">360°</text><text x={pad} y={14} className="axis-label">MAX OBSTRUCTION ELEVATION</text></svg></div>
}

function SkylinePlot({ result, profile }: { result: AnalysisResult; profile: TerrainProfile }) {
  const W = 760, H = 250, left = 42, right = 18, top = 22, bottom = 34
  const terrain = profile.profile
  const allElevations = [...terrain.map(p => p.horizon_elevation_deg), ...result.points.flatMap(p => [p.sun.elevation_deg, p.earth.elevation_deg])]
  const low = Math.min(-5, ...allElevations), high = Math.max(8, ...allElevations)
  const x = (az: number) => left + ((((az % 360) + 360) % 360) / 360) * (W-left-right)
  const y = (elevation: number) => top + ((high-elevation)/(high-low || 1)) * (H-top-bottom)
  const horizonPath = terrain.map((p,i) => `${i?'L':'M'}${x(p.azimuth_deg).toFixed(1)},${y(p.horizon_elevation_deg).toFixed(1)}`).join(' ')
  const fillPath = `${horizonPath} L${x(terrain[terrain.length-1].azimuth_deg).toFixed(1)},${H-bottom} L${x(terrain[0].azimuth_deg).toFixed(1)},${H-bottom} Z`
  const step = Math.max(1, Math.floor(result.points.length / 180))
  const sunPoints = result.points.filter((_,i)=>i%step===0).map((p,i)=><circle key={`sun-${i}`} cx={x(p.sun.azimuth_deg)} cy={y(p.sun.elevation_deg)} r="3" className="skyline-sun-point"><title>{formatUtc(p.timestamp_utc)} · Sun {p.sun.azimuth_deg.toFixed(1)}° az, {p.sun.elevation_deg.toFixed(1)}° el</title></circle>)
  const earthPoints = result.points.filter((_,i)=>i%step===0).map((p,i)=><circle key={`earth-${i}`} cx={x(p.earth.azimuth_deg)} cy={y(p.earth.elevation_deg)} r="3" className="skyline-earth-point"><title>{formatUtc(p.timestamp_utc)} · Earth {p.earth.azimuth_deg.toFixed(1)}° az, {p.earth.elevation_deg.toFixed(1)}° el</title></circle>)
  return <div className="skyline-wrap"><div className="skyline-legend"><span><i className="skyline-terrain-key"/> Terrain skyline</span><span><i className="skyline-sun-key"/> Sun track</span><span><i className="skyline-earth-key"/> Earth track</span></div><svg className="skyline-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Terrain skyline and Sun and Earth azimuth elevation samples"><line x1={left} x2={W-right} y1={y(0)} y2={y(0)} stroke="#888" strokeDasharray="4 4"/><path d={fillPath} className="skyline-terrain-fill"/><path d={horizonPath} className="skyline-terrain-line"/><g>{sunPoints}{earthPoints}</g><text x={left} y={H-8} className="axis-label">0° · N</text><text x={W/2} y={H-8} className="axis-label" textAnchor="middle">180° · S</text><text x={W-right} y={H-8} className="axis-label" textAnchor="end">360°</text><text x={left} y={14} className="axis-label">ELEVATION (DEG)</text></svg><p className="field-help">Azimuth is horizontal position; elevation is measured above the local reference plane. The DEM skyline is interpolated between profile bins.</p></div>
}

function ResourceCard({ icon: Icon, title, summary, detail, href, action }: { icon: typeof Database; title: string; summary: string; detail: string; href: string; action: string }) {
  return <article className="resource-card"><div className="resource-icon"><Icon size={20}/></div><h3>{title}</h3><p>{summary}</p><small>{detail}</small><a href={href} target="_blank" rel="noreferrer">{action}<ExternalLink size={14}/></a></article>
}

const tourSteps: { page: Page; target: string; title: string; body: string }[] = [
  { page:'overview', target:'overview', title:'Plan against the horizon', body:'At the lunar south pole, low Sun angles make the local skyline decisive. SELENIC keeps ephemeris, terrain and assumptions visible.' },
  { page:'sites', target:'sites', title:'Define study locations', body:'Edit Moon-fixed coordinates and inspect their positions on the reference globe. These are study points, not official landing recommendations.' },
  { page:'compare', target:'compare', title:'Request real ephemerides', body:'Choose a UTC analysis interval and request Sun and Earth positions from JPL Horizons. Failures remain visible; no synthetic data is substituted.' },
  { page:'windows', target:'windows', title:'Compare mission windows', body:'Review elevation timelines, then add a verified lunar DEM to reveal how terrain changes Sun and Earth visibility.' },
  { page:'simulation', target:'simulation', title:'Run a mission power simulation', body:'Run a time-stepped solar-array, panel-temperature, DC power-bus and battery model using the live ephemeris and optional local terrain skyline.' },
]

type TourGeometry = {
  target: { left: number; top: number; width: number; height: number }
  left: number
  top: number
  width: number
  position: 'above' | 'below'
  startX: number
  startY: number
  endX: number
  endY: number
}

export default function App() {
  const [page, setPage] = useState<Page>('overview')
  const [sites, setSites] = useState<Site[]>(initialSites)
  const [date, setDate] = useState(today)
  const [startTime, setStartTime] = useState('00:00')
  const [durationHours, setDurationHours] = useState(24)
  const [stepMinutes, setStepMinutes] = useState(30)
  const [results, setResults] = useState<AnalysisResult[]>([])
  const [visibilitySummaries, setVisibilitySummaries] = useState<Record<string, VisibilitySummary>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [apiReady, setApiReady] = useState(false)
  const [notice, setNotice] = useState('No analysis has been run yet. Connect the backend, then request live JPL Horizons ephemerides.')
  const [tourIndex, setTourIndex] = useState<number | null>(null)
  const [tourGeometry, setTourGeometry] = useState<TourGeometry | null>(null)
  const [terrainFile, setTerrainFile] = useState<File | null>(null)
  const [terrainBusy, setTerrainBusy] = useState(false)
  const [terrainError, setTerrainError] = useState('')
  const [terrainProfiles, setTerrainProfiles] = useState<Record<string, TerrainProfile>>({})
  const [maxDistanceKm, setMaxDistanceKm] = useState(20)
  const [azimuthStep, setAzimuthStep] = useState(5)
  const [elevationUnit, setElevationUnit] = useState<'m'|'km'>('m')
  const [observerHeightM, setObserverHeightM] = useState(1.5)
  const [datumConfirmed, setDatumConfirmed] = useState(false)
  const [diagnosticBusy, setDiagnosticBusy] = useState(false)
  const [diagnosticMessage, setDiagnosticMessage] = useState('')
  const [diagnosticOk, setDiagnosticOk] = useState<boolean | null>(null)
  const [solarWeight, setSolarWeight] = useState(45)
  const [earthWeight, setEarthWeight] = useState(35)
  const [darknessWeight, setDarknessWeight] = useState(20)
  const [simulationSiteId, setSimulationSiteId] = useState('')
  const [missionPreset, setMissionPreset] = useState<MissionPreset>('solar-outpost')
  const [simulationLoadKw, setSimulationLoadKw] = useState(8)
  const [simulationArrayKw, setSimulationArrayKw] = useState(18)
  const [simulationBatteryKwh, setSimulationBatteryKwh] = useState(160)
  const [simulationInitialBatteryPct, setSimulationInitialBatteryPct] = useState(80)
  const [simulationUseTerrain, setSimulationUseTerrain] = useState(true)
  const [simulationArrayTiltDeg, setSimulationArrayTiltDeg] = useState(85)
  const [simulationArrayAzimuthDeg, setSimulationArrayAzimuthDeg] = useState(0)
  const [simulationSolarDistanceAu, setSimulationSolarDistanceAu] = useState(1.0)
  const [simulationMinimumBatteryPct, setSimulationMinimumBatteryPct] = useState(20)
  const [simulationMaxChargeRateC, setSimulationMaxChargeRateC] = useState(0.25)
  const [simulationMaxDischargeRateC, setSimulationMaxDischargeRateC] = useState(0.5)
  const [simulationLoadProfile, setSimulationLoadProfile] = useState<MissionLoadProfile>('steady')
  const [simulationBusy, setSimulationBusy] = useState(false)
  const [simulationError, setSimulationError] = useState('')
  const [simulationOutput, setSimulationOutput] = useState<MissionSimulation | null>(null)

  useEffect(() => { checkApi().then(setApiReady) }, [])
  useEffect(() => { setSimulationOutput(null); setSimulationError('') }, [results])
  useEffect(() => {
    if (!results.length) return
    setSimulationSiteId(results[0].site.id)
    const firstLit = results[0].points.find(point => point.sun.elevation_deg > -0.267)
    if (firstLit) setSimulationArrayAzimuthDeg(Math.round(firstLit.sun.azimuth_deg * 10) / 10)
  }, [results])
  useEffect(() => {
    if (tourIndex === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTour()
      if (event.key === 'ArrowRight') nextTour(1)
      if (event.key === 'ArrowLeft') nextTour(-1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tourIndex])
  useEffect(() => {
    if (tourIndex === null) { setTourGeometry(null); return }
    let frame = 0
    let retries = 0
    let measureTimer = 0
    let target: HTMLElement | null = null
    const measure = () => {
      if (!target || !target.isConnected) return
      const rect = target.getBoundingClientRect()
      const width = Math.min(390, window.innerWidth - 32)
      const calloutHeight = 238
      const position: 'above' | 'below' = rect.bottom + calloutHeight + 24 < window.innerHeight ? 'below' : 'above'
      const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.left + rect.width / 2 - width / 2))
      const top = position === 'below'
        ? Math.min(window.innerHeight - calloutHeight - 16, rect.bottom + 22)
        : Math.max(16, rect.top - calloutHeight - 22)
      const startX = left + width / 2
      const startY = position === 'below' ? top : top + calloutHeight
      const endX = Math.max(rect.left + 18, Math.min(rect.right - 18, rect.left + rect.width / 2))
      const endY = position === 'below' ? rect.bottom + 4 : rect.top - 4
      setTourGeometry({
        target: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        left, top, width, position, startX, startY, endX, endY,
      })
    }
    const findTarget = () => {
      target = document.querySelector<HTMLElement>(`[data-tour-target="${tourSteps[tourIndex].target}"]`)
      if (!target && retries < 12) {
        retries += 1
        frame = window.requestAnimationFrame(findTarget)
        return
      }
      if (!target) return
      target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
      measureTimer = window.setTimeout(measure, 500)
      window.addEventListener('resize', measure)
      window.addEventListener('scroll', measure, { passive: true })
    }
    frame = window.requestAnimationFrame(findTarget)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(measureTimer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure)
    }
  }, [tourIndex, page])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setCurrentIndex(current => current >= Math.max(0, results[0].points.length-1) ? 0 : current+1), 800)
    return () => window.clearInterval(timer)
  }, [playing, results])

  const index = Math.min(currentIndex, Math.max(0, (results[0]?.points.length ?? 1)-1))
  const currentTimestamp = results[0]?.points[index]?.timestamp_utc ?? `${date}T00:00:00Z`
  const live = results.length >= 2 && results.every(result => !result.is_demo)
  const cached = live && results.some(result => result.is_cached)
  const siteA = results[0], siteB = results[1]
  const analysisMatchesInputs = results.length === sites.length && results.every((result, i) => {
    const site = sites[i]
    const sameSite = result.site.id === site.id && result.site.name === site.name &&
      result.site.latitude_deg === site.latitude_deg &&
      result.site.longitude_east_deg === site.longitude_east_deg &&
      result.site.altitude_km === site.altitude_km
    const sameWindow = result.duration_hours === durationHours && result.step_minutes === stepMinutes &&
      result.start_utc.slice(0, 16) === `${date}T${startTime}`
    return sameSite && sameWindow
  })
  const summary = useMemo(() => {
    if (!siteA || !siteB) return 'Run a comparison to inspect the two candidate locations.'
    const sunDelta = siteA.metrics.sunlight_hours_sampled-siteB.metrics.sunlight_hours_sampled
    const earthDelta = siteA.metrics.earth_visibility_hours_sampled-siteB.metrics.earth_visibility_hours_sampled
    if (Math.abs(sunDelta)<0.2 && Math.abs(earthDelta)<0.2) return 'The candidates are closely matched in the current sampled geometric metrics.'
    return `${sunDelta>=0?siteA.site.name:siteB.site.name} has the longer sampled sunlight interval; ${earthDelta>=0?siteA.site.name:siteB.site.name} has the longer Earth-above-horizon interval.`
  }, [siteA,siteB])

  const simulationSite = results.find(result => result.site.id === simulationSiteId) ?? results[0]
  const simulationProfile = simulationSite && analysisMatchesInputs && simulationUseTerrain ? terrainProfiles[simulationSite.site.id] : undefined
  const simulationInputs: MissionSimulationInputs = {
    load_kw: simulationLoadKw,
    solar_array_rated_kw: simulationArrayKw,
    battery_capacity_kwh: simulationBatteryKwh,
    initial_battery_percent: simulationInitialBatteryPct,
    minimum_battery_percent: simulationMinimumBatteryPct,
    array_tilt_deg: simulationArrayTiltDeg,
    array_azimuth_deg: simulationArrayAzimuthDeg,
    load_profile: simulationLoadProfile,
    cell_efficiency_stc: 0.28,
    pv_temperature_coefficient_per_c: -0.0035,
    panel_absorptivity: 0.90,
    panel_emissivity: 0.85,
    panel_areal_heat_capacity_j_m2k: 12000,
    initial_panel_temperature_k: 250,
    radiative_sink_temperature_k: 120,
    support_temperature_k: 250,
    mount_thermal_conductance_w_m2k: 1.0,
    solar_irradiance_w_m2: 1361,
    solar_distance_au: simulationSolarDistanceAu,
    mppt_efficiency: 0.96,
    power_bus_efficiency: 0.98,
    array_degradation_factor: 1.0,
    battery_charge_efficiency: 0.95,
    battery_discharge_efficiency: 0.95,
    maximum_charge_rate_c: simulationMaxChargeRateC,
    maximum_discharge_rate_c: simulationMaxDischargeRateC,
  }
  const runSimulation = async () => {
    if (!simulationSite || !analysisMatchesInputs) return
    setSimulationBusy(true)
    setSimulationError('')
    setSimulationOutput(null)
    try {
      const output = await requestMissionSimulation(simulationSite, simulationProfile, simulationInputs)
      setSimulationOutput(output)
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : 'Mission simulation could not be completed.')
    } finally {
      setSimulationBusy(false)
    }
  }
  const applyMissionPreset = (preset: MissionPreset) => {
    setMissionPreset(preset)
    if (preset === 'solar-outpost') {
      setSimulationLoadKw(8); setSimulationArrayKw(18); setSimulationBatteryKwh(160); setSimulationInitialBatteryPct(80)
      setSimulationMinimumBatteryPct(20); setSimulationArrayTiltDeg(85); setSimulationArrayAzimuthDeg(0); setSimulationSolarDistanceAu(1.0)
      setSimulationMaxChargeRateC(0.25); setSimulationMaxDischargeRateC(0.5); setSimulationLoadProfile('steady')
    } else if (preset === 'crew-exploration') {
      setSimulationLoadKw(12); setSimulationArrayKw(24); setSimulationBatteryKwh(240); setSimulationInitialBatteryPct(85)
      setSimulationMinimumBatteryPct(25); setSimulationArrayTiltDeg(80); setSimulationArrayAzimuthDeg(0); setSimulationSolarDistanceAu(1.0)
      setSimulationMaxChargeRateC(0.3); setSimulationMaxDischargeRateC(0.6); setSimulationLoadProfile('crew_cycle')
    } else {
      setSimulationLoadKw(3); setSimulationArrayKw(8); setSimulationBatteryKwh(72); setSimulationInitialBatteryPct(90)
      setSimulationMinimumBatteryPct(30); setSimulationArrayTiltDeg(80); setSimulationArrayAzimuthDeg(0); setSimulationSolarDistanceAu(1.0)
      setSimulationMaxChargeRateC(0.2); setSimulationMaxDischargeRateC(0.4); setSimulationLoadProfile('steady')
    }
    setSimulationOutput(null)
  }

  const updateSite = (i: number, next: Site) => {
    setSites(old => old.map((site,index) => index===i ? next : site))
    setTerrainProfiles(old => {
      const updated = { ...old }
      delete updated[next.id]
      return updated
    })
    setVisibilitySummaries(old => { const updated = { ...old }; delete updated[next.id]; return updated })
    setNotice('A study point changed. Re-run the comparison before interpreting the existing results; its previous terrain profile and summary were cleared.')
  }
  const goTo = (next: Page) => { setPage(next); setPlaying(false); window.scrollTo({top:0,behavior:'smooth'}) }
  const startTour = () => { setTourIndex(0); setPage(tourSteps[0].page); window.scrollTo({top:0,behavior:'smooth'}) }
  const closeTour = () => setTourIndex(null)
  const nextTour = (direction: number) => {
    const next = (tourIndex ?? 0) + direction
    if (next < 0) return
    if (next >= tourSteps.length) { closeTour(); return }
    setTourGeometry(null)
    setTourIndex(next); setPage(tourSteps[next].page); window.scrollTo({top:0,behavior:'smooth'})
  }

  const runHorizonsDiagnostic = async () => {
    setDiagnosticBusy(true)
    setDiagnosticMessage('Sending a small test observation request to JPL Horizons…')
    setDiagnosticOk(null)
    try {
      const result = await diagnoseHorizons()
      setDiagnosticOk(true)
      setDiagnosticMessage(`JPL Horizons is responding. ${result.sample_count} Sun samples received; first elevation ${result.first_sample.elevation_deg.toFixed(2)}° at ${formatUtc(result.first_sample.timestamp_utc)}.`)
    } catch (error) {
      setDiagnosticOk(false)
      setDiagnosticMessage(error instanceof Error ? error.message : 'The JPL diagnostic could not be completed.')
    } finally {
      setDiagnosticBusy(false)
    }
  }

  const runAnalysis = async () => {
    const invalid = sites.find(site => !site.name.trim() || !Number.isFinite(site.latitude_deg) || site.latitude_deg < -90 || site.latitude_deg > 90 || !Number.isFinite(site.longitude_east_deg) || site.longitude_east_deg < 0 || site.longitude_east_deg >= 360 || !Number.isFinite(site.altitude_km) || site.altitude_km < -5 || site.altitude_km > 20)
    if (invalid) { setNotice(`Check ${invalid.name || 'a candidate site'}: use latitude −90° to 90°, east longitude 0° to less than 360°, and altitude −5 to 20 km.`); return }
    if (!date || !startTime) { setNotice('Select a valid UTC date and start time.'); return }
    setLoading(true); setPlaying(false); setNotice('Requesting Sun and Earth observer ephemerides from JPL Horizons…')
    try {
      const liveResults = await fetchComparison(sites,date,startTime,durationHours,stepMinutes)
      setResults(liveResults); setCurrentIndex(0); setApiReady(true)
      const updatedSummaries: Record<string, VisibilitySummary> = {}
      const summaryErrors: string[] = []
      for (const result of liveResults) {
        const profile = terrainProfiles[result.site.id]
        if (profile) {
          try { updatedSummaries[result.site.id] = await fetchVisibilitySummary(result, profile) }
          catch (error) { summaryErrors.push(`${result.site.name}: ${error instanceof Error ? error.message : 'unknown error'}`) }
        }
      }
      setVisibilitySummaries(updatedSummaries)
      setNotice(summaryErrors.length
        ? `Live JPL Horizons ephemerides received, but the terrain decision summary failed for: ${summaryErrors.join(' · ')}`
        : 'Live JPL Horizons ephemerides received. Terrain profiles, when present, are evaluated separately by the backend visibility model.')
    } catch (error) {
      setApiReady(false)
      setNotice(`Live JPL data could not be retrieved. Existing results, if any, have been left unchanged. ${error instanceof Error ? error.message : ''}`)
    } finally { setLoading(false) }
  }
  const processTerrain = async () => {
    if (!terrainFile) { setTerrainError('Choose a lunar GeoTIFF file first.'); return }
    if (!datumConfirmed) { setTerrainError('Confirm that the DEM uses a documented lunar coordinate reference and known elevation units.'); return }
    setTerrainBusy(true); setTerrainError('')
    try {
      const options = { maxDistanceKm, azimuthStep, elevationUnit, observerHeightM }
      const profileResults = await fetchTerrainProfiles(terrainFile, sites, options)
      const nextProfiles = Object.fromEntries(profileResults.map(profile => [profile.site.id, profile])) as Record<string, TerrainProfile>
      setTerrainProfiles(nextProfiles)
      const nextSummaries: Record<string, VisibilitySummary> = {}
      const summaryErrors: string[] = []
      for (const result of results) {
        const profile = nextProfiles[result.site.id]
        if (profile && !result.is_demo) {
          try { nextSummaries[result.site.id] = await fetchVisibilitySummary(result, profile) }
          catch (error) { summaryErrors.push(`${result.site.name}: ${error instanceof Error ? error.message : 'unknown error'}`) }
        }
      }
      setVisibilitySummaries(nextSummaries)
      if (summaryErrors.length) {
        setNotice(`Terrain profiles are ready, but one or more visibility summaries could not be calculated. ${summaryErrors.join(' · ')}`)
      } else if (results.length && results.every(result => result.is_demo)) {
        setNotice('Terrain profiles calculated. The skyline plot is available, but decision metrics require real JPL Horizons ephemerides; preview curves are not used for scientific metrics.')
      } else if (results.length && !analysisMatchesInputs) {
        setNotice('Terrain profiles calculated, but the displayed ephemerides do not match the current site or time settings. Re-run the comparison before interpreting a combined skyline or decision summary.')
      } else {
        setNotice('Terrain profiles calculated. The skyline plot is ready; finite-disc and decision metrics are calculated only for sites with real JPL Horizons ephemerides.')
      }
    } catch (error) { setTerrainError(error instanceof Error ? error.message : 'Terrain processing failed.') }
    finally { setTerrainBusy(false) }
  }

  const lolaQueryUrl = useMemo(() => {
    const pad = 0.04
    const minLat = Math.max(-90,Math.min(...sites.map(s=>s.latitude_deg))-pad)
    const maxLat = Math.min(90,Math.max(...sites.map(s=>s.latitude_deg))+pad)
    const longitudes = sites.map(s=>s.longitude_east_deg).sort((a,b)=>a-b)
    const west = Math.max(0,longitudes[0]-pad), east = Math.min(360,longitudes[1]+pad)
    const params = new URLSearchParams({query:'lolardr',results:'vsi',westernlon:west.toFixed(4),easternlon:east.toFixed(4),minlat:minLat.toFixed(4),maxlat:maxLat.toFixed(4)})
    return `https://oderest.rsl.wustl.edu/livegds?${params.toString()}`
  }, [sites])

  return <div className="app-shell">
    <header className="app-header">
      <div className="header-topline">
        <button className="brand" onClick={()=>goTo('overview')} aria-label="SELENIC overview"><span className="brand-symbol">S</span><span className="brand-text"><strong>SELENIC</strong><small>LUNAR LANDING INTELLIGENCE</small></span></button>
        <div className="header-actions"><span className={`api-state ${apiReady?'online':''}`}><i/> {apiReady?'API available':'API offline'}</span><button className="tour-button" onClick={startTour}><CircleHelp size={16}/> Guided tour</button></div>
      </div>
      <nav className="main-nav" aria-label="Main navigation" data-tour-target="navigation">{navItems.map(item=>{const Icon=item.icon;return <button key={item.id} className={page===item.id?'active':''} aria-current={page===item.id?'page':undefined} onClick={()=>goTo(item.id)}><Icon size={17}/><span>{item.label}</span></button>})}</nav>
    </header>
    <main className="page-shell">
      {page==='overview' && <>
        <section className="home-hero" data-tour-target="overview">
          <div className="hero-copy"><span className="eyebrow">FIELD STUDY 001 · LUNAR SOUTH POLE</span><h1>Plan against<br/><em>the horizon.</em></h1><p>See how the lunar skyline changes visibility, discover promising operating windows and compare candidate sites with transparent mission criteria.</p><div className="hero-actions"><button className="button button-dark" onClick={()=>goTo('sites')}>Explore candidate sites <ArrowRight size={16}/></button><button className="button button-light" onClick={startTour}>Take the guided tour</button></div><span className="hero-caption">INDEPENDENT PLANETARY ENGINEERING · SELENIC</span></div>
          <div className="hero-globe"><div className="hero-globe-title"><span>MOON / SOUTH POLAR VIEW</span><span>INTERACTIVE REFERENCE</span></div><MoonGlobe sites={sites}/><div className="hero-globe-foot"><span>DRAG TO ROTATE · SCROLL TO ZOOM</span><span>LRO WAC IMAGE · NOT TERRAIN RELIEF</span></div></div>
        </section>
        <section className="overview-intro"><div><span className="eyebrow">A LUNAR MISSION WORKSPACE</span><h2>See the horizon.<br/>Choose the window.</h2></div><p>One workspace for terrain-aware visibility, mission-window discovery and explainable site comparison.</p></section>
        <section className="home-cards">{navItems.filter(item=>['sites','compare','windows','simulation'].includes(item.id)).map(item=>{const Icon=item.icon;const descriptions:Record<string,string>={'sites':'Set coordinates and see where two candidate locations sit on the lunar globe.','compare':'Run the same time window at both locations and compare Sun and Earth geometry.','windows':'Scrub through the mission interval and inspect rise, set and visibility windows.','simulation':'Run a time-stepped solar-array, thermal and battery simulation against the selected ephemeris and terrain skyline.','terrain':'Upload a verified lunar elevation grid and calculate local terrain obstruction.'};return <button key={item.id} className="home-card" onClick={()=>goTo(item.id)}><span className="home-card-icon"><Icon size={21}/></span><span className="home-card-number">0{navItems.findIndex(n=>n.id===item.id)}</span><h3>{item.label}</h3><p>{descriptions[item.id]}</p><span className="card-link">Open workspace <ArrowRight size={15}/></span></button>})}</section>
      </>}

      {page==='sites' && <>
        <PageHeading eyebrow="WORKSPACE 01 · LOCATION" title="Explore candidate sites" description="Define 2–5 lunar study points. Edit their coordinates and inspect their spatial relationship on the reference globe." />
        <section className="explorer-layout" data-tour-target="sites"><div className="explorer-globe panel"><div className="panel-title"><div><span className="eyebrow">LUNAR ORIENTATION</span><h2>Candidate locations</h2></div><span className="source-label">3D REFERENCE</span></div><MoonGlobe sites={sites}/><div className="globe-helper">{sites.map((site,i)=><span key={site.id}><i className={`dot ${i%2?'dot-b':'dot-a'}`}/> {String.fromCharCode(65+i)} · {site.name}</span>)}<small>Markers show entered coordinates; image texture is not elevation relief.</small></div></div><div className="site-editors">{sites.map((site,i)=><div className="site-editor-wrap" key={site.id}><SiteEditor site={site} label={String.fromCharCode(65+i)} onChange={value=>updateSite(i,value)}/>{sites.length>2&&<button className="text-button remove-site" onClick={()=>{setSites(old=>old.filter((_,index)=>index!==i));setResults([]);setTerrainProfiles({});setVisibilitySummaries({});setNotice('Candidate removed. Run a fresh comparison for the updated site set.')}}>Remove candidate</button>}</div>)}<div className="editor-actions"><button className="button button-dark" onClick={()=>goTo('compare')}>Continue to analysis <ArrowRight size={16}/></button><button className="button button-light" onClick={()=>{setSites(initialSites);setResults([]);setTerrainProfiles({});setVisibilitySummaries({})}}><RotateCcw size={15}/> Reset study points</button><button className="button button-light" disabled={sites.length>=5} onClick={()=>{const n=sites.length;const last=sites[n-1];setSites(old=>[...old,{id:`study-point-${n+1}`,name:`South-polar study point ${String.fromCharCode(65+n)}`,latitude_deg:Math.max(-89.8,last.latitude_deg+0.15),longitude_east_deg:(last.longitude_east_deg+12)%360,altitude_km:0}]);setResults([]);setTerrainProfiles({});setVisibilitySummaries({});setNotice('New candidate added. Set its coordinates, then run a fresh comparison.')}}>+ Add candidate ({sites.length}/5)</button></div></div></section>
      </>}

      {page==='compare' && <>
        <PageHeading eyebrow="WORKSPACE 02 · ANALYSIS" title="Compare the local sky" description="Use one UTC interval for all selected sites. Identical samples make the candidate comparison easier to interpret." />
        <section className="analysis-controls panel" data-tour-target="compare"><div className="analysis-control-intro"><span className="eyebrow">ANALYSIS WINDOW</span><h2>Choose an analysis interval</h2><p>All times are UTC. Plan up to 30 days per request; the API enforces a 2,000-row limit to keep requests bounded.</p></div><div className="analysis-fields"><label>Analysis start · UTC date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Start time · UTC<input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)}/></label><label>Duration<select value={durationHours} onChange={e=>{const next=Number(e.target.value);setDurationHours(next);if(Math.floor(next*60/stepMinutes)+1>2000)setStepMinutes(30)}}><option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option><option value={48}>48 hours</option><option value={72}>72 hours · 3 days</option><option value={168}>168 hours · 1 week</option><option value={336}>336 hours · 2 weeks</option><option value={720}>720 hours · 30 days</option></select></label><label>Sample interval<select value={stepMinutes} onChange={e=>setStepMinutes(Number(e.target.value))}><option value={15} disabled={Math.floor(durationHours*60/15)+1>2000}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select></label></div><div className="analysis-actions"><button className="button button-dark" onClick={runAnalysis} disabled={loading}>{loading?'Requesting ephemerides…':'Run live comparison'} <ArrowRight size={16}/></button><span className={`result-mode ${live?'live':'demo'}`}>{cached?'JPL HORIZONS · CACHE':live?'LIVE · JPL HORIZONS':results.length?'RESULTS LOADED':'NO ANALYSIS YET'}</span></div></section>
        <section className="horizons-diagnostic" aria-live="polite"><div><strong>JPL Horizons connection</strong><p>Test one real Sun observation before requesting a full two-site comparison.</p></div><button className="button button-light" onClick={runHorizonsDiagnostic} disabled={diagnosticBusy}>{diagnosticBusy?'Testing…':'Test JPL connection'} <ArrowRight size={15}/></button>{diagnosticMessage&&<p className={diagnosticOk===false?'diagnostic-error':'diagnostic-message'}>{diagnosticMessage}</p>}</section>
        <div className="notice-box"><Info size={17}/><p>{notice}</p></div>
        {results.length>0 && !analysisMatchesInputs && <div className="stale-results" role="status"><Info size={16}/><p>The current form settings differ from the last analysis. Run the comparison again to refresh the displayed results.</p></div>}
        {results.length===0&&<div className="empty-analysis panel"><span className="eyebrow">READY FOR A LIVE RUN</span><h2>No ephemeris loaded</h2><p>Choose your study points and analysis interval, then run a live comparison. SELENIC will not substitute invented curves when JPL is unavailable.</p><button className="button button-dark" onClick={goTo.bind(null,'sites')}>Review study points <ArrowRight size={15}/></button></div>}
        <section className="compare-grid">{[siteA,siteB].map((result,i)=>{if(!result)return null;const point=result.points[index];const terrain=terrainProfiles[result.site.id];return <article className="compare-card panel" key={result.site.id}><div className="compare-card-head"><span className={`site-token token-${i?'b':'a'}`}>{i?'B':'A'}</span><div><h2>{result.site.name}</h2><p>{result.site.latitude_deg.toFixed(3)}° · {result.site.longitude_east_deg.toFixed(3)}° E</p></div></div><HorizonInstrument sun={point.sun} earth={point.earth}/><div className="sky-readout"><div><span><Sun size={15}/> Sun · azimuth {point.sun.azimuth_deg.toFixed(1)}°</span><strong>{formatAngle(point.sun.elevation_deg)}</strong></div><div><span><Globe2 size={15}/> Earth · azimuth {point.earth.azimuth_deg.toFixed(1)}°</span><strong>{formatAngle(point.earth.elevation_deg)}</strong></div></div><div className="visibility-tags"><span>{point.sun.elevation_deg>=0?'Sun above geometric horizon':'Sun below geometric horizon'}</span><span>{point.earth.elevation_deg>=0?'Earth above geometric horizon':'Earth below geometric horizon'}</span></div>{terrain?<p className="terrain-status"><Check size={14}/> DEM horizon profile available for this site.</p>:<p className="terrain-status muted">Terrain obstruction not applied. Add a compatible DEM on Terrain Analysis.</p>}</article>})}</section>
        <section className="comparison-summary panel"><span className="eyebrow">CURRENT COMPARISON</span><h2>What changes between the two study points?</h2><p>{summary}</p><div className="summary-metrics"><div><span>A · SUN ABOVE</span><strong>{siteA?.metrics.sunlight_hours_sampled.toFixed(1)??'—'} h</strong></div><div><span>A · EARTH VISIBLE</span><strong>{siteA?.metrics.earth_visibility_hours_sampled.toFixed(1)??'—'} h</strong></div><div><span>B · SUN ABOVE</span><strong>{siteB?.metrics.sunlight_hours_sampled.toFixed(1)??'—'} h</strong></div><div><span>B · EARTH VISIBLE</span><strong>{siteB?.metrics.earth_visibility_hours_sampled.toFixed(1)??'—'} h</strong></div></div>{results.length>0&&<><button className="button button-light" onClick={()=>exportCsv(results,analysisMatchesInputs?terrainProfiles:{},analysisMatchesInputs?visibilitySummaries:{})}><Download size={16}/> Export comparison CSV</button><div className="comparison-next-actions"><button className="button button-dark" onClick={()=>goTo('windows')}><Clock3 size={15}/> Open Mission Planner</button><button className="button button-light" onClick={()=>goTo('simulation')}><BatteryCharging size={15}/> Run Mission Simulation</button></div></>}</section>
      </>}

      {page==='windows' && <>
        <PageHeading eyebrow="WORKSPACE 03 · TIME" title="Follow the mission windows" description="Explore how the Sun and Earth move relative to each candidate's local horizon throughout the selected analysis period." />
        {results.length===0&&<div className="empty-analysis panel"><span className="eyebrow">NO EPHEMERIS LOADED</span><h2>Mission windows need live positions</h2><p>Run a comparison first. Then upload a compatible lunar DEM to see the skyline and terrain-adjusted joint windows.</p><button className="button button-dark" onClick={()=>goTo('compare')}>Run a comparison <ArrowRight size={15}/></button></div>}
        {results.length>0&&<section className="timeline-workspace panel" data-tour-target="windows"><div className="panel-title"><div><span className="eyebrow">EPHEMERIS TIMELINE</span><h2>Elevation through time</h2></div><div className="chart-legend"><span><i className="sun-key"/> Sun</span><span><i className="earth-key"/> Earth</span><span>0° = geometric horizon</span></div></div>{results.map((result,i)=><div className="chart-block" key={result.site.id}><div className="chart-head"><div><span className={`site-token token-${i?'b':'a'}`}>{i?'B':'A'}</span><strong>{result.site.name}</strong></div><small>{result.step_minutes}-minute samples · {result.source}{result.is_cached?' · cached':''}</small></div><ElevationChart result={result} activeIndex={index}/></div>)}<div className="timeline-scrubber"><button className="play-control" onClick={()=>setPlaying(v=>!v)} aria-label={playing?'Pause timeline':'Play timeline'}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><div><input type="range" min="0" max={Math.max(0,(results[0]?.points.length??1)-1)} value={index} onChange={e=>setCurrentIndex(Number(e.target.value))}/><div className="scrubber-meta"><span>START</span><strong>{formatUtc(currentTimestamp)}</strong><span>END</span></div></div></div></section>}
        <section className="window-cards">{results.map((result,i)=>{const profile=analysisMatchesInputs?terrainProfiles[result.site.id]:undefined;const visibility=analysisMatchesInputs?visibilitySummaries[result.site.id]:undefined;return <article className="window-card panel" key={result.site.id}><span className="eyebrow">STUDY POINT {String.fromCharCode(65+i)}</span><h3>{result.site.name}</h3><div className="window-stat"><span>Geometric sunlight</span><strong>{result.metrics.sunlight_hours_sampled.toFixed(1)} h</strong></div><div className="window-stat"><span>Geometric Earth visibility</span><strong>{result.metrics.earth_visibility_hours_sampled.toFixed(1)} h</strong></div>{profile? <><SkylinePlot result={result} profile={profile}/>{visibility? <><div className="window-stat terrain-stat"><span>Finite-disc Sun visibility</span><strong>{visibility.sun_visible_disc_hours.toFixed(1)} h</strong></div><div className="window-stat terrain-stat"><span>Finite-disc Earth visibility</span><strong>{visibility.earth_visible_disc_hours.toFixed(1)} h</strong></div><div className="window-stat decision-stat"><span>Joint Sun + Earth window</span><strong>{visibility.joint_sun_and_earth_hours.toFixed(1)} h</strong></div><div className="window-stat decision-stat"><span>Longest continuous darkness</span><strong>{visibility.longest_continuous_dark_interval?.hours.toFixed(1)??'—'} h</strong></div><div className="window-stat decision-stat"><span>Best joint window</span><strong>{visibility.best_joint_window?.hours.toFixed(1)??'—'} h</strong></div><p className="field-help">{visibility.earth_eclipses_sun_possible?'Possible Earth-on-Sun eclipse sampled in this interval.':'No Earth-on-Sun eclipse detected at the selected sample times.'}</p><p className="field-help">Computed from {profile.filename}. Earth angular radius uses a nominal 0.95° approximation; review model notes before interpretation.</p></>:<><div className="window-stat terrain-stat"><span>Terrain-adjusted sampled sunlight · geometric</span><strong>{terrainAdjustedHours(result,profile,'sun').toFixed(1)} h</strong></div><div className="window-stat terrain-stat"><span>Terrain-adjusted sampled Earth visibility · geometric</span><strong>{terrainAdjustedHours(result,profile,'earth').toFixed(1)} h</strong></div><p className="field-help">The finite-disc and joint-window summary is unavailable for this result. {result.is_demo?'Illustrative preview data are not used for scientific decision metrics.':'Re-run the analysis or check the backend visibility-summary endpoint.'}</p></>}</>:<p className="field-help">Upload a compatible lunar DEM on Terrain Analysis to calculate obstruction-adjusted estimates and the skyline plot.</p>}</article>})}</section>
        {results.length>0&&<section className="decision-lab">
          <header className="decision-heading"><span className="eyebrow">SELENIC DECISION ENGINE</span><h2>From visibility to a mission decision</h2><p>Explore the current sampled interval. Terrain-aware estimates are used when a DEM profile is loaded; otherwise results are explicitly geometric.</p></header>
          <section className="horizon-flip panel"><div className="panel-title"><div><span className="eyebrow">SIGNATURE FEATURE · HORIZON FLIP</span><h3>Same sky. Different horizon.</h3><p>Compare the smooth reference horizon with the local terrain skyline.</p></div><span className="source-label">{analysisMatchesInputs?'CURRENT ANALYSIS':'STALE ANALYSIS'}</span></div>
          {results.slice(0,1).map(result=>{const profile=analysisMatchesInputs?terrainProfiles[result.site.id]:undefined;const flat=result.metrics.sunlight_hours_sampled;const terrain=profile?terrainAdjustedHours(result,profile,'sun'):null;const earthFlat=result.metrics.earth_visibility_hours_sampled;const earthTerrain=profile?terrainAdjustedHours(result,profile,'earth'):null;return <div className="flip-site" key={result.site.id}><strong>{result.site.name}</strong><span>{formatAngle(result.site.latitude_deg)} · {result.site.longitude_east_deg.toFixed(2)}° E</span><div className="flip-values"><div><small>FLAT-HORIZON SUN</small><b>{flat.toFixed(1)} h</b></div><div><small>{profile?'TERRAIN-ADJUSTED SUN':'TERRAIN PROFILE'}</small><b>{terrain===null?'Not loaded':`${terrain.toFixed(1)} h`}</b></div></div>{profile?<><div className="flip-delta">{Math.abs(flat-(terrain??0)).toFixed(1)} h sampled difference</div><div className="flip-values secondary"><div><small>FLAT-HORIZON EARTH</small><b>{earthFlat.toFixed(1)} h</b></div><div><small>TERRAIN EARTH</small><b>{(earthTerrain??0).toFixed(1)} h</b></div></div><SkylinePlot result={result} profile={profile}/></>:<div className="flip-empty"><Layers3 size={20}/><p>Upload a verified lunar DEM to reveal how crater rims and ridges change the answer.</p><button className="button button-dark" onClick={()=>goTo('terrain')}>Add terrain profile <ArrowRight size={15}/></button></div>}</div>})}</section>
          <section className="window-finder panel"><div className="panel-title"><div><span className="eyebrow">MISSION WINDOW FINDER</span><h3>Daily visibility scan</h3><p>Each cell summarizes one UTC day inside the current analysis. This is not a year-long forecast.</p></div><span className="source-label">{results[0]?.duration_hours} HOUR SCAN</span></div><div className="window-heat-legend"><span><i className="heat-low"/> Lower</span><span><i className="heat-mid"/> Mixed</span><span><i className="heat-high"/> Higher</span></div>
          <div className="heatmap-sites">{results.map((result,ri)=>{const profile=analysisMatchesInputs?terrainProfiles[result.site.id]:undefined;const days=new Map<string,{sun:number;earth:number;n:number}>();result.points.forEach(point=>{const day=point.timestamp_utc.slice(0,10),v=days.get(day)??{sun:0,earth:0,n:0};v.sun+=((profile?point.sun.elevation_deg>=horizonAt(profile,point.sun.azimuth_deg):point.sun.elevation_deg>=0)?1:0);v.earth+=((profile?point.earth.elevation_deg>=horizonAt(profile,point.earth.azimuth_deg):point.earth.elevation_deg>=0)?1:0);v.n++;days.set(day,v)});return <div className="heatmap-row" key={result.site.id}><strong>{result.site.name}</strong><div className="heatmap-cells">{Array.from(days.entries()).map(([day,v])=>{const f=(v.sun+v.earth)/(2*v.n),level=f>=.66?'high':f>=.33?'mid':'low';return <div className={`heat-cell ${level}`} key={day} title={`${day} UTC · Sun ${(100*v.sun/v.n).toFixed(0)}% · Earth ${(100*v.earth/v.n).toFixed(0)}%`}><span>{new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'})}</span></div>})}</div></div>})}</div><p className="field-help">Hover over a day for sampled Sun and Earth visibility fractions. DEM horizons are applied when available.</p></section>
          <section className="ranking-panel panel"><div className="panel-title"><div><span className="eyebrow">EXPLAINABLE SITE RANKING</span><h3>Which site best fits this mission?</h3><p>Adjust priorities. Scores are relative to the current candidates, not a landing-safety certification.</p></div><span className="source-label">DECISION AID</span></div>
          <div className="mission-presets"><span>Mission profile</span><button className="button button-light" onClick={()=>{setSolarWeight(55);setEarthWeight(15);setDarknessWeight(30)}}>Solar outpost</button><button className="button button-light" onClick={()=>{setSolarWeight(35);setEarthWeight(35);setDarknessWeight(30)}}>Crew exploration</button><button className="button button-light" onClick={()=>{setSolarWeight(15);setEarthWeight(65);setDarknessWeight(20)}}>Communications relay</button></div><div className="weight-controls"><label>Sun visibility <b>{solarWeight}%</b><input type="range" min="0" max="100" value={solarWeight} onChange={e=>setSolarWeight(Number(e.target.value))}/></label><label>Earth visibility <b>{earthWeight}%</b><input type="range" min="0" max="100" value={earthWeight} onChange={e=>setEarthWeight(Number(e.target.value))}/></label><label>Darkness resilience <b>{darknessWeight}%</b><input type="range" min="0" max="100" value={darknessWeight} onChange={e=>setDarknessWeight(Number(e.target.value))}/></label></div>
          {(()=>{const rows=results.map(result=>{const vis=analysisMatchesInputs?visibilitySummaries[result.site.id]:undefined,profile=analysisMatchesInputs?terrainProfiles[result.site.id]:undefined,sun=vis?.sun_visible_disc_hours??(profile?terrainAdjustedHours(result,profile,'sun'):result.metrics.sunlight_hours_sampled),earth=vis?.earth_visible_disc_hours??(profile?terrainAdjustedHours(result,profile,'earth'):result.metrics.earth_visibility_hours_sampled),dark=vis?.longest_continuous_dark_interval?.hours??Math.max(0,result.duration_hours-sun);return {result,sun,earth,dark}});const ms=Math.max(1,...rows.map(x=>x.sun)),me=Math.max(1,...rows.map(x=>x.earth)),md=Math.max(...rows.map(x=>x.dark)),nd=Math.min(...rows.map(x=>x.dark)),w=Math.max(1,solarWeight+earthWeight+darknessWeight);return <div className="ranked-sites">{rows.map(x=>({...x,score:100*(solarWeight*x.sun/ms+earthWeight*x.earth/me+darknessWeight*(md===nd?1:(md-x.dark)/(md-nd)))/w})).sort((a,b)=>b.score-a.score).map((x,i)=><article className="ranked-site" key={x.result.site.id}><span className="rank-number">{i+1}</span><div className="rank-main"><div className="rank-title"><strong>{x.result.site.name}</strong><b>{x.score.toFixed(0)}<small>/100</small></b></div><div className="rank-bar"><span style={{width:`${x.score}%`}}/></div><p>{x.sun.toFixed(1)} h Sun · {x.earth.toFixed(1)} h Earth · {x.dark.toFixed(1)} h darkness</p><small>{analysisMatchesInputs&&terrainProfiles[x.result.site.id]?'Terrain-adjusted sampled inputs':'Geometric inputs; terrain not applied'}</small></div></article>)}</div>})()}
          <p className="field-help">Weights are normalized automatically. Slope and roughness are excluded until validated raster calculations are available.</p></section>
        </section>}
        <div className="notice-box"><Info size={17}/><p>Geometric values use a zero-degree reference horizon. DEM-adjusted windows use the uploaded local terrain profile; they remain sampled estimates and do not constitute a certified power or communications model.</p></div>
      </>}


      {page==='simulation' && <>
        <PageHeading eyebrow="WORKSPACE 04 · LUNAR POWER SYSTEM SIMULATION" title="Simulate a mission power system" description="Run a backend time-step model of the solar array, panel temperature, power conversion and battery. Results are driven by the selected JPL Horizons ephemeris and optional DEM skyline." />
        {results.length===0 && <div className="empty-analysis panel"><span className="eyebrow">NO EPHEMERIS LOADED</span><h2>Simulation needs a live comparison first</h2><p>Run a JPL Horizons comparison before simulating. SELENIC does not invent Sun or Earth positions when data is missing.</p><button className="button button-dark" onClick={()=>goTo('compare')}>Run a comparison <ArrowRight size={15}/></button></div>}
        {results.length>0 && !analysisMatchesInputs && <div className="stale-results" role="status"><Info size={16}/><p>The study points or analysis interval have changed since the last comparison. Run the comparison again before starting a mission simulation.</p><button className="button button-light" onClick={()=>goTo('compare')}>Review analysis <ArrowRight size={14}/></button></div>}
        {results.length>0 && analysisMatchesInputs && <>
          <section className="simulation-setup panel" data-tour-target="simulation">
            <div className="panel-title"><div><span className="eyebrow">SCENARIO CONFIGURATION</span><h2>Configure the mission electrical power system</h2><p>Presets are editable starting scenarios, not actual Artemis hardware specifications.</p></div><span className="source-label">TIME-STEPPED MODEL · 5 MIN</span></div>
            <div className="simulation-site-row"><label>Candidate site<select value={simulationSite?.site.id ?? ''} onChange={event=>{setSimulationSiteId(event.target.value);setSimulationOutput(null)}}>{results.map(result=><option key={result.site.id} value={result.site.id}>{result.site.name}</option>)}</select></label><label className="simulation-terrain-toggle"><input type="checkbox" checked={Boolean(terrainProfiles[simulationSite?.site.id ?? '']) && simulationUseTerrain} onChange={event=>{setSimulationUseTerrain(event.target.checked);setSimulationOutput(null)}} disabled={!terrainProfiles[simulationSite?.site.id ?? '']}/> Apply uploaded local DEM skyline {terrainProfiles[simulationSite?.site.id ?? ''] ? <span className="sim-inline-status">available</span> : <span className="sim-inline-status muted">no DEM profile for this site</span>}</label></div>
            <div className="simulation-presets" role="group" aria-label="Mission profile presets">
              <button aria-pressed={missionPreset==='solar-outpost'} className={missionPreset==='solar-outpost'?'selected':''} onClick={()=>applyMissionPreset('solar-outpost')}><Sun size={18}/><strong>Solar outpost</strong><span>Steady station load</span></button>
              <button aria-pressed={missionPreset==='crew-exploration'} className={missionPreset==='crew-exploration'?'selected':''} onClick={()=>applyMissionPreset('crew-exploration')}><Activity size={18}/><strong>Crew exploration</strong><span>Scheduled crew activity</span></button>
              <button aria-pressed={missionPreset==='communications-relay'} className={missionPreset==='communications-relay'?'selected':''} onClick={()=>applyMissionPreset('communications-relay')}><RadioTower size={18}/><strong>Communications relay</strong><span>Lower, continuous load</span></button>
            </div>
            <div className="simulation-inputs">
              <label>Base electrical load <span>kW</span><input type="number" min="0.1" max="100000" step="0.1" value={simulationLoadKw} onChange={event=>{setSimulationLoadKw(Number(event.target.value));setSimulationOutput(null)}}/></label>
              <label>Solar-array rated power <span>kWp at 1,000 W/m²</span><input type="number" min="0" max="100000" step="0.1" value={simulationArrayKw} onChange={event=>{setSimulationArrayKw(Number(event.target.value));setSimulationOutput(null)}}/></label>
              <label>Battery capacity <span>kWh</span><input type="number" min="0.1" max="10000000" step="1" value={simulationBatteryKwh} onChange={event=>{setSimulationBatteryKwh(Number(event.target.value));setSimulationOutput(null)}}/></label>
              <label>Initial battery charge <span>%</span><input type="number" min={simulationMinimumBatteryPct} max="100" step="1" value={simulationInitialBatteryPct} onChange={event=>{setSimulationInitialBatteryPct(Number(event.target.value));setSimulationOutput(null)}}/></label>
              <label>Minimum battery reserve <span>%</span><input type="number" min="0" max="90" step="1" value={simulationMinimumBatteryPct} onChange={event=>{const value=Number(event.target.value);setSimulationMinimumBatteryPct(value);if(simulationInitialBatteryPct<value)setSimulationInitialBatteryPct(value);setSimulationOutput(null)}}/></label>
              <label>Array tilt from horizontal <span>degrees</span><input type="number" min="0" max="90" step="1" value={simulationArrayTiltDeg} onChange={event=>{setSimulationArrayTiltDeg(Number(event.target.value));setSimulationOutput(null)}}/></label>
              <label>Array facing direction <span>azimuth · 0° north, 90° east</span><input type="number" min="0" max="359.99" step="1" value={simulationArrayAzimuthDeg} onChange={event=>{setSimulationArrayAzimuthDeg(Number(event.target.value));setSimulationOutput(null)}}/></label>
              <label>Battery maximum charge rate <span>C-rate</span><input type="number" min="0" max="10" step="0.05" value={simulationMaxChargeRateC} onChange={event=>{setSimulationMaxChargeRateC(Number(event.target.value));setSimulationOutput(null)}}/></label>
              <label>Battery maximum discharge rate <span>C-rate</span><input type="number" min="0" max="10" step="0.05" value={simulationMaxDischargeRateC} onChange={event=>{setSimulationMaxDischargeRateC(Number(event.target.value));setSimulationOutput(null)}}/></label>
              <label>Sun distance assumption <span>AU</span><input type="number" min="0.8" max="1.2" step="0.0001" value={simulationSolarDistanceAu} onChange={event=>{setSimulationSolarDistanceAu(Number(event.target.value));setSimulationOutput(null)}}/></label>
              <label>Mission electrical load schedule<select value={simulationLoadProfile} onChange={event=>{setSimulationLoadProfile(event.target.value as MissionLoadProfile);setSimulationOutput(null)}}><option value="steady">Steady base load</option><option value="crew_cycle">Crew activity cycle</option><option value="peak_operations">Peak operations shift</option></select></label>
            </div>
            <div className="simulation-model-assumptions"><span className="eyebrow">MODEL CONFIGURATION</span><p>South-polar sunlight is often close to the horizon: the default array tilt is steep, and its facing azimuth is initialized from the first near-visible Sun sample. Adjust both for the orientation you want to test. PV cell efficiency 28% at STC · temperature coefficient −0.35%/°C · MPPT efficiency 96% · DC bus efficiency 98% · battery charge/discharge efficiency 95% · solar irradiance 1,361 W/m² at 1 AU (NASA reference TSI; distance is user-adjustable). These are explicit baseline assumptions and can be changed in the advanced API payload.</p><p>Panel thermal state is integrated with solar absorption, electrical extraction, two-sided radiation and mount conduction. Battery C-rate and minimum reserve are enforced during the simulation.</p></div>
            <div className="simulation-run-row"><p>Simulation interpolates the ephemeris and integrates at 5-minute steps. The interval must contain real samples no more than six hours apart.</p><button className="button button-dark" onClick={runSimulation} disabled={simulationBusy || !simulationSite}><Play size={16}/>{simulationBusy?'Running simulation…':'Run mission simulation'}</button></div>
            {simulationError && <div className="error-box" role="alert"><Info size={17}/>{simulationError}</div>}
          </section>
          {simulationOutput?.status==='completed' && <section className="simulation-results">
            <div className="simulation-result-heading"><div><span className="eyebrow">SIMULATION OUTPUT · {simulationOutput.model_id}</span><h2>{simulationOutput.unmet_energy_kwh > 1e-6 ? 'Power system cannot serve the full mission load' : 'Power system serves the modeled mission load'}</h2><p>{simulationSite?.site.name} · {simulationOutput.simulated_hours.toFixed(1)} simulated hours · {simulationOutput.integration_steps.toLocaleString()} internal time steps · {simulationOutput.terrain_applied?'DEM skyline applied':'geometric horizon'} · {simulationSite?.is_cached?'cached JPL Horizons':'JPL Horizons'}</p></div><button className="button button-light" onClick={()=>exportSimulationCsv(simulationOutput,simulationSite?.site.name ?? 'Selected site',missionPreset,simulationInputs)}><Download size={15}/> Export simulation CSV</button></div>
            <div className="simulation-metrics">
              <article><span>LOAD ENERGY COVERAGE</span><strong>{simulationOutput.energy_coverage_percent.toFixed(1)}%</strong><small>Electrical demand served</small></article>
              <article><span>UNMET ENERGY</span><strong>{simulationOutput.unmet_energy_kwh.toFixed(2)} kWh</strong><small>Demand not served after battery limits</small></article>
              <article><span>MINIMUM BATTERY SOC</span><strong>{simulationOutput.minimum_battery_percent.toFixed(1)}%</strong><small>Configured reserve {simulationMinimumBatteryPct}%</small></article>
              <article><span>MAXIMUM PANEL TEMP</span><strong>{simulationOutput.maximum_panel_temperature_c.toFixed(1)}°C</strong><small>One-node thermal model</small></article>
            </div>
            <section className="simulation-chart-panel panel"><div className="panel-title"><div><span className="eyebrow">BATTERY DYNAMICS</span><h3>State of charge over the mission interval</h3><p>The dashed line marks your configured minimum battery reserve.</p></div><span className="source-label">{simulationOutput.ending_battery_percent.toFixed(1)}% ENDING SOC</span></div><SimulationBatteryChart data={simulationOutput.series} reservePercent={simulationMinimumBatteryPct}/></section>
            <section className="simulation-chart-panel panel"><div className="panel-title"><div><span className="eyebrow">POWER BALANCE</span><h3>Solar generation, mission load and battery flow</h3><p>Power is reported at the DC bus. A positive unmet load indicates the system could not supply demand.</p></div></div><SimulationPowerChart data={simulationOutput.series}/></section>
            <div className="simulation-detail-grid"><section className="panel simulation-detail"><span className="eyebrow">ENERGY & ENVIRONMENT</span><h3>Mission outcome</h3><div className="window-stat"><span>Solar energy to DC bus</span><strong>{simulationOutput.solar_energy_to_bus_kwh.toFixed(1)} kWh</strong></div><div className="window-stat"><span>Total load energy</span><strong>{simulationOutput.total_demand_kwh.toFixed(1)} kWh</strong></div><div className="window-stat"><span>Curtailed solar energy</span><strong>{simulationOutput.curtailed_solar_energy_kwh.toFixed(1)} kWh</strong></div><div className="window-stat"><span>Peak solar bus power</span><strong>{simulationOutput.peak_solar_bus_power_kw.toFixed(2)} kW</strong></div><div className="window-stat"><span>Peak battery charge</span><strong>{simulationOutput.peak_battery_charge_kw.toFixed(2)} kW</strong></div><div className="window-stat"><span>Peak battery discharge</span><strong>{simulationOutput.peak_battery_discharge_kw.toFixed(2)} kW</strong></div><div className="window-stat"><span>Battery equivalent full cycles</span><strong>{simulationOutput.battery_equivalent_full_cycles.toFixed(3)}</strong></div><div className="window-stat"><span>Earth-visible opportunity</span><strong>{simulationOutput.earth_visible_hours.toFixed(1)} h</strong></div><div className="window-stat"><span>Joint Sun/Earth opportunity (weighted)</span><strong>{simulationOutput.joint_sun_earth_visible_hours.toFixed(1)} h</strong></div>{simulationOutput.first_energy_shortfall_utc&&<p className="simulation-warning">First modeled energy shortfall near {formatUtc(simulationOutput.first_energy_shortfall_utc)}.</p>}</section><section className="panel simulation-detail"><span className="eyebrow">PHYSICAL MODEL & LIMITS</span><h3>What was simulated</h3><div className="window-stat"><span>Derived array area</span><strong>{simulationOutput.array_area_m2_derived.toFixed(1)} m²</strong></div><div className="window-stat"><span>Panel temperature range</span><strong>{simulationOutput.minimum_panel_temperature_c.toFixed(1)}–{simulationOutput.maximum_panel_temperature_c.toFixed(1)}°C</strong></div><div className="window-stat"><span>Time at minimum battery reserve</span><strong>{simulationOutput.hours_at_minimum_soc.toFixed(2)} h</strong></div><div className="window-stat"><span>Longest Sun-obscured interval</span><strong>{simulationOutput.longest_sun_obscured_interval_hours.toFixed(1)} h</strong></div><ul>{simulationOutput.notes.map(note=><li key={note}>{note}</li>)}</ul></section></div>
          </section>}
          {!simulationOutput && !simulationBusy && !simulationError && <div className="notice-box"><Info size={17}/><p>Configure the array, load and battery above, then select <strong>Run mission simulation</strong>. Results are not generated until you explicitly run the model.</p></div>}
        </>}
      </>}

      {page==='data' && <>
        <PageHeading eyebrow="WORKSPACE 05 · DATA LIBRARY" title="Explore the Moon's source data" description="Use the same lunar data resources that researchers rely on: inspect camera imagery, find elevation products, and compare interface patterns before running your own terrain analysis." />
        <section className="terrain-source-grid">
          <ResourceCard icon={Satellite} title="LROC / Lunaserv" summary="Inspect WAC global imagery, normalized reflectance, shaded relief, polar illumination and topography-related layers." detail="Lunar Reconnaissance Orbiter Camera · external map service" href="https://data.lroc.im-ldi.com/lroc/" action="Open LROC map viewer"/>
          <ResourceCard icon={Database} title="PDS Lunar ODE" summary="Search lunar mission archives and inspect the product labels, coverage footprints and download options for LOLA data." detail="NASA Planetary Data System · Geosciences Node" href="https://ode.rsl.wustl.edu/moon/" action="Browse lunar data archive"/>
        </section>
        <section className="lroc-viewer panel" data-tour-target="data">
          <div className="panel-title"><div><span className="eyebrow">NASA / JPL · MOON TREK WMTS</span><h2>Inspect lunar imagery and layers</h2><p>Preview the LRO Wide Angle Camera global mosaic here, or open Moon Trek and LROC in a separate tab for their full interactive layer controls.</p></div><a className="text-link" href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">Open Moon Trek <ExternalLink size={14}/></a></div>
          <div className="moon-wac-preview" aria-label="NASA LRO WAC global mosaic preview">
            <div className="moon-wac-tile-row">
              <img src="https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/0/0/0.jpg" alt="LRO WAC global mosaic tile, western half" loading="lazy" />
              <img src="https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/0/0/1.jpg" alt="LRO WAC global mosaic tile, eastern half" loading="lazy" />
            </div>
            <div className="moon-wac-caption"><span>LRO WAC GLOBAL MOSAIC</span><span>NASA / JPL MOON TREK · WMTS</span></div>
          </div>
          <div className="viewer-foot"><span>IMAGE TILES ONLY · NOT A DIGITAL ELEVATION MODEL</span><a href="https://data.lroc.im-ldi.com/lroc/" target="_blank" rel="noreferrer">Open LROC layers <ExternalLink size={14}/></a></div>
        </section>
        <section className="data-guide">
          <div><span className="eyebrow">RECOMMENDED ELEVATION PRODUCTS</span><h2>Start with a gridded LOLA or LROC polar DEM.</h2><p>For local horizon analysis, look for a map-projected LOLA Gridded Data Record (GDR) elevation product or the LROC WAC GLD100 topography product with LOLA 30 m DTM coverage poleward of 75° latitude. These product families can be large, so select a regional tile or crop a suitable area that covers both candidate sites and the full profile radius.</p>
            <div className="guide-links"><a href="https://lroc.im-ldi.com/" target="_blank" rel="noreferrer">LROC project and education resources <ExternalLink size={14}/></a><a href="https://lroc.im-ldi.com/images/downloads" target="_blank" rel="noreferrer">LROC curated polar topography <ExternalLink size={14}/></a><a href="https://ode.rsl.wustl.edu/moon/" target="_blank" rel="noreferrer">PDS Lunar ODE search <ExternalLink size={14}/></a><a href="https://ode.rsl.wustl.edu/moon/pagehelp/content/Missions_Instruments/LRO/LOLA/GDR/Intro.htm" target="_blank" rel="noreferrer">LOLA GDR product guide <ExternalLink size={14}/></a><a href="https://ode.rsl.wustl.edu/moon/tools.aspx" target="_blank" rel="noreferrer">LOLA RDR query tool <ExternalLink size={14}/></a><a href={lolaQueryUrl} target="_blank" rel="noreferrer">Prepare observation query for my sites <ExternalLink size={14}/></a></div>
          </div>
          <aside className="data-callout"><strong>Current candidate area</strong><span>{Math.min(...sites.map(s=>s.latitude_deg)).toFixed(3)}° to {Math.max(...sites.map(s=>s.latitude_deg)).toFixed(3)}° latitude</span><span>{Math.min(...sites.map(s=>s.longitude_east_deg)).toFixed(3)}° to {Math.max(...sites.map(s=>s.longitude_east_deg)).toFixed(3)}° E</span><p>The prepared ODE query is for LOLA RDR point observations, not a DEM. For terrain upload, use gridded LOLA GDR or suitable LROC polar topography. Some GDR products are IMG/JPEG 2000 with labels and need a projection-preserving conversion to GeoTIFF.</p><button className="button button-dark" onClick={()=>goTo('terrain')}>Continue to terrain analysis <ArrowRight size={15}/></button></aside>
        </section>
        <section className="science-notes panel"><span className="eyebrow">DATA PROVENANCE</span><h2>Keep the source trail with your analysis</h2><ul><li>Record the exact PDS product ID, release/version and access date.</li><li>Record Moon-fixed CRS, east/west longitude convention, vertical datum, elevation unit, pixel spacing and no-data value.</li><li>Do not use an LROC WMS screenshot as an elevation raster.</li></ul><p className="field-help">SELENIC links to these resources; it does not automatically download data from them.</p></section>
      </>}

      {page==='terrain' && <>
        <PageHeading eyebrow="WORKSPACE 06 · TERRAIN ANALYSIS" title="Measure the local horizon" description="After finding a suitable elevation product in the Data Library, upload a georeferenced lunar GeoTIFF here to estimate which ridges and crater rims obstruct the sky from each candidate site." />
        <section className="terrain-prep panel"><div><span className="eyebrow">BEFORE YOU UPLOAD</span><h2>Bring a real lunar elevation grid.</h2><p>One DEM should cover both sites and the full profile radius you select. Verify the product label first; the confirmation checkbox is your attestation, not an automatic validation of the datum.</p></div><ol><li>Find a LOLA GDR or LROC polar DEM in the Data Library.</li><li>Preserve the lunar body-fixed CRS and vertical reference.</li><li>Convert IMG/JP2/ISIS products to GeoTIFF only with a projection-preserving workflow.</li><li>Choose a profile radius that fits inside the downloaded tile.</li></ol><button className="button button-light" onClick={()=>window.open('https://ode.rsl.wustl.edu/moon/','_blank','noopener,noreferrer')}>Browse PDS Lunar ODE <ExternalLink size={15}/></button></section>
        <section className="dem-import panel" data-tour-target="terrain"><div className="panel-title"><div><span className="eyebrow">LOCAL TERRAIN PROCESSING</span><h2>Import a lunar elevation model</h2><p>SELENIC samples radial terrain profiles and estimates the local obstruction angle by azimuth. It rejects azimuth directions with insufficient raster coverage instead of treating missing data as clear sky.</p></div><span className="source-label">GEOTIFF · MAX 100 MB</span></div><div className="dem-controls"><label className="file-drop"><FileImage size={25}/><strong>{terrainFile?terrainFile.name:'Choose lunar DEM GeoTIFF'}</strong><span>{terrainFile?`${(terrainFile.size/1024/1024).toFixed(1)} MB selected`:'Accepts .tif and .tiff with a lunar CRS'}</span><input type="file" accept=".tif,.tiff,image/tiff" onChange={e=>{setTerrainFile(e.target.files?.[0]??null);setTerrainError('')}}/></label><div className="dem-options"><label>Profile radius<select value={maxDistanceKm} onChange={e=>setMaxDistanceKm(Number(e.target.value))}><option value={5}>5 km</option><option value={10}>10 km</option><option value={20}>20 km</option><option value={50}>50 km</option></select></label><label>Azimuth spacing<select value={azimuthStep} onChange={e=>setAzimuthStep(Number(e.target.value))}><option value={2}>2° (finer)</option><option value={5}>5°</option><option value={10}>10°</option><option value={15}>15° (faster)</option></select></label><label>Elevation units<select value={elevationUnit} onChange={e=>setElevationUnit(e.target.value as 'm'|'km')}><option value="m">Meters</option><option value="km">Kilometers</option></select></label><label>Observer height above surface · m<input type="number" min="0" max="100" step="0.5" value={observerHeightM} onChange={e=>setObserverHeightM(Number(e.target.value))}/></label></div></div><label className="confirm-datum"><input type="checkbox" checked={datumConfirmed} onChange={e=>setDatumConfirmed(e.target.checked)}/> I have checked that this DEM uses a lunar body-fixed coordinate reference and that its elevation units and vertical datum are documented.</label>{terrainError&&<div className="error-box" role="alert">{terrainError}</div>}<div className="dem-actions"><button className="button button-dark" onClick={processTerrain} disabled={terrainBusy||!terrainFile||!datumConfirmed}>{terrainBusy?'Processing terrain…':'Calculate terrain profiles for all study points'} <ArrowRight size={16}/></button><span className="field-help">Upload the DEM once; the backend calculates one profile per study point.</span></div>{Object.keys(terrainProfiles).length>0&&<div className="terrain-results">{sites.map((site,i)=>{const profile=terrainProfiles[site.id];return profile?<article className="terrain-result" key={site.id}><div className="chart-head"><div><span className={`site-token token-${i?'b':'a'}`}>{i?'B':'A'}</span><strong>{site.name}</strong></div><span className="coverage-pill">{(profile.coverage_fraction*100).toFixed(0)}% overall · {(profile.minimum_azimuth_coverage_fraction*100).toFixed(0)}% weakest azimuth</span></div><p className="field-help">{profile.filename} · {profile.crs} · {profile.width} × {profile.height} · observer ground {profile.observer_ground_elevation_m.toFixed(1)} m</p><TerrainPlot data={profile}/><ul className="warning-list">{profile.warnings.slice(0,3).map(w=><li key={w}>{w}</li>)}</ul></article>:null})}</div>}</section>
        <div className="notice-box"><Info size={17}/><p>Terrain-adjusted windows are available on Mission Windows after profiles are calculated. These are sampled prototype estimates, not certified line-of-sight calculations.</p></div>
      </>}

      {page==='learn' && <>
        <PageHeading eyebrow="WORKSPACE 07 · FIELD GUIDE" title="A guide to the lunar horizon" description="A clear introduction to the geometry, visibility and terrain behind each comparison." />
        <section className="guide-hero panel" data-tour-target="learn"><span className="eyebrow">WHY THE SOUTH POLE?</span><h2>At the Moon's poles,<br/>the horizon is an engineering constraint.</h2><p>The Sun determines local illumination. Earth's position determines whether direct communication may be possible. Ridges and crater rims can obstruct either one, even when an object is above a smooth reference horizon.</p></section>
        <div className="learning-grid"><article className="learn-card"><div className="learn-icon"><Sun size={22}/></div><h3>Sun elevation</h3><p>Sun elevation is the angle between the Sun and the local horizontal plane. A low Sun can be hidden by a nearby ridge; a higher Sun generally offers a clearer view of the sky. The angle alone is not a solar-array power prediction.</p></article><article className="learn-card"><div className="learn-icon"><Globe2 size={22}/></div><h3>Earth visibility</h3><p>Earth elevation and azimuth describe where Earth appears in the local sky. Being above the geometric horizon is a first visibility check, not a complete communications assessment: antenna pointing, terrain and link budget still matter.</p></article><article className="learn-card"><div className="learn-icon"><MountainIcon/></div><h3>Terrain obstruction</h3><p>A digital elevation model can estimate how high nearby terrain rises along each azimuth. SELENIC samples this terrain horizon and compares it with the Sun and Earth elevations. Missing terrain coverage must remain unknown, not be treated as open sky.</p></article><article className="learn-card"><div className="learn-icon"><Clock3 size={22}/></div><h3>Time windows</h3><p>Sunrise, sunset, Earthrise and Earthset define changing operating windows. SELENIC samples positions over time and interpolates threshold crossings; the result depends on the chosen sampling interval.</p></article></div>
        <section className="science-notes panel"><span className="eyebrow">DATA AND MODEL NOTES</span><h2>What SELENIC does — and does not — claim</h2><ul><li>Live Sun/Earth positions are requested from JPL Horizons when the API is online.</li><li>Geometric windows use apparent elevation relative to the reference geometric horizon.</li><li>Terrain-adjusted estimates require a compatible user-supplied lunar DEM GeoTIFF.</li><li>DEM provenance, body-fixed CRS, elevation units and vertical datum must be verified before use.</li><li>The Simulate workspace runs SELENIC-LPS-1.0, a 5-minute time-step lunar electrical power-system model with direct solar-array incidence, finite-disc/DEM shading, a one-node panel thermal balance, MPPT/DC-bus losses, battery efficiency, C-rate limits, reserve protection and configurable load schedules.</li><li>The simulation remains a conceptual system model: it is not validated against hardware test data or a full flight EPS model. It omits cell electrochemistry, battery thermal behavior and ageing, array electrical I-V curves, detailed multi-view thermal radiation, lunar albedo/earthshine contribution to PV power, dust/degradation evolution, and transient control-loop behavior. Earth visibility is not an RF link budget.</li></ul><p className="field-help">This is a research and education prototype, not certified mission-planning software.</p><button className="button button-light" onClick={()=>goTo('terrain')}>Open terrain workspace <ArrowRight size={15}/></button></section>
      </>}

      <footer className="app-footer"><span>Designed &amp; built by Edom</span><span>Independent project · Not affiliated with NASA</span></footer>
    </main>
    {tourIndex!==null&&<div className="tour-layer" aria-live="polite">
      {tourGeometry&&<>
        <div className="tour-highlight" style={{left:tourGeometry.target.left-5,top:tourGeometry.target.top-5,width:tourGeometry.target.width+10,height:tourGeometry.target.height+10}}/>
        <svg className="tour-arrow-layer" width="100%" height="100%" aria-hidden="true">
          <defs><marker id="tour-arrow-head" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#171717"/></marker></defs>
          <path d={`M ${tourGeometry.startX} ${tourGeometry.startY} Q ${(tourGeometry.startX+tourGeometry.endX)/2} ${(tourGeometry.startY+tourGeometry.endY)/2} ${tourGeometry.endX} ${tourGeometry.endY}`} fill="none" stroke="#171717" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#tour-arrow-head)"/>
          <circle cx={tourGeometry.endX} cy={tourGeometry.endY} r="5" fill="#fff" stroke="#171717" strokeWidth="2"/>
        </svg>
      </>}
      <section className={`tour-callout ${tourGeometry?'':'tour-callout-standalone'}`} data-position={tourGeometry?.position ?? 'below'} style={tourGeometry?{left:tourGeometry.left,top:tourGeometry.top,width:tourGeometry.width}:{left:'50%',top:'50%',width:'min(390px, calc(100vw - 32px))',transform:'translate(-50%, -50%)'}} role="dialog" aria-modal="false" aria-labelledby="tour-title">
        <header><span>SELENIC TOUR · {tourIndex+1} / {tourSteps.length}</span><button onClick={closeTour} aria-label="Close tour"><X size={19}/></button></header>
        <div className="tour-progress"><span style={{width:`${((tourIndex+1)/tourSteps.length)*100}%`}}/></div>
        <h2 id="tour-title">{tourSteps[tourIndex].title}</h2><p>{tourSteps[tourIndex].body}</p>
        <div className="tour-actions"><button className="text-button" onClick={closeTour}>Skip tour</button><div><button className="button button-light" disabled={tourIndex===0} onClick={()=>nextTour(-1)}><ChevronLeft size={16}/> Back</button><button className="button button-dark" onClick={()=>nextTour(1)}>{tourIndex===tourSteps.length-1?'Finish':'Next'} <ChevronRight size={16}/></button></div></div>
      </section>
    </div>}
  </div>
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></header>
}
function MountainIcon() { return <MapIcon size={22}/> }
