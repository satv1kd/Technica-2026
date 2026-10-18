import { describe, expect, it, vi } from "vitest";
import { MockTransport, PalmArm, box, type ArmTransport } from "../bridge/serial/palmArm";
import { MARGIN, axesSegments, chartSegments, drawSegments, priceSegments, resample, toBox } from "../bridge/serial/palmChart";

/** A scripted arm: records lines and replies only when the test says so. */
class FakeArm implements ArmTransport {
  readonly kind = "serial" as const;
  sent: string[] = [];
  private cb: (l: string) => void = () => {};
  constructor(private readonly sayReady = true) {}
  onLine(cb: (l: string) => void) { this.cb = cb; }
  async open() { if (this.sayReady) setTimeout(() => this.cb("ready"), 0); }
  async write(line: string) { this.sent.push(line); }
  async close() {}
  reply(line: string) { this.cb(line); }
}

const fast = { command: 200, ping: 200, ready: 50 };

async function connected(t = new FakeArm()) {
  const arm = new PalmArm(fast);
  const p = arm.connect(t);
  await vi.waitFor(() => expect(t.sent).toEqual(["P\n"]));
  t.reply("ok");
  await p;
  t.sent.length = 0;
  return { arm, t };
}

describe("PalmArm protocol", () => {
  it("waits for the board's ready line, then pings before drawing", async () => {
    const t = new FakeArm();
    const arm = new PalmArm(fast);
    const p = arm.connect(t);
    await vi.waitFor(() => expect(t.sent).toEqual(["P\n"]));
    expect(arm.state).toBe("busy");
    t.reply("ok");
    await p;
    expect(arm.state).toBe("ready");
  });

  it("carries on after the reset wait when no ready line comes", async () => {
    const t = new FakeArm(false);
    const arm = new PalmArm(fast);
    const p = arm.connect(t);
    await vi.waitFor(() => expect(t.sent).toEqual(["P\n"]), { timeout: 500 });
    t.reply("ok");
    await expect(p).resolves.toBeUndefined();
  });

  it("drawLine sends exactly one W line, clamped and rounded to 0..1000", async () => {
    const { arm, t } = await connected();
    const done = arm.drawLine(-5, 499.6, 1200, 30.2);
    await vi.waitFor(() => expect(t.sent).toEqual(["W 0 500 1000 30\n"]));
    t.reply("ok");
    await expect(done).resolves.toBeUndefined();
  });

  it("sends one command at a time: the next waits for the previous ok", async () => {
    const { arm, t } = await connected();
    const a = arm.drawLine(0, 0, 100, 100);
    const b = arm.drawLine(100, 100, 200, 50);
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(t.sent).toHaveLength(1);
    t.reply("ok");
    await a;
    await vi.waitFor(() => expect(t.sent).toEqual(["W 0 0 100 100\n", "W 100 100 200 50\n"]));
    t.reply("ok");
    await b;
  });

  it("ignores chatter lines and rejects on an err reply", async () => {
    const { arm, t } = await connected();
    const p = arm.drawLine(0, 0, 10, 10);
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.reply("base 43  elbow 120  lift 90 (holding)");
    t.reply("err unreachable");
    await expect(p).rejects.toThrow("err unreachable");
    // The queue keeps working after an error.
    const q = arm.drawLine(1, 1, 2, 2);
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    t.reply("ok");
    await expect(q).resolves.toBeUndefined();
  });

  it("stop sends X immediately, skipping the queue, and rejects what was waiting", async () => {
    const { arm, t } = await connected();
    const inFlight = arm.drawLine(0, 0, 500, 500);
    const queued = arm.drawLine(500, 500, 1000, 0);
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    await arm.stop();
    expect(t.sent).toEqual(["W 0 0 500 500\n", "X\n"]);
    await expect(inFlight).rejects.toThrow("stopped");
    expect(arm.state).toBe("stopped");
    await queued.catch(() => {});
    // Resume turns the servos back on.
    const r = arm.resume();
    await vi.waitFor(() => expect(t.sent.at(-1)).toBe("R\n"));
    t.reply("Servos on.");
    t.reply("ok");
    await r;
    expect(arm.state).toBe("ready");
  });

  it("times out a silent arm instead of hanging", async () => {
    const { arm } = await connected();
    await expect(arm.drawLine(0, 0, 1, 1)).rejects.toThrow(/did not answer/);
  });

  it("refuses to draw when not connected", async () => {
    await expect(new PalmArm(fast).drawLine(0, 0, 1, 1)).rejects.toThrow(/not connected/);
  });

  it("box() rounds and clamps", () => {
    expect([box(-1), box(1000.4), box(1001), box(NaN)]).toEqual([0, 1000, 1000, 0]);
  });
});

