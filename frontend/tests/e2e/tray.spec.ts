import { expect, test, type Page } from "@playwright/test";
import { installVoiceMocks } from "./voice.fixture";

const lessons = [
  { number: 1, id: "feel-a-graph", title: "How to feel a graph", stretch: false, done: true, upNext: false },
  { number: 2, id: "etf", title: "Stocks vs. ETFs", stretch: false, done: false, upNext: true },
  { number: 3, id: "first-trade", title: "Your first practice trade", stretch: false, done: false, upNext: false },
  { number: 4, id: "pvoo", title: "Tokenized funds with PVOO", stretch: false, done: false, upNext: false },
  { number: 5, id: "backtest", title: "What if? Backtesting and risk", stretch: false, done: false, upNext: false },
  { number: 6, id: "options", title: "Options basics", stretch: true, done: false, upNext: false },
];

interface Calls {
  stt: number;
  talk: string[];
  action: any[];
  tts: string[];
}

async function setup(page: Page, opts: { tipSeen?: boolean } = {}): Promise<Calls> {
  const calls: Calls = { stt: 0, talk: [], action: [], tts: [] };
  await installVoiceMocks(page);
  if (opts.tipSeen !== false) {
    await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  }
  await page.route("**/api/progress", (route) => route.fulfill({ json: { progress: {}, upNext: "etf", lessons } }));
  await page.route("**/api/stt", (route) => {
    calls.stt++;
    return route.fulfill({ json: { ok: true, text: "What is an ETF?", confidence: 0.95 } });
  });
  await page.route("**/api/talk", (route) => {
    calls.talk.push(route.request().postDataJSON().transcript);
    return route.fulfill({ json: { reply: "Apple rose this month.", directives: [], state: {}, history: [], tools: [] } });
  });
  await page.route("**/api/action", (route) => {
    calls.action.push(route.request().postDataJSON().action);
    return route.fulfill({
      json: {
        reply: "Rest your hand palm up. Press N for the next step, or R to repeat.",
        directives: [], state: { lesson: { id: "feel-a-graph", step: 0 } }, history: [], tools: ["start_lesson"],
      },
    });
  });
  await page.route("**/api/tts", (route) => {
    calls.tts.push(route.request().postDataJSON().text);
    return route.fulfill({ contentType: "audio/wav", body: "test audio" });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
  return calls;
}

const tray = (page: Page) => page.getByRole("complementary", { name: "Try asking", includeHidden: true });

test("holding space slides the tray up within 300 ms; releasing hides it", async ({ page }) => {
  await setup(page);
  await expect(tray(page)).toBeHidden();
  await page.keyboard.down(" ");
  await expect(tray(page)).toBeVisible({ timeout: 300 });
  await expect(page.locator(".spacebar .soundwave-bar")).toHaveCount(14);
  await expect(page.locator(".spacebar")).toHaveClass(/pressed/);
  await page.keyboard.press("Escape");
  await page.keyboard.up(" ");
  await expect(tray(page)).toBeHidden();
});

test("the tray lists lessons 1-5 and questions 6-9 with Done and Up next tags", async ({ page }) => {
  await setup(page);
  await page.keyboard.down(" ");
  const t = tray(page);
  await expect(t.getByRole("region", { name: "Lessons" }).getByRole("button")).toHaveCount(5);
  await expect(t.getByRole("region", { name: "Quick questions" }).getByRole("button")).toHaveCount(4);
  await expect(t.getByRole("button", { name: /^1 How to feel a graph Done$/ })).toBeVisible();
  await expect(t.getByRole("button", { name: /^2 Stocks vs\. ETFs Up next$/ })).toBeVisible();
  await expect(t.getByRole("button", { name: /^9 How fast does PVOO settle\?$/ })).toBeVisible();
  await expect(t.getByText("Options basics")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.up(" ");
});

test("press 1 while holding space, release: lesson 1 starts without speech-to-text", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.down(" ");
  await page.keyboard.press("1");
  await expect(tray(page).getByRole("button", { name: /^1 / })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up(" ");
  await expect(page.getByLabel("Tutor reply")).toHaveText(/^Rest your hand palm up/);
  expect(calls.action).toEqual([{ type: "start_lesson", lesson: "feel-a-graph" }]);
  expect(calls.stt).toBe(0);
  expect(calls.talk).toEqual([]);
  await expect(page.getByLabel("Your question")).toHaveText("You asked: How to feel a graph");
});

test("press 7 while holding space, release: the quick question goes to the tutor", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.down(" ");
  await page.waitForTimeout(300);
  await page.keyboard.press("7");
  await page.keyboard.up(" ");
  await expect(page.getByLabel("Tutor reply")).toHaveText("Apple rose this month.");
  expect(calls.talk).toEqual(["How did Apple do this month?"]);
  expect(calls.stt).toBe(0);
});

test("the last number pressed wins, and Escape cancels the pick", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.down(" ");
  await page.keyboard.press("6");
  await page.keyboard.press("8");
  await expect(tray(page).getByRole("button", { name: /^8 / })).toHaveAttribute("aria-pressed", "true");
  await expect(tray(page).getByRole("button", { name: /^6 / })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await page.keyboard.up(" ");
  await page.waitForTimeout(200);
  expect(calls.talk).toEqual([]);
  expect(calls.action).toEqual([]);
});

test("without a number, holding space still records speech as before", async ({ page }) => {
  const calls = await setup(page);
  await page.keyboard.down(" ");
  await page.waitForTimeout(350);
  await page.keyboard.up(" ");
  await expect(page.getByLabel("Your question")).toHaveText("You asked: What is an ETF?");
  expect(calls.stt).toBe(1);
});

test("first time only: the tutor reads two suggestions after the reply", async ({ page }) => {
  const calls = await setup(page, { tipSeen: false });
  await page.keyboard.down(" ");
  await page.waitForTimeout(350);
  await page.keyboard.up(" ");
  await expect(page.getByLabel("Tutor reply")).toBeVisible();
  await expect.poll(() => calls.tts.length).toBe(2);
  expect(calls.tts[1]).toMatch(/^Tip: while you hold space, you can press a number.*Press 1 for How to feel a graph\..*press 7/);
  expect(await page.evaluate(() => localStorage.getItem("sonar-tray-tip"))).toBe("1");

  // A second hold does not repeat the tip.
  await page.keyboard.down(" ");
  await page.waitForTimeout(350);
  await page.keyboard.up(" ");
  await expect.poll(() => calls.tts.length).toBe(3);
  await page.waitForTimeout(300);
  expect(calls.tts.filter((t) => t.startsWith("Tip:"))).toHaveLength(1);
});

test("a quick tap on the first visit speaks the tip right away", async ({ page }) => {
  const calls = await setup(page, { tipSeen: false });
  await page.keyboard.down(" ");
  await page.keyboard.up(" ");
  await expect.poll(() => calls.tts.length).toBe(1);
  expect(calls.tts[0]).toMatch(/^Tip:/);
  expect(calls.stt).toBe(0);
});
