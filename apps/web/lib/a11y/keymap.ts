/** Logical actions produced by the keyboard (Appendix A.5). */
export type KeyAction =
  | { type: "talk-start" }
  | { type: "talk-end" }
  | { type: "digit"; n: number }
  | { type: "menu" }
  | { type: "repeat" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "sonify" }
  | { type: "confirm" }
  | { type: "escape" }
  | { type: "type" };

export interface KeyLike {
  key: string;
  repeat?: boolean;
}

/** Map a keydown to an action. Returns null for keys Sonar ignores. */
export function keyDownAction(e: KeyLike): KeyAction | null {
  // Holding Space fires repeated keydowns; only the first starts talking.
  if (e.key === " ") return e.repeat ? null : { type: "talk-start" };
  if (/^[0-9]$/.test(e.key)) return { type: "digit", n: Number(e.key) };
  switch (e.key.toLowerCase()) {
    case "m": return { type: "menu" };
    case "r": return { type: "repeat" };
    case "n":
    case "arrowright": return { type: "next" };
    case "p":
    case "arrowleft": return { type: "prev" };
    case "s": return { type: "sonify" };
    case "t": return { type: "type" };
    case "enter": return { type: "confirm" };
    case "escape": return { type: "escape" };
    default: return null;
  }
}

export function keyUpAction(e: KeyLike): KeyAction | null {
  return e.key === " " ? { type: "talk-end" } : null;
}