describe("chart to segments", () => {
  it("resamples long series to about 10 points", () => {
    const r = resample(Array.from({ length: 21 }, (_, i) => i), 10);
    expect(r).toHaveLength(10);
    expect(r[0]).toBe(0);
    expect(r.at(-1)).toBe(20);
  });

  it("prices become 9 joined lines across the box with 8% margins", () => {
    const segs = priceSegments(Array.from({ length: 30 }, (_, i) => 100 + i));
    expect(segs).toHaveLength(9);
    const lo = Math.round(MARGIN * 1000), hi = 1000 - lo;
    expect(segs[0]).toMatchObject({ x1: lo, y1: lo });
    expect(segs.at(-1)).toMatchObject({ x2: hi, y2: hi });
    for (const s of segs) for (const v of [s.x1, s.y1, s.x2, s.y2]) expect(v >= lo && v <= hi).toBe(true);
    for (let i = 1; i < segs.length; i++) expect([segs[i].x1, segs[i].y1]).toEqual([segs[i - 1].x2, segs[i - 1].y2]);
  });

  it("a flat series is a level line through the middle", () => {
    expect(priceSegments([5, 5, 5]).every((s) => s.y1 === 500 && s.y2 === 500)).toBe(true);
  });

  it("optional L-shaped axes come first", () => {
    const segs = priceSegments([1, 2, 3], { axes: true });
    expect(segs.slice(0, 2)).toEqual(axesSegments());
    expect(axesSegments()[0].x1).toBe(axesSegments()[1].x1);
  });

  it("app charts: dashed lines skip alternate segments, taps touch down once", () => {
    const pts = Array.from({ length: 5 }, (_, i) => ({ x: i / 4, y: i / 4 }));
    const segs = chartSegments({
      ops: [
        { op: "stroke", style: "solid", points: pts },
        { op: "stroke", style: "dashed", points: pts },
        { op: "tap", at: { x: 1, y: 1 } },
      ],
      alt: "",
      legend: [],
    });
    expect(segs).toHaveLength(4 + 2 + 1);
    expect(segs.at(-1)).toEqual({ x1: toBox(1), y1: toBox(1), x2: toBox(1), y2: toBox(1) });
  });

  it("long app strokes are resampled to at most 10 points", () => {
    const pts = Array.from({ length: 16 }, (_, i) => ({ x: i / 15, y: (i % 3) / 2 }));
    expect(chartSegments({ ops: [{ op: "stroke", style: "solid", points: pts }], alt: "", legend: [] })).toHaveLength(9);
  });
});

describe("drawing a chart with the mock arm", () => {
  it("sends one W per segment, in order, and reports progress", async () => {
    const t = new MockTransport(5);
    const arm = new PalmArm({ command: 1000, ping: 1000, ready: 200 });
    await arm.connect(t);
    const progress: number[] = [];
    const res = await drawSegments(arm, priceSegments([3, 1, 4, 1, 5]), (d) => progress.push(d)).done;
    expect(res).toEqual({ drawn: 4, total: 4, stopped: false });
    expect(t.sent.filter((c) => c.startsWith("W"))).toHaveLength(4);
    expect(progress).toEqual([1, 2, 3, 4]);
  });

  it("a stop mid-chart ends the job, and nothing more is sent", async () => {
    const t = new MockTransport(40);
    const arm = new PalmArm({ command: 1000, ping: 1000, ready: 200 });
    await arm.connect(t);
    const job = drawSegments(arm, priceSegments([1, 2, 3, 4, 5, 6, 7, 8]));
    await vi.waitFor(() => expect(t.sent.filter((c) => c.startsWith("W")).length).toBeGreaterThan(0));
    await arm.stop();
    const res = await job.done;
    expect(res.stopped).toBe(true);
    expect(res.drawn).toBeLessThan(res.total);
    const after = t.sent.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(t.sent.length).toBe(after);
    expect(t.sent.at(-1)).toBe("X");
  });
});
