import { describe, expect, it } from "vitest";
import { DEFAULT_LESSONS, trayItems, trayPick, trayTip } from "@web/lib/tray";
import type { LessonInfo } from "@web/lib/menus";

const withProgress: LessonInfo[] = [
  { ...DEFAULT_LESSONS[0], done: true, upNext: false },
  { ...DEFAULT_LESSONS[1], upNext: true },
  ...DEFAULT_LESSONS.slice(2),
  { number: 6, id: "options", title: "Options basics", stretch: true, done: false, upNext: false },
];

describe("Try asking tray", () => {
  it("has lessons on 1-5 and quick questions on 6-9", () => {
    const items = trayItems(withProgress);
    expect(items.map((i) => i.key)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(items.slice(0, 5).every((i) => i.cmd.kind === "lesson")).toBe(true);
    expect(items.slice(5).map((i) => i.label)).toEqual([
      "How has the S&P 500 done this year?",
      "How did Apple do this month?",
      "Compare a stock and an ETF",
      "How fast does PVOO settle?",
    ]);
  });

  it("leaves out the stretch lesson", () => {
    expect(trayItems(withProgress).some((i) => i.label === "Options basics")).toBe(false);
  });

  it("tags Done and Up next from progress", () => {
    const [first, second, third] = trayItems(withProgress);
    expect(first.tag).toBe("Done");
    expect(second.tag).toBe("Up next");
    expect(third.tag).toBeUndefined();
  });

  it("works with defaults before progress loads", () => {
    const items = trayItems();
    expect(items).toHaveLength(9);
    expect(items[0]).toMatchObject({ label: "How to feel a graph", tag: "Up next", cmd: { kind: "lesson", lesson: "feel-a-graph" } });
  });

  it("picks by key and ignores keys with no item", () => {
    const items = trayItems();
    expect(trayPick(items, 7)?.cmd).toEqual({ kind: "ask", text: "How did Apple do this month?" });
    expect(trayPick(items, 0)).toBeUndefined();
  });

  it("the first-time tip reads two suggestions", () => {
    expect(trayTip(trayItems())).toBe(
      "Tip: while you hold space, you can press a number instead of talking. " +
        "Press 1 for How to feel a graph. Or press 7 to ask: How did Apple do this month?",
    );
  });
});
