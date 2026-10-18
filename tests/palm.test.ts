import { describe, expect, it } from "vitest";
import { opsFromShape, type ChartOps } from "@services/chart/ops";
import { frequency, sonifyPlan, TONE_S, GAP_S } from "@web/lib/palm/sonify";
import { BOX, HOME, MAX_SPEED_CM_S, boxToCm, forward, solveIK, timeline, trapezoid } from "@web/lib/palm/motion";
import { EARCONS } from "@web/lib/voice/earcons";
import { plan } from "../bridge/serial/planner";

const stroke = (ys: number[], style: "solid" | "dashed" = "solid"): ChartOps => ({
  ops: [{ op: "stroke", style, points: ys.map((y, i) => ({ x: i / Math.max(1, ys.length - 1), y })) }],
  alt: "",
  legend: [],
});

describe("sonification", () => {
  it("maps the unit box to 220-880 Hz linearly", () => {
    const tones = sonifyPlan(stroke([0, 0.25, 0.5, 0.75, 1])).events.filter((e) => e.kind === "tone");
    expect(tones.map((t) => (t as any).freq)).toEqual([220, 385, 550, 715, 880]);
  });

  it("clicks every point and spaces tones 150 ms + 100 ms", () => {
    const { events, duration } = sonifyPlan(stroke([0, 1, 0.5]));
    expect(events.filter((e) => e.kind === "click")).toHaveLength(3);
    const ts = events.filter((e) => e.kind === "tone").map((e) => e.t);
    expect(ts[1] - ts[0]).toBeCloseTo(TONE_S + GAP_S);
    expect(duration).toBeCloseTo(3 * (TONE_S + GAP_S));
  });

  it("taps are low thumps; dashed lines use a different timbre", () => {
    const chart: ChartOps = { ...stroke([0.5, 0.6], "dashed"), ops: [...stroke([0.5, 0.6], "dashed").ops, { op: "tap", at: { x: 1, y: 0.6 } }] };
    const { events } = sonifyPlan(chart);
    expect(events.find((e) => e.kind === "thump")).toMatchObject({ freq: 80, dur: 0.2 });
    expect((events.find((e) => e.kind === "tone") as any).wave).toBe("triangle");
  });

  it("clamps out-of-box values", () => {
    expect(frequency(-1)).toBe(220);
    expect(frequency(2)).toBe(880);
  });
});

describe("earcons", () => {
  it("listening start rises and end falls", () => {
    const [start] = EARCONS["listen-start"], [end] = EARCONS["listen-end"];
    expect(start.to).toBeGreaterThan(start.from);
    expect(end.to).toBeLessThan(end.from);
  });
  it("the trade thump is low and wrong-answer is lower than success", () => {
    expect(EARCONS.trade[0].from).toBeLessThan(120);
    expect(EARCONS.wrong[0].from).toBeLessThan(EARCONS.success[0].from);
  });
});

describe("arm kinematics", () => {
  it("IK and forward kinematics agree across the whole drawing box", () => {
    for (const x of [0, 0.5, 1]) {
      for (const y of [0, 0.5, 1]) {
        const target = boxToCm({ x, y });
        const j = solveIK(target);
        expect(j, `reach ${x},${y}`).not.toBeNull();
        const { tip } = forward(j!);
        expect(tip.x).toBeCloseTo(target.x, 6);
        expect(tip.y).toBeCloseTo(target.y, 6);
      }
    }
  });

  it("rejects targets out of reach", () => {
    expect(solveIK({ x: 30, y: 0 })).toBeNull();
    expect(solveIK({ x: 0.1, y: 0 })).toBeNull();
  });

  it("home is reachable", () => {
    expect(solveIK(boxToCm(HOME))).not.toBeNull();
  });
});

describe("motion profile", () => {
  it("never exceeds 4 cm/s and covers the distance", () => {
    const p = trapezoid(BOX.w);
    expect(p.peakV).toBeLessThanOrEqual(MAX_SPEED_CM_S);
    expect(p.at(0)).toBe(0);
    expect(p.at(p.duration)).toBe(1);
    // Average speed under the cap, so a 6 cm line takes at least 1.5 s.
    expect(p.duration).toBeGreaterThanOrEqual(BOX.w / MAX_SPEED_CM_S);
    // Monotonic.
    let prev = 0;
    for (let t = 0; t <= p.duration; t += p.duration / 50) {
      expect(p.at(t)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p.at(t);
    }
  });

  it("short moves use a triangle profile", () => {
    const p = trapezoid(0.2);
    expect(p.peakV).toBeLessThan(MAX_SPEED_CM_S);
  });

  it("the timeline lifts between strokes and returns home", () => {
    const { segments } = timeline(opsFromShape("long-line-short-line-tap"));
    const kinds = segments.map((s) => s.kind);
    expect(kinds.filter((k) => k === "press")).toHaveLength(2);
    expect(kinds.filter((k) => k === "lift")).toHaveLength(2);
    expect(kinds).toContain("tap");
    const last = segments.at(-1)!;
    expect(last.kind === "move" && last.to).toEqual(HOME);
  });
});

describe("serial planner", () => {
  it("homes, lowers, draws, lifts, and homes again", () => {
    expect(plan(stroke([0, 1]))).toEqual(["H", "F 3", "M 0.000 0.000", "P1", "M 1.000 1.000", "P0", "H"]);
  });

  it("taps and waits", () => {
    const cmds = plan(opsFromShape("long-line-short-line-tap"));
    expect(cmds).toContain("W 600");
    expect(cmds).toContain("T 180");
    expect(cmds.filter((c) => c === "P1").length).toBeGreaterThanOrEqual(2);
  });

  it("clamps coordinates and pressure", () => {
    const cmds = plan(stroke([-0.5, 1.5]), 9);
    expect(cmds[1]).toBe("F 5");
    expect(cmds).toContain("M 0.000 0.000");
    expect(cmds).toContain("M 1.000 1.000");
  });

  it("dashed strokes lift between dashes", () => {
    const cmds = plan(stroke([0, 0.2, 0.4, 0.6, 0.8], "dashed"));
    expect(cmds.filter((c) => c === "P0").length).toBeGreaterThan(1);
  });
});
