import type { Speaker, Speed } from "./tts";

/** Keep the drawing and cached speech together when replaying a reply. */
export async function repeat(speaker: Speaker, redraw: () => void, speed: Speed = "normal") {
  if (!speaker.last) return false;
  redraw();
  return speaker.repeat(speed);
}
