"use client";

import type { ReactNode } from "react";
import type { ChartOps } from "../../../backend/services/chart/ops";
import type { StepView } from "../../../backend/services/lessons/player";
import { dashStates, lessonHeader, type QuizView } from "../lib/answer";
import { PalmScene, type PalmStatus } from "./PalmScene";

interface Props {
  asked: string;
  thinking: boolean;
  reply: string;
  chart: ChartOps | null;
  playKey: number;
  palmStatus: PalmStatus;
  /** True while the chart is playing as sound. */
  soundPlaying?: boolean;
  /** e.g. "Palm arm: drawing line 3 of 9" while the physical arm draws. */
  armStatus?: string | null;
  armConnected: boolean;
  lesson: StepView | null;
  quiz: QuizView | null;
  onPalmStatus: (s: PalmStatus) => void;
  onPrev: () => void;
  onNext: () => void;
  onAnswer: (n: number) => void;
  /** Trade panels (confirm, settling, results) shown under the caption. */
  children?: ReactNode;
}

function LegendSwatch({ style }: { style: "solid" | "dashed" }) {
  return (
    <svg className="legend-swatch" width="44" height="12" viewBox="0 0 44 12" aria-hidden="true">
      <line x1="2" y1="6" x2="42" y2="6" strokeWidth="4" strokeLinecap="round"
        className={style === "dashed" ? "legend-dashed" : "legend-solid"}
        strokeDasharray={style === "dashed" ? "7 6" : undefined} />
    </svg>
  );
}

function palmLabel(status: PalmStatus, armConnected: boolean): string {
  if (armConnected && status !== "idle") return "Sent to your palm arm";
  return status === "drawing" ? "Drawing on your palm" : status === "finished" ? "Drawing finished" : "";
}

/** The glass answer card: lesson header, the felt chart, caption, and quiz. */
export function AnswerCard(p: Props) {
  const { lesson, quiz, chart } = p;
  const status = p.armStatus ?? (p.soundPlaying ? "Playing chart as sound" : palmLabel(p.palmStatus, p.armConnected));
  return (
    <section className="answer-card" aria-label="Answer">
      {lesson && (
        <header className="lesson-header">
          <p className="lesson-meta">{lessonHeader(lesson)}</p>
          <h2 className="lesson-title">{lesson.lessonTitle}</h2>
          <ol className="lesson-dashes" aria-hidden="true">
            {dashStates(lesson).map((s, i) => <li key={i} className={`dash dash-${s}`} />)}
          </ol>
        </header>
      )}

      {p.asked && !lesson && !quiz && <p className="asked" aria-label="Your question">You asked: {p.asked}</p>}

      {chart && (
        <figure className="palm-figure">
          <PalmScene chart={chart} playKey={p.playKey} onStatus={p.onPalmStatus} />
          {chart.legend.length > 0 && (
            <ul className="legend" aria-label="Chart legend">
              {chart.legend.map((l) => (
                <li key={l.label}>
                  <LegendSwatch style={l.style} />
                  <span>{l.label}</span>
                  <span className="sr-only">, {l.style} line</span>
                </li>
              ))}
            </ul>
          )}
          {status && <figcaption className="palm-status" role="status">{status}</figcaption>}
        </figure>
      )}

      {quiz ? (
        <div className="quiz">
          <p className="caption quiz-question" aria-label="Quiz question">{quiz.question}</p>
          <ol className="quiz-options">
            {quiz.options.map((opt, i) => {
              const r = quiz.result;
              const state = !r ? "" : i === r.correctIndex && r.correct ? "correct" : i === r.chosen && !r.correct ? "wrong" : "";
              return (
                <li key={opt}>
                  <button type="button" className={`quiz-option ${state}`} onClick={() => p.onAnswer(i + 1)}
                    aria-describedby={state ? "quiz-explanation" : undefined}>
                    <span className="quiz-key">{i + 1}</span>
                    <span className="quiz-label">{opt}</span>
                    {state === "correct" && <span className="quiz-mark">Correct</span>}
                    {state === "wrong" && <span className="quiz-mark">Not quite</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          {quiz.result && <p id="quiz-explanation" className="caption quiz-explanation" aria-label="Tutor reply">{p.reply}</p>}
        </div>
      ) : (
        p.thinking
          ? <p className="caption caption-thinking" role="status">Thinking…</p>
          : <p className="caption" aria-label="Tutor reply">{p.reply}</p>
      )}

      {p.children}

      {lesson && (
        <nav className="lesson-nav" aria-label="Lesson steps">
          <button type="button" className="lesson-button" onClick={p.onPrev} disabled={lesson.stepIndex === 0}>
            <span className="dock-key">P</span> Back
          </button>
          <button type="button" className="lesson-button lesson-next" onClick={p.onNext}>
            <span className="dock-key">N</span> {lesson.isLast ? "Quiz" : "Next"}
          </button>
        </nav>
      )}
    </section>
  );
}
