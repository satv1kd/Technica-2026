/** Short non-speech sounds for state changes, made with Web Audio (no files). */

export type Earcon = "listen-start" | "listen-end" | "success" | "wrong" | "trade" | "thinking";

interface Note {
  /** Start and end frequency in Hz (a glide when they differ). */
  from: number;
  to: number;
  start: number; // seconds after trigger
  dur: number; // seconds
  type: OscillatorType;
  gain: number;
}

export const EARCONS: Record<Earcon, Note[]> = {
  // Rising when the mic opens, falling when it closes.
  "listen-start": [{ from: 440, to: 660, start: 0, dur: 0.12, type: "sine", gain: 0.18 }],
  "listen-end": [{ from: 660, to: 440, start: 0, dur: 0.12, type: "sine", gain: 0.18 }],
  // A bright two-note chime (C6 then G6).
  success: [
    { from: 1046.5, to: 1046.5, start: 0, dur: 0.14, type: "triangle", gain: 0.16 },
    { from: 1568, to: 1568, start: 0.12, dur: 0.22, type: "triangle", gain: 0.16 },
  ],
  // A low, soft falling tone.
  wrong: [{ from: 220, to: 165, start: 0, dur: 0.3, type: "sine", gain: 0.2 }],
  // A felt thump for a confirmed trade.
  trade: [{ from: 90, to: 55, start: 0, dur: 0.25, type: "sine", gain: 0.45 }],
  thinking: [{ from: 520, to: 520, start: 0, dur: 0.06, type: "sine", gain: 0.08 }],
};

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function playNotes(notes: Note[], ac = audioContext()) {
  if (!ac) return;
  const t0 = ac.currentTime + 0.01;
  for (const n of notes) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.from, t0 + n.start);
    osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.start + n.dur);
    // Short attack and release so nothing clicks.
    g.gain.setValueAtTime(0.0001, t0 + n.start);
    g.gain.exponentialRampToValueAtTime(n.gain, t0 + n.start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.start + n.dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0 + n.start);
    osc.stop(t0 + n.start + n.dur + 0.02);
  }
}

export function earcon(name: Earcon) {
  playNotes(EARCONS[name]);
}
