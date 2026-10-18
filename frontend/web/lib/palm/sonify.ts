/**
 * Play a chart as sound: low notes for low prices, high notes for high ones.
 * 220 Hz (bottom of the box) to 880 Hz (top), a soft click on every point,
 * and a low thump (80 Hz) for each tap. Dashed lines use a different timbre
 * so two series stay distinguishable by ear.
 */
import type { ChartOps } from "../../../../backend/services/chart/ops";
import { audioContext } from "../voice/earcons";

export const LOW_HZ = 220;
export const HIGH_HZ = 880;
export const TONE_S = 0.15;
export const GAP_S = 0.1;
export const THUMP_HZ = 80;
export const THUMP_S = 0.2;

export const frequency = (y: number) => LOW_HZ + Math.min(1, Math.max(0, y)) * (HIGH_HZ - LOW_HZ);

export type SoundEvent =
  | { kind: "tone"; t: number; dur: number; freq: number; wave: OscillatorType }
  | { kind: "click"; t: number }
  | { kind: "thump"; t: number; dur: number; freq: number };

/** The full schedule, in seconds from start. Pure, so it can be tested. */
export function sonifyPlan(chart: ChartOps): { events: SoundEvent[]; duration: number } {
  const events: SoundEvent[] = [];
  let t = 0;
  for (const op of chart.ops) {
    if (op.op === "pause") {
      t += op.ms / 1000;
    } else if (op.op === "tap") {
      events.push({ kind: "thump", t, dur: THUMP_S, freq: THUMP_HZ });
      t += THUMP_S + GAP_S;
    } else {
      const wave: OscillatorType = op.style === "dashed" ? "triangle" : "sine";
      for (const p of op.points) {
        events.push({ kind: "tone", t, dur: TONE_S, freq: frequency(p.y), wave });
        events.push({ kind: "click", t });
        t += TONE_S + GAP_S;
      }
    }
  }
  return { events, duration: t };
}

let stopCurrent: (() => void) | null = null;

export function stopSonify() {
  stopCurrent?.();
  stopCurrent = null;
}

/** Play the chart; resolves when it finishes or is stopped. */
export function sonify(chart: ChartOps): Promise<void> {
  stopSonify();
  const ac = audioContext();
  if (!ac) return Promise.resolve();
  const { events, duration } = sonifyPlan(chart);
  const t0 = ac.currentTime + 0.05;
  const out = ac.createGain();
  out.gain.value = 1;
  out.connect(ac.destination);
  const nodes: AudioScheduledSourceNode[] = [];

  for (const e of events) {
    if (e.kind === "click") {
      // A 10 ms burst of filtered noise marks each point.
      const len = Math.floor(ac.sampleRate * 0.01);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource();
      const hp = ac.createBiquadFilter();
      const g = ac.createGain();
      src.buffer = buf;
      hp.type = "highpass";
      hp.frequency.value = 3000;
      g.gain.value = 0.12;
      src.connect(hp).connect(g).connect(out);
      src.start(t0 + e.t);
      nodes.push(src);
    } else {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = e.kind === "tone" ? e.wave : "sine";
      osc.frequency.value = e.freq;
      const peak = e.kind === "thump" ? 0.5 : 0.16;
      g.gain.setValueAtTime(0.0001, t0 + e.t);
      g.gain.exponentialRampToValueAtTime(peak, t0 + e.t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + e.t + e.dur);
      osc.connect(g).connect(out);
      osc.start(t0 + e.t);
      osc.stop(t0 + e.t + e.dur + 0.02);
      nodes.push(osc);
    }
  }

  return new Promise((resolve) => {
    const timer = setTimeout(done, (duration + 0.1) * 1000);
    function done() {
      clearTimeout(timer);
      if (stopCurrent === stop) stopCurrent = null;
      resolve();
    }
    function stop() {
      out.gain.cancelScheduledValues(ac!.currentTime);
      out.gain.setValueAtTime(0.0001, ac!.currentTime);
      nodes.forEach((n) => {
        try {
          n.stop();
        } catch {}
      });
      done();
    }
    stopCurrent = stop;
  });
}
