/**
 * Lesson progress mirrored to localStorage, so Done / Up next tags survive a
 * reload even if the database is unreachable. The server stays the source of
 * truth; this only ever adds "done".
 */
import type { LessonInfo } from "./menus";

const KEY = "sonar-progress";

export function loadDone(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function markDone(lessonId: string) {
  try {
    const done = new Set(loadDone());
    done.add(lessonId);
    localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch {}
}

export function clearDone() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

/** Apply locally known completions and recompute "Up next" (first unfinished core lesson). */
export function mergeDone(lessons: LessonInfo[], done: string[]): LessonInfo[] {
  const d = new Set(done);
  const withDone = lessons.map((l) => ({ ...l, done: l.done || d.has(l.id) }));
  const next = withDone.find((l) => !l.stretch && !l.done)?.id ?? null;
  return withDone.map((l) => ({ ...l, upNext: l.id === next }));
}
