import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installVoiceMocks } from "./voice.fixture";

/** WCAG 2.1 A and AA, scanned in every app state. */
async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const problems = results.violations.map((v) =>
    `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 3).map((n) => `  ${n.target.join(" ")}: ${n.failureSummary?.split("\n")[1] ?? ""}`).join("\n")}`);
  expect(problems, `axe violations in ${label}`).toEqual([]);
}

const chart = {
  ops: [{ op: "stroke", style: "solid", label: "AAPL", points: [0, 0.4, 0.2, 0.9, 1].map((y, i) => ({ x: i / 4, y })) },
    { op: "tap", at: { x: 1, y: 1 }, label: "peak" }],
  alt: "Apple trend line with a tap at its peak.", legend: [{ label: "AAPL", style: "solid" }],
};
const step = { lessonId: "etf", lessonTitle: "Stocks vs. ETFs", lessonNumber: 2, lessonCount: 5, stepIndex: 0, stepCount: 4,
  title: "t", say: "s", chart, awaitingConfirm: null, isLast: false, dataUnavailable: false };
const proposal = { id: "p1", side: "buy", symbol: "PVOO", asset_class: "tokenized", quantity: 2, price: 701.75, total: 1403.5,
  price_note: "The market is closed, so this is the last closing price, from Friday, October 16.",
  risk_note: "PVOO is a practice token.", expires_at: new Date(Date.now() + 60_000).toISOString(), readback: "Buy 2 PVOO." };
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

async function setup(page: Page) {
  await installVoiceMocks(page);
  await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  await page.route("**/api/progress", (r) => r.fulfill({ json: { lessons: [] } }));
  await page.route("**/api/market?kind=history*", (r) => r.fulfill({ json: { points: Array.from({ length: 21 }, (_, i) => ({ date: `2026-09-${10 + i}`, close: 680 + i })) } }));
  await page.route("**/api/market?kind=portfolio", (r) => r.fulfill({ json: { cash: 8596.5, invested: 1403.5, total_value: 10000, holdings: [], tip: "Spreading money out is called diversification." } }));
  await page.route("**/api/action", (route) => {
    const { action } = route.request().postDataJSON();
    const json = (body: object) => route.fulfill({ json: { state: {}, history: [], tools: [], ...body } });
    if (action.type === "start_lesson") return json({ reply: "Here's Apple. Press N for the next step.", directives: [{ type: "lesson", step }, { type: "chart", chart }] });
    if (action.type === "next") return json({ reply: "Quiz time.", directives: [{ type: "quiz", lessonId: "etf", question: "Which usually moves more?", options: ["One stock", "A broad ETF", "The same"] }] });
    if (action.type === "quiz_answer") return json({ reply: "Not quite. Try again.", directives: [{ type: "quiz_result", lessonId: "etf", nextLessonId: null, result: { correct: false, chosen: 1, correctIndex: 0, explanation: "x" } }] });
    if (action.type === "tool") return json({ reply: proposal.readback, directives: [{ type: "confirm", proposal }] });
    return json({ reply: "Done. You bought 2 PVOO.", directives: [{ type: "settled", trade: {
      trade: { id: "t", time: "", side: "buy", symbol: "PVOO", asset_class: "tokenized", quantity: 2, price: 701.75, total: 1403.5 },
      settlement: { kind: "onchain", settle_ms: 2100, explorer: `https://explorer.solana.com/tx/${SIG}?cluster=devnet` }, cash_after: 8596.5 } }] });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
}

test("menu, tray, and settings pass axe", async ({ page }) => {
  await setup(page);
  await audit(page, "main menu");
  await page.keyboard.down(" ");
  await expect(page.getByRole("complementary", { name: "Try asking" })).toBeVisible();
  await audit(page, "try asking tray");
  await page.keyboard.press("Escape");
  await page.keyboard.up(" ");
  await page.keyboard.press("4");
  await audit(page, "settings menu");
});

test("lesson, quiz, confirm, and results pass axe", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("1");
  await page.keyboard.press("1");
  await expect(page.locator("main")).toHaveAttribute("data-state", "lesson");
  await audit(page, "lesson step");
  await page.keyboard.press("n");
  await expect(page.locator("main")).toHaveAttribute("data-state", "quiz");
  await page.keyboard.press("2");
  await expect(page.locator(".quiz-option.wrong")).toBeVisible();
  await audit(page, "quiz with a wrong answer");

  await page.keyboard.press("m");
  await page.keyboard.press("3");
  await page.keyboard.press("1");
  await expect(page.locator("main")).toHaveAttribute("data-state", "confirm");
  await audit(page, "confirm trade");
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toHaveAttribute("data-state", "answer", { timeout: 6000 });
  await audit(page, "trade results");
});

test("typing fallback passes axe", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("t");
  await audit(page, "typing box");
});

test("the app is an application region so screen readers pass keys through", async ({ page }) => {
  await setup(page);
  const app = page.getByRole("application", { name: "Sonar investing tutor" });
  await expect(app).toBeVisible();
  await expect(app).toHaveAccessibleDescription(/Hold space to talk.*M opens the menu, R repeats/);
});

test("focus returns to the space bar after mouse clicks and typed questions", async ({ page }) => {
  await setup(page);
  const spacebar = page.getByRole("button", { name: /Space bar/ });
  await expect(spacebar).toBeFocused();
  await page.getByRole("button", { name: /^4 Settings$/ }).click();
  await expect(spacebar).toBeFocused();
  await page.getByRole("button", { name: "Menu (M)" }).click();
  await expect(spacebar).toBeFocused();

  await page.route("**/api/talk", (r) => r.fulfill({ json: { reply: "An ETF holds many companies.", directives: [], state: {}, history: [], tools: [] } }));
  await page.keyboard.press("t");
  await page.keyboard.type("What is an ETF?");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Tutor reply")).toHaveText("An ETF holds many companies.");
  await expect(spacebar).toBeFocused();
  // The caption is mirrored to the polite live region.
  await expect(page.locator("#sonar-live")).toHaveText("An ETF holds many companies.");
});

test("Tab moves through visible controls only; the closed tray is skipped", async ({ page }) => {
  await setup(page);
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return `${el?.className ?? ""}|${el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? ""}`;
    }));
  }
  expect(seen.some((s) => s.startsWith("tray-item"))).toBe(false);
  expect(seen.some((s) => s.includes("Menu (M)"))).toBe(true);
  expect(seen.some((s) => s.includes("Repeat voice (R)"))).toBe(true);
  expect(seen.some((s) => s.startsWith("menu-item"))).toBe(true);
});
