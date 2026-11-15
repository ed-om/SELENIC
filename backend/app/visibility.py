"""Terrain-aware visibility summaries for a sampled lunar observer ephemeris.

The model treats the Sun and Earth as finite angular discs and integrates their
visible fractions against an azimuth-dependent terrain skyline. It remains a
sampled geometric estimate, not a ray-traced or operational power/communications
model. Earth angular radius is a documented nominal approximation.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any

from .models import EphemerisPoint, HorizonBin

SUN_ANGULAR_RADIUS_DEG = 0.267
# Nominal Earth angular radius as seen from the lunar surface; actual value varies.
EARTH_ANGULAR_RADIUS_DEG = 0.95


def disc_visible_fraction(margin_deg: float, angular_radius_deg: float) -> float:
    """Fraction of a circular disc above a straight horizon.

    margin is the disc-centre elevation minus the skyline elevation.
    """
    if angular_radius_deg <= 0:
        raise ValueError("angular_radius_deg must be positive")
    if margin_deg >= angular_radius_deg:
        return 1.0
    if margin_deg <= -angular_radius_deg:
        return 0.0
    t = max(-1.0, min(1.0, margin_deg / angular_radius_deg))
    return 0.5 + (math.asin(t) + t * math.sqrt(max(0.0, 1.0 - t * t))) / math.pi


def _horizon_at(profile: list[HorizonBin], azimuth_deg: float) -> float:
    bins = sorted(profile, key=lambda item: item.azimuth_deg)
    az = azimuth_deg % 360.0
    for index, left in enumerate(bins):
        right = bins[(index + 1) % len(bins)]
        left_az = left.azimuth_deg
        right_az = right.azimuth_deg if index < len(bins) - 1 else right.azimuth_deg + 360.0
        query = az if az >= left_az else az + 360.0
        if left_az <= query <= right_az:
            span = right_az - left_az
            if span <= 0:
                return left.horizon_elevation_deg
            fraction = (query - left_az) / span
            return left.horizon_elevation_deg * (1 - fraction) + right.horizon_elevation_deg * fraction
    return bins[0].horizon_elevation_deg


def _timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _angular_separation(a_az: float, a_el: float, b_az: float, b_el: float) -> float:
    az1, el1, az2, el2 = map(math.radians, (a_az, a_el, b_az, b_el))
    cosine = math.sin(el1) * math.sin(el2) + math.cos(el1) * math.cos(el2) * math.cos(az1 - az2)
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def _integrate(values: list[float], times: list[datetime]) -> float:
    total = 0.0
    for index in range(len(values) - 1):
        hours = (times[index + 1] - times[index]).total_seconds() / 3600.0
        if hours <= 0 or hours > 1.6 * 24:
            continue
        total += (values[index] + values[index + 1]) * 0.5 * hours
    return round(total, 2)


def _longest_true_interval(flags: list[bool], times: list[datetime]) -> dict[str, Any] | None:
    best: tuple[int, int] | None = None
    start: int | None = None
    for index, flag in enumerate(flags):
        if flag and start is None:
            start = index
        if start is not None and (not flag or index == len(flags) - 1):
            end = index if flag and index == len(flags) - 1 else index - 1
            if end > start and (best is None or end - start > best[1] - best[0]):
                best = (start, end)
            start = None
    if best is None:
        return None
    start_i, end_i = best
    return {
        "start_utc": times[start_i].isoformat().replace("+00:00", "Z"),
        "end_utc": times[end_i].isoformat().replace("+00:00", "Z"),
        "hours": round((times[end_i] - times[start_i]).total_seconds() / 3600.0, 2),
    }


def summarize_visibility(points: list[EphemerisPoint], profile: list[HorizonBin]) -> dict[str, Any]:
    if len(points) < 2:
        raise ValueError("At least two aligned ephemeris samples are required")
    ordered = sorted(points, key=lambda point: point.timestamp_utc)
    times = [_timestamp(point.timestamp_utc) for point in ordered]
    sun_fraction: list[float] = []
    earth_fraction: list[float] = []
    eclipse_samples: list[str] = []
    total_eclipse_samples: list[str] = []

    for point in ordered:
        sun_horizon = _horizon_at(profile, point.sun.azimuth_deg)
        earth_horizon = _horizon_at(profile, point.earth.azimuth_deg)
        sun_fraction.append(disc_visible_fraction(point.sun.elevation_deg - sun_horizon, SUN_ANGULAR_RADIUS_DEG))
        earth_fraction.append(disc_visible_fraction(point.earth.elevation_deg - earth_horizon, EARTH_ANGULAR_RADIUS_DEG))
        separation = _angular_separation(
            point.sun.azimuth_deg, point.sun.elevation_deg,
            point.earth.azimuth_deg, point.earth.elevation_deg,
        )
        # Only flag a locally relevant occultation when some part of both discs
        # is above the terrain skyline. Bodies fully hidden behind a ridge do not
        # produce a usable surface-observer eclipse event.
        if sun_fraction[-1] > 0 and earth_fraction[-1] > 0 and separation < EARTH_ANGULAR_RADIUS_DEG + SUN_ANGULAR_RADIUS_DEG:
            eclipse_samples.append(point.timestamp_utc)
            if separation < EARTH_ANGULAR_RADIUS_DEG - SUN_ANGULAR_RADIUS_DEG:
                total_eclipse_samples.append(point.timestamp_utc)

    joint_fraction = [sun * earth for sun, earth in zip(sun_fraction, earth_fraction)]
    longest_dark = _longest_true_interval([fraction <= 1e-9 for fraction in sun_fraction], times)
    best_joint = _longest_true_interval(
        [sun >= 0.5 and earth >= 0.5 for sun, earth in zip(sun_fraction, earth_fraction)],
        times,
    )

    # Centre-crossing event markers are useful for inspection; finite-disc
    # visibility integrations above use the full angular radii.
    events: list[dict[str, str]] = []
    for body_name, fractions in (("Sun", sun_fraction), ("Earth", earth_fraction)):
        for index in range(len(fractions) - 1):
            left, right = fractions[index], fractions[index + 1]
            if (left < 0.5 <= right) or (left >= 0.5 > right):
                events.append({
                    "body": body_name,
                    "event": "rise" if right > left else "set",
                    "timestamp_utc": times[index + 1].isoformat().replace("+00:00", "Z"),
                })

    return {
        "sun_visible_disc_hours": _integrate(sun_fraction, times),
        "earth_visible_disc_hours": _integrate(earth_fraction, times),
        "joint_sun_and_earth_hours": _integrate(joint_fraction, times),
        "longest_continuous_dark_interval": longest_dark,
        "best_joint_window": best_joint,
        "events": events,
        "earth_eclipses_sun_possible": bool(eclipse_samples),
        "earth_eclipses_sun_sample_times_utc": eclipse_samples,
        "total_eclipse_possible": bool(total_eclipse_samples),
        "total_eclipse_sample_times_utc": total_eclipse_samples,
        "angular_radii_assumed_deg": {
            "sun": SUN_ANGULAR_RADIUS_DEG,
            "earth_nominal": EARTH_ANGULAR_RADIUS_DEG,
        },
        "model_notes": [
            "Disc fractions use a straight local skyline and sampled ephemeris; this is not full 3D ray tracing.",
            "Earth angular radius is a nominal 0.95° approximation and varies with Earth-Moon distance.",
            "Joint hours integrate the product of visible disc fractions as a geometric overlap proxy, not link availability or power.",
            "Events are sampled 50%-visibility crossings and are accurate only to the selected sample cadence.",
        ],
    }
