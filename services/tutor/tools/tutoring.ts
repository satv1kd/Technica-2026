import { nextLesson } from "../../lessons/progress";
import { confirmStep, playStep, type CallTool } from "../../lessons/player";
import { gradeQuiz } from "../../lessons/quiz";
import type { Lesson } from "../../lessons/schema";
import type { Tool, ToolContext } from "./types";

function findLesson(lessons: Lesson[], ref: unknown): Lesson {
  const s = String(ref ?? "").trim().toLowerCase();
  const n = Number(s);
  const lesson =
    (Number.isInteger(n) && n >= 1 ? lessons[n - 1] : undefined) ??
    lessons.find((l) => l.id === s) ??
    lessons.find((l) => l.title.toLowerCase().includes(s));
  if (!lesson) throw new Error(`There's no lesson called ${ref}.`);
  return lesson;
}

/** Lets the step player call the same tools the model uses. */
export function toolCaller(ctx: ToolContext, registry: Map<string, Tool>): CallTool {
  return async (name, args) => {
    const tool = registry.get(name);
    if (!tool) throw new Error(`Unknown tool ${name}`);
    // Lesson steps draw their own chart; don't double-draw via show_chart's directive.
    const sub: ToolContext = { ...ctx, directives: [] };
    const result = await tool.execute(args, sub);
    if (name === "show_chart") return result;
    ctx.directives.push(...sub.directives.filter((d) => d.type !== "chart"));
    return result;
  };
}

function quizDirective(ctx: ToolContext, lesson: Lesson) {
  ctx.state.quiz = { lessonId: lesson.id };
  ctx.state.lesson = null;
  ctx.directives.push({ type: "quiz", lessonId: lesson.id, question: lesson.quiz.q, options: lesson.quiz.options });
  const opts = lesson.quiz.options.map((o, i) => `${i + 1}: ${o}.`).join(" ");
  ctx.verbatim = `Quiz time. ${lesson.quiz.q} ${opts} Press a number, or say your answer.`;
}

