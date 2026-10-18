# Task ID: 24

**Title:** Stretch Goal: Options Basics Lesson and Market Module

**Status:** pending

**Dependencies:** 3 ✓, 7 ✓, 10 ⧖, 12 ⧖

**Priority:** low

**Description:** Implement lesson 6 (Options basics) with visualization of call and put payoff diagrams, and add options market module to the trading engine. Only if time permits after all P0/P1 tasks are complete.

**Details:**

Options implementation (stretch):
1. Complete lesson 6 content (6-options-basics.json already exists):
   - 3 steps: buying a call, buying a put, time decay
   - Quiz on maximum loss
2. Implement options-specific visualizations:
   - Hockey stick payoff diagram for calls and puts
   - Zero line (dashed) as reference
   - Break-even point marked with tap
   - Time decay curve showing value erosion
3. Create services/engine/markets/options.py:
   - Simplified options pricing (Black-Scholes or fixed premiums)
   - Call and put contracts
   - Expiration dates
   - Strike prices
4. Add options tools:
   - get_option_quote(symbol, strike, expiry, type)
   - propose_option_trade(side, contract, qty)
   - Calculate P&L for educational purposes
5. Update UI for options:
   - Show strike, expiry, premium in proposal
   - Explain max loss vs max gain clearly
   - Warning: "Most beginners lose money on options. Use practice money only."
6. Integrate lesson 6 into menu and progress tracking

Note: This is P2 priority. Only implement if:
- All P0 and P1 tasks are complete and tested
- At least 4 hours remain before code freeze
- Core demo flow is rock solid

If time is short, skip this and focus on polish and testing.

Cross-team dependencies:
- Task 15 in the frontend tag: UI Components: Answer Card, Lesson Header, and Quiz Options
- Task 22 in the shared tag: Integration Testing: End-to-End Demo Flow with Eyes-Closed Test

**Test Strategy:**

If implemented: Unit test options pricing produces reasonable premiums. Test call payoff diagram shows hockey stick shape. Test quiz warns about risk. Integration test: propose and confirm option trade (simulated, not real). Manual test: Play lesson 6 fully. If not implemented: Mark as deferred in TaskMaster, document for future work.
