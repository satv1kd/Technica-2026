import { z } from "zod";

export const stepSchema = z.object({
  id: z.string(),
  title: z.string(),
  say: z.string(),
  data: z
    .array(z.object({ tool: z.string(), args: z.record(z.unknown()) }))
    .optional(),
  action: z
    .array(z.object({ tool: z.string(), args: z.record(z.unknown()) }))
    .optional(),
  chart: z
    .object({
      series: z.array(z.string()),
      smooth: z.string().optional(),
      points: z.number().int().optional(),
      markers: z.array(z.string()).optional(),
      shape: z.string().optional(),
    })
    .optional(),
  alt: z.string().optional(),
});

export const lessonSchema = z.object({
  id: z.string(),
  title: z.string(),
  stretch: z.boolean().optional(),
  steps: z.array(stepSchema).min(1),
  quiz: z.object({
    q: z.string(),
    options: z.array(z.string()).min(2).max(4),
    answer: z.number().int().min(0),
    why: z.string(),
  }).refine((quiz) => quiz.answer < quiz.options.length, {
    message: "quiz.answer must index into options",
  }),
});

export type Step = z.infer<typeof stepSchema>;
export type Lesson = z.infer<typeof lessonSchema>;

/** Placeholders like {AAPL.pct} that a tool fills in at play time. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
}
