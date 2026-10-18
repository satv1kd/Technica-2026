import { expect, test, type Page } from "@playwright/test";
import { installVoiceMocks } from "./voice.fixture";

const ys = [0.31, 0.56, 0.54, 0.64, 0.63, 0.43, 0.0, 0.15, 0.35, 0.83, 0.86, 1.0];
const chart = {
  ops: [{ op: "stroke", style: "solid", label: "AAPL", points: ys.map((y, i) => ({ x: i / 11, y })) },
    { op: "tap", at: { x: 1, y: 1 }, label: "AAPL peak" }],
  alt: "Apple trend line with a tap at its peak.", legend: [{ label: "AAPL", style: "solid" }],
};

async function openChart(page: Page) {
  await installVoiceMocks(page);
  await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  await page.route("**/api/talk", (r) => r.fulfill({ json: { reply: "Apple rose this month.", directives: [{ type: "chart", chart }], state: {}, history: [], tools: [] } }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
  await page.keyboard.press("t");
  await page.keyboard.type("How did Apple do?");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("img", { name: chart.alt })).toBeVisible();
}

/** Count warm trace pixels (the pressed line's glow) on the canvas. */
const warmPixels = (page: Page) => page.locator("canvas.palm-canvas").evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 215 && d[i + 2] > 160 && d[i + 2] < 225) n++;
  return n;
});

test("the arm draws the trace, then reports Drawing finished", async ({ page }) => {
  await openChart(page);
  await expect(page.getByRole("status").filter({ hasText: "Drawing on your palm" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Drawing finished" })).toBeVisible({ timeout: 20_000 });
  expect(await warmPixels(page)).toBeGreaterThan(100);
});

test("Repeat redraws the chart from the start", async ({ page }) => {
  await openChart(page);
  await expect(page.getByRole("status").filter({ hasText: "Drawing finished" })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("r");
  await expect(page.getByRole("status").filter({ hasText: "Drawing on your palm" })).toBeVisible();
});

test("reduced motion shows the finished drawing at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openChart(page);
  // The drawing is complete at once; the status may already have moved on to the
  // chart's sound (task 17), so either status means the drawing is done.
  await expect(page.getByRole("status").filter({ hasText: /Drawing finished|Playing chart as sound/ })).toBeVisible({ timeout: 1_000 });
  await expect.poll(() => warmPixels(page), { timeout: 1_000 }).toBeGreaterThan(100);
});
