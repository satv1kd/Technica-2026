import { expect, test } from "@playwright/test";
import { installVoiceMocks } from "./voice.fixture";

// Keyboard only, as a blind learner would use it.

test.beforeEach(async ({ page }) => {
  await installVoiceMocks(page);
  // Keep transcription pending while these tests inspect shell transitions.
  await page.route("**/api/stt", () => {});
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
  await expect(page.locator("main")).toHaveAttribute("data-state", "menu");
});

test("launch shows the menu and focuses the space bar", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Press a number, or space to talk");
  await expect(page.getByRole("list", { name: "Main menu" })).toContainText("Lessons");
  await expect(page.getByRole("button", { name: /Space bar/ })).toBeFocused();
});

test("holding space listens, releasing thinks", async ({ page }) => {
  await page.keyboard.down(" ");
  await expect(page.locator("main")).toHaveAttribute("data-state", "listening");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Listening");
  await expect(page.locator(".aurora")).toHaveClass(/aurora-listening/);

  await page.waitForTimeout(350);
  await page.keyboard.up(" ");
  await expect(page.locator("main")).toHaveAttribute("data-state", "thinking");
  await expect(page.locator(".aurora")).not.toHaveClass(/aurora-listening/);
});

test("a tap shorter than 250 ms goes back to the menu", async ({ page }) => {
  await page.keyboard.down(" ");
  await page.keyboard.up(" ");
  await expect(page.locator("main")).toHaveAttribute("data-state", "menu");
});

test("escape cancels listening", async ({ page }) => {
  await page.keyboard.down(" ");
  await expect(page.locator("main")).toHaveAttribute("data-state", "listening");
  await page.keyboard.press("Escape");
  await expect(page.locator("main")).toHaveAttribute("data-state", "menu");
  await page.keyboard.up(" ");
});

test("M returns to the menu", async ({ page }) => {
  await page.keyboard.down(" ");
  await page.waitForTimeout(300);
  await page.keyboard.up(" ");
  await expect(page.locator("main")).toHaveAttribute("data-state", "thinking");
  await page.keyboard.press("m");
  await expect(page.locator("main")).toHaveAttribute("data-state", "menu");
});

test("the live region announces each state", async ({ page }) => {
  const live = page.locator("#sonar-live");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await page.keyboard.down(" ");
  await expect(live).toHaveText("Listening");
  await page.keyboard.press("Escape");
  await expect(live).toHaveText("Press a number, or space to talk");
  await page.keyboard.up(" ");
});

test("animation is off when the OS asks for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const name = await page.locator(".blob").first().evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe("none");
});
