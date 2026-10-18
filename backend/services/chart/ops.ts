/**
 * Chart ops: the one drawing format every output understands (on-screen palm,
 * sonification, and the arm path planner). Coordinates are in the unit box:
 * x 0 = past (left) .. 1 = today (right); y 0 = low .. 1 = high.
 */

export interface Pt {
  x: number;
  y: number;
}

export type ChartOp =
  | { op: "stroke"; points: Pt[]; style: "solid" | "dashed"; label?: string }
  | { op: "tap"; at: Pt; label?: string }
  | { op: "pause"; ms: number };

export interface ChartOps {
  ops: ChartOp[];
  /** Screen-reader description of the drawing. */
  alt: string;
  /** Legend entries: label and line style (never color alone). */
  legend: { label: string; style: "solid" | "dashed" }[];
}

/** Shape of the engine's /chart response (see services/engine/api.py). */
export interface EngineChart {
  range: string;
  scale: { low: number; high: number };
  series: {
    symbol: string;
    smoothing: string;
    points: { x: number; y: number; date: string; value: number }[];
    markers: { peak?: number; trough?: number; end: number };
    summary: {
      direction: "up" | "down" | "barely moved";
      pct_change: number;
      first_close: number;
      last_close: number;
    };
  }[];
}

const STYLES = ["solid", "dashed"] as const;

/** Turn an engine chart into ops: one stroke per series, taps on requested markers. */
export function opsFromEngineChart(chart: EngineChart, markers: string[] = [], alt?: string): ChartOps {
  const ops: ChartOp[] = [];
  chart.series.forEach((s, i) => {
    if (i > 0) ops.push({ op: "pause", ms: 600 });
    ops.push({ op: "stroke", points: s.points.map(({ x, y }) => ({ x, y })), style: STYLES[i % 2], label: s.symbol });
    for (const m of markers) {
      const idx = (s.markers as Record<string, number | undefined>)[m];
      if (idx !== undefined) ops.push({ op: "tap", at: { x: s.points[idx].x, y: s.points[idx].y }, label: `${s.symbol} ${m}` });
    }
  });
  const names = chart.series.map((s) => s.symbol);
  return {
    ops,
    alt:
      alt ??
      chart.series
        .map((s, i) => `${s.symbol} as a ${STYLES[i % 2]} line, ${s.summary.direction} over ${chart.range}`)
        .join("; ") + (markers.length ? `, with taps at the ${markers.join(" and ")}.` : "."),
    legend: names.map((label, i) => ({ label, style: STYLES[i % 2] })),
  };
}

const line = (pts: [number, number][], style: "solid" | "dashed" = "solid", label?: string): ChartOp => ({
  op: "stroke",
  points: pts.map(([x, y]) => ({ x, y })),
  style,
  label,
});

/** Teaching shapes used by lessons that draw ideas rather than data. */
export const SHAPES: Record<string, () => ChartOp[]> = {
  flat: () => [line([[0, 0.5], [1, 0.5]])],
  rising: () => [line([[0, 0.1], [1, 0.9]])],
  "tap-center": () => [{ op: "tap", at: { x: 0.5, y: 0.5 } }],
  "short-line-tap": () => [line([[0.35, 0.5], [0.65, 0.5]]), { op: "tap", at: { x: 0.65, y: 0.5 } }],
  "long-line-short-line-tap": () => [
    line([[0, 0.7], [1, 0.7]], "solid", "Regular ETF: next business day"),
    { op: "pause", ms: 600 },
    line([[0, 0.3], [0.12, 0.3]], "dashed", "PVOO: about 2 seconds"),
    { op: "tap", at: { x: 0.12, y: 0.3 } },
  ],
  "call-payoff": () => [
    line([[0, 0.3], [1, 0.3]], "dashed", "Zero"),
    { op: "pause", ms: 400 },
    line([[0, 0.2], [0.5, 0.2], [1, 0.9]], "solid", "Call value"),
    { op: "tap", at: { x: 0.57, y: 0.3 } },
  ],
  "put-payoff": () => [
    line([[0, 0.3], [1, 0.3]], "dashed", "Zero"),
    { op: "pause", ms: 400 },
    line([[0, 0.9], [0.5, 0.2], [1, 0.2]], "solid", "Put value"),
    { op: "tap", at: { x: 0.43, y: 0.3 } },
  ],
  decay: () => [line([[0, 0.9], [0.4, 0.8], [0.7, 0.6], [0.9, 0.3], [1, 0.05]])],
};

export function opsFromShape(shape: string, alt = ""): ChartOps {
  const make = SHAPES[shape];
  if (!make) throw new Error(`Unknown chart shape: ${shape}`);
  const ops = make();
  const legend = ops.flatMap((o) => (o.op === "stroke" && o.label ? [{ label: o.label, style: o.style }] : []));
  return { ops, alt, legend };
}
