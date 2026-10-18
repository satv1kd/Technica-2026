# Screen reader check (task 21)

Automated checks already pass: axe (WCAG 2.1 A/AA) in every app state, keyboard-only
Playwright flows, focus return, the live region, and tab order. This list covers what
only a person with a real screen reader can confirm. It takes about 10 minutes.

Run the app (`npm run dev`, plus the engine on port 8000) and open http://localhost:3000.

## NVDA (Windows, Chrome or Edge)

1. Load the page. NVDA should say "Sonar investing tutor, application" and then read the
   key help ("Hold space to talk...") without you pressing anything else.
2. Press **M**. You should hear the menu read aloud, and NVDA should **not** jump to a
   landmark. If it jumps, focus mode is off: press NVDA+Space once and try again.
3. Press **1**, then **1**. Lesson 1 starts. NVDA reads each caption **once** (not twice).
4. Press **N** and **P**. The steps change; NVDA doesn't move by paragraph.
5. Finish the lesson and answer the quiz with **1** (wrong), then **2** (right). You hear
   "Not quite..." then "That's right...", and the option buttons say "Not quite" / "Correct".
6. Press **3**, then **1** (Buy 2 PVOO). The read-back is spoken. Press **Escape**: "Cancelled".
   Repeat and press **Enter**: the checklist and "Done..." are announced.
7. Press **T**, type a question, press **Enter**. Focus returns to the space bar.
8. Hold **Space**: the earcon plays and nothing is announced over your speech.

## VoiceOver (macOS, Safari or Chrome)

1. Turn on VoiceOver (Cmd+F5). Quick Nav must not swallow letter keys: if M or N don't
   work, toggle Quick Nav off with Left+Right arrow together.
2. Repeat steps 1 to 8 above.

## Low vision (no screen reader)

1. Settings, **3** (text size) twice: the extra-large text stays readable and nothing overlaps.
2. Check text over the blurred background in bright and dark room light. axe can't measure
   contrast on gradients and backdrop blur, so this one is by eye.
3. Turn on "Reduce motion" in the OS. The background stops moving, the hand stops breathing,
   and charts appear already drawn.

Note anything that fails, with the step number, in the task 21 issue.
