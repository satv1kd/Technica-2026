/**
 * Canvas 2D drawing for the palm scene: a realistic open left hand (palm up),
 * a brushed-aluminum two-joint arm, and the soft trace the stylus leaves.
 *
 * Everything is drawn in arm-plane centimetres (shoulder at the origin, y up)
 * through a View that maps cm to canvas pixels.
 */
import type { Pt } from "../../../../services/chart/ops";
import { BOX, forward, type Joints } from "./motion";

export const VIEW_CM = { x0: -20, x1: 4, y0: -1.5, y1: 18.5 };

export class View {
  readonly scale: number;
  constructor(readonly w: number, readonly h: number) {
    this.scale = Math.min(w / (VIEW_CM.x1 - VIEW_CM.x0), h / (VIEW_CM.y1 - VIEW_CM.y0));
  }
  px(p: Pt): Pt {
    const offX = (this.w - (VIEW_CM.x1 - VIEW_CM.x0) * this.scale) / 2;
    const offY = (this.h - (VIEW_CM.y1 - VIEW_CM.y0) * this.scale) / 2;
    return { x: offX + (p.x - VIEW_CM.x0) * this.scale, y: this.h - offY - (p.y - VIEW_CM.y0) * this.scale };
  }
  len(cm: number) {
    return cm * this.scale;
  }
}

// Hand ----------------------------------------------------------------------

/** Finger centerlines from knuckle to tip, in cm (left hand, palm up: thumb on the right). */
const FINGERS: { base: Pt; tip: Pt; width: number }[] = [
  { base: { x: -12.0, y: 12.6 }, tip: { x: -13.2, y: 17.0 }, width: 1.55 }, // little
  { base: { x: -9.9, y: 13.2 }, tip: { x: -10.3, y: 18.6 }, width: 1.75 }, // ring
  { base: { x: -7.6, y: 13.4 }, tip: { x: -7.5, y: 19.2 }, width: 1.85 }, // middle
  { base: { x: -5.3, y: 13.0 }, tip: { x: -4.7, y: 18.2 }, width: 1.75 }, // index
];
const THUMB = { base: { x: -3.6, y: 6.2 }, mid: { x: -1.4, y: 8.6 }, tip: { x: -0.4, y: 11.2 }, width: 2.0 };

function capsule(ctx: CanvasRenderingContext2D, v: View, a: Pt, b: Pt, width: number) {
  const pa = v.px(a), pb = v.px(b);
  const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
  const r = v.len(width / 2);
  const nx = Math.cos(ang + Math.PI / 2) * r, ny = Math.sin(ang + Math.PI / 2) * r;
  ctx.moveTo(pa.x + nx, pa.y + ny);
  ctx.lineTo(pb.x + nx, pb.y + ny);
  ctx.arc(pb.x, pb.y, r, ang + Math.PI / 2, ang - Math.PI / 2, true);
  ctx.lineTo(pa.x - nx, pa.y - ny);
  ctx.arc(pa.x, pa.y, r, ang - Math.PI / 2, ang + Math.PI / 2, true);
}

function handPath(ctx: CanvasRenderingContext2D, v: View) {
  ctx.beginPath();
  // Palm: a soft rounded quadrilateral with a fuller heel near the wrist.
  const P = (x: number, y: number) => v.px({ x, y });
  const s = P(-12.8, 4.0);
  ctx.moveTo(s.x, s.y);
  const c = (a: number[], b: number[], e: number[]) => {
    const [p1, p2, p3] = [P(a[0], a[1]), P(b[0], b[1]), P(e[0], e[1])];
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  };
  c([-13.8, 7.5], [-13.6, 11.5], [-12.4, 13.3]); // little-finger edge
  c([-10.5, 14.4], [-6.5, 14.6], [-4.4, 13.4]); // knuckle line
  c([-3.0, 12.4], [-2.6, 9.6], [-3.2, 7.4]); // index side down to thumb web
  c([-3.6, 5.0], [-5.0, 1.6], [-7.8, 0.9]); // thenar heel
  c([-10.4, 0.6], [-12.4, 1.8], [-12.8, 4.0]); // hypothenar heel
  for (const f of FINGERS) capsule(ctx, v, f.base, f.tip, f.width);
  capsule(ctx, v, THUMB.base, THUMB.mid, THUMB.width);
  capsule(ctx, v, THUMB.mid, THUMB.tip, THUMB.width * 0.9);
}

