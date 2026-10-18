"use client";

import type { PointerEvent } from "react";

export const SOUNDWAVE_BARS = 14;

interface Props {
  listening: boolean;
  disabled?: boolean;
  onPress: () => void;
  onRelease: () => void;
  onCancel: () => void;
  /** True while a press is in progress (lost pointer capture cancels it). */
  isHeld: () => boolean;
}

/** The giant glass space bar: hold to talk, release to send. */
export function SpaceBar({ listening, disabled, onPress, onRelease, onCancel, isHeld }: Props) {
  return (
    <button
      className={`spacebar${listening ? " pressed" : ""}`}
      aria-label="Space bar. Hold to talk."
      aria-pressed={listening}
      disabled={disabled}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onCancel}
      onLostPointerCapture={() => {
        if (isHeld()) onCancel();
      }}
      autoFocus
    >
      <span className="spacebar-label">Space</span>
      <span className="soundwave" aria-hidden="true">
        {Array.from({ length: SOUNDWAVE_BARS }, (_, i) => (
          <span key={i} className="soundwave-bar" style={{ animationDelay: `${(i % 7) * 70 + (i > 6 ? 35 : 0)}ms` }} />
        ))}
      </span>
    </button>
  );
}
