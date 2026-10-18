"use client";

import { useEffect, useState } from "react";
import { SETTLE_HOLD_MS, checklist, explorerLink, type Settlement } from "../lib/trade";

interface Props {
  settlement: Settlement;
  /** Called once every line has ticked, so the app can show the results. */
  onDone: () => void;
}

const MARK: Record<string, string> = { done: "Done", warning: "Warning", info: "Note" };
const ICON: Record<string, string> = { done: "✓", warning: "!", info: "i" };

/** The animated settling checklist, with the Explorer link. */
export function SettlingChecklist({ settlement, onDone }: Props) {
  const items = checklist(settlement);
  const [shown, setShown] = useState(1);
  const link = explorerLink(settlement);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(items.length);
      const t = setTimeout(onDone, 600);
      return () => clearTimeout(t);
    }
    const timers = items.map((it, i) => setTimeout(() => setShown(i + 1), it.atMs));
    timers.push(setTimeout(onDone, items[items.length - 1].atMs + SETTLE_HOLD_MS));
    return () => timers.forEach(clearTimeout);
    // Run once per settlement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlement]);

  return (
    <section className="settling" aria-label="Settling your trade">
      <ol className="checklist">
        {items.slice(0, shown).map((it) => (
          <li key={it.label} className={`check check-${it.state}`}>
            <span className="check-icon" aria-hidden="true">{ICON[it.state]}</span>
            <span className="sr-only">{MARK[it.state]}: </span>
            {it.label}
          </li>
        ))}
      </ol>
      {link && shown === items.length && (
        <p className="explorer">
          <a href={link.href} target="_blank" rel="noreferrer">
            {link.example ? "See an earlier PVOO trade on the Solana Explorer" : "See this trade on the Solana Explorer"}
          </a>
        </p>
      )}
    </section>
  );
}
