import { expect, test, type Page } from "@playwright/test";
import { installVoiceMocks } from "./voice.fixture";

const SAY = [
  "Rest your hand palm up. I'll draw a slow line from left to right.",
  "Now a line that climbs. When the line moves up, the price went up.",
  "Feel that tap? A tap always means something important happened.",
];
const QUIZ = { q: "Where on your palm is today?", options: ["The left side", "The right side", "The center"], answer: 1 };

function step(i: number) {
  return {
    lessonId: "feel-a-graph", lessonTitle: "How to feel a graph", lessonNumber: 1, lessonCount: 5,
    stepIndex: i, stepCount: 3, title: `Step ${i + 1}`, say: SAY[i], awaitingConfirm: null,
    isLast: i === 2, dataUnavailable: false,
    chart: { ops: [{ op: "stroke", style: "solid", points: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] }], alt: `Step ${i + 1} drawing`, legend: [] },
  };
}

/** A tiny stand-in for the lesson engine behind /api/action. */
async function fakeLessons(page: Page) {
  const actions: any[] = [];
  let at = 0;
  await page.route("**/api/action", (route) => {
    const { action } = route.request().postDataJSON();
    actions.push(action);
    const lesson = (i: number) => {
      at = i;
      const s = step(i);
      return { reply: `${s.say} Press N for the next step, or R to repeat.`, state: { lesson: { id: s.lessonId, step: i } },
        directives: [{ type: "lesson", step: s }, { type: "chart", chart: s.chart }], history: [], tools: [] };
    };
    let body: any;
    if (action.type === "start_lesson") body = lesson(0);
    else if (action.type === "prev") body = lesson(Math.max(0, at - 1));
    else if (action.type === "next" && at < 2) body = lesson(at + 1);
    else if (action.type === "next") {
      body = { reply: `Quiz time. ${QUIZ.q}`, state: { quiz: { lessonId: "feel-a-graph" } }, history: [], tools: [],
        directives: [{ type: "quiz", lessonId: "feel-a-graph", question: QUIZ.q, options: QUIZ.options }] };
    } else if (action.type === "quiz_answer") {
      const chosen = Number(action.choice) - 1;
      const correct = chosen === QUIZ.answer;
      const why = "Drawings always move from the past on the left to today on the right.";
      body = {
        reply: correct ? `That's right. ${why} Up next: Stocks vs. ETFs.` : `Not quite. ${why} Try again.`,
        state: correct ? {} : { quiz: { lessonId: "feel-a-graph" } }, history: [], tools: [],
        directives: [{ type: "quiz_result", lessonId: "feel-a-graph", nextLessonId: correct ? "etf" : null,
          result: { correct, chosen, correctIndex: QUIZ.answer, explanation: why } }],
      };
    } else body = { reply: "Done.", directives: [], state: {}, history: [], tools: [] };
    return route.fulfill({ json: body });
  });
  return actions;
}

async function setup(page: Page) {
  await installVoiceMocks(page);
  await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  await page.route("**/api/progress", (r) => r.fulfill({ json: { lessons: [] } }));
  const actions = await fakeLessons(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
  return actions;
}

const card = (page: Page) => page.getByRole("region", { name: "Answer" });

test("a lesson shows its header, step progress, drawing, and caption", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("1"); // Lessons
  await page.keyboard.press("1"); // How to feel a graph
  await expect(page.locator("main")).toHaveAttribute("data-state", "lesson");
  await expect(card(page).getByText("Lesson 1 of 5 · Step 1 of 3")).toBeVisible();
  await expect(card(page).getByRole("heading", { name: "How to feel a graph" })).toBeVisible();
  await expect(card(page).locator(".dash")).toHaveClass([/dash-current/, /dash-future/, /dash-future/]);
  await expect(card(page).getByRole("img", { name: "Step 1 drawing" })).toBeVisible();
  await expect(card(page).getByLabel("Tutor reply")).toHaveText(/^Rest your hand palm up/);
  await expect(page.locator("#sonar-live")).toHaveText(/^Rest your hand palm up/);
  await expect(card(page).getByRole("button", { name: /Back/ })).toBeDisabled();
});

test("N and P (and the arrow keys) move through the steps", async ({ page }) => {
  const actions = await setup(page);
  await page.keyboard.press("1");
  await page.keyboard.press("1");
  await expect(card(page).getByText("Step 1 of 3")).toBeVisible();
  await page.keyboard.press("n");
  await expect(card(page).getByText("Lesson 1 of 5 · Step 2 of 3")).toBeVisible();
  await expect(card(page).locator(".dash")).toHaveClass([/dash-done/, /dash-current/, /dash-future/]);
  await page.keyboard.press("ArrowLeft");
  await expect(card(page).getByText("Step 1 of 3")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(card(page).getByText("Step 2 of 3")).toBeVisible();
  await page.keyboard.press("n");
  await expect(card(page).getByText("Step 3 of 3")).toBeVisible();
  await expect(card(page).getByRole("button", { name: /Quiz/ })).toBeVisible();
  expect(actions.map((a) => a.type)).toEqual(["start_lesson", "next", "prev", "next", "next"]);
});

test("clicking Next keeps focus on the space bar", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("1");
  await page.keyboard.press("1");
  await card(page).getByRole("button", { name: /Next/ }).click();
  await expect(card(page).getByText("Step 2 of 3")).toBeVisible();
  await expect(page.getByRole("button", { name: /Space bar/ })).toBeFocused();
});

