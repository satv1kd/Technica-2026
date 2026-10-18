export type AppState =
  | "menu"
  | "listening"
  | "thinking"
  | "answer"
  | "lesson"
  | "quiz"
  | "confirm"
  | "settling";

export type AppEvent =
  | { type: "TALK_START" }
  | { type: "TALK_END"; heldMs: number }
  | { type: "TALK_CANCEL" }
  | { type: "MENU" }
  | { type: "BACK" }
  | { type: "REPLY_READY"; kind: "answer" | "lesson" | "quiz" | "confirm" }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "CONFIRM" }
  | { type: "CANCEL" }
  | { type: "SETTLED" };

export const MIN_HOLD_MS = 250;

/** Pure transition function; side effects (audio, fetch) live in the UI layer. */
export function transition(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case "TALK_START":
      // Talking is allowed from anywhere except mid-settlement.
      return state === "settling" ? state : "listening";
    case "TALK_END":
      if (state !== "listening") return state;
      return event.heldMs >= MIN_HOLD_MS ? "thinking" : "menu";
    case "TALK_CANCEL":
      return state === "listening" ? "menu" : state;
    case "MENU":
    case "BACK":
      return state === "settling" ? state : "menu";
    case "REPLY_READY":
      return state === "thinking" ? event.kind : state;
    case "NEXT":
      return state === "lesson" ? "lesson" : state;
    case "PREV":
      return state === "lesson" ? "lesson" : state;
    case "CONFIRM":
      return state === "confirm" ? "settling" : state;
    case "CANCEL":
      return state === "confirm" ? "answer" : state === "listening" ? "menu" : state;
    case "SETTLED":
      return state === "settling" ? "answer" : state;
  }
}
