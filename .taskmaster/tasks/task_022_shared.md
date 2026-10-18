# Task ID: 22

**Title:** Integration Testing: End-to-End Demo Flow with Eyes-Closed Test

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Build comprehensive integration test suite covering the full demo flow: welcome, lesson, question with chart, backtest, practice trade, token backing check, portfolio. Include eyes-closed manual test with blind or blindfolded tester.

**Details:**

Integration testing implementation:
1. Create tests/integration/ directory with Playwright test suites
2. Implement E2E test scenarios:
   - Full demo flow test:
     - Launch app, hear welcome
     - Press 1 for Lessons
     - Press 1 for lesson 1
     - Complete all steps with N key
     - Answer quiz correctly
     - Verify progress saved
   - Question with chart flow:
     - Press space, ask "How did Apple do this month?"
     - Verify get_quote and get_price_history tools called
     - Verify chart appears
     - Verify sonification plays (if arm disconnected)
   - Backtest flow:
     - Ask "What if I invested $1000 in VOO a year ago?"
     - Verify run_backtest tool called
     - Verify result includes end value, return %, max drawdown
     - Verify chart shows the period
   - Practice trade flow:
     - Select "Buy 2 PVOO" from menu
     - Verify propose_trade called
     - Verify confirmation screen shows price and total
     - Press Enter to confirm
     - Verify confirm_trade called
     - Verify mint happens (if devnet available)
     - Verify settlement checklist animates
     - Verify Explorer link shown
   - Token backing check:
     - Request backing check
     - Verify check_token_backing tool called
     - Verify supply matches ledger message spoken
   - Portfolio check:
     - Request portfolio
     - Verify get_portfolio tool called
     - Verify holdings and cash shown correctly
3. Test data accuracy (PRD success metric):
   - Script with known inputs and expected outputs
   - Verify 100% of spoken numbers match database
   - Log all tool calls and results
   - Compare spoken text to tool results
4. Test trade confirmation requirement (PRD success metric):
   - Verify 0 trades execute without explicit confirmation
   - Test that propose without confirm doesn't execute
   - Test that timeout prevents execution
5. Test PVOO backing (PRD success metric):
   - After every PVOO trade, verify supply == ledger
   - Automated check in test suite
6. Test voice latency (PRD success metric):
   - Measure time from space bar release to first audio
   - Verify p90 < 4 seconds
   - Log all latency measurements
7. Eyes-closed manual test:
   - Recruit blind tester or use blindfolded sighted tester
   - Provide no sighted assistance
   - Ask tester to complete:
     - One lesson start to finish
     - Ask one question and feel chart
     - Complete one practice trade
   - Record session, note any friction points
   - Success = completion with zero sighted help
8. Fallback scenario testing:
   - Database down: verify CSV fallback works
   - Devnet down: verify ledger-only settlement
   - ElevenLabs quota: verify Gemini TTS fallback
   - Network offline: verify graceful degradation
9. Weekend/holiday testing:
   - Run during market closure
   - Verify Friday close prices used
   - Verify "market is closed" mentioned

Test data fixture example:
const EXPECTED_APPLE_1M = {
  symbol: 'AAPL',
  direction: 'up',
  percent: '3.5',
  peak: { date: '2026-10-10', price: 178.32 }
};
// Verify spoken text contains these values

Cross-team dependencies:
- Task 9 in the frontend tag: Voice I/O: Push-to-Talk, ElevenLabs STT/TTS, and Gemini TTS Fallback
- Task 10 in the backend tag: Tutor Brain: Tool Registry and Gemini Function-Calling Loop
- Task 11 in the backend tag: Tutor Brain: Speech Style Filter and Guardrails
- Task 12 in the backend tag: Lesson Engine: Curriculum Loader, Step Player, Quiz Engine, and Progress
- Task 13 in the frontend tag: UI Components: Space Bar Hero and Try Asking Tray
- Task 14 in the frontend tag: UI Components: Numbered Options Menu, Settings, and Bottom Dock
- Task 15 in the frontend tag: UI Components: Answer Card, Lesson Header, and Quiz Options
- Task 17 in the frontend tag: Chart Output: Sonification with Frequency Mapping and Accessible Sound Toggle
- Task 18 in the frontend tag: Trading Flow: Trade Confirmation and Settlement UI with Devnet Fallback

**Test Strategy:**

Automated E2E tests run in CI on every commit. Manual eyes-closed test performed before final submission. Latency measurements logged and analyzed. All 5 PRD success metrics verified programmatically. Record test sessions for review. Document any failures and fixes. Final gate: blindfolded team member completes demo with no help.
