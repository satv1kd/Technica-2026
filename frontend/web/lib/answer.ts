/**
 * Turns tutor directives into what the answer card shows: which app state to
 * enter, the lesson header, the quiz, and the confirm prompt.
 */
import type { ChartOps } from "../../../backend/services/chart/ops";
import type { Proposal, StepView } from "../../../backend/services/lessons/player";
import type { QuizResult } from "../../../backend/services/lessons/quiz";
import type { Directive } from "../../../backend/services/tutor/tools/types";
import type { ReplyKind } from "./state/appMachine";

export interface QuizView {
  lessonId: string;
  question: string;
  options: string[];
  result: QuizResult | null;
}

export interface AnswerView {
  kind: ReplyKind;
  lesson: StepView | null;
  quiz: QuizView | null;
  proposal: Proposal | null;
  /** A correct quiz answer is felt as a double tap on the palm. */
  chart: ChartOps | null;
  nextLessonId: string | null;
  /** The engine's /confirm result when a trade just filled. */
  trade: any | null;
}

export const DOUBLE_TAP: ChartOps = {
  ops: [
    { op: "tap", at: { x: 0.5, y: 0.5 }, label: "correct" },
    { op: "pause", ms: 150 },
    { op: "tap", at: { x: 0.5, y: 0.5 }, label: "correct" },
  ],
  alt: "Two quick taps in the center of the palm: correct.",
  legend: [],
};

/**
 * Work out the next view from a turn's directives. `prevQuiz` keeps the open
 * quiz on screen so a wrong answer can be retried.
 */
export function answerView(directives: Directive[], prevQuiz: QuizView | null): AnswerView {
  const find = <T extends Directive["type"]>(type: T) =>
    directives.find((d): d is Extract<Directive, { type: T }> => d.type === type);

  const lesson = find("lesson")?.step ?? null;
  const quizOpen = find("quiz");
  const quizResult = find("quiz_result");
  const confirm = find("confirm")?.proposal ?? lesson?.awaitingConfirm ?? null;
  const chartDirective = find("chart")?.chart ?? null;
  const trade = find("settled")?.trade ?? null;

  let quiz: QuizView | null = null;
  if (quizOpen) {
    quiz = { lessonId: quizOpen.lessonId, question: quizOpen.question, options: quizOpen.options, result: null };
  } else if (quizResult && prevQuiz && prevQuiz.lessonId === quizResult.lessonId) {
    quiz = { ...prevQuiz, result: quizResult.result };
  }

  const kind: ReplyKind = trade ? "settling" : confirm ? "confirm" : quiz ? "quiz" : lesson ? "lesson" : "answer";
  const chart = quizResult?.result.correct ? DOUBLE_TAP : chartDirective;

  return {
    kind,
    lesson: lesson && !quiz ? lesson : null,
    quiz,
    proposal: confirm,
    chart,
    nextLessonId: quizResult?.result.correct ? quizResult.nextLessonId : null,
    trade,
  };
}

/** "Lesson 2 of 5 · Step 1 of 4" */
export function lessonHeader(step: StepView): string {
  return `Lesson ${step.lessonNumber} of ${step.lessonCount} · Step ${step.stepIndex + 1} of ${step.stepCount}`;
}

/** done (before the current step), current, or future, for the progress dashes. */
export function dashStates(step: StepView): ("done" | "current" | "future")[] {
  return Array.from({ length: step.stepCount }, (_, i) =>
    i < step.stepIndex ? "done" : i === step.stepIndex ? "current" : "future",
  );
}
