import { expect, test, type Page } from "@playwright/test";
import { installVoiceMocks } from "./voice.fixture";

const chart = {
  ops: [
    { op: "stroke", style: "solid", label: "AAPL", points: [0.2, 0.6, 0.4, 0.9, 1].map((y, i) => ({ x: i / 4, y })) },
    { op: "tap", at: { x: 1, y: 1 }, label: "peak" },
  ],
  alt: "Apple trend line with a tap at its peak.",
  legend: [{ label: "AAPL", style: "solid" }],
};

async function setup(page: Page, query = "") {
  await installVoiceMocks(page);
  await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  await page.route("**/api/talk", (r) => r.fulfill({ json: { reply: "Apple rose this month.", directives: [{ type: "chart", chart }], state: {}, history: [], tools: [] } }));
  await page.goto("/" + query, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
}

async function askForChart(page: Page) {
  await page.keyboard.press("t");
  await page.keyboard.type("How did Apple do?");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Tutor reply")).toHaveText("Apple rose this month.");
}

const panel = (page: Page) => page.getByRole("region", { name: "Palm arm" });
const status = (page: Page) => panel(page).getByRole("status");
const logLines = (page: Page) => panel(page).getByRole("list", { name: "Arm commands" }).getByRole("listitem");

test("mock arm: connect, draw a chart as W lines, then show it finished", async ({ page }) => {
  await setup(page, "?arm=mock");
  await expect(status(page)).toHaveText("Mock arm: not connected");
  await panel(page).getByRole("button", { name: "Connect mock arm" }).click();
  await expect(status(page)).toHaveText("Mock arm: connected");
  await expect(logLines(page)).toContainText(["P"]);

  await askForChart(page);
  // 5 points -> 4 lines, plus the peak tap as a zero-length line.
  await expect(status(page)).toHaveText(/Mock arm: drawing line \d of 5/);
  await expect(page.getByRole("region", { name: "Answer" }).getByRole("status")).toHaveText(/Mock arm: drawing line/);
  await expect(status(page)).toHaveText("Mock arm: connected", { timeout: 10_000 });
  const ws = (await logLines(page).allTextContents()).filter((l) => l.startsWith("W "));
  expect(ws).toHaveLength(5);
  for (const w of ws) {
    const n = w.split(" ").slice(1).map(Number);
    expect(n).toHaveLength(4);
    expect(n.every((v) => Number.isInteger(v) && v >= 0 && v <= 1000)).toBe(true);
  }
  const tap = ws.at(-1)!.split(" ").slice(1);
  expect(tap[0]).toBe(tap[2]);
  expect(tap[1]).toBe(tap[3]);
});

test("mock arm: Stop arm sends X at once and Resume turns it back on", async ({ page }) => {
  await setup(page, "?arm=mock");
  await panel(page).getByRole("button", { name: "Connect mock arm" }).click();
  await expect(status(page)).toHaveText("Mock arm: connected");
  await askForChart(page);
  await expect(status(page)).toHaveText(/drawing line/);
  await panel(page).getByRole("button", { name: /Stop arm/ }).click();
  await expect(status(page)).toHaveText("Mock arm: stopped");
  await expect(logLines(page).last()).toHaveText("STOP");
  await expect(page.locator(".voice-message")).toHaveText(/Arm stopped/);
  const sentAfterStop = await logLines(page).count();
  await page.waitForTimeout(1500);
  expect(await logLines(page).count()).toBe(sentAfterStop);
  await panel(page).getByRole("button", { name: "Resume arm" }).click();
  await expect(status(page)).toHaveText("Mock arm: connected");
  await expect(logLines(page).last()).toHaveText("R");
});

test("the X key is an emergency stop", async ({ page }) => {
  await setup(page, "?arm=mock");
  await panel(page).getByRole("button", { name: "Connect mock arm" }).click();
  await askForChart(page);
  await expect(status(page)).toHaveText(/drawing line/);
  await page.keyboard.press("x");
  await expect(status(page)).toHaveText("Mock arm: stopped");
});

test("Settings > Palm arm connects the arm too", async ({ page }) => {
  await setup(page, "?arm=mock");
  await page.keyboard.press("4");
  await page.keyboard.press("4");
  await expect(status(page)).toHaveText("Mock arm: connected");
  await expect(page.getByRole("button", { name: /Palm arm: connected/ })).toBeVisible();
});

/**
 * Web Serial, end to end, against a fake port that behaves like palm_arm.ino:
 * prints a menu and "ready" after the reset, answers P and W with "ok"
 * (W after a delay), and stays silent on X.
 */
test("real Web Serial path: 115200 baud, ready, ping, then one W line at a time", async ({ page }) => {
  await page.addInitScript(() => {
    const log = { baud: 0, sent: [] as string[], maxOutstanding: 0 };
    (window as any).__serial = log;
    let push: (s: string) => void = () => {};
    let outstanding = 0;
    const enc = new TextEncoder();
    const port = {
      readable: new ReadableStream<Uint8Array>({ start(c) { push = (s) => c.enqueue(enc.encode(s)); } }),
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          const line = new TextDecoder().decode(chunk).trim();
          log.sent.push(line);
          if (line === "X") return;
          outstanding++;
          log.maxOutstanding = Math.max(log.maxOutstanding, outstanding);
          const done = () => { outstanding--; push("ok\r\n"); };
          if (line.startsWith("W")) setTimeout(() => { push("base 60  elbow 140  lift 90 (holding)\r\n"); done(); }, 150);
          else setTimeout(done, 20);
        },
      }),
      async open(o: { baudRate: number }) {
        log.baud = o.baudRate;
        setTimeout(() => push("At HOME (pen up). Manual commands:\r\n"), 50);
        setTimeout(() => push("ready\r\n"), 200);
      },
      async close() {},
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { getPorts: async () => [], requestPort: async () => port },
    });
  });
  await setup(page);
  await panel(page).getByRole("button", { name: "Connect arm" }).click();
  await expect(status(page)).toHaveText("Palm arm: connected", { timeout: 5000 });
  await askForChart(page);
  await expect(status(page)).toHaveText("Palm arm: connected", { timeout: 10_000 });
  const serial = await page.evaluate(() => (window as any).__serial);
  expect(serial.baud).toBe(115200);
  expect(serial.sent[0]).toBe("P");
  expect(serial.sent.filter((l: string) => l.startsWith("W "))).toHaveLength(5);
  expect(serial.maxOutstanding).toBe(1); // never more than one command in flight
});
