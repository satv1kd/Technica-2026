import { expect, test, type Page } from "@playwright/test";
import { installVoiceMocks } from "./voice.fixture";

// Five points spanning the box, then a tap: tones 220, 385, 550, 715, 880 Hz and an 80 Hz thump.
const chart = {
  ops: [
    { op: "stroke", style: "solid", label: "AAPL", points: [0, 0.25, 0.5, 0.75, 1].map((y, i) => ({ x: i / 4, y })) },
    { op: "tap", at: { x: 1, y: 1 }, label: "AAPL peak" },
  ],
  alt: "A rising line with a tap at the top.",
  legend: [{ label: "AAPL", style: "solid" }],
};

async function setup(page: Page, opts: { chartSounds?: boolean } = {}) {
  await installVoiceMocks(page);
  await page.addInitScript((chartSounds) => {
    localStorage.setItem("sonar-tray-tip", "1");
    if (chartSounds !== undefined) localStorage.setItem("sonar-settings", JSON.stringify({ chartSounds }));
  }, opts.chartSounds);
  await page.route("**/api/talk", (r) => r.fulfill({ json: { reply: "Apple rose this month.", directives: [{ type: "chart", chart }], state: {}, history: [], tools: [] } }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
}

async function ask(page: Page) {
  await page.keyboard.press("t");
  await page.keyboard.type("How did Apple do?");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Tutor reply")).toHaveText("Apple rose this month.");
}

const chartTones = (page: Page) =>
  page.evaluate(() => (window as any).__audio.tones.map((t: { freq: number }) => Math.round(t.freq)));

test("with no arm connected, the chart plays as sound after the tutor speaks", async ({ page }) => {
  await setup(page);
  await ask(page);
  await expect(page.getByRole("status").filter({ hasText: "Playing chart as sound" })).toBeVisible();
  await expect.poll(() => chartTones(page)).toEqual([220, 385, 550, 715, 880, 80]);
  // The indicator clears when the sound ends (5 tones x 250 ms + a thump).
  await expect(page.getByRole("status").filter({ hasText: "Playing chart as sound" })).toBeHidden({ timeout: 4000 });
});

test("S plays the chart again on demand", async ({ page }) => {
  await setup(page);
  await ask(page);
  await expect.poll(() => chartTones(page)).toHaveLength(6);
  await expect(page.getByRole("status").filter({ hasText: "Playing chart as sound" })).toBeHidden({ timeout: 4000 });
  await page.keyboard.press("s");
  await expect(page.getByRole("status").filter({ hasText: "Playing chart as sound" })).toBeVisible();
  await expect.poll(() => chartTones(page)).toHaveLength(12);
});

test("Escape stops the chart sound", async ({ page }) => {
  await setup(page);
  await ask(page);
  await expect(page.getByRole("status").filter({ hasText: "Playing chart as sound" })).toBeVisible();
  const before = await page.evaluate(() => (window as any).__audio.stops);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").filter({ hasText: "Playing chart as sound" })).toBeHidden({ timeout: 500 });
  expect(await page.evaluate(() => (window as any).__audio.stops)).toBeGreaterThan(before);
});

test("a new question stops the old chart's sound", async ({ page }) => {
  await setup(page);
  await ask(page);
  await expect(page.getByRole("status").filter({ hasText: "Playing chart as sound" })).toBeVisible();
  const before = await page.evaluate(() => (window as any).__audio.stops);
  await page.keyboard.down(" ");
  expect(await page.evaluate(() => (window as any).__audio.stops)).toBeGreaterThan(before);
  await page.keyboard.press("Escape");
  await page.keyboard.up(" ");
});
