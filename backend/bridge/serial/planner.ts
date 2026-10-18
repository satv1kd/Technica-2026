/**
 * Arm path planner: chart ops -> serial commands (Appendix C).
 *
 *   H        home and lift        P0 / P1  lift / lower stylus
 *   M x y    move to x, y in [0,1] inside the 6 x 4 cm box
 *   T ms     tap                  W ms     wait
 *   F n      max pressure 1..5
 *
 * Coordinates are chart coordinates: x 0 = past (left) .. 1 = today (right),
 * y 0 = low .. 1 = high. The firmware maps them onto the palm box and moves
 * in a straight line between points at up to 4 cm/s with a trapezoidal
 * profile, exactly like the on-screen arm, so one M per chart point keeps
 * the two in step.
 */
import type { ChartOps, Pt } from "../../services/chart/ops";

export const MAX_PRESSURE = 3;
// Same as the on-screen arm (frontend/web/lib/palm/motion.ts) so they stay in step.
export const TAP_MS = 180;

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const fmt = (n: number) => clamp(n).toFixed(3);
const move = (p: Pt) => `M ${fmt(p.x)} ${fmt(p.y)}`;

export function plan(chart: ChartOps, pressure = MAX_PRESSURE): string[] {
  const cmds = ["H", `F ${Math.min(5, Math.max(1, Math.round(pressure)))}`];
  let down = false;
  const lift = () => {
    if (down) cmds.push("P0");
    down = false;
  };
  const lower = () => {
    if (!down) cmds.push("P1");
    down = true;
  };
  for (const op of chart.ops) {
    if (op.op === "pause") {
      lift();
      cmds.push(`W ${Math.round(op.ms)}`);
    } else if (op.op === "tap") {
      lift();
      cmds.push(move(op.at), `T ${TAP_MS}`);
    } else if (op.points.length) {
      lift();
      const [first, ...rest] = op.points;
      cmds.push(move(first));
      lower();
      rest.forEach((p, i) => {
        // Dashed lines skip every other segment with the stylus up, so they
        // feel different from solid ones.
        if (op.style === "dashed" && i % 2 === 1) {
          lift();
          cmds.push(move(p));
        } else {
          lower();
          cmds.push(move(p));
        }
      });
    }
  }
  lift();
  cmds.push("H");
  return cmds;
}
