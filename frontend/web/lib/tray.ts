/** The Try asking tray: lessons on keys 1-5, quick questions on 6-9. */
import { TRAY_QUESTIONS, lessonTag, type LessonInfo } from "./menus";

export type TrayCommand = { kind: "lesson"; lesson: string } | { kind: "ask"; text: string };

export interface TrayItem {
  key: number;
  label: string;
  tag?: string;
  cmd: TrayCommand;
}

/** Used until /api/progress answers (or if it can't), so the tray never renders empty. */
export const DEFAULT_LESSONS: LessonInfo[] = [
  { number: 1, id: "feel-a-graph", title: "How to feel a graph", stretch: false, done: false, upNext: true },
  { number: 2, id: "etf", title: "Stocks vs. ETFs", stretch: false, done: false, upNext: false },
  { number: 3, id: "first-trade", title: "Your first practice trade", stretch: false, done: false, upNext: false },
  { number: 4, id: "pvoo", title: "Tokenized funds with PVOO", stretch: false, done: false, upNext: false },
  { number: 5, id: "backtest", title: "What if? Backtesting and risk", stretch: false, done: false, upNext: false },
];

export function trayItems(lessons: LessonInfo[] = DEFAULT_LESSONS): TrayItem[] {
  const core = lessons.filter((l) => !l.stretch).slice(0, 5);
  const lessonItems = core.map((l, i) => ({
    key: i + 1,
    label: l.title,
    tag: lessonTag(l),
    cmd: { kind: "lesson" as const, lesson: l.id },
  }));
  const questionItems = TRAY_QUESTIONS.slice(0, 4).map((text, i) => ({
    key: 6 + i,
    label: text,
    cmd: { kind: "ask" as const, text },
  }));
  return [...lessonItems, ...questionItems];
}

export function trayPick(items: TrayItem[], key: number): TrayItem | undefined {
  return items.find((it) => it.key === key);
}

export const TRAY_TIP_FLAG = "tray-tip";

/** Spoken once, the first time the tray opens. */
export function trayTip(items: TrayItem[]): string {
  const lesson = items.find((it) => it.key === 1);
  const question = items.find((it) => it.key === 7) ?? items.find((it) => it.cmd.kind === "ask");
  const parts = ["Tip: while you hold space, you can press a number instead of talking."];
  if (lesson) parts.push(`Press 1 for ${lesson.label}.`);
  if (question) parts.push(`Or press ${question.key} to ask: ${question.label}`);
  return parts.join(" ");
}
