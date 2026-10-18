"use client";

import type { ArmState } from "../../../backend/bridge/serial/palmArm";

interface Props {
  state: ArmState;
  mock: boolean;
  supported: boolean;
  progress: { drawn: number; total: number } | null;
  log: string[];
  onConnect: () => void;
  onDisconnect: () => void;
  onStop: () => void;
  onResume: () => void;
  onTraceBox: () => void;
}

export function armStatusText(state: ArmState, mock: boolean, progress: Props["progress"]): string {
  const name = mock ? "Mock arm" : "Palm arm";
  switch (state) {
    case "disconnected": return `${name}: not connected`;
    case "connecting": return `${name}: connecting…`;
    case "stopped": return `${name}: stopped`;
    case "busy":
      return progress ? `${name}: drawing line ${Math.min(progress.drawn + 1, progress.total)} of ${progress.total}` : `${name}: moving`;
    default: return `${name}: connected`;
  }
}

/** Connect / Stop / Resume / Trace box for the physical palm arm. */
export function ArmControls(p: Props) {
  const connected = p.state !== "disconnected" && p.state !== "connecting";
  const status = armStatusText(p.state, p.mock, p.progress);
  return (
    <section className="arm-controls" aria-label="Palm arm">
      <p className="arm-status" role="status">
        <span className={`arm-dot arm-dot-${p.state}`} aria-hidden="true" />
        {status}
      </p>
      <div className="arm-buttons">
        {!connected ? (
          <button type="button" className="arm-button" onClick={p.onConnect}
            disabled={p.state === "connecting" || (!p.supported && !p.mock)}>
            {p.mock ? "Connect mock arm" : "Connect arm"}
          </button>
        ) : (
          <button type="button" className="arm-button" onClick={p.onDisconnect}>Disconnect</button>
        )}
        {p.state === "stopped" ? (
          <button type="button" className="arm-button arm-resume" onClick={p.onResume}>Resume arm</button>
        ) : (
          <button type="button" className="arm-button arm-stop" onClick={p.onStop} disabled={!connected}
            aria-keyshortcuts="X">
            <span className="dock-key">X</span> Stop arm
          </button>
        )}
        <button type="button" className="arm-button" onClick={p.onTraceBox} disabled={p.state !== "ready"}
          title="The arm traces the 50 x 30 mm drawing box so you can position your hand">
          Trace box
        </button>
      </div>
      {!p.supported && !p.mock && (
        <p className="arm-note">The arm needs Chrome or Edge. Add <code>?arm=mock</code> to the address to test without it.</p>
      )}
      {p.mock && p.log.length > 0 && (
        <details className="arm-log" open>
          <summary>Commands sent</summary>
          <ol aria-label="Arm commands">
            {p.log.map((l, i) => <li key={i}><code>{l}</code></li>)}
          </ol>
        </details>
      )}
    </section>
  );
}
