import type { ChartOps } from "../../chart/ops";
import type { Lesson } from "../../lessons/schema";
import type { ProgressStore } from "../../lessons/progress";
import type { StepView, Proposal } from "../../lessons/player";
import type { QuizResult } from "../../lessons/quiz";
import type { EngineFetch } from "../engine";

/** What the browser tells the tutor about where the learner is. */
export interface TurnState {
  lesson?: { id: string; step: number } | null;
  quiz?: { lessonId: string } | null;
  pendingProposal?: { id: string } | null;
}

/** Instructions for the UI that come out of tool calls. */
export type Directive =
  | { type: "chart"; chart: ChartOps }
  | { type: "confirm"; proposal: Proposal }
  | { type: "settled"; trade: any }
  | { type: "cancelled"; proposalId: string }
  | { type: "lesson"; step: StepView }
  | { type: "quiz"; lessonId: string; question: string; options: string[] }
  | { type: "quiz_result"; lessonId: string; result: QuizResult; nextLessonId: string | null }
  | { type: "options"; options: { label: string; say: string }[] }
  | { type: "menu" };

export interface ToolContext {
  engine: EngineFetch;
  lessons: Lesson[];
  progress: ProgressStore;
  state: TurnState;
  transcript: string;
  /** True when the learner pressed Enter on a confirm prompt. */
  userConfirmed: boolean;
  directives: Directive[];
  /** When set, this exact text is spoken instead of the model's wording. */
  verbatim?: string;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: Record<string, any>, ctx: ToolContext): Promise<any>;
  /** Optional compact form sent back to the model (big payloads stay in the UI). */
  forModel?(result: any): any;
}
