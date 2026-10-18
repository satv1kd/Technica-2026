# Task ID: 12

**Title:** Lesson Engine: Curriculum Loader, Step Player, Quiz Engine, and Progress

**Status:** in-progress

**Dependencies:** 3 ✓, 10 ⧖

**Priority:** high

**Description:** Build the lesson engine that loads validated lesson JSON files, plays steps with data placeholder resolution, runs quizzes, and tracks learner progress.

**Details:**

Lesson engine implementation:
1. Create services/lessons/ with loader.ts, player.ts, quiz.ts, progress.ts
2. Implement loader.ts:
   - Load all JSON files from services/lessons/content/*.json
   - Validate each against lessonSchema on startup
   - Extract and index all placeholders like {AAPL.pct_1m}
   - Fail fast on validation errors with file name and issue
3. Implement player.ts for step playback:
   - playStep(lessonId, stepIndex) function
   - Resolve data placeholders by calling appropriate tools at play time
   - Fill placeholders in say text: "{AAPL.pct_1m}" → "3.5"
   - Start TTS and chart drawing simultaneously
   - End with instruction: "Press N for the next step, or R to repeat"
   - N or right arrow advances, P or left arrow goes back
4. Implement quiz.ts:
   - gradeQuiz(lessonId, choice) function
   - Accept number key 1-3 or spoken answer
   - Match spoken answers to options with fuzzy matching
   - Return correct: boolean, explanation: string
   - On correct: play success chime, send double palm tap, update progress
   - On incorrect: play wrong-answer tone, explain why, allow retry
5. Implement progress.ts:
   - Store in lesson_progress table: lesson_id, done, best_step, updated
   - Also mirror to localStorage for offline persistence
   - getProgress() returns completed lessons and next lesson
   - updateProgress(lessonId, stepIndex) saves progress
   - "Up next" and "Done" tags for lesson menu
6. Handle placeholder resolution failures gracefully:
   - If tool fails, speak step without the number
   - Append: "The current data is unavailable."
7. Integrate with tutor loop via start_lesson and next_step tools

Pseudo-code:
async function playStep(lessonId: string, stepIdx: number) {
  const lesson = lessons.find(l => l.id === lessonId);
  const step = lesson.steps[stepIdx];
  
  // Resolve placeholders
  let say = step.say;
  if (step.data) {
    const results = await Promise.all(step.data.map(d => callTool(d.tool, d.args)));
    for (const [i, result] of results.entries()) {
      const placeholder = extractPlaceholder(step.data[i]);
      say = say.replace(`{${placeholder}}`, extractValue(result, placeholder));
    }
  }
  
  // Play narration and chart together
  await Promise.all([
    speak(say),
    step.chart ? drawChart(step.chart) : Promise.resolve()
  ]);
  
  announce("Press N for the next step, or R to repeat");
}

**Test Strategy:**

Unit test: Load all 6 lesson files, verify schema validation passes. Test playStep() with lesson 1 step 1. Test placeholder resolution with mock tool results. Test quiz grading with correct and incorrect answers. Integration test: Complete lesson 1, verify progress saved to database and localStorage. Test placeholder failure shows graceful message. E2E test: Navigate full lesson with N/P keys.
