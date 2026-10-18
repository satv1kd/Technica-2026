/**
 * Charts -> straight-line segments for PalmArm.drawLine (box coords 0..1000).
 *
 * A palm can only feel about 10 points, so series are resampled down, scaled
 * into the box with ~8% margins, and drawn as one W line per pair of
 * neighboring points. x runs past -> today across the palm; y runs low -> high
 * away from the arm's base.
 */
import type { ChartOps, Pt } from "../../services/chart/ops";
import type { PalmArm } from "./palmArm";

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const MAX_POINTS = 10;
export const MARGIN = 0.08;

/** Evenly resample a series down to n values (linear interpolation). */
export function resample(values: number[], n = MAX_POINTS): number[] {
  if (values.length <= n) return values.slice();
  return Array.from({ length: n }, (_, i) => {
    const pos = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos), t = pos - lo;
    return values[lo] * (1 - t) + values[hi] * t;
  });
}

/** Resample a polyline of unit-box points to at most n points, keeping x in step. */
function resamplePoints(points: Pt[], n = MAX_POINTS): Pt[] {
  if (points.length <= n) return points;
  const xs = resample(points.map((p) => p.x), n);
  const ys = resample(points.map((p) => p.y), n);
  return xs.map((x, i) => ({ x, y: ys[i] }));
}

/** Unit box (0..1) -> arm box (0..1000) with a margin on every side. */
export const toBox = (u: number, margin = MARGIN) =>
  Math.round((margin + Math.min(1, Math.max(0, u)) * (1 - 2 * margin)) * 1000);

function segmentsOf(points: Pt[], dashed = false): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    // Dashed lines skip every other segment so they feel different from solid ones.
    if (dashed && i % 2 === 0) continue;
    const a = points[i - 1], b = points[i];
    out.push({ x1: toBox(a.x), y1: toBox(a.y), x2: toBox(b.x), y2: toBox(b.y) });
  }
  return out;
}

/** L-shaped axes along the left and bottom margins. */
export function axesSegments(): Segment[] {
  const lo = Math.round(MARGIN * 1000) - 40, hi = 1000 - Math.round(MARGIN * 1000);
  const o = Math.max(0, lo);
  return [
    { x1: o, y1: hi, x2: o, y2: o }, // up the left side, drawn top to bottom
    { x1: o, y1: o, x2: hi, y2: o }, // then along the bottom, past to today
  ];
}

/** A price series (any length) -> segments: resampled, min-max normalized, margins. */
export function priceSegments(values: number[], { axes = false, maxPoints = MAX_POINTS } = {}): Segment[] {
  const ys = resample(values.map(Number).filter(Number.isFinite), maxPoints);
  if (ys.length < 2) return axes ? axesSegments() : [];
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min;
  const pts = ys.map((y, i) => ({ x: i / (ys.length - 1), y: span ? (y - min) / span : 0.5 }));
  return [...(axes ? axesSegments() : []), ...segmentsOf(pts)];
}

/**
 * The app's chart format -> segments. Points are already on one shared
 * scale (two-series comparisons stay comparable), so only resample and fit
 * the margins. Taps become zero-length lines: the pen touches down and lifts.
 */
export function chartSegments(chart: ChartOps, { axes = false } = {}): Segment[] {
  const out: Segment[] = axes ? axesSegments() : [];
  for (const op of chart.ops) {
    if (op.op === "stroke") out.push(...segmentsOf(resamplePoints(op.points), op.style === "dashed"));
    else if (op.op === "tap") {
      const x = toBox(op.at.x), y = toBox(op.at.y);
      out.push({ x1: x, y1: y, x2: x, y2: y });
    }
  }
  return out;
}

export interface DrawJob {
  /** Resolves when every segment is drawn, or the job was cancelled or stopped. */
  done: Promise<{ drawn: number; total: number; stopped: boolean }>;
  /** Finish the current line, then skip the rest. */
  cancel(): void;
}

/**
 * Draw segments one W line at a time. "err unreachable" on one line is
 * logged and skipped; a stop or a lost connection ends the job.
 */
export function drawSegments(
  arm: PalmArm,
  segments: Segment[],
  onProgress?: (drawn: number, total: number) => void,
): DrawJob {
  let cancelled = false;
  const done = (async () => {
    let drawn = 0;
    for (const s of segments) {
      if (cancelled || !arm.connected) return { drawn, total: segments.length, stopped: cancelled };
      try {
        await arm.drawLine(s.x1, s.y1, s.x2, s.y2);
      } catch (err) {
        const msg = (err as Error).message;
        if (/stopped|not connected|disconnected|did not answer/.test(msg)) {
          return { drawn, total: segments.length, stopped: true };
        }
        // Anything else (e.g. "err unreachable"): skip this line, keep drawing.
      }
      drawn++;
      onProgress?.(drawn, segments.length);
    }
    return { drawn, total: segments.length, stopped: false };
  })();
  return { done, cancel: () => { cancelled = true; } };
}

/** Convenience: draw a price list on the palm. */
export function drawPriceChart(arm: PalmArm, values: number[], opts: { axes?: boolean; maxPoints?: number } = {}) {
  return drawSegments(arm, priceSegments(values, opts));
}
