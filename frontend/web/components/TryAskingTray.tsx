"use client";

import type { TrayItem } from "../lib/tray";

interface Props {
  open: boolean;
  items: TrayItem[];
  picked: number | null;
  onPick: (key: number) => void;
}

/** Glass panel that slides up while the space bar is held. */
export function TryAskingTray({ open, items, picked, onPick }: Props) {
  const groups = [
    { title: "Lessons", items: items.filter((it) => it.cmd.kind === "lesson") },
    { title: "Quick questions", items: items.filter((it) => it.cmd.kind === "ask") },
  ];
  return (
    <aside className={`tray${open ? " open" : ""}`} aria-label="Try asking" aria-hidden={!open}>
      <p className="tray-hint">Try asking, or press a number. It's sent when you let go.</p>
      <div className="tray-groups">
        {groups.map((g) => (
          <section key={g.title} className="tray-group" aria-label={g.title}>
            <h2 className="tray-title">{g.title}</h2>
            <ol className="tray-list">
              {g.items.map((it) => (
                <li key={it.key}>
                  <button
                    type="button"
                    className={`tray-item${picked === it.key ? " picked" : ""}`}
                    aria-pressed={picked === it.key}
                    tabIndex={open ? 0 : -1}
                    onClick={() => onPick(it.key)}
                  >
                    <span className="tray-key">{it.key}</span>
                    <span className="tray-label">{it.label}</span>
                    {it.tag && <span className={`tray-tag tag-${it.tag.toLowerCase().replace(/\s+/g, "-")}`}>{it.tag}</span>}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </aside>
  );
}
