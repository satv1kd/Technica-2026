"use client";

import { GEMINI_TAG, type Menu } from "../lib/menus";

interface Props {
  menu: Menu;
  onChoose: (n: number) => void;
}

/** The numbered options, listed vertically under the space bar. */
export function OptionsMenu({ menu, onChoose }: Props) {
  const regular = menu.items.filter((it) => it.tag !== GEMINI_TAG);
  const gemini = menu.items.findIndex((it) => it.tag === GEMINI_TAG);
  return (
    <nav className="menu" aria-label={menu.title} data-menu={menu.id}>
      {menu.id !== "main" && <h2 className="menu-title">{menu.title}</h2>}
      <ol className="menu-list" aria-label={menu.title}>
        {regular.map((it, i) => (
          <li key={it.label}>
            <button type="button" className="menu-item" onClick={() => onChoose(i + 1)}>
              <span className="menu-key">{i + 1}</span>
              <span className="menu-label">{it.label}</span>
              {it.tag && <span className={`tray-tag tag-${it.tag.toLowerCase().replace(/\s+/g, "-")}`}>{it.tag}</span>}
            </button>
          </li>
        ))}
        {menu.id !== "main" && (
          <li>
            <button type="button" className="menu-item menu-back" onClick={() => onChoose(0)}>
              <span className="menu-key">0</span>
              <span className="menu-label">Back</span>
            </button>
          </li>
        )}
      </ol>
      {gemini >= 0 && (
        <section className="menu-gemini" aria-label={GEMINI_TAG}>
          <h2 className="menu-gemini-title">{GEMINI_TAG}</h2>
          <button type="button" className="menu-item" onClick={() => onChoose(gemini + 1)}>
            <span className="menu-key">{gemini + 1}</span>
            <span className="menu-label">{menu.items[gemini].label}</span>
          </button>
        </section>
      )}
    </nav>
  );
}
