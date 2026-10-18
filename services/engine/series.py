"""Turn daily closes into a palm-sized drawing: 12 to 16 points in [0, 1].

Pipeline: closes -> SMA -> RDP down to N points -> normalize -> markers.

The palm can tell apart only about 10 to 20 points, so the drawing carries
the overall shape. The voice carries the exact numbers (see `summary`).
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

MIN_POINTS, MAX_POINTS = 12, 16
#: Moves smaller than this (as a fraction of the start price) count as flat.
FLAT_THRESHOLD = 0.001
#: Overall changes smaller than this percent are "barely moved".
BARELY_MOVED_PCT = 1.0

SMA_WINDOWS = {"1w": 1, "1m": 5, "3m": 10, "6m": 20, "1y": 20, "2y": 20}


def sma(values: list[float], window: int) -> list[float]:
    """Trailing simple moving average. The first window-1 values are dropped."""
    if window <= 1 or len(values) < window:
        return list(values)
    out, running = [], sum(values[:window])
    out.append(running / window)
    for i in range(window, len(values)):
        running += values[i] - values[i - window]
        out.append(running / window)
    return out


def _distance(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    """Perpendicular distance from p to the line through a and b."""
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / (dx * dx + dy * dy) ** 0.5


def rdp_select(xy: list[tuple[float, float]], k: int, keep: set[int] = frozenset()) -> list[int]:
    """Indices of the k most shape-defining points, in order.

    Ramer-Douglas-Peucker in importance order: start from the endpoints and
    repeatedly add the point farthest from the current polyline. Indices in
    `keep` (peak, trough) are always included.
    """
    n = len(xy)
    if n <= k:
        return list(range(n))
    chosen = {0, n - 1} | set(keep)
    while len(chosen) < k:
        order = sorted(chosen)
        best, best_d = None, -1.0
        for a, b in zip(order, order[1:]):
            for i in range(a + 1, b):
                d = _distance(xy[i], xy[a], xy[b])
                if d > best_d:
                    best, best_d = i, d
        if best is None:
            break
        chosen.add(best)
    return sorted(chosen)


def densify(values: list[float], k: int) -> list[tuple[float, float]]:
    """Pad a short series to exactly k (position, value) points.

    Every original point is kept, so peaks and dips survive; midpoints are
    added in the widest gaps. Positions are fractional source indices.
    """
    pts = [(float(i), v) for i, v in enumerate(values)]
    if len(pts) == 1:
        pts = [(0.0, values[0]), (0.0, values[0])]
    while len(pts) < k:
        i = max(range(len(pts) - 1), key=lambda j: pts[j + 1][0] - pts[j][0])
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        pts.insert(i + 1, ((x1 + x2) / 2, (y1 + y2) / 2))
    return pts


@dataclass(frozen=True)
class ChartPoint:
    x: float  # 0 = past (left), 1 = today (right)
    y: float  # 0 = lowest, 1 = highest on the shared scale
    day: date
    value: float


@dataclass(frozen=True)
class Series:
    symbol: str
    points: list[ChartPoint]
    markers: dict[str, int]  # peak, trough, end -> index into points
    smooth_window: int
    first_close: float
    last_close: float
    raw_peak: tuple[date, float]
    raw_trough: tuple[date, float]

    @property
    def pct_change(self) -> float:
        return (self.last_close - self.first_close) / self.first_close * 100

    @property
    def direction(self) -> str:
        if abs(self.pct_change) < BARELY_MOVED_PCT:
            return "barely moved"
        return "up" if self.pct_change > 0 else "down"


def _smooth(days: list[date], closes: list[float], window: int) -> tuple[list[date], list[float]]:
    smoothed = sma(closes, window)
    return days[len(days) - len(smoothed):], smoothed


def chart_series(
    series: dict[str, list[tuple[date, Decimal | float]]],
    rng: str = "1m",
    points: int = 12,
) -> tuple[list[Series], tuple[float, float]]:
    """Build drawings for one or more symbols on one shared vertical scale.

    Returns the series and the (low, high) price scale that maps to y = 0..1.
    """
    if not MIN_POINTS <= points <= MAX_POINTS:
        raise ValueError(f"points must be between {MIN_POINTS} and {MAX_POINTS}")
    window = SMA_WINDOWS.get(rng, 5)

    prepared = []
    for symbol, rows in series.items():
        if not rows:
            raise ValueError(f"No prices for {symbol} in that range.")
        days = [d for d, _ in rows]
        closes = [float(c) for _, c in rows]
        sdays, smooth = _smooth(days, closes, window)
        prepared.append((symbol, days, closes, sdays, smooth))

    lo = min(min(p[4]) for p in prepared)
    hi = max(max(p[4]) for p in prepared)
    flat = (hi - lo) <= FLAT_THRESHOLD * max(abs(lo), 1e-9)

    def norm(v: float) -> float:
        return 0.5 if flat else (v - lo) / (hi - lo)

    out = []
    for symbol, days, closes, sdays, smooth in prepared:
        if len(smooth) < points:
            # Too few points to choose from: pad to exactly `points`.
            padded = densify(smooth, points)
            chosen_days = [sdays[round(pos)] for pos, _ in padded]
            chosen_vals = [v for _, v in padded]
        else:
            n = len(smooth)
            xy = [(i / (n - 1), norm(v)) for i, v in enumerate(smooth)]
            peak_i = max(range(n), key=lambda i: smooth[i])
            trough_i = min(range(n), key=lambda i: smooth[i])
            keep = set() if flat else {peak_i, trough_i}
            idx = rdp_select(xy, points, keep)
            chosen_days, chosen_vals = [sdays[i] for i in idx], [smooth[i] for i in idx]

        m = len(chosen_vals)
        pts = [
            ChartPoint(x=round(j / (m - 1), 4), y=round(norm(v), 4), day=d, value=round(v, 2))
            for j, (d, v) in enumerate(zip(chosen_days, chosen_vals))
        ]
        markers = {"end": m - 1}
        if not flat:
            markers["peak"] = max(range(m), key=lambda j: pts[j].value)
            markers["trough"] = min(range(m), key=lambda j: pts[j].value)

        peak_raw = max(range(len(closes)), key=lambda i: closes[i])
        trough_raw = min(range(len(closes)), key=lambda i: closes[i])
        out.append(Series(
            symbol=symbol, points=pts, markers=markers, smooth_window=window,
            first_close=closes[0], last_close=closes[-1],
            raw_peak=(days[peak_raw], closes[peak_raw]),
            raw_trough=(days[trough_raw], closes[trough_raw]),
        ))
    return out, (round(lo, 2), round(hi, 2))