function crease(ctx: CanvasRenderingContext2D, v: View, pts: number[][], width: number, alpha: number) {
  ctx.beginPath();
  const p = pts.map(([x, y]) => v.px({ x, y }));
  ctx.moveTo(p[0].x, p[0].y);
  if (p.length === 4) ctx.bezierCurveTo(p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y);
  else p.slice(1).forEach((q) => ctx.lineTo(q.x, q.y));
  ctx.strokeStyle = `rgba(120, 62, 46, ${alpha})`;
  ctx.lineWidth = v.len(width);
  ctx.lineCap = "round";
  ctx.stroke();
  // A faint highlight just below each crease sells the depth.
  ctx.translate(0, v.len(0.06));
  ctx.strokeStyle = `rgba(255, 228, 210, ${alpha * 0.45})`;
  ctx.lineWidth = v.len(width * 0.6);
  ctx.stroke();
  ctx.translate(0, -v.len(0.06));
}

/** Draw the static hand (call once into an offscreen canvas). */
export function drawHand(ctx: CanvasRenderingContext2D, v: View) {
  ctx.save();
  // Soft drop shadow on the desk.
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = v.len(1.2);
  ctx.shadowOffsetY = v.len(0.5);
  handPath(ctx, v);
  ctx.fillStyle = "#c98d72";
  ctx.fill("nonzero");
  ctx.restore();

  ctx.save();
  handPath(ctx, v);
  ctx.clip("nonzero");
  // Warm skin: bright at the palm center, deeper toward the edges.
  const c = v.px({ x: -8, y: 7.5 });
  const g = ctx.createRadialGradient(c.x, c.y, v.len(1), c.x, c.y, v.len(12));
  g.addColorStop(0, "#f4c7ad");
  g.addColorStop(0.45, "#e2a588");
  g.addColorStop(0.8, "#c98a6e");
  g.addColorStop(1, "#a86a52");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, v.w, v.h);
  // Fingertip pads, a touch pinker.
  for (const f of FINGERS) {
    const t = v.px({ x: f.base.x + (f.tip.x - f.base.x) * 0.92, y: f.base.y + (f.tip.y - f.base.y) * 0.92 });
    const pg = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, v.len(1.1));
    pg.addColorStop(0, "rgba(240, 160, 150, 0.45)");
    pg.addColorStop(1, "rgba(240, 160, 150, 0)");
    ctx.fillStyle = pg;
    ctx.fillRect(t.x - v.len(1.2), t.y - v.len(1.2), v.len(2.4), v.len(2.4));
  }
  // Palm lines.
  crease(ctx, v, [[-13.0, 11.0], [-10.5, 10.2], [-7.4, 11.8], [-4.6, 12.6]], 0.13, 0.55); // heart
  crease(ctx, v, [[-3.6, 9.6], [-6.4, 9.2], [-9.8, 8.4], [-12.6, 7.0]], 0.12, 0.5); // head
  crease(ctx, v, [[-3.8, 9.4], [-5.8, 7.6], [-6.2, 4.4], [-6.0, 1.4]], 0.14, 0.55); // life
  // Finger joint creases: two per finger, one on the thumb.
  for (const f of FINGERS) {
    for (const at of [0.38, 0.68]) {
      const m = { x: f.base.x + (f.tip.x - f.base.x) * at, y: f.base.y + (f.tip.y - f.base.y) * at };
      const ang = Math.atan2(f.tip.y - f.base.y, f.tip.x - f.base.x) + Math.PI / 2;
      const hw = f.width * 0.32;
      crease(ctx, v, [[m.x - Math.cos(ang) * hw, m.y - Math.sin(ang) * hw], [m.x + Math.cos(ang) * hw, m.y + Math.sin(ang) * hw]], 0.07, 0.45);
    }
  }
  crease(ctx, v, [[-2.0, 8.0], [-0.9, 9.2]], 0.07, 0.45);
  // Rim light: a thin warm glow just inside the outline (subsurface feel).
  handPath(ctx, v);
  ctx.strokeStyle = "rgba(255, 200, 170, 0.55)";
  ctx.lineWidth = v.len(0.35);
  ctx.filter = `blur(${Math.max(1, v.len(0.15))}px)`;
  ctx.stroke();
  ctx.filter = "none";
  ctx.restore();

  // Drawing box: faint dashed 6 x 4 cm rectangle with PAST / TODAY labels.
  const a = v.px({ x: BOX.x, y: BOX.y + BOX.h }), b = v.px({ x: BOX.x + BOX.w, y: BOX.y });
  ctx.save();
  ctx.setLineDash([v.len(0.25), v.len(0.2)]);
  ctx.strokeStyle = "rgba(60, 30, 20, 0.35)";
  ctx.lineWidth = Math.max(1, v.len(0.05));
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(60, 30, 20, 0.6)";
  ctx.font = `700 ${Math.max(9, v.len(0.42))}px "Atkinson Hyperlegible", system-ui, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText("PAST", a.x, b.y + v.len(0.15));
  ctx.textAlign = "right";
  ctx.fillText("TODAY", b.x, b.y + v.len(0.15));
  ctx.restore();
}

// Arm -----------------------------------------------------------------------

function aluminum(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, width: number) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
  const nx = Math.cos(ang) * width, ny = Math.sin(ang) * width;
  const g = ctx.createLinearGradient(a.x - nx / 2, a.y - ny / 2, a.x + nx / 2, a.y + ny / 2);
  g.addColorStop(0, "#5d6870");
  g.addColorStop(0.22, "#c8d1d8");
  g.addColorStop(0.42, "#eef3f6");
  g.addColorStop(0.62, "#9aa6ae");
  g.addColorStop(1, "#4b555c");
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  // Brushed texture: fine lengthwise streaks.
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#ffffff";
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(a.x + (nx * i) / 7, a.y + (ny * i) / 7);
    ctx.lineTo(b.x + (nx * i) / 7, b.y + (ny * i) / 7);
    ctx.stroke();
  }
  ctx.restore();
}

function hub(ctx: CanvasRenderingContext2D, c: Pt, r: number) {
  const g = ctx.createRadialGradient(c.x - r * 0.3, c.y - r * 0.3, r * 0.1, c.x, c.y, r);
  g.addColorStop(0, "#3b4248");
  g.addColorStop(1, "#15191c");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // Four screws.
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i + Math.PI / 4;
    const s = { x: c.x + Math.cos(a) * r * 0.62, y: c.y + Math.sin(a) * r * 0.62 };
    ctx.fillStyle = "#9aa4ab";
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a3034";
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.09, s.y);
    ctx.lineTo(s.x + r * 0.09, s.y);
    ctx.stroke();
  }
}

/**
 * Draw the arm at the given joints. `lift` is 0 (pressing) to 1 (fully up):
 * the stylus rises 6 px and its shadow grows and softens.
 */
export function drawArm(ctx: CanvasRenderingContext2D, v: View, j: Joints, lift: number) {
  const shoulder = v.px({ x: 0, y: 0 });
  const { elbow: e, tip } = forward(j);
  const elbow = v.px(e), wrist = v.px(tip);
  const up = 6 * lift;

  // Stylus shadow on the skin (grows when lifted).
  ctx.save();
  ctx.fillStyle = `rgba(40, 18, 10, ${0.35 - 0.15 * lift})`;
  ctx.filter = `blur(${2 + 4 * lift}px)`;
  ctx.beginPath();
  ctx.ellipse(wrist.x + 3 + up, wrist.y + 3 + up * 0.6, v.len(0.35) + up, v.len(0.22) + up * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Base plate the shoulder is mounted on.
  ctx.save();
  ctx.fillStyle = "#1b2024";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = v.len(0.6);
  ctx.beginPath();
  ctx.roundRect(shoulder.x - v.len(1.6), shoulder.y - v.len(1.2), v.len(3.6), v.len(3.4), v.len(0.5));
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = v.len(0.4);
  ctx.shadowOffsetY = v.len(0.15);
  aluminum(ctx, shoulder, elbow, v.len(1.3));
  aluminum(ctx, elbow, { x: wrist.x, y: wrist.y - up }, v.len(1.0));
  ctx.restore();

  hub(ctx, shoulder, v.len(0.95));
  hub(ctx, elbow, v.len(0.75));

  // Lift servo at the wrist: a small dark block.
  const w = { x: wrist.x, y: wrist.y - up };
  const ang = j.shoulder + j.elbow;
  ctx.save();
  ctx.translate(w.x, w.y);
  ctx.rotate(-ang);
  ctx.fillStyle = "#23292e";
  ctx.beginPath();
  ctx.roundRect(-v.len(0.9), -v.len(0.45), v.len(0.9), v.len(0.9), v.len(0.12));
  ctx.fill();
  ctx.fillStyle = "#3a8f86";
  ctx.fillRect(-v.len(0.75), -v.len(0.1), v.len(0.25), v.len(0.2));
  ctx.restore();

  // Soft white inkless stylus tip.
  const tg = ctx.createRadialGradient(w.x - 2, w.y - 2, 1, w.x, w.y, v.len(0.38));
  tg.addColorStop(0, "#ffffff");
  tg.addColorStop(1, "#cfd6da");
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.arc(w.x, w.y, v.len(0.32), 0, Math.PI * 2);
  ctx.fill();
}

// Trace ---------------------------------------------------------------------

export interface TraceLine {
  points: Pt[]; // unit-box coordinates
  style: "solid" | "dashed";
  born: number; // ms timestamp
}

export interface Ripple {
  at: Pt;
  born: number;
}

export const FADE_AFTER_MS = 10_000;

const boxPx = (v: View, p: Pt) => v.px({ x: BOX.x + p.x * BOX.w, y: BOX.y + p.y * BOX.h });

/** Pressed marks on the skin: a soft glow plus a slight indentation shadow. */
export function drawTrace(ctx: CanvasRenderingContext2D, v: View, lines: TraceLine[], ripples: Ripple[], now: number) {
  for (const line of lines) {
    if (line.points.length < 2) continue;
    const fade = now - line.born > FADE_AFTER_MS ? 0.7 : 1;
    const pts = line.points.map((p) => boxPx(v, p));
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    };
    ctx.save();
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.setLineDash(line.style === "dashed" ? [v.len(0.35), v.len(0.25)] : []);
    // Indentation: a darker line offset slightly down-right.
    ctx.translate(1, 1.5);
    path();
    ctx.strokeStyle = `rgba(110, 50, 35, ${0.35 * fade})`;
    ctx.lineWidth = v.len(0.2);
    ctx.stroke();
    ctx.translate(-1, -1.5);
    // Glow.
    path();
    ctx.shadowColor = line.style === "dashed" ? "rgba(134, 235, 218, 0.9)" : "rgba(255, 201, 90, 0.9)";
    ctx.shadowBlur = v.len(0.45);
    ctx.strokeStyle = line.style === "dashed" ? `rgba(220, 255, 248, ${0.9 * fade})` : `rgba(255, 238, 200, ${0.9 * fade})`;
    ctx.lineWidth = v.len(0.14);
    ctx.stroke();
    ctx.restore();
  }
  // Tap: a dimple with a ripple ring.
  for (const r of ripples) {
    const age = (now - r.born) / 700;
    const c = boxPx(v, r.at);
    ctx.save();
    ctx.fillStyle = "rgba(110, 50, 35, 0.35)";
    ctx.beginPath();
    ctx.arc(c.x, c.y, v.len(0.18), 0, Math.PI * 2);
    ctx.fill();
    if (age < 1) {
      ctx.strokeStyle = `rgba(255, 138, 122, ${1 - age})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, v.len(0.2 + age * 0.9), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
