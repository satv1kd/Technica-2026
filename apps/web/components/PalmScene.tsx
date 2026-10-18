"use client";

import { useEffect, useRef } from "react";
import type { ChartOps, Pt } from "../../../services/chart/ops";
import { View, drawArm, drawHand, drawTrace, type Ripple, type TraceLine } from "../lib/palm/draw";
import { HOME, boxToCm, solveIK, timeline, type Joints, type Segment } from "../lib/palm/motion";

export type PalmStatus = "idle" | "drawing" | "finished";

interface Props {
  chart: ChartOps | null;
  /** Change to redraw the same chart (Repeat voice). */
  playKey: number;
  onStatus?: (s: PalmStatus) => void;
  /** Called on every tap so the page can play a thump or pulse the arm. */
  onTap?: () => void;
}

const lerp = (a: Pt, b: Pt, f: number): Pt => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Where the stylus is and how high it's lifted at time t (seconds). */
function stateAt(segments: Segment[], t: number): { pos: Pt; lift: number; seg: Segment | null } {
  let pos = HOME, lift = 1;
  for (const s of segments) {
    if (t < s.start) break;
    const f = s.dur ? Math.min(1, (t - s.start) / s.dur) : 1;
    const ease = 0.5 - Math.cos(Math.PI * f) / 2;
    if (s.kind === "move") {
      pos = lerp(s.from, s.to, s.at(t - s.start));
      lift = s.pen === "down" ? 0 : 1;
    } else if (s.kind === "press") {
      pos = s.at_;
      lift = 1 - ease;
    } else if (s.kind === "lift") {
      pos = s.at_;
      lift = ease;
    } else if (s.kind === "tap") {
      pos = s.at_;
      lift = Math.abs(Math.cos(Math.PI * f)); // down and back up
    }
    if (t < s.start + s.dur) return { pos, lift, seg: s };
  }
  return { pos, lift, seg: null };
}

export function PalmScene({ chart, playKey, onStatus, onTap }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handCache = useRef<{ canvas: HTMLCanvasElement; w: number; h: number } | null>(null);
  const cb = useRef({ onStatus, onTap });
  cb.current = { onStatus, onTap };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const still = reducedMotion();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      handCache.current = null;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const plan = chart ? timeline(chart) : { segments: [], duration: 0 };
    const lines: TraceLine[] = [];
    const ripples: Ripple[] = [];
    const t0 = performance.now();
    let last: Joints = solveIK(boxToCm(HOME))!;
    let lastSeg: Segment | null = null;
    let status: PalmStatus = chart ? "drawing" : "idle";
    cb.current.onStatus?.(status);

    if (still && chart) {
      // Reduced motion: show the finished drawing at once, no animation.
      for (const op of chart.ops) {
        if (op.op === "stroke") lines.push({ points: op.points, style: op.style, born: t0 });
        if (op.op === "tap") ripples.push({ at: op.at, born: t0 - 1000 });
      }
    }

    let raf = 0;
    const frame = (now: number) => {
      const w = canvas.width, h = canvas.height;
      const v = new View(w, h);
      if (!handCache.current || handCache.current.w !== w || handCache.current.h !== h) {
        const off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        drawHand(off.getContext("2d")!, v);
        handCache.current = { canvas: off, w, h };
      }
      const t = still ? plan.duration : (now - t0) / 1000;
      const { pos, lift, seg } = stateAt(plan.segments, t);

      if (!still && seg !== lastSeg) {
        if (seg?.kind === "press" || (seg?.kind === "move" && seg.pen === "down" && lastSeg?.kind === "press")) {
          if (seg.kind === "press") lines.push({ points: [seg.at_], style: "solid", born: now });
        }
        if (seg?.kind === "tap") {
          ripples.push({ at: seg.at_, born: now });
          cb.current.onTap?.();
        }
        lastSeg = seg;
      }
      if (!still && seg?.kind === "move" && seg.pen === "down") {
        const line = lines.at(-1);
        if (line) {
          line.style = seg.style ?? "solid";
          line.points.push(pos);
        }
      }

      // Idle breathing: the hand rises and settles about 1.5 px every 4 s.
      const breathe = still ? 0 : Math.sin((now / 4000) * Math.PI * 2) * 1.5 * dpr;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(0, breathe);
      ctx.drawImage(handCache.current.canvas, 0, 0);
      drawTrace(ctx, v, lines, ripples, now);
      ctx.restore();
      const target = boxToCm(pos);
      last = solveIK(target) ?? last;
      drawArm(ctx, v, last, lift);

      if (chart && status === "drawing" && t >= plan.duration) {
        status = "finished";
        cb.current.onStatus?.(status);
      }
      if (!still || status === "drawing") raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [chart, playKey]);

  return (
    <canvas
      ref={canvasRef}
      className="palm-canvas"
      role="img"
      aria-label={chart?.alt || "An open hand, palm up, with a small robotic arm beside it."}
    />
  );
}
