from datetime import datetime, timezone

import pytest

from app.models import BodyPosition, EphemerisPoint, HorizonBin
from app.visibility import disc_visible_fraction, summarize_visibility


def test_disc_visible_fraction_has_correct_endpoints_and_midpoint():
    assert disc_visible_fraction(1.0, 0.267) == 1.0
    assert disc_visible_fraction(-1.0, 0.267) == 0.0
    assert disc_visible_fraction(0.0, 0.267) == pytest.approx(0.5)


def test_skyline_reduces_sun_fraction_and_joint_window():
    points = [
        EphemerisPoint(
            timestamp_utc=f"2026-11-14T{hour:02d}:00:00Z",
            sun=BodyPosition(azimuth_deg=0, elevation_deg=elevation),
            earth=BodyPosition(azimuth_deg=180, elevation_deg=5),
        )
        for hour, elevation in ((0, 5), (1, 5), (2, -5))
    ]
    flat = [HorizonBin(azimuth_deg=az, horizon_elevation_deg=0) for az in (0, 90, 180, 270)]
    ridged = [HorizonBin(azimuth_deg=az, horizon_elevation_deg=6) for az in (0, 90, 180, 270)]
    flat_result = summarize_visibility(points, flat)
    ridge_result = summarize_visibility(points, ridged)
    assert flat_result["sun_visible_disc_hours"] > ridge_result["sun_visible_disc_hours"]
    assert flat_result["joint_sun_and_earth_hours"] > ridge_result["joint_sun_and_earth_hours"]
    assert ridge_result["sun_visible_disc_hours"] == 0.0


def test_flags_possible_earth_occultation_of_sun():
    points = [
        EphemerisPoint(
            timestamp_utc=f"2026-11-14T{hour:02d}:00:00Z",
            sun=BodyPosition(azimuth_deg=0, elevation_deg=10),
            earth=BodyPosition(azimuth_deg=0.5, elevation_deg=10),
        )
        for hour in (0, 1)
    ]
    profile = [HorizonBin(azimuth_deg=az, horizon_elevation_deg=0) for az in (0, 90, 180, 270)]
    result = summarize_visibility(points, profile)
    assert result["earth_eclipses_sun_possible"] is True
    assert "2026-11-14T00:00:00Z" in result["earth_eclipses_sun_sample_times_utc"]


def test_eclipse_is_not_flagged_when_both_discs_are_hidden_by_terrain():
    points = [
        EphemerisPoint(
            timestamp_utc=f"2026-11-14T{hour:02d}:00:00Z",
            sun=BodyPosition(azimuth_deg=0, elevation_deg=10),
            earth=BodyPosition(azimuth_deg=0.5, elevation_deg=10),
        )
        for hour in (0, 1)
    ]
    high_ridge = [HorizonBin(azimuth_deg=az, horizon_elevation_deg=12) for az in (0, 90, 180, 270)]
    result = summarize_visibility(points, high_ridge)
    assert result["earth_eclipses_sun_possible"] is False
    assert result["earth_eclipses_sun_sample_times_utc"] == []
