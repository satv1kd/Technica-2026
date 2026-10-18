import { describe, expect, it } from "vitest";
import { transition } from "@web/lib/state/appMachine";
import { keyDownAction } from "@web/lib/a11y/keymap";

describe("appMachine", () => {
  it("holding space listens, release after 250ms thinks", () => {
    let s = transition("menu", { type: "TALK_START" });
    expect(s).toBe("listening");
    s = transition(s, { type: "TALK_END", heldMs: 300 });
    expect(s).toBe("thinking");
  });

  it("a tap shorter than 250ms returns to the menu", () => {
    const s = transition("listening", { type: "TALK_END", heldMs: 100 });
    expect(s).toBe("menu");
  });

  it("escape cancels listening and a pending confirmation", () => {
    expect(transition("listening", { type: "CANCEL" })).toBe("menu");
    expect(transition("confirm", { type: "CANCEL" })).toBe("answer");
  });

  it("a trade only settles from the confirm state", () => {
    expect(transition("answer", { type: "CONFIRM" })).toBe("answer");
    expect(transition("confirm", { type: "CONFIRM" })).toBe("settling");
  });

  it("cannot talk or leave the menu while settling", () => {
    expect(transition("settling", { type: "TALK_START" })).toBe("settling");
    expect(transition("settling", { type: "MENU" })).toBe("settling");
  });
});

describe("keymap", () => {
  it("ignores key repeat on space", () => {
    expect(keyDownAction({ key: " ", repeat: true })).toBeNull();
    expect(keyDownAction({ key: " " })).toEqual({ type: "talk-start" });
  });

  it("maps digits, letters, and arrows", () => {
    expect(keyDownAction({ key: "3" })).toEqual({ type: "digit", n: 3 });
    expect(keyDownAction({ key: "ArrowRight" })).toEqual({ type: "next" });
    expect(keyDownAction({ key: "M" })).toEqual({ type: "menu" });
    expect(keyDownAction({ key: "q" })).toBeNull();
  });
});

describe("settling", () => {
  it("returns to the answer, or to the lesson the trade was part of", () => {
    expect(transition("settling", { type: "SETTLED" })).toBe("answer");
    expect(transition("settling", { type: "SETTLED", to: "lesson" })).toBe("lesson");
    expect(transition("answer", { type: "SETTLED", to: "lesson" })).toBe("answer");
  });
});
