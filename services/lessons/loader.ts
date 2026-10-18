import fs from "node:fs";
import path from "node:path";
import { lessonSchema, type Lesson } from "./schema";

const CONTENT_DIR = path.join(__dirname, "content");

/** Load and validate every lesson file; throws with the file name on a bad one. */
export function loadCurriculum(dir: string = CONTENT_DIR): Lesson[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      const parsed = lessonSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`Invalid lesson ${file}: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}
