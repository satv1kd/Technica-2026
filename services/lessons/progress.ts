/**
 * Lesson progress. Stored as learning_events (kind 'lesson_progress') in Tiger
 * Data, which is the team's schema for learner activity; the browser mirrors
 * it to localStorage.
 */
import type pg from "pg";

export interface LessonProgress {
  done: boolean;
  bestStep: number;
}

export type ProgressMap = Record<string, LessonProgress>;

export interface ProgressStore {
  get(): Promise<ProgressMap>;
  record(lessonId: string, step: number, done: boolean): Promise<void>;
  reset(): Promise<void>;
}

/** The first core lesson that isn't done ("Up next"), or null when all are. */
export function nextLesson(order: { id: string; stretch?: boolean }[], progress: ProgressMap): string | null {
  return order.find((l) => !l.stretch && !progress[l.id]?.done)?.id ?? null;
}

export function mergeProgress(a: ProgressMap, b: ProgressMap): ProgressMap {
  const out: ProgressMap = { ...a };
  for (const [id, p] of Object.entries(b)) {
    const q = out[id];
    out[id] = { done: (q?.done ?? false) || p.done, bestStep: Math.max(q?.bestStep ?? 0, p.bestStep) };
  }
  return out;
}

export class MemoryProgress implements ProgressStore {
  private map: ProgressMap = {};
  async get() {
    return structuredClone(this.map);
  }
  async record(lessonId: string, step: number, done: boolean) {
    this.map = mergeProgress(this.map, { [lessonId]: { done, bestStep: step } });
  }
  async reset() {
    this.map = {};
  }
}

export class DbProgress implements ProgressStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly accountId: () => Promise<string>,
  ) {}

  async get(): Promise<ProgressMap> {
    const id = await this.accountId();
    const { rows } = await this.pool.query(
      `SELECT detail->>'lesson_id' AS lesson_id,
              bool_or((detail->>'done')::boolean) AS done,
              max((detail->>'step')::int) AS best_step
       FROM learning_events
       WHERE account_id = $1 AND kind = 'lesson_progress'
         AND time > COALESCE((SELECT max(time) FROM learning_events
                              WHERE account_id = $1 AND kind = 'lesson_reset'), '-infinity')
       GROUP BY 1`,
      [id],
    );
    return Object.fromEntries(rows.map((r) => [r.lesson_id, { done: r.done, bestStep: r.best_step }]));
  }

  async record(lessonId: string, step: number, done: boolean) {
    await this.pool.query(
      `INSERT INTO learning_events (account_id, kind, detail) VALUES ($1, 'lesson_progress', $2)`,
      [await this.accountId(), { lesson_id: lessonId, step, done }],
    );
  }

  async reset() {
    // Append-only: a reset event hides earlier progress without deleting history.
    await this.pool.query(
      `INSERT INTO learning_events (account_id, kind, detail) VALUES ($1, 'lesson_reset', '{}')`,
      [await this.accountId()],
    );
  }
}

/** Same rule as the engine: ENGINE_ACCOUNT_ID, else the 'Demo learner' account. */
export function demoAccount(pool: pg.Pool, configured = process.env.ENGINE_ACCOUNT_ID): () => Promise<string> {
  let cached: Promise<string> | null = null;
  return () =>
    (cached ??= (async () => {
      const { rows } = configured?.trim()
        ? await pool.query("SELECT id FROM accounts WHERE id = $1", [configured.trim()])
        : await pool.query(
            "SELECT id FROM accounts ORDER BY (name = 'Demo learner') DESC, created_at LIMIT 1",
          );
      if (!rows[0]) throw new Error("No practice account found. Run `npm run db:migrate`.");
      return String(rows[0].id);
    })());
}
