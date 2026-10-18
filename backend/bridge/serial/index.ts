/** Palm arm bridge: what the web app calls. */
import type { ChartOps } from "../../services/chart/ops";
import { plan } from "./planner";
import type { ArmLink } from "./webserial";

export { ArmLink } from "./webserial";
export { plan } from "./planner";

// The real PalmDraw arm (UNO R4 firmware: "W x1 y1 x2 y2", ok / err replies).
export * from "./palmArm";
export * from "./palmChart";

/**
 * Draw a chart on the physical arm alongside the on-screen palm. Resolves
 * false instead of throwing when the arm isn't connected or the drawing
 * fails, so the caller just keeps the on-screen trace and sound.
 */
export async function drawOnArm(
  link: ArmLink | null,
  chart: ChartOps,
  opts: { pressure?: number; onProgress?: (i: number) => void; log?: (msg: string) => void } = {},
): Promise<boolean> {
  if (!link?.connected) return false;
  try {
    await link.send(plan(chart, opts.pressure), opts.onProgress);
    return true;
  } catch (err) {
    (opts.log ?? console.warn)(`[arm] ${(err as Error).message}`);
    return false;
  }
}
