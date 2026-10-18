# Task ID: 13

**Title:** UI Components: Space Bar Hero and Try Asking Tray

**Status:** pending

**Dependencies:** 4 ✓, 9 ⧖

**Priority:** high

**Description:** Build the giant glass space bar component and the Try Asking tray that slides up while space is held, showing 9 numbered suggestions (5 lessons + 4 quick questions).

**Details:**

Space bar and tray implementation:
1. Create apps/web/components/SpaceBar.tsx
2. Implement giant space bar visual:
   - Glass surface styling as specified
   - Press-down animation: 10px translation on active
   - Amber glow effect on press using box-shadow
   - 14-bar soundwave animation inside the key during listening
   - Smooth transitions with easing
3. Implement pointer and keyboard handling:
   - onPointerDown and onPointerUp for mouse/touch
   - Space key already wired in page.tsx
   - Visual feedback on both interaction types
4. Create apps/web/components/TryAskingTray.tsx
5. Implement tray that slides up from bottom:
   - Slide animation triggered by listening state
   - Glass panel styling
   - Two groups: Lessons (1-5) and Quick questions (6-9)
   - Each item shows number key and label
   - Lessons show "Done" or "Up next" tags based on progress
   - Click or number key while held sends suggestion on release
6. First-time behavior:
   - On first open, tutor reads two suggestions aloud
   - Store in localStorage to not repeat
7. Integrate with lesson progress for tags
8. Update page.tsx to render tray conditionally when listening

Tray content:
Lessons:
1. How to feel a graph
2. Stocks vs. ETFs
3. Your first practice trade
4. Tokenized funds with PVOO
5. What if? Backtesting and risk

Quick questions:
6. How has the S&P 500 done this year?
7. How did Apple do this month?
8. Compare a stock and an ETF
9. How fast does PVOO settle?

Cross-team dependencies:
- Task 12 in the backend tag: Lesson Engine: Curriculum Loader, Step Player, Quiz Engine, and Progress

**Test Strategy:**

E2E test with Playwright: Press space, verify tray slides up within 300ms. Press number 1 while holding space, release, verify lesson 1 starts. Visual regression test for glass styling and glow effect. Test with completed lesson 1, verify "Done" tag appears. Test first-time open reads suggestions aloud (mock localStorage).
