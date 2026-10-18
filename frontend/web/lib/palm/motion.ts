/**
 * Arm kinematics and motion, shared by the on-screen arm and the path planner.
 *
 * Units are centimetres in the arm's plane: the shoulder sits at the origin,
 * and the 6 x 4 cm drawing box sits up and to the left of it.
 */
import type { ChartOps, Pt } from "../../../../backend/services/chart/ops";

export const LINK1_CM = 9; // shoulder to elbow
export const LINK2_CM = 8; // elbow to stylus
export const MAX_SPEED_CM_S = 4;
export const ACCEL_CM_S2 = 16;
export const BOX = { x: -11, y: 6, w: 6, h: 4 }; // lower-left corner and size, in cm
export const SHOULDER_LIMIT = [-Math.PI, Math.PI] as const;
export const ELBOW_LIMIT = [0.15, Math.PI - 0.15] as const;
export const PRESS_MS = 120;
export const TAP_MS = 180;

export interface Joints {
  shoulder: number; // radians from +x
  elbow: number; // radians, relative to the upper link
}

/** Map unit-box chart coordinates to cm in the arm plane. */
export function boxToCm(p: Pt): Pt {
  return { x: BOX.x + p.x * BOX.w, y: BOX.y + p.y * BOX.h };
}

/**
 * Two-link inverse kinematics (elbow-up branch). Returns null if the target
 * is out of reach or would break a joint limit.
 */
export function solveIK(target: Pt, l1 = LINK1_CM, l2 = LINK2_CM): Joints | null {
  const d2 = target.x ** 2 + target.y ** 2;
  const cosE = (d2 - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  if (cosE < -1 || cosE > 1) return null;
  const elbow = Math.acos(cosE);
  const shoulder = Math.atan2(target.y, target.x) - Math.atan2(l2 * Math.sin(elbow), l1 + l2 * Math.cos(elbow));
  if (elbow < ELBOW_LIMIT[0] || elbow > ELBOW_LIMIT[1]) return null;
  return { shoulder, elbow };
}

export function forward(j: Joints, l1 = LINK1_CM, l2 = LINK2_CM): { elbow: Pt; tip: Pt } {
  const elbow = { x: l1 * Math.cos(j.shoulder), y: l1 * Math.sin(j.shoulder) };
  const a = j.shoulder + j.elbow;
  return { elbow, tip: { x: elbow.x + l2 * Math.cos(a), y: elbow.y + l2 * Math.sin(a) } };
}

/**
 * Trapezoidal velocity profile for a move of `dist` cm: accelerate, cruise
 * at max speed, decelerate. Returns duration in seconds and the fraction of
 * the distance covered at time t.
 */
export function trapezoid(dist: number, vmax = MAX_SPEED_CM_S, accel = ACCEL_CM_S2) {
  const tAcc = vmax / accel;
  const dAcc = 0.5 * accel * tAcc * tAcc;
  let duration: number;
  let peakV = vmax;
  if (2 * dAcc >= dist) {
    // Too short to reach full speed: a triangle profile.
    const t = Math.sqrt(dist / accel);
    duration = 2 * t;
    peakV = accel * t;
  } else {
    duration = 2 * tAcc + (dist - 2 * dAcc) / vmax;
  }
  const ta = peakV / accel;
  const at = (t: number): number => {
    if (dist === 0) return 1;
    const tt = Math.min(Math.max(t, 0), duration);
    let s: number;
    if (tt < ta) s = 0.5 * accel * tt * tt;
    else if (tt <= duration - ta) s = 0.5 * accel * ta * ta + peakV * (tt - ta);
    else s = dist - 0.5 * accel * (duration - tt) ** 2;
    return Math.min(1, s / dist);
  };
  return { duration, at, peakV };
}

/** One timed motion segment for the on-screen arm. */
export type Segment =
  | { kind: "move"; from: Pt; to: Pt; pen: "up" | "down"; start: number; dur: number; at: (t: number) => number; style?: "solid" | "dashed" }
  | { kind: "lift" | "press"; at_: Pt; start: number; dur: number }
  | { kind: "tap"; at_: Pt; start: number; dur: number }
  | { kind: "wait"; start: number; dur: number };

export const HOME: Pt = { x: 1.1, y: 0.5 }; // just right of the box, in unit coords

/** Turn chart ops into a timeline (seconds), honoring the speed limit. */
export function timeline(chart: ChartOps): { segments: Segment[]; duration: number } {
  const segments: Segment[] = [];
  let t = 0;
  let pos: Pt = HOME;
  let pen: "up" | "down" = "up";

  const travel = (to: Pt, penState: "up" | "down", style?: "solid" | "dashed") => {
    const a = boxToCm(pos), b = boxToCm(to);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const prof = trapezoid(dist);
    segments.push({ kind: "move", from: pos, to, pen: penState, start: t, dur: prof.duration, at: prof.at, style });
    t += prof.duration;
    pos = to;
  };
  const lift = () => {
    if (pen === "down") {
      segments.push({ kind: "lift", at_: pos, start: t, dur: PRESS_MS / 1000 });
      t += PRESS_MS / 1000;
      pen = "up";
    }
  };
  const press = () => {
    if (pen === "up") {
      segments.push({ kind: "press", at_: pos, start: t, dur: PRESS_MS / 1000 });
      t += PRESS_MS / 1000;
      pen = "down";
    }
  };

  for (const op of chart.ops) {
    if (op.op === "pause") {
      lift();
      segments.push({ kind: "wait", start: t, dur: op.ms / 1000 });
      t += op.ms / 1000;
    } else if (op.op === "tap") {
      lift();
      travel(op.at, "up");
      segments.push({ kind: "tap", at_: op.at, start: t, dur: TAP_MS / 1000 });
      t += TAP_MS / 1000;
    } else if (op.points.length) {
      lift();
      travel(op.points[0], "up");
      press();
      for (const p of op.points.slice(1)) travel(p, "down", op.style);
    }
  }
  lift();
  travel(HOME, "up");
  return { segments, duration: t };
}

/** Idle breathing: the hand rises and settles about 1.5 px every 4 s. */
export const BREATHE_PX = 1.5;
export const BREATHE_PERIOD_MS = 4000;
export function breathe(nowMs: number): number {
  return Math.sin((nowMs / BREATHE_PERIOD_MS) * Math.PI * 2) * BREATHE_PX;
}
