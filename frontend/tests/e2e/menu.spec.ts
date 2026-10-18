import { expect, test, type Page } from "@playwright/test";
import { installVoiceMocks } from "./voice.fixture";

interface Calls {
  tts: { text: string; speed: string }[];
  talk: string[];
  action: any[];
  progressDeletes: number;
}

async function setup(page: Page): Promise<Calls> {
  const calls: Calls = { tts: [], talk: [], action: [], progressDeletes: 0 };
  await installVoiceMocks(page);
  await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  await page.route("**/api/tts", (route) => {
    calls.tts.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "audio/wav", body: "test audio" });
  });
  await page.route("**/api/progress", (route) => {
    if (route.request().method() === "DELETE") {
      calls.progressDeletes++;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { lessons: [] } });
  });
  await page.route("**/api/talk", (route) => {
    calls.talk.push(route.request().postDataJSON().transcript);
    return route.fulfill({
      json: {
        reply: "Apple rose this month.", state: {}, history: [], tools: [],
        directives: [{ type: "options", options: [{ label: "Continue Stocks vs. ETFs", say: "Continue the Stocks vs. ETFs lesson" }] }],
      },
    });
  });
  await page.route("**/api/action", (route) => {
    calls.action.push(route.request().postDataJSON().action);
    return route.fulfill({ json: { reply: "You have ten thousand dollars in practice cash.", directives: [], state: {}, history: [], tools: [] } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // The live region is filled by the client, so this waits for hydration (key handlers attached).
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
  return calls;
}

const menu = (page: Page) => page.locator("nav.menu");

test("the main menu shows on launch with five numbered options", async ({ page }) => {
  await setup(page);
  await expect(menu(page)).toHaveAttribute("data-menu", "main");
  await expect(page.getByRole("list", { name: "Main menu" }).getByRole("button")).toHaveText([
    "1Lessons", "2Ask a question", "3Practice trading", "4Settings", "5Help",
  ]);
});

test("M reads the welcome and menu aloud the first time", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.press("m");
  await expect.poll(() => calls.tts.length).toBe(1);
  expect(calls.tts[0].text).toMatch(/^Welcome to Sonar\. .*What would you like to do\? 1, Lessons\. 2, Ask a question\./);
  await page.keyboard.press("m");
  await expect.poll(() => calls.tts.length).toBe(2);
  expect(calls.tts[1].text).toMatch(/^Main menu\. 1, Lessons\./);
});

test("R before anything was said repeats the welcome", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.press("r");
  await expect.poll(() => calls.tts.length).toBe(1);
  expect(calls.tts[0].text).toMatch(/^Welcome to Sonar\./);
});

test("1 opens Lessons, 0 goes back to the main menu", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.press("1");
  await expect(menu(page)).toHaveAttribute("data-menu", "lessons");
  await expect(menu(page).getByRole("heading", { name: "Lessons" })).toBeVisible();
  await expect(menu(page).getByRole("button", { name: /^1 How to feel a graph/ })).toBeVisible();
  await expect(menu(page).getByRole("button", { name: /^0 Back$/ })).toBeVisible();
  await expect.poll(() => calls.tts.at(-1)?.text ?? "").toMatch(/^Lessons\. 1, How to feel a graph, Up next\..* 0, Back\.$/);
  await page.keyboard.press("0");
  await expect(menu(page)).toHaveAttribute("data-menu", "main");
});

test("Practice trading runs a tool directly, without the model", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.press("3");
  await expect(menu(page)).toHaveAttribute("data-menu", "practice");
  await page.keyboard.press("4");
  await expect(page.getByLabel("Tutor reply")).toHaveText("You have ten thousand dollars in practice cash.");
  expect(calls.action).toEqual([{ type: "tool", name: "get_portfolio" }]);
  expect(calls.talk).toEqual([]);
});

test("Ask a question sends the question to the tutor", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.press("2");
  await page.keyboard.press("2");
  await expect(page.getByLabel("Tutor reply")).toHaveText("Apple rose this month.");
  expect(calls.talk).toEqual(["How did Apple do this month?"]);
});

test("a Gemini suggestion appears as option 6 and can be chosen", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.press("2");
  await page.keyboard.press("2");
  await expect(page.getByLabel("Tutor reply")).toBeVisible();
  await page.keyboard.press("m");
  const slot = page.getByRole("region", { name: "Options from Gemini" });
  await expect(slot.getByRole("button")).toHaveText("6Continue Stocks vs. ETFs");
  await page.keyboard.press("6");
  await expect.poll(() => calls.talk.length).toBe(2);
  expect(calls.talk[1]).toBe("Continue the Stocks vs. ETFs lesson");
});

test("settings change, persist, are spoken, and the next speech uses the new speed", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.press("4");
  await expect(menu(page)).toHaveAttribute("data-menu", "settings");
  await page.keyboard.press("1");
  await expect(page.locator(".voice-message")).toHaveText("Speaking speed is now fast.");
  await expect.poll(() => calls.tts.at(-1)?.text).toBe("Speaking speed is now fast.");
  expect(calls.tts.at(-1)?.speed).toBe("fast");
  await expect(menu(page).getByRole("button", { name: /Speaking speed: fast/ })).toBeVisible();

  await page.keyboard.press("2");
  await expect(page.locator(".voice-message")).toHaveText("Chart sounds are now on.");
  await page.keyboard.press("3");
  await expect(page.locator(".voice-message")).toHaveText("Text size is now large.");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text-scale").trim())).toBe("1.5");

  // Persisted across a reload.
  await page.reload();
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
  await page.keyboard.press("4");
  await expect(menu(page).getByRole("button", { name: /Speaking speed: fast/ })).toBeVisible();
  await expect(menu(page).getByRole("button", { name: /Chart sounds: on/ })).toBeVisible();
  await expect(menu(page).getByRole("button", { name: /Text size: large/ })).toBeVisible();

  // The next speech after a change uses the new speed.
  await page.keyboard.press("0");
  await expect.poll(() => calls.tts.at(-1)?.text ?? "").toMatch(/^Main menu\./);
  expect(calls.tts.at(-1)?.speed).toBe("fast");
});

test("reset progress needs a second press to confirm", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.press("4");
  await page.keyboard.press("5");
  await expect(page.locator(".voice-message")).toHaveText("Press 5 again to reset all lesson progress.");
  expect(calls.progressDeletes).toBe(0);
  await page.keyboard.press("5");
  await expect(page.locator(".voice-message")).toHaveText("Lesson progress is reset.");
  expect(calls.progressDeletes).toBe(1);
});

test("the dock shows M and R, and hides while the tray is open", async ({ page }) => {
  await setup(page);
  const dock = page.getByRole("toolbar", { name: "Menu and repeat" });
  await expect(dock.getByRole("button", { name: "Menu (M)" })).toBeVisible();
  await expect(dock.getByRole("button", { name: "Repeat voice (R)" })).toBeVisible();
  await page.keyboard.down(" ");
  await expect(dock).toBeHidden();
  await page.keyboard.press("Escape");
  await page.keyboard.up(" ");
  await expect(dock).toBeVisible();
});

test("R repeats a menu instantly without another speech request", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.press("m");
  await expect.poll(() => calls.tts.length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__voice.played)).toBe(1);
  await page.keyboard.press("r");
  await expect.poll(() => page.evaluate(() => (window as any).__voice.played)).toBe(2);
  expect(calls.tts).toHaveLength(1);
});
