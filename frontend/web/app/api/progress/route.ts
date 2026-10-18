import { NextResponse } from "next/server";
import { nextLesson } from "../../../../../backend/services/lessons/progress";
import { tutor } from "../../../../../backend/services/tutor/server";

export const runtime = "nodejs";

/** Lesson list with Done / Up next, for the menus. */
export async function GET() {
  const { deps } = tutor();
  let progress = {};
  try {
    progress = await deps.progress.get();
  } catch (err) {
    console.warn(`[progress] ${(err as Error).message}`);
  }
  const upNext = nextLesson(deps.lessons, progress);
  return NextResponse.json({
    progress,
    upNext,
    lessons: deps.lessons.map((l, i) => ({
      number: i + 1, id: l.id, title: l.title, stretch: Boolean(l.stretch),
      done: Boolean((progress as any)[l.id]?.done), upNext: l.id === upNext,
    })),
  });
}

/** Reset lesson progress (Settings, option 5). */
export async function DELETE() {
  await tutor().deps.progress.reset();
  return NextResponse.json({ ok: true });
}
