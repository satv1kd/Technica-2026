# Task ID: 3

**Title:** Foundation: Lesson Content JSON Files and Schema Validation

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Create all 5 core lesson JSON files (plus 1 stretch) from Appendix B with proper schema validation. Ensure placeholder extraction works correctly.

**Details:**

Lesson content creation:
1. Review existing services/lessons/schema.ts (appears complete)
2. Check existing lesson files: 1-feel-a-graph.json, 2-stocks-vs-etfs.json, 3-first-trade.json, 4-tokenized-funds.json, 6-options-basics.json
3. Create missing lesson 5-backtesting-risk.json
4. Ensure all lessons follow the schema: id, title, steps[], quiz{q, options, answer, why}
5. Each step needs: id, title, say (with {PLACEHOLDER} syntax), optional data[], action[], chart{}, alt
6. Validate all files against lessonSchema on load
7. Extract and document all placeholders used (AAPL.pct, VOO.price, etc.)
8. Test placeholder extraction with placeholders() function

Example step structure:
{
  "id": "etf-1",
  "title": "One stock's trend",
  "say": "Here's Apple over the last month. It's {AAPL.dir_1m} about {AAPL.pct_1m} percent.",
  "data": [{"tool": "get_price_history", "args": {"symbol": "AAPL", "range": "1m"}}],
  "chart": {"series": ["AAPL"], "smooth": "sma5", "points": 12, "markers": ["peak"]}
}

**Test Strategy:**

Unit test: Load all 6 lesson files and verify they pass lessonSchema validation. Test that quiz.answer indexes into options. Test placeholders() function extracts {AAPL.pct} correctly. Verify each lesson has 1-6 steps and one quiz.
