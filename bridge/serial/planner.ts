/**
 * Arm path planner: chart ops -> serial commands (Appendix C).
 *
 *   H        home and lift        P0 / P1  lift / lower stylus
 *   M x y    move to x, y in [0,1] inside the 6 x 4 cm box
 *   T ms     tap                  W ms     wait
 *   F n      max pressure 1..5    (the firmware enforces speed limits)
 */
import type { ChartOps } from "../../services/chart/ops";

export const MAX_PRESSURE = 3;
const fmt = (n: number) => Math.min(1, Math.max(0, n)).toFixed(3);

export function plan(chart: ChartOps, pressure = MAX_PRESSURE): string[] {
  const cmds = ["H", `F ${Math.min(5, Math.max(1, Math.round(pressure)))}`];
  let down = false;
  const lift = () => {
    if (down) cmds.push("P0");
    down = false;
  };
  for (const op of chart.ops) {
    if (op.op === "pause") {
      lift();
      cmds.push(`W ${Math.round(op.ms)}`);
    } else if (op.op === "tap") {
      lift();
      cmds.push(`M ${fmt(op.at.x)} ${fmt(op.at.y)}`, "T 180");
    } else if (op.points.length) {
      lift();
      const [first, ...rest] = op.points;
      cmds.push(`M ${fmt(first.x)} ${fmt(first.y)}`, "P1");
      down = true;
      // Dashed lines lift briefly between segments so they feel different.
      rest.forEach((p, i) => {
        if (op.style === "dashed" && i % 2 === 1) {
          cmds.push("P0", `M ${fmt(p.x)} ${fmt(p.y)}`, "P1");
        } else {
          cmds.push(`M ${fmt(p.x)} ${fmt(p.y)}`);
        }
      });
    }
  }
  lift();
  cmds.push("H");
  return cmds;
}
