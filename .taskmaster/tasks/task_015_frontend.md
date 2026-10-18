# Task ID: 15

**Title:** UI Components: Answer Card, Lesson Header, and Quiz Options

**Status:** pending

**Dependencies:** 4 ✓, 9 ✓, 13

**Priority:** high

**Description:** Build the answer card component that displays tutor replies, the palm scene, chart legend, and large captions. Include lesson header with progress and quiz option selection.

**Details:**

Answer card implementation:
1. Create apps/web/components/AnswerCard.tsx
2. Implement answer card with sections:
   - "You asked: ..." (user's question)
   - Palm scene canvas (see task 16)
   - Chart legend using solid vs dashed lines (never color alone)
   - Large caption with reply text (1.25-1.6rem bold, Atkinson Hyperlegible)
   - "Drawing on your palm" / "Drawing finished" / "Sent to your palm arm" status
3. Conditional rendering:
   - Hide canvas when answer has no chart
   - Show legend only when chart is present
4. Implement lesson header for lesson state:
   - "Lesson 2 of 5 · Step 1 of 4"
   - Lesson title
   - Progress dashes: done (amber), current (white), future (gray)
   - Back (P) and Next (N) buttons
   - Keyboard shortcuts: P/left arrow back, N/right arrow next
5. Implement quiz options:
   - Question as caption
   - Three numbered options (large glass buttons)
   - Number keys 1-3 to answer
   - Correct answer turns teal background
   - Wrong answer turns coral background
   - Explanation appears below after selection
6. Accessibility features:
   - Caption mirrored to ARIA live region (polite)
   - Canvas has alt description from step.alt
   - All buttons have clear labels
   - Focus management: keep on space bar after interactions
7. Integrate with state machine:
   - answer state shows card with reply
   - lesson state shows header and card
   - quiz state shows question and options

Quiz rendering pseudo-code:
{state === 'quiz' && (
  <div className="quiz">
    <p className="question">{quiz.q}</p>
    <div className="options">
      {quiz.options.map((opt, i) => (
        <button
          key={i}
          className={classNames('option', {
            correct: answered && i === quiz.answer,
            wrong: answered && i !== quiz.answer && i === selected
          })}
          onClick={() => handleQuizAnswer(i)}
        >
          <span className="number">{i + 1}</span> {opt}
        </button>
      ))}
    </div>
    {answered && <p className="explanation">{quiz.why}</p>}
  </div>
)}

Cross-team dependencies:
- Task 10 in the backend tag: Tutor Brain: Tool Registry and Gemini Function-Calling Loop
- Task 12 in the backend tag: Lesson Engine: Curriculum Loader, Step Player, Quiz Engine, and Progress

**Test Strategy:**

E2E test: Ask "What is an ETF?", verify answer card appears with caption. Verify canvas is hidden for non-chart answers. Test lesson mode: Start lesson 1, verify header shows "Lesson 1 of 5 · Step 1 of 4". Press N, verify progress updates. Test quiz: Answer correctly, verify teal background and chime. Answer incorrectly, verify coral and explanation. Verify ARIA live region announces caption. Test screen reader reads alt text for chart canvas.
