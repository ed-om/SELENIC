from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class SiteInput(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    latitude_deg: float = Field(ge=-90, le=90)
    longitude_east_deg: float = Field(ge=0, lt=360)
    altitude_km: float = Field(default=0.0, ge=-5, le=20)


class AnalysisRequest(BaseModel):
    site: SiteInput
    start_utc: datetime
    duration_hours: int = Field(default=24, ge=6, le=720)
    step_minutes: Literal[15, 30, 60] = 30

    @field_validator("start_utc")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("start_utc must include a timezone, preferably Z for UTC")
        return value

    @model_validator(mode="after")
    def enforce_row_limit(self) -> "AnalysisRequest":
        rows = (self.duration_hours * 60) // self.step_minutes + 1
        if rows > 2000:
            raise ValueError("The requested interval exceeds 2,000 samples; use a coarser step or shorter duration")
        return self


class CompareRequest(BaseModel):
    sites: list[SiteInput] = Field(min_length=2, max_length=5)
    start_utc: datetime
    duration_hours: int = Field(default=24, ge=6, le=720)
    step_minutes: Literal[15, 30, 60] = 30

    @field_validator("start_utc")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("start_utc must include a timezone, preferably Z for UTC")
        return value

    @model_validator(mode="after")
    def enforce_row_limit(self) -> "CompareRequest":
        rows = (self.duration_hours * 60) // self.step_minutes + 1
        if rows > 2000:
            raise ValueError("The requested interval exceeds 2,000 samples; use a coarser step or shorter duration")
        return self


class BodyPosition(BaseModel):
    azimuth_deg: float
    elevation_deg: float


class EphemerisPoint(BaseModel):
    timestamp_utc: str
    sun: BodyPosition
    earth: BodyPosition


class AnalysisMetrics(BaseModel):
    sunlight_hours_sampled: float
    earth_visibility_hours_sampled: float
    peak_solar_elevation_deg: float
    peak_earth_elevation_deg: float
    solar_elevation_index_percent: float


class AnalysisResult(BaseModel):
    site: SiteInput
    source: str
    ephemeris_model: str
    is_demo: bool = False
    is_cached: bool = False
    start_utc: str
    duration_hours: int
    step_minutes: int
    horizon_model: str
    terrain_mask_applied: bool
    warnings: list[str]
    points: list[EphemerisPoint]
    metrics: AnalysisMetrics


class HorizonBin(BaseModel):
    azimuth_deg: float = Field(ge=0, lt=360)
    horizon_elevation_deg: float = Field(ge=-90, le=90)


class VisibilitySummaryRequest(BaseModel):
    points: list[EphemerisPoint] = Field(min_length=2, max_length=2000)
    profile: list[HorizonBin] = Field(min_length=3, max_length=360)


class MissionSimulationInputs(BaseModel):
    """User-specified electrical and thermal parameters for the lunar EPS model."""

    load_kw: float = Field(gt=0, le=100_000)
    solar_array_rated_kw: float = Field(ge=0, le=100_000)
    battery_capacity_kwh: float = Field(gt=0, le=10_000_000)
    initial_battery_percent: float = Field(ge=0, le=100)
    minimum_battery_percent: float = Field(ge=0, le=90, default=20)
    array_tilt_deg: float = Field(ge=0, le=90, default=0)
    array_azimuth_deg: float = Field(ge=0, lt=360, default=0)
    load_profile: Literal["steady", "crew_cycle", "peak_operations"] = "steady"
    cell_efficiency_stc: float = Field(gt=0.05, le=0.45, default=0.28)
    pv_temperature_coefficient_per_c: float = Field(ge=-0.02, le=0.01, default=-0.0035)
    panel_absorptivity: float = Field(gt=0, le=1, default=0.90)
    panel_emissivity: float = Field(gt=0, le=1, default=0.85)
    panel_areal_heat_capacity_j_m2k: float = Field(ge=500, le=100_000, default=12_000)
    initial_panel_temperature_k: float = Field(ge=50, le=500, default=250)
    radiative_sink_temperature_k: float = Field(ge=3, le=350, default=120)
    support_temperature_k: float = Field(ge=3, le=400, default=250)
    mount_thermal_conductance_w_m2k: float = Field(ge=0, le=50, default=1.0)
    solar_irradiance_w_m2: float = Field(ge=1200, le=1420, default=1361)
    solar_distance_au: float = Field(gt=0.8, le=1.2, default=1.0)
    mppt_efficiency: float = Field(gt=0.5, le=1, default=0.96)
    power_bus_efficiency: float = Field(gt=0.5, le=1, default=0.98)
    array_degradation_factor: float = Field(ge=0, le=1, default=1.0)
    battery_charge_efficiency: float = Field(gt=0.5, le=1, default=0.95)
    battery_discharge_efficiency: float = Field(gt=0.5, le=1, default=0.95)
    maximum_charge_rate_c: float = Field(ge=0, le=10, default=0.25)
    maximum_discharge_rate_c: float = Field(ge=0, le=10, default=0.50)

    @model_validator(mode="after")
    def initial_soc_above_reserve(self) -> "MissionSimulationInputs":
        if self.initial_battery_percent < self.minimum_battery_percent:
            raise ValueError("initial_battery_percent must be at or above minimum_battery_percent")
        return self


class MissionSimulationRequest(BaseModel):
    points: list[EphemerisPoint] = Field(min_length=2, max_length=2000)
    profile: list[HorizonBin] | None = Field(default=None, min_length=3, max_length=360)
    inputs: MissionSimulationInputs
    integration_step_seconds: int = Field(default=300, ge=30, le=900)
