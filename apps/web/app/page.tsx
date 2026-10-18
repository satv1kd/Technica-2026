"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { AuroraBackground } from "../components/AuroraBackground";
import { announce } from "../lib/a11y/live";
import { keyDownAction, keyUpAction, type KeyAction } from "../lib/a11y/keymap";
import { transition, type AppEvent, type AppState } from "../lib/state/appMachine";

const HEADINGS: Record<AppState, string> = {
  menu: "Press a number, or space to talk",
  listening: "Listening",
  thinking: "Thinking",
  answer: "Press space to talk",
  lesson: "Press N for the next step",
  quiz: "Press 1, 2, or 3 to answer",
  confirm: "Press Enter to confirm, or Escape to cancel",
  settling: "Settling your trade",
};

const MAIN_MENU = ["Lessons", "Ask a question", "Practice trading", "Settings", "Help"];

export default function Home() {
  const [state, dispatch] = useReducer(
    (s: AppState, e: AppEvent) => transition(s, e),
    "menu" as AppState,
  );
  const pressedAt = useRef<number | null>(null);

  const handle = useCallback((a: KeyAction, phase: "down" | "up") => {
    if (phase === "down") {
      switch (a.type) {
        case "talk-start":
          pressedAt.current = performance.now();
          dispatch({ type: "TALK_START" });
          break;
        case "menu": dispatch({ type: "MENU" }); break;
        case "digit": if (a.n === 0) dispatch({ type: "BACK" }); break;
        case "next": dispatch({ type: "NEXT" }); break;
        case "prev": dispatch({ type: "PREV" }); break;
        case "confirm": dispatch({ type: "CONFIRM" }); break;
        case "escape": dispatch({ type: "CANCEL" }); break;
        default: break; // repeat, sonify, type: wired up in later phases
      }
    } else if (a.type === "talk-end" && pressedAt.current !== null) {
      const heldMs = performance.now() - pressedAt.current;
      pressedAt.current = null;
      dispatch({ type: "TALK_END", heldMs });
    }
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const a = keyDownAction(e);
      if (!a) return;
      e.preventDefault();
      handle(a, "down");
    };
    const up = (e: KeyboardEvent) => {
      const a = keyUpAction(e);
      if (a) handle(a, "up");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [handle]);

  useEffect(() => {
    announce(HEADINGS[state]);
  }, [state]);

  return (
    <main className="shell">
      <AuroraBackground listening={state === "listening"} />
      <h1 className="heading">{HEADINGS[state]}</h1>
      <button
        className={`spacebar${state === "listening" ? " pressed" : ""}`}
        aria-label="Space bar. Hold to talk."
        onPointerDown={() => handle({ type: "talk-start" }, "down")}
        onPointerUp={() => handle({ type: "talk-end" }, "up")}
        autoFocus
      >
        Space
      </button>
      {state === "menu" && (
        <ol className="menu" aria-label="Main menu">
          {MAIN_MENU.map((label, i) => (
            <li key={label}>
              <span className="menu-key">{i + 1}</span> {label}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
