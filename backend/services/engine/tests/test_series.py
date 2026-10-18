import math
from datetime import date, timedelta

import pytest

from series import chart_series, densify, rdp_select, sma


def days(values, start=date(2026, 9, 1)):
    return [(start + timedelta(days=i), v) for i, v in enumerate(values)]


def test_sma():
    assert sma([1, 2, 3, 4, 5], 3) == [2, 3, 4]
    assert sma([1, 2], 5) == [1, 2]  # not enough data: unchanged
    assert sma([1, 2, 3], 1) == [1, 2, 3]


def test_rise_then_fall_keeps_its_shape():
    # The task's example: 9 points, too few, so it is resampled to 12.
    [s], _ = chart_series({"X": days([1, 2, 3, 4, 5, 4, 3, 2, 1])}, rng="1w", points=12)
    ys = [p.y for p in s.points]
    assert len(ys) == 12
    peak = s.markers["peak"]
    assert 0 < peak < 11
    assert ys[peak] == 1.0
    assert all(a <= b for a, b in zip(ys[: peak + 1], ys[1 : peak + 1]))  # rising
    assert all(a >= b for a, b in zip(ys[peak:], ys[peak + 1 :]))  # falling
    assert ys[0] == ys[-1] == 0.0


@pytest.mark.parametrize("points", [12, 14, 16])
def test_long_series_gives_exactly_n_points_in_unit_box(points):
    values = [100 + 10 * math.sin(i / 6) + i * 0.2 for i in range(120)]
    [s], _ = chart_series({"X": days(values)}, rng="6m", points=points)
    assert len(s.points) == points
    assert all(0 <= p.y <= 1 and 0 <= p.x <= 1 for p in s.points)
    assert s.points[0].x == 0 and s.points[-1].x == 1
    assert [p.day for p in s.points] == sorted(p.day for p in s.points)


def test_peak_and_trough_survive_simplification():
    values = [100] * 40
    values[13] = 140  # a sharp spike
    values[29] = 70  # a sharp dip
    [s], _ = chart_series({"X": days(values)}, rng="1w", points=12)  # no smoothing
    assert s.points[s.markers["peak"]].value == 140
    assert s.points[s.markers["trough"]].value == 70
    assert s.points[s.markers["peak"]].y == 1.0
    assert s.points[s.markers["trough"]].y == 0.0


def test_flat_series_is_a_centered_line():
    [s], _ = chart_series({"X": days([5] * 30)}, rng="1m", points=12)
    assert {p.y for p in s.points} == {0.5}
    assert "peak" not in s.markers
    assert s.direction == "barely moved"


def test_compare_mode_uses_one_shared_scale():
    a = [100 + i * 2 for i in range(30)]  # climbs 100 -> 158
    b = [120 + (i % 2) * 0.5 for i in range(30)]  # nearly flat around 120
    (sa, sb), (lo, hi) = chart_series({"A": days(a), "B": days(b)}, rng="1m", points=12)
    assert sa.points[-1].y == 1.0 and sa.points[0].y == 0.0
    # B sits in the middle band of A's range and barely moves.
    ys = [p.y for p in sb.points]
    assert max(ys) - min(ys) < 0.05
    assert 0.2 < ys[0] < 0.6
    assert lo < 120 < hi


def test_direction_and_raw_peak_come_from_real_closes():
    values = [100, 104, 108, 112, 109, 106, 103, 105, 110, 115, 112]
    [s], _ = chart_series({"X": days(values)}, rng="1m", points=12)
    assert s.direction == "up"
    assert round(s.pct_change, 1) == 12.0
    assert s.raw_peak[1] == 115


def test_rdp_select_always_keeps_endpoints_and_requested_points():
    xy = [(i / 9, (i % 3) / 2) for i in range(10)]
    idx = rdp_select(xy, 5, keep={4})
    assert idx[0] == 0 and idx[-1] == 9 and 4 in idx and len(idx) == 5


def test_densify_keeps_originals_and_fills_widest_gaps():
    pts = densify([0, 10, 0], 5)
    assert [v for _, v in pts] == [0, 5, 10, 5, 0]
    assert (1.0, 10) in pts


def test_points_bounds():
    with pytest.raises(ValueError):
        chart_series({"X": days([1, 2, 3])}, points=20)
