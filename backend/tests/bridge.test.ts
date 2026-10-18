import { describe, expect, it } from "vitest";
import { TAP_MS, plan } from "../bridge/serial/planner";
import { ArmLink, type SerialPortLike } from "../bridge/serial/webserial";
import { drawOnArm } from "../bridge/serial";
import type { ChartOps } from "@services/chart/ops";

const chart = (ops: ChartOps["ops"]): ChartOps => ({ ops, alt: "", legend: [] });
const moves = (cmds: string[]) => cmds.filter((c) => c.startsWith("M ")).map((c) => c.split(" ").slice(1).map(Number));

describe("planner", () => {
  it("homes, sets pressure, draws a stroke, then taps and homes again", () => {
    const cmds = plan(chart([
      { op: "stroke", points: [{ x: 0, y: 0 }, { x: 0.04, y: 0.02 }], style: "solid" },
      { op: "pause", ms: 500 },
      { op: "tap", at: { x: 1, y: 0.5 } },
    ]));
    expect(cmds).toEqual([
      "H", "F 3",
      "M 0.000 0.000", "P1", "M 0.040 0.020", "P0",
      "W 500",
      "M 1.000 0.500", `T ${TAP_MS}`,
      "H",
    ]);
  });

  it("sends one move per chart point, like the on-screen arm's timeline", () => {
    const cmds = plan(chart([{ op: "stroke", points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.9 }, { x: 1, y: 1 }], style: "solid" }]));
    expect(moves(cmds)).toEqual([[0, 0], [0.5, 0.9], [1, 1]]);
  });

  it("lifts the stylus on every other segment of a dashed line", () => {
    const cmds = plan(chart([{
      op: "stroke", style: "dashed",
      points: [{ x: 0, y: 0 }, { x: 0.02, y: 0 }, { x: 0.04, y: 0 }, { x: 0.06, y: 0 }],
    }]));
    expect(cmds.slice(2, -1)).toEqual([
      "M 0.000 0.000", "P1", "M 0.020 0.000",
      "P0", "M 0.040 0.000",
      "P1", "M 0.060 0.000", "P0",
    ]);
  });

  it("clamps coordinates and pressure to safe limits", () => {
    const cmds = plan(chart([{ op: "tap", at: { x: 1.4, y: -0.2 } }]), 9);
    expect(cmds).toContain("F 5");
    expect(cmds).toContain("M 1.000 0.000");
  });

});

/** A fake ESP32: answers each command line with whatever `reply` returns. */
function fakeArm(reply: (cmd: string) => string | null) {
  const sent: string[] = [];
  let push!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder(), dec = new TextDecoder();
  let closed = false;
  const port: SerialPortLike = {
    open: async () => {},
    close: async () => { closed = true; },
    readable: new ReadableStream<Uint8Array>({ start: (c) => { push = c; } }),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        const cmd = dec.decode(chunk).trim();
        sent.push(cmd);
        const r = reply(cmd);
        if (r !== null) push.enqueue(enc.encode(r));
      },
    }),
  };
  return { port, sent, isClosed: () => closed };
}

describe("ArmLink", () => {
  it("sends one command at a time and waits for OK", async () => {
    const arm = fakeArm(() => "OK\n");
    const link = new ArmLink();
    await link.open(arm.port);
    const done: number[] = [];
    await link.send(["H", "M 0.5 0.5", "H"], (i) => done.push(i));
    expect(arm.sent).toEqual(["H", "M 0.5 0.5", "H"]);
    expect(done).toEqual([0, 1, 2]);
    expect(link.connected).toBe(true);
  });

  it("skips debug and blank lines while waiting for the reply", async () => {
    const arm = fakeArm(() => "\nik: shoulder=42.0 elbow=88.1\nOK\n");
    const link = new ArmLink();
    await link.open(arm.port);
    await expect(link.send(["M 0.1 0.1"])).resolves.toBeUndefined();
  });

  it("stops on ERR but stays connected", async () => {
    const arm = fakeArm((cmd) => (cmd.startsWith("M") ? "ERR_LIMIT\n" : "OK\n"));
    const link = new ArmLink();
    await link.open(arm.port);
    await expect(link.send(["H", "M 2 2", "H"])).rejects.toThrow(/ERR_LIMIT/);
    expect(arm.sent).toEqual(["H", "M 2 2"]);
    expect(link.connected).toBe(true);
  });

  it("times out and disconnects when the arm goes silent", async () => {
    const arm = fakeArm(() => null);
    const link = new ArmLink(50);
    const status: boolean[] = [];
    link.onStatus = (c) => status.push(c);
    await link.open(arm.port);
    await expect(link.send(["H"])).rejects.toThrow(/did not answer/);
    expect(link.connected).toBe(false);
    expect(arm.isClosed()).toBe(true);
    expect(status).toEqual([true, false]);
  });

  it("refuses to send when not connected", async () => {
    await expect(new ArmLink().send(["H"])).rejects.toThrow(/not connected/);
  });
});

describe("drawOnArm", () => {
  const tap = chart([{ op: "tap", at: { x: 0.5, y: 0.5 } }]);

  it("draws when connected", async () => {
    const arm = fakeArm(() => "OK\n");
    const link = new ArmLink();
    await link.open(arm.port);
    expect(await drawOnArm(link, tap)).toBe(true);
    expect(arm.sent).toEqual(["H", "F 3", "M 0.500 0.500", `T ${TAP_MS}`, "H"]);
  });

  it("returns false without an arm, or when it fails, instead of throwing", async () => {
    expect(await drawOnArm(null, tap)).toBe(false);
    const arm = fakeArm(() => "ERR_TIMEOUT\n");
    const link = new ArmLink();
    await link.open(arm.port);
    const logged: string[] = [];
    expect(await drawOnArm(link, tap, { log: (m) => logged.push(m) })).toBe(false);
    expect(logged[0]).toMatch(/ERR_TIMEOUT/);
  });
});

describe("payoff chart", () => {
  it("draws zero, the hockey stick, and a break-even tap the arm can follow", async () => {
    const { opsFromPayoff } = await import("@services/chart/ops");
    const ops = opsFromPayoff({
      type: "call", strike: 100, breakeven: 104, contract_cost: 400,
      payoff_at_expiry: [70, 85, 100, 115, 130].map((price) => ({ price, profit: Math.max(0, price - 100) * 100 - 400 })),
    });
    const [zero, , line, tap] = ops.ops as any[];
    expect(zero.style).toBe("dashed");
    expect(line.points.slice(0, 3).map((p: any) => p.y)).toEqual([0, 0, 0]); // flat loss up to the strike
    expect(line.points.at(-1)).toEqual({ x: 1, y: 1 });
    expect(tap.at.x).toBeCloseTo((104 - 70) / 60);
    expect(tap.at.y).toBeCloseTo(zero.points[0].y);
    expect(ops.alt).toMatch(/break-even at 104/);
    // Every point is inside the unit box, so the arm planner can draw it.
    expect(plan(ops).filter((c) => c.startsWith("M")).every((c) => c.split(" ").slice(1).every((n) => +n >= 0 && +n <= 1))).toBe(true);
  });
});
