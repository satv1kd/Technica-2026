import type { Lesson } from "./schema";

export interface QuizResult {
  correct: boolean;
  chosen: number | null;
  correctIndex: number;
  explanation: string;
}

const ORDINALS: Record<string, number> = {
  one: 0, first: 0, "1": 0,
  two: 1, second: 1, "2": 1,
  three: 2, third: 2, "3": 2,
  four: 3, fourth: 3, "4": 3,
};

const STOP = new Set(["the", "and", "you", "your", "its", "think", "maybe", "answer", "is", "it", "um", "uh", "a", "an", "of", "to", "i"]);
const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));

/**
 * Map a key press (1-based number) or a spoken answer to an option index.
 * Spoken answers match by number word ("the second one") or by overlap with
 * the option text ("the right side").
 */
export function matchChoice(options: string[], answer: number | string): number | null {
  if (typeof answer === "number") {
    return answer >= 1 && answer <= options.length ? answer - 1 : null;
  }
  const said = answer.toLowerCase().trim();
  const toks = words(said);

  // Exact or near-exact option text first.
  const exact = options.findIndex((o) => said.includes(o.toLowerCase()));
  if (exact >= 0) return exact;

  // Then word overlap with each option.
  let best = -1, bestScore = 0, tie = false;
  options.forEach((o, i) => {
    const ow = new Set(words(o));
    const score = toks.filter((t) => ow.has(t)).length / Math.max(ow.size, 1);
    if (score > bestScore) [best, bestScore, tie] = [i, score, false];
    else if (score === bestScore && score > 0) tie = true;
  });
  if (best >= 0 && bestScore >= 0.5 && !tie) return best;

  // Finally "number two", "the first one".
  for (const t of said.split(/\s+/)) {
    const idx = ORDINALS[t.replace(/[^a-z0-9]/g, "")];
    if (idx !== undefined && idx < options.length) return idx;
  }
  return null;
}

export function gradeQuiz(lesson: Lesson, answer: number | string): QuizResult {
  const { options, answer: correctIndex, why } = lesson.quiz;
  const chosen = matchChoice(options, answer);
  if (chosen === null) {
    return {
      correct: false,
      chosen,
      correctIndex,
      explanation: `I didn't catch which answer you meant. Press 1 to ${options.length}, or say the answer.`,
    };
  }
  const correct = chosen === correctIndex;
  return {
    correct,
    chosen,
    correctIndex,
    explanation: correct ? `That's right. ${why}` : `Not quite. ${why} Try again.`,
  };
}
