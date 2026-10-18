/** The numbered menus (Appendix A.3), as data. */
import type { Settings } from "./settings";
import { sizeName } from "./settings";

export type Command =
  | { kind: "submenu"; id: MenuId }
  | { kind: "lesson"; lesson: string }
  | { kind: "ask"; text: string }
  | { kind: "tool"; name: string; args?: Record<string, unknown> }
  | { kind: "setting"; key: "speed" | "chartSounds" | "textSize" | "arm" | "reset" }
  | { kind: "help" };

export type MenuId = "main" | "lessons" | "ask" | "practice" | "settings";

export interface MenuItem {
  label: string;
  tag?: string;
  cmd: Command;
}

export interface Menu {
  id: MenuId;
  title: string;
  items: MenuItem[]; // numbered 1..n; submenus also get "0 Back"
}

export interface GeminiOption {
  label: string;
  say: string;
}

export const GEMINI_TAG = "Options from Gemini";

/** What a number key does in a menu: an item, back (0), or nothing. */
export function menuChoice(menu: Menu, n: number): MenuItem | "back" | null {
  if (n === 0) return menu.id === "main" ? null : "back";
  return menu.items[n - 1] ?? null;
}

export interface LessonInfo {
  number: number;
  id: string;
  title: string;
  stretch: boolean;
  done: boolean;
  upNext: boolean;
}

export const ASK_QUESTIONS = [
  "How has the S&P 500 done this year?",
  "How did Apple do this month?",
  "Compare a stock and an ETF",
  "Explain fees",
  "How fast does PVOO settle?",
];

export function lessonTag(l: LessonInfo): string | undefined {
  return l.done ? "Done" : l.upNext ? "Up next" : l.stretch ? "Stretch" : undefined;
}

export function buildMenu(
  id: MenuId,
  ctx: {
    lessons: LessonInfo[];
    settings: Settings;
    armConnected: boolean;
    armSupported: boolean;
    /** One context-aware suggestion from the tutor's suggest_options tool. */
    gemini?: GeminiOption | null;
  },
): Menu {
  switch (id) {
    case "main":
      return {
        id, title: "Main menu",
        items: [
          { label: "Lessons", cmd: { kind: "submenu", id: "lessons" } },
          { label: "Ask a question", cmd: { kind: "submenu", id: "ask" } },
          { label: "Practice trading", cmd: { kind: "submenu", id: "practice" } },
          { label: "Settings", cmd: { kind: "submenu", id: "settings" } },
          { label: "Help", cmd: { kind: "help" } },
          ...(ctx.gemini ? [{ label: ctx.gemini.label, tag: GEMINI_TAG, cmd: { kind: "ask" as const, text: ctx.gemini.say } }] : []),
        ],
      };
    case "lessons":
      return {
        id, title: "Lessons",
        items: ctx.lessons.map((l) => ({ label: l.title, tag: lessonTag(l), cmd: { kind: "lesson", lesson: l.id } })),
      };
    case "ask":
      return { id, title: "Ask a question", items: ASK_QUESTIONS.map((q) => ({ label: q, cmd: { kind: "ask", text: q } })) };
    case "practice":
      return {
        id, title: "Practice trading",
        items: [
          { label: "Buy 2 PVOO", cmd: { kind: "tool", name: "propose_trade", args: { side: "buy", symbol: "PVOO", quantity: 2 } } },
          { label: "Buy 1 share of VOO", cmd: { kind: "tool", name: "propose_trade", args: { side: "buy", symbol: "VOO", quantity: 1 } } },
          { label: "Sell PVOO", cmd: { kind: "tool", name: "propose_trade", args: { side: "sell", symbol: "PVOO", quantity: 1 } } },
          { label: "Hear my portfolio", cmd: { kind: "tool", name: "get_portfolio" } },
          { label: "Check PVOO backing", cmd: { kind: "tool", name: "check_token_backing" } },
        ],
      };
    case "settings": {
      const s = ctx.settings;
      return {
        id, title: "Settings",
        items: [
          { label: `Speaking speed: ${s.speed}`, cmd: { kind: "setting", key: "speed" } },
          { label: `Chart sounds: ${s.chartSounds ? "on" : "off"}`, cmd: { kind: "setting", key: "chartSounds" } },
          { label: `Text size: ${sizeName(s.textSize)}`, cmd: { kind: "setting", key: "textSize" } },
          {
            label: ctx.armSupported ? `Palm arm: ${ctx.armConnected ? "connected" : "not connected"}` : "Palm arm: needs Chrome or Edge",
            cmd: { kind: "setting", key: "arm" },
          },
          { label: "Reset lesson progress", cmd: { kind: "setting", key: "reset" } },
        ],
      };
    }
  }
}

/** What the tutor says when a menu opens. */
export function speakMenu(menu: Menu, extra?: string): string {
  const items = menu.items.map((it, i) => `${i + 1}, ${it.label}${it.tag ? `, ${it.tag}` : ""}.`).join(" ");
  const back = menu.id === "main" ? "" : " 0, Back.";
  return `${menu.title}. ${items}${back}${extra ? ` ${extra}` : ""}`;
}

export const WELCOME =
  "Welcome to Sonar. Press space to talk at any time. Press R to repeat, and M for this menu. What would you like to do?";

export const HELP =
  "Here are the keys. Hold space to talk, and let go to send. Numbers pick menu options and quiz answers. " +
  "Zero goes back. M opens the menu. R repeats what I said and redraws the chart. N and P move through lesson steps. " +
  "S plays the chart as sound. Enter confirms a trade, and Escape cancels. T lets you type instead of talking.";

/** Try asking tray: lessons 1-5 and quick questions 6-9. */
export const TRAY_QUESTIONS = ASK_QUESTIONS.filter((q) => q !== "Explain fees");
