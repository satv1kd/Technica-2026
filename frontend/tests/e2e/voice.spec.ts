import { expect, test } from "@playwright/test";
import { installVoiceMocks } from "./voice.fixture";

const reply = "An ETF is a fund that holds many investments.";

test.beforeEach(async ({ page }) => {
  await installVoiceMocks(page);
  // The first-visit tray tip has its own tests (tray.spec.ts); keep it out of these counts.
  await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  await page.route("**/api/stt", (route) => route.fulfill({ json: { ok: true, text: "What is an ETF?", confidence: 0.95 } }));
  await page.route("**/api/talk", (route) => route.fulfill({ json: { reply, directives: [], state: {}, history: [], tools: [] } }));
  await page.route("**/api/tts", (route) => route.fulfill({ contentType: "audio/wav", body: "test audio" }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
});

test("hold to talk sends a transcript, speaks, and repeats without another API call", async ({ page }) => {
  let ttsCalls = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/tts")) ttsCalls++; });
  await page.keyboard.down(" ");
  await expect(page.locator("main")).toHaveAttribute("data-state", "listening");
  await page.waitForTimeout(350);
  await page.keyboard.up(" ");
  await expect(page.getByLabel("Your question")).toHaveText("You asked: What is an ETF?", { timeout: 3000 });
  await expect(page.getByLabel("Tutor reply")).toHaveText(reply);
  await expect.poll(() => page.evaluate(() => (window as any).__voice.played)).toBe(1);
  await page.keyboard.press("r");
  await expect.poll(() => page.evaluate(() => (window as any).__voice.played)).toBe(2);
  await page.getByRole("button", { name: "Repeat voice (R)" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__voice.played)).toBe(3);
  expect(ttsCalls).toBe(1);
  await expect(page.locator("#sonar-live")).toHaveText(reply);
  await expect.poll(() => page.evaluate(() => (window as any).__voice.tracksStopped)).toBe(1);
});

test("T focuses a labeled input and Enter sends the typed question", async ({ page }) => {
  let question = "";
  await page.route("**/api/talk", async (route) => {
    question = route.request().postDataJSON().transcript;
    await route.fulfill({ json: { reply, directives: [] } });
  });
  await page.keyboard.press("t");
  await expect(page.getByRole("textbox", { name: "Type your question" })).toBeFocused();
  await page.keyboard.type("What is an ETF?");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Tutor reply")).toHaveText(reply);
  expect(question).toBe("What is an ETF?");
  expect(await page.evaluate(() => (window as any).__voice.recordings)).toBe(0);
});

test("low confidence shows the typing fallback", async ({ page }) => {
  await page.route("**/api/stt", (route) => route.fulfill({ json: { ok: true, text: "buy", confidence: 0.2 } }));
  await page.keyboard.down(" ");
  await page.waitForTimeout(350);
  await page.keyboard.up(" ");
  await expect(page.getByRole("textbox", { name: "Type your question" })).toBeFocused();
  await expect(page.locator("main").getByText("I didn't catch that. Try again, or type your question.", { exact: true })).toBeVisible();
});

test("microphone denial opens typing instead of getting stuck", async ({ page }) => {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new Error("Permission denied"); };
  });
  await page.keyboard.down(" ");
  await expect(page.getByRole("textbox", { name: "Type your question" })).toBeFocused();
  await page.keyboard.up(" ");
  await expect(page.locator("main")).toHaveAttribute("data-state", "menu");
});

test("Escape discards pending transcription and its late result", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/stt", async (route) => {
    await held;
    await route.fulfill({ json: { ok: true, text: "late question", confidence: 1 } }).catch(() => {});
  });
  await page.keyboard.down(" ");
  await page.waitForTimeout(350);
  await page.keyboard.up(" ");
  await expect(page.locator("main")).toHaveAttribute("data-state", "thinking");
  await page.keyboard.press("Escape");
  release();
  await expect(page.locator("main")).toHaveAttribute("data-state", "menu");
  await expect(page.getByLabel("Your question")).toHaveCount(0);
});

test("browser speech takes over when server speech is unavailable", async ({ page }) => {
  await page.route("**/api/tts", (route) => route.fulfill({ status: 503 }));
  await page.keyboard.press("t");
  await page.getByRole("textbox").fill("What is an ETF?");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).__voice.spoken)).toEqual([reply]);
  await page.keyboard.press("r");
  await expect.poll(() => page.evaluate(() => (window as any).__voice.spoken)).toEqual([reply, reply]);
});

test("pointer hold records and pointer cancellation discards audio", async ({ page }) => {
  const space = page.getByRole("button", { name: /Space bar/ });
  await space.hover();
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.up();
  await expect(page.getByLabel("Tutor reply")).toHaveText(reply);
  await space.hover();
  await page.mouse.down();
  await expect(page.locator("main")).toHaveAttribute("data-state", "listening");
  await space.dispatchEvent("pointercancel");
  await page.mouse.up();
  await expect(page.locator("main")).toHaveAttribute("data-state", "menu");
});