export function tutoringTools(registry: Map<string, Tool>): Tool[] {
  async function show(ctx: ToolContext, lesson: Lesson, i: number) {
    const step = await playStep(lesson, ctx.lessons, i, toolCaller(ctx, registry));
    ctx.state.lesson = { id: lesson.id, step: i };
    if (step.awaitingConfirm) ctx.state.pendingProposal = { id: step.awaitingConfirm.id };
    ctx.directives.push({ type: "lesson", step });
    if (step.chart) ctx.directives.push({ type: "chart", chart: step.chart });
    await ctx.progress.record(lesson.id, i, false);
    ctx.verbatim = step.say;
    return { lesson: lesson.title, step: i + 1, of: step.stepCount, spoken: step.say };
  }

  const startLesson: Tool = {
    name: "start_lesson",
    description:
      "Start a lesson by number (1 to 6) or id. 1 How to feel a graph, 2 Stocks vs. ETFs, 3 Your first practice trade, " +
      "4 Tokenized funds with PVOO, 5 What if? Backtesting and risk, 6 Options basics. Use 'next' for the lesson that is up next.",
    parameters: { type: "object", properties: { lesson: { type: "string" } }, required: ["lesson"] },
    async execute({ lesson }, ctx) {
      let ref = lesson;
      if (String(lesson).toLowerCase() === "next") {
        ref = nextLesson(ctx.lessons, await ctx.progress.get()) ?? ctx.lessons[0].id;
      }
      return show(ctx, findLesson(ctx.lessons, ref), 0);
    },
  };

  const nextStep: Tool = {
    name: "next_step",
    description: "Move to the next or previous step of the current lesson, or repeat it.",
    parameters: {
      type: "object",
      properties: { direction: { type: "string", enum: ["next", "previous", "repeat"] } },
    },
    async execute({ direction = "next" }, ctx) {
      const at = ctx.state.lesson;
      if (!at) throw new Error("No lesson is in progress. Start one first.");
      const lesson = findLesson(ctx.lessons, at.id);
      if (direction === "next" && at.step >= lesson.steps.length - 1) {
        await ctx.progress.record(lesson.id, at.step, false);
        quizDirective(ctx, lesson);
        return { quiz: lesson.quiz.q, options: lesson.quiz.options };
      }
      const i = direction === "next" ? at.step + 1 : direction === "previous" ? Math.max(0, at.step - 1) : at.step;
      return show(ctx, lesson, i);
    },
  };

  const confirmLessonTrade: Tool = {
    name: "confirm_lesson_trade",
    description: "Internal: the learner confirmed the trade in the current lesson step.",
    parameters: { type: "object", properties: {} },
    async execute(_, ctx) {
      const at = ctx.state.lesson;
      const pending = ctx.state.pendingProposal?.id;
      if (!at || !pending) throw new Error("No lesson trade is waiting.");
      const lesson = findLesson(ctx.lessons, at.id);
      const step = await confirmStep(lesson, ctx.lessons, at.step, pending, toolCaller(ctx, registry));
      ctx.state.pendingProposal = null;
      ctx.directives.push({ type: "lesson", step });
      if (step.chart) ctx.directives.push({ type: "chart", chart: step.chart });
      ctx.verbatim = step.say;
      return { spoken: step.say };
    },
  };

  const answerQuiz: Tool = {
    name: "answer_quiz",
    description: "Grade the learner's quiz answer (a number 1 to 4, or their words).",
    parameters: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
    async execute({ answer }, ctx) {
      const lessonId = ctx.state.quiz?.lessonId;
      if (!lessonId) throw new Error("There's no quiz open.");
      const lesson = findLesson(ctx.lessons, lessonId);
      const asNumber = /^\d$/.test(String(answer).trim()) ? Number(answer) : String(answer);
      const result = gradeQuiz(lesson, asNumber);
      let next: string | null = null;
      if (result.correct) {
        await ctx.progress.record(lesson.id, lesson.steps.length - 1, true);
        next = nextLesson(ctx.lessons, await ctx.progress.get());
        ctx.state.quiz = null;
      }
      ctx.directives.push({ type: "quiz_result", lessonId, result, nextLessonId: next });
      const nextTitle = next ? findLesson(ctx.lessons, next).title : null;
      ctx.verbatim =
        result.explanation +
        (result.correct
          ? nextTitle
            ? ` Up next: ${nextTitle}. Say start the next lesson, or press M for the menu.`
            : " You've finished every core lesson. Press M for the menu."
          : "");
      return { ...result, next_lesson: nextTitle };
    },
  };

  const suggestOptions: Tool = {
    name: "suggest_options",
    description:
      "Offer one context-aware option in the numbered menu, like 'Continue Stocks vs. ETFs'. Shown as 'Options from Gemini'.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Short menu label, under 6 words" },
        say: { type: "string", description: "What the learner would be asking for" },
      },
      required: ["label", "say"],
    },
    async execute({ label, say }, ctx) {
      ctx.directives.push({ type: "options", options: [{ label: String(label).slice(0, 48), say: String(say) }] });
      return { shown: true };
    },
  };

  const explainFees: Tool = {
    name: "explain_fees",
    description:
      "Compare two funds with the same growth but different yearly fees (expense ratios, in percent) over many years.",
    parameters: {
      type: "object",
      properties: {
        low_fee: { type: "number" }, high_fee: { type: "number" },
        years: { type: "number" }, amount: { type: "number" },
      },
    },
    async execute({ low_fee = 0.03, high_fee = 1.0, years = 30, amount = 10_000 }) {
      // An assumed yearly growth rate, stated in the result so the tutor says it out loud.
      const assumed_return = 7;
      const grow = (fee: number) =>
        Array.from({ length: years + 1 }, (_, y) => amount * (1 + (assumed_return - fee) / 100) ** y);
      const low = grow(low_fee), high = grow(high_fee);
      const top = low.at(-1)!;
      const toPts = (vals: number[]) =>
        vals
          .filter((_, y) => y % Math.max(1, Math.round(years / 12)) === 0 || y === years)
          .map((v, i, arr) => ({ x: Number((i / (arr.length - 1)).toFixed(4)), y: Number(((v - amount) / (top - amount)).toFixed(4)) }));
      const end_low = Math.round(low.at(-1)!), end_high = Math.round(high.at(-1)!);
      return {
        low_fee, high_fee, years, amount, assumed_return,
        end_low, end_high,
        difference: end_low - end_high,
        pct_less: Number((((end_low - end_high) / end_low) * 100).toFixed(1)),
        curves: { low: toPts(low), high: toPts(high) },
      };
    },
    forModel: ({ curves, ...rest }) => rest,
  };

  return [startLesson, nextStep, answerQuiz, suggestOptions, explainFees, confirmLessonTrade];
}
