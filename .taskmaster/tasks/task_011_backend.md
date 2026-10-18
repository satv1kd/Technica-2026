# Task ID: 11

**Title:** Tutor Brain: Speech Style Filter and Guardrails

**Status:** in-progress

**Dependencies:** 10 ⧖

**Priority:** medium

**Description:** Implement the speech style filter that makes model output sound natural when spoken, and guardrails that ensure accuracy and safety (no invented numbers, no personalized advice, no claiming trades without confirmation).

**Details:**

Speech processing implementation:
1. Create services/tutor/speechStyle.ts module
2. Implement toSpeech(text) filter:
   - Strip all markdown formatting (* ** # [] ())
   - Split sentences longer than 25 words at natural breaks
   - Convert numbers to speakable form: "3.5%" → "about 3.5 percent", "$560" → "five hundred sixty dollars"
   - Describe visual shapes: "the line rises steeply" not "the green line"
   - Append one-line risk disclaimer when returns are mentioned: "Remember, prices can fall as well as rise."
3. Create services/tutor/guardrails.ts module
4. Implement checkReply(reply, toolLog) that:
   - Extracts all numbers and percentages from reply text
   - Verifies each number appears in tool results from this turn
   - Blocks reply if any number is missing from tool log
   - Triggers regeneration with additional prompt: "Use only the data from your tool calls"
5. Add content guardrails:
   - Detect requests for personalized advice ("should I buy", "what stock is best for me")
   - Respond with education-only answer: "Sonar teaches investing concepts. I can't recommend specific investments for your situation."
   - Detect claims of completed trades without confirm_trade in tool log
   - Block and correct: "I cannot confirm that trade without seeing a confirmation in my records."
6. Log all guardrail blocks for monitoring

Pseudo-code:
function checkReply(reply: string, toolLog: ToolResult[]): CheckResult {
  const numbersInReply = extractNumbers(reply); // ["12", "3.5", "560"]
  const numbersInTools = toolLog.flatMap(extractNumbers); // from JSON results
  
  for (const num of numbersInReply) {
    if (!numbersInTools.includes(num)) {
      return { blocked: true, reason: `Number ${num} not found in tool results` };
    }
  }
  
  if (reply.includes("should") && detectAdviceRequest(reply)) {
    return { blocked: true, reason: "Personalized advice detected" };
  }
  
  if (reply.match(/bought|sold|confirmed/i) && !toolLog.some(t => t.tool === 'confirm_trade')) {
    return { blocked: true, reason: "Trade claim without confirmation" };
  }
  
  return { blocked: false };
}

**Test Strategy:**

Unit test: toSpeech() removes markdown and splits long sentences. Test "VOO is up 12%" becomes "VOO is up about 12 percent. Remember, prices can fall as well as rise." Unit test: checkReply() blocks "Apple is at $175" when tool results only have $170. Test advice detection blocks "Should I buy NVDA?". Test trade claim is blocked without confirm_trade. Integration test with live model to ensure regeneration works.
