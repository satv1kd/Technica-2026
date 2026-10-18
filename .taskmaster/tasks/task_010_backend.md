# Task ID: 10

**Title:** Tutor Brain: Tool Registry and Gemini Function-Calling Loop

**Status:** in-progress

**Dependencies:** 6 ✓, 7 ✓, 8 ⧖

**Priority:** high

**Description:** Implement the 16-tool registry (11 trading + 5 tutoring) and the Gemini function-calling loop that turns learner questions into spoken replies with tool calls. Enforce the rule that all numbers must come from tool results.

**Details:**

Tutor brain implementation:
1. Create services/tutor/ module with loop.ts, tools/ directory, prompts/system.md
2. Implement tool registry in tools/index.ts exporting 16 tools:
   Trading tools: list_markets, get_quote, get_price_history, show_chart, propose_trade, confirm_trade, cancel_trade, get_portfolio, run_backtest, review_trades, check_token_backing
   Tutoring tools: start_lesson, next_step, answer_quiz, suggest_options, explain_fees
3. Each tool has JSON schema for parameters and return type
4. Build function-calling loop in loop.ts:
   - Take transcript, conversation history, current state as input
   - Call Gemini API with tools array and function calling enabled
   - Handle up to 5 tool rounds per turn
   - Collect all tool results
   - Generate final reply text
   - Return reply, tool results, UI directives (show_chart, open_menu, start_lesson)
5. Create system prompt in prompts/system.md:
   - "You are Sonar, a voice-first investing tutor for blind learners"
   - "Always use tools to get current data. Never answer from memory."
   - "All numbers in your reply MUST come from tool results in this turn."
   - "You teach, you don't give personalized advice."
   - "Describe shapes, never just colors."
   - "Keep sentences under 25 words for natural speech."
6. Implement apps/web/app/api/talk/route.ts as the entry point:
   - Receive transcript from STT
   - Call tutor loop
   - Return reply text and UI directives

Tool example:
{
  name: "get_quote",
  description: "Get current price for a symbol",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Stock symbol like AAPL or VOO" }
    },
    required: ["symbol"]
  },
  execute: async ({ symbol }) => {
    const res = await fetch(`${ENGINE_URL}/quote?symbol=${symbol}`);
    return res.json();
  }
}

**Test Strategy:**

Integration test with recorded tool results: Ask "How did Apple do this month?", verify get_quote and get_price_history are called, verify reply contains numbers from tool results only. Unit test: Tool registry has 16 tools, each with valid JSON schema. Test guardrail blocks reply with numbers not in tool log. Verify up to 5 tool rounds work. Test conversation history is preserved across turns.
