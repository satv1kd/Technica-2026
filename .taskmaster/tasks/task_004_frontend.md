# Task ID: 4

**Title:** Foundation: Next.js App Shell with Aurora Background and State Machine

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Build the single-page app shell with aurora background, accessible keymap, ARIA live region, and the complete state machine for all 8 app states.

**Details:**

App shell implementation:
1. Review existing apps/web/app/page.tsx, lib/state/appMachine.ts, lib/a11y/keymap.ts, lib/a11y/live.ts
2. Complete the state machine with all 8 states: menu, listening, thinking, answer, lesson, quiz, confirm, settling
3. Implement transition logic between states based on events: TALK_START, TALK_END, MENU, BACK, NEXT, PREV, CONFIRM, CANCEL
4. Build AuroraBackground component with 4 blurred color blobs (teal #0FA595, sea blue #2A5FB0, amber #FFC95A, coral #E8655C) that drift and blend
5. Add 8% scale and saturation increase during listening state
6. Implement glass surface styling: rgba(8,24,22,.46), 26px backdrop blur, 1px white 20% border, 28-32px radius
7. Set up typography: Bricolage Grotesque for headings, Atkinson Hyperlegible for body
8. Wire keyboard handlers: Space (hold to talk), M (menu), R (repeat), N/P (lesson nav), 0-9 (options), Enter (confirm), Escape (cancel), T (type), S (sonify)
9. Implement ARIA live region that announces state changes
10. Add reduced motion support via prefers-reduced-motion media query

State machine transitions:
menu + TALK_START → listening
listening + TALK_END → thinking
thinking + (response received) → answer
answer + NEXT → lesson
lesson + CONFIRM → confirm
confirm + CONFIRM → settling

**Test Strategy:**

Unit test: State machine transitions with each event type. Verify listening state triggers background animation. E2E test with Playwright: Press space, verify listening state, release and verify thinking state. Test all keyboard shortcuts. Verify ARIA live region announces each state change.
