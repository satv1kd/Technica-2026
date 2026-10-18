"use client";

interface Props {
  hidden: boolean;
  canRepeat: boolean;
  onMenu: () => void;
  onRepeat: () => void;
  onType: () => void;
}

/** Always-present M Menu and R Repeat voice buttons, plus T to type (hidden while the tray is open). */
export function BottomDock({ hidden, canRepeat, onMenu, onRepeat, onType }: Props) {
  return (
    <div className={`dock${hidden ? " dock-hidden" : ""}`} aria-hidden={hidden} role="toolbar" aria-label="Menu and repeat">
      <button type="button" className="dock-button" onClick={onMenu} tabIndex={hidden ? -1 : 0} aria-label="Menu (M)">
        <span className="dock-key">M</span> Menu
      </button>
      <button
        type="button"
        className="dock-button dock-repeat"
        onClick={onRepeat}
        disabled={!canRepeat}
        tabIndex={hidden ? -1 : 0}
        aria-label="Repeat voice (R)"
      >
        <span className="dock-key">R</span> Repeat voice
      </button>
      <button type="button" className="dock-button" onClick={onType} tabIndex={hidden ? -1 : 0} aria-label="Type a question (T)">
        <span className="dock-key">T</span> Type
      </button>
    </div>
  );
}
