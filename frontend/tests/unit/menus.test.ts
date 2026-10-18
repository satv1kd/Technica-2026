import { describe, expect, it } from "vitest";
import { GEMINI_TAG, buildMenu, menuChoice, speakMenu } from "@web/lib/menus";
import { DEFAULT_SETTINGS, toggleSetting } from "@web/lib/settings";
import { DEFAULT_LESSONS } from "@web/lib/tray";

const ctx = { lessons: DEFAULT_LESSONS, settings: DEFAULT_SETTINGS, armConnected: false, armSupported: true };

describe("menus", () => {
  it("main menu has the five PRD options", () => {
    expect(buildMenu("main", ctx).items.map((i) => i.label)).toEqual([
      "Lessons", "Ask a question", "Practice trading", "Settings", "Help",
    ]);
  });

  it("number keys pick items; 0 goes back only from submenus", () => {
    const main = buildMenu("main", ctx);
    expect(menuChoice(main, 1)).toMatchObject({ cmd: { kind: "submenu", id: "lessons" } });
    expect(menuChoice(main, 0)).toBeNull();
    expect(menuChoice(main, 9)).toBeNull();
    expect(menuChoice(buildMenu("settings", ctx), 0)).toBe("back");
  });

  it("adds the Gemini suggestion as option 6 on the main menu only", () => {
    const gemini = { label: "Continue Stocks vs. ETFs", say: "Continue the Stocks vs. ETFs lesson" };
    const main = buildMenu("main", { ...ctx, gemini });
    expect(main.items[5]).toEqual({ label: gemini.label, tag: GEMINI_TAG, cmd: { kind: "ask", text: gemini.say } });
    expect(buildMenu("lessons", { ...ctx, gemini }).items.some((i) => i.tag === GEMINI_TAG)).toBe(false);
  });

  it("settings labels show current values", () => {
    const labels = buildMenu("settings", { ...ctx, settings: { speed: "fast", chartSounds: true, textSize: "xl" } }).items.map((i) => i.label);
    expect(labels.slice(0, 3)).toEqual(["Speaking speed: fast", "Chart sounds: on", "Text size: extra large"]);
  });

  it("spoken submenus end with 0, Back", () => {
    expect(speakMenu(buildMenu("practice", ctx))).toMatch(/^Practice trading\. 1, Buy 2 PVOO\..* 0, Back\.$/);
    expect(speakMenu(buildMenu("main", ctx))).not.toMatch(/Back/);
  });
});

describe("settings toggles", () => {
  it("cycles speaking speed and says so", () => {
    const r = toggleSetting(DEFAULT_SETTINGS, "speed");
    expect(r.settings.speed).toBe("fast");
    expect(r.say).toBe("Speaking speed is now fast.");
    expect(toggleSetting(r.settings, "speed").settings.speed).toBe("slow");
  });

  it("toggles chart sounds and cycles text size", () => {
    expect(toggleSetting(DEFAULT_SETTINGS, "chartSounds").say).toBe("Chart sounds are now on.");
    const large = toggleSetting(DEFAULT_SETTINGS, "textSize");
    expect(large.say).toBe("Text size is now large.");
    expect(toggleSetting(large.settings, "textSize").say).toBe("Text size is now extra large.");
  });
});
