import { expect, test, type Page } from "@playwright/test";
import { installVoiceMocks } from "./voice.fixture";

const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const EXPLORER = `https://explorer.solana.com/tx/${SIG}?cluster=devnet`;

type Settle = "onchain" | "simulated";

interface Fake {
  actions: any[];
  tts: string[];
  settle: Settle;
  trades: number;
  lessonTrade: boolean;
}

async function setup(page: Page, opts: { settle?: Settle; clock?: boolean; lessonTrade?: boolean } = {}): Promise<Fake> {
  const fake: Fake = { actions: [], tts: [], settle: opts.settle ?? "onchain", trades: 0, lessonTrade: !!opts.lessonTrade };
  if (opts.clock) await page.clock.install();
  await installVoiceMocks(page);
  await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  await page.route("**/api/tts", (r) => { fake.tts.push(r.request().postDataJSON().text); return r.fulfill({ contentType: "audio/wav", body: "x" }); });
  await page.route("**/api/progress", (r) => r.fulfill({ json: { lessons: [] } }));
  await page.route("**/api/market?kind=history*", (r) => r.fulfill({ json: {
    symbol: "PVOO", range: "1m",
    points: Array.from({ length: 21 }, (_, i) => ({ date: `2026-09-${String(16 + i).padStart(2, "0")}`, close: 680 + i })),
  } }));
  await page.route("**/api/market?kind=portfolio", (r) => r.fulfill({ json: {
    cash: 10000 - 1403.5 * fake.trades, invested: 1403.5 * fake.trades, total_value: 10000,
    holdings: [{ symbol: "PVOO", quantity: 2 * fake.trades, price: 701.75, value: 1403.5 * fake.trades }],
    tip: fake.trades >= 3 && fake.trades % 3 === 0 ? "More than half of your account is in PVOO." : null,
  } }));
  await page.route("**/api/action", (route) => {
    const { action } = route.request().postDataJSON();
    fake.actions.push(action);
    const proposal = {
      id: `p${fake.actions.length}`, side: "buy", symbol: "PVOO", asset_class: "tokenized", quantity: 2,
      price: 701.75, total: 1403.5, price_as_of: "2026-10-16",
      price_note: "The market is closed, so this is the last closing price, from Friday, October 16.",
      risk_note: "PVOO is a practice token. Tokens depend on trust.",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      readback: "Buy 2 tokens of PVOO at 701.75 dollars each, 1,403.50 dollars total.",
    };
    if (action.type === "tool" && action.name === "propose_trade") {
      return route.fulfill({ json: { reply: proposal.readback, directives: [{ type: "confirm", proposal }],
        state: { pendingProposal: { id: proposal.id } }, history: [], tools: [] } });
    }
    if (action.type === "confirm") {
      fake.trades++;
      const settlement = fake.settle === "onchain"
        ? { kind: "onchain", ref: SIG, settle_ms: 2140, note: "That settled on Solana devnet in 2.1 seconds.", explorer: EXPLORER }
        : { kind: "simulated", ref: null, settle_ms: null, example_explorer: EXPLORER,
            note: "Solana devnet didn't answer in time, so this trade was recorded on Sonar's ledger only, as a simulated settlement." };
      const trade = { trade: { id: "t1", time: "2026-10-18T12:00:00Z", side: "buy", symbol: "PVOO", asset_class: "tokenized",
        quantity: 2, price: 701.75, total: 1403.5 }, settlement, cash_after: 10000 - 1403.5 * fake.trades };
      const directives: any[] = [{ type: "settled", trade }];
      if (fake.lessonTrade) {
        directives.unshift({ type: "lesson", step: { lessonId: "pvoo", lessonTitle: "Tokenized funds with PVOO", lessonNumber: 4,
          lessonCount: 5, stepIndex: 2, stepCount: 5, title: "Buy PVOO", say: "", chart: null, awaitingConfirm: null, isLast: false, dataUnavailable: false } });
      }
      return route.fulfill({ json: { reply: `Done. You bought 2 PVOO with practice money. ${settlement.note}`,
        directives, state: fake.lessonTrade ? { lesson: { id: "pvoo", step: 2 } } : {}, history: [], tools: [] } });
    }
    return route.fulfill({ json: { reply: "Cancelled. Nothing was traded.", directives: [{ type: "cancelled", proposalId: "p1" }], state: {}, history: [], tools: [] } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
  return fake;
}

const confirmPanel = (page: Page) => page.getByRole("region", { name: "Confirm your practice trade" });

async function buyTwoPvoo(page: Page) {
  await page.keyboard.press("3"); // Practice trading
  await page.keyboard.press("1"); // Buy 2 PVOO
  await expect(confirmPanel(page)).toBeVisible();
}

test("the confirm screen shows the order, price, total, risk, countdown, and a preview", async ({ page }) => {
  await setup(page);
  await buyTwoPvoo(page);
  const panel = confirmPanel(page);
  await expect(panel.getByRole("heading", { name: "Buy 2 PVOO" })).toBeVisible();
  await expect(panel.getByText("Price: $701.75 per token")).toBeVisible();
  await expect(panel.getByText("Total: $1,403.50")).toBeVisible();
  await expect(panel.getByText(/^This is practice money\. PVOO is a practice token/)).toBeVisible();
  await expect(panel.locator(".confirm-seconds")).toHaveText(/^(60|59|58)$/);
  await expect(panel.getByRole("button", { name: /Confirm purchase/ })).toBeVisible();
  const preview = page.getByRole("region", { name: "Trade preview" });
  await expect(preview.getByRole("cell", { name: "Waiting for confirmation" })).toBeVisible();
  await expect(preview.getByRole("img", { name: /^Price chart\. 21 trading days/ })).toBeVisible();
});

test("Enter settles on chain: checklist, Explorer link, then results", async ({ page }) => {
  const fake = await setup(page);
  await buyTwoPvoo(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toHaveAttribute("data-state", "settling");
  const checks = page.getByRole("region", { name: "Settling your trade" }).getByRole("listitem");
  await expect(checks).toHaveText([
    /Signed with your practice key/, /Sent to Solana devnet/, /Confirmed in 2\.1 seconds/,
  ]);
  const link = page.getByRole("link", { name: "See this trade on the Solana Explorer" }).first();
  await expect(link).toHaveAttribute("href", EXPLORER);
  await expect(page.locator("main")).toHaveAttribute("data-state", "answer", { timeout: 6000 });
  const results = page.getByRole("region", { name: "Trade results" });
  await expect(results.getByRole("cell", { name: "Settled on Solana devnet" })).toBeVisible();
  await expect(results.getByText("Holdings $1,403.50")).toBeVisible();
  await expect(results.getByText("Cash $8,596.50")).toBeVisible();
  await expect(results.getByRole("list", { name: "How long settlement takes" })).toContainText("2.1 seconds");
  // The single settlement tap on the palm.
  await expect(page.getByRole("img", { name: /One tap in the center of the palm/ })).toBeVisible();
  expect(fake.actions.map((a) => a.type)).toEqual(["tool", "confirm"]);
});

test("devnet down: a ledger-only settlement with a warning and an earlier example link", async ({ page }) => {
  await setup(page, { settle: "simulated" });
  await buyTwoPvoo(page);
  await page.keyboard.press("Enter");
  const settling = page.getByRole("region", { name: "Settling your trade" });
  await expect(settling.getByRole("listitem")).toHaveText([
    /Signed with your practice key/, /Recorded in ledger/, /Warning: Devnet unavailable, simulated settlement/,
  ]);
  await expect(settling.getByRole("link", { name: "See an earlier PVOO trade on the Solana Explorer" })).toHaveAttribute("href", EXPLORER);
  await expect(page.getByRole("region", { name: "Trade results" }).getByRole("cell", { name: "Recorded, simulated settlement" }))
    .toBeVisible({ timeout: 6000 });
});

test("Escape cancels, and nothing is confirmed", async ({ page }) => {
  const fake = await setup(page);
  await buyTwoPvoo(page);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Tutor reply")).toHaveText("Cancelled. Nothing was traded.");
  expect(fake.actions.map((a) => a.type)).toEqual(["tool", "cancel"]);
});

test("after 60 seconds the offer expires, and Enter gets a new price", async ({ page }) => {
  const fake = await setup(page, { clock: true });
  await buyTwoPvoo(page);
  await page.clock.fastForward(61_000);
  await expect(confirmPanel(page).getByRole("alert")).toHaveText(/^Offer expired\./);
  await expect.poll(() => fake.tts.some((t) => t.startsWith("That offer expired."))).toBe(true);
  await expect(confirmPanel(page).getByRole("button", { name: /Get a new price/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(() => fake.actions.length).toBe(2);
  expect(fake.actions[1]).toEqual({ type: "tool", name: "propose_trade", args: { side: "buy", symbol: "PVOO", quantity: 2 } });
  expect(fake.actions.some((a) => a.type === "confirm")).toBe(false);
  await expect(confirmPanel(page).locator(".confirm-seconds")).toBeVisible();
});

test("a coaching tip appears and is spoken after the third trade", async ({ page }) => {
  const fake = await setup(page);
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press("m");
    await buyTwoPvoo(page);
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toHaveAttribute("data-state", "answer", { timeout: 6000 });
  }
  await expect(page.getByRole("region", { name: "Trade results" }).getByText("Habit tip: More than half of your account is in PVOO.")).toBeVisible();
  await expect.poll(() => fake.tts.some((t) => t.startsWith("Habit tip:"))).toBe(true);
  expect(fake.trades).toBe(3);
});

test("a trade inside a lesson returns to the lesson after settling", async ({ page }) => {
  await setup(page, { lessonTrade: true });
  await buyTwoPvoo(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toHaveAttribute("data-state", "lesson", { timeout: 6000 });
  await expect(page.getByText("Lesson 4 of 5 · Step 3 of 5")).toBeVisible();
  await expect(page.getByRole("region", { name: "Trade results" })).toBeVisible();
});