test("the quiz marks a wrong answer coral, then the right one teal, and saves progress", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("1");
  await page.keyboard.press("1");
  // Keys are ignored while a step loads, so wait for each step before the next N.
  await expect(card(page).getByText("Step 1 of 3")).toBeVisible();
  for (const next of ["Step 2 of 3", "Step 3 of 3"]) {
    await page.keyboard.press("n");
    await expect(card(page).getByText(next)).toBeVisible();
  }
  await page.keyboard.press("n");
  await expect(page.locator("main")).toHaveAttribute("data-state", "quiz");
  await expect(card(page).getByLabel("Quiz question")).toHaveText(QUIZ.q);
  const options = card(page).locator(".quiz-option");
  await expect(options).toHaveCount(3);

  await page.keyboard.press("1");
  await expect(options.nth(0)).toHaveClass(/wrong/);
  await expect(options.nth(0)).toContainText("Not quite");
  await expect(card(page).getByLabel("Tutor reply")).toHaveText(/^Not quite\./);

  await page.keyboard.press("2");
  await expect(options.nth(1)).toHaveClass(/correct/);
  await expect(options.nth(1)).toContainText("Correct");
  await expect(options.nth(0)).not.toHaveClass(/wrong/);
  await expect(card(page).getByLabel("Tutor reply")).toHaveText(/^That's right\./);
  // The correct answer is felt as a double tap.
  await expect(card(page).getByRole("img", { name: /Two quick taps/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("sonar-progress"))).toBe('["feel-a-graph"]');

  // The tray now tags lesson 1 Done and lesson 2 Up next.
  await page.keyboard.down(" ");
  const tray = page.getByRole("complementary", { name: "Try asking" });
  await expect(tray.getByRole("button", { name: /^1 How to feel a graph Done$/ })).toBeVisible();
  await expect(tray.getByRole("button", { name: /^2 Stocks vs\. ETFs Up next$/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.up(" ");
});

test("an answer without a chart hides the canvas and legend", async ({ page }) => {
  await installVoiceMocks(page);
  await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  await page.route("**/api/talk", (r) => r.fulfill({ json: { reply: "An ETF holds many companies.", directives: [], state: {}, history: [], tools: [] } }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
  await page.keyboard.press("t");
  await page.keyboard.type("What is an ETF?");
  await page.keyboard.press("Enter");
  await expect(card(page).getByLabel("Your question")).toHaveText("You asked: What is an ETF?");
  await expect(card(page).getByLabel("Tutor reply")).toHaveText("An ETF holds many companies.");
  await expect(card(page).locator("canvas")).toHaveCount(0);
  await expect(card(page).getByRole("list", { name: "Chart legend" })).toHaveCount(0);
});

test("a two-series chart shows a solid and dashed legend", async ({ page }) => {
  await installVoiceMocks(page);
  await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  const chart = {
    ops: [
      { op: "stroke", style: "solid", label: "AAPL", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { op: "stroke", style: "dashed", label: "VOO", points: [{ x: 0, y: 0.4 }, { x: 1, y: 0.5 }] },
    ],
    alt: "AAPL as a solid line, VOO as a dashed line", legend: [{ label: "AAPL", style: "solid" }, { label: "VOO", style: "dashed" }],
  };
  await page.route("**/api/talk", (r) => r.fulfill({ json: { reply: "Apple swung more than VOO.", directives: [{ type: "chart", chart }], state: {}, history: [], tools: [] } }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");
  await page.keyboard.press("t");
  await page.keyboard.type("Compare Apple and VOO");
  await page.keyboard.press("Enter");
  const legend = card(page).getByRole("list", { name: "Chart legend" });
  await expect(legend.getByRole("listitem")).toHaveText(["AAPL, solid line", "VOO, dashed line"]);
  await expect(card(page).getByRole("img", { name: chart.alt })).toBeVisible();
  await expect(card(page).getByRole("status")).toHaveText(/Drawing on your palm|Drawing finished/);
});

test("Enter confirms and Escape cancels a pending order", async ({ page }) => {
  await installVoiceMocks(page);
  await page.addInitScript(() => localStorage.setItem("sonar-tray-tip", "1"));
  const actions: any[] = [];
  await page.route("**/api/action", (route) => {
    const { action } = route.request().postDataJSON();
    actions.push(action);
    const proposal = { id: "p1", readback: "Buy 1 share of VOO at 701.75 dollars. Press Enter or say confirm." };
    if (action.type === "tool") {
      return route.fulfill({ json: { reply: proposal.readback, directives: [{ type: "confirm", proposal }], state: { pendingProposal: { id: "p1" } }, history: [], tools: [] } });
    }
    return route.fulfill({ json: { reply: action.type === "confirm" ? "Done. You bought 1 VOO with practice money." : "Cancelled. Nothing was traded.", directives: [], state: {}, history: [], tools: [] } });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sonar-live")).toHaveText("Press a number, or space to talk");

  await page.keyboard.press("3");
  await page.keyboard.press("2"); // Buy 1 share of VOO
  await expect(page.locator("main")).toHaveAttribute("data-state", "confirm");
  await page.keyboard.press("Escape");
  await expect(card(page).getByLabel("Tutor reply")).toHaveText("Cancelled. Nothing was traded.");

  await page.keyboard.press("m");
  await page.keyboard.press("3");
  await page.keyboard.press("2");
  await expect(page.locator("main")).toHaveAttribute("data-state", "confirm");
  await page.keyboard.press("Enter");
  await expect(card(page).getByLabel("Tutor reply")).toHaveText(/^Done\. You bought 1 VOO/);
  expect(actions.map((a) => a.type)).toEqual(["tool", "cancel", "tool", "confirm"]);
});
