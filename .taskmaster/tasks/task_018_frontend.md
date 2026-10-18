# Task ID: 18

**Title:** Trading Flow: Trade Confirmation and Settlement UI with Devnet Fallback

**Status:** pending

**Dependencies:** 15

**Priority:** high

**Description:** Build the trade confirmation flow UI showing price, total, risk note, Enter to confirm / Escape to cancel, settlement checklist with timing, and Explorer link. Handle devnet failures gracefully with ledger-only fallback.

**Details:**

Trade flow UI implementation:
1. Add confirm state handling to page.tsx state machine
2. Create confirmation view when propose_trade tool returns:
   - Display proposal details:
     - "Buy 2 PVOO"
     - "Price: $467.82 per share"
     - "Total: $935.64"
     - Risk note: "This is practice money. Prices can fall as well as rise."
   - Two large buttons:
     - "Enter Confirm purchase" (amber, primary)
     - "Esc Cancel" (secondary)
   - 60-second countdown timer
   - After 60s, show "Offer expired" message
3. Implement settling state visualization:
   - Animated checklist:
     - "Signed with your practice key" (instant check)
     - "Sent to Solana devnet" (check after 0.5-1s)
     - "Confirmed in X.X seconds" (check when complete)
   - Show settlement time prominently
   - Display Explorer link: https://explorer.solana.com/tx/{sig}?cluster=devnet
   - Single palm tap animation
4. Handle devnet fallback scenario:
   - If chain service returns "simulated settlement" flag:
     - Checklist shows:
       - "Signed with your practice key" ✓
       - "Recorded in ledger" ✓
       - "Devnet unavailable - simulated" ⚠️
     - Show example Explorer link from previous successful transaction
     - Tutor says: "The token ledger updated, but the blockchain is unavailable right now. Here's an example of how settlement normally looks."
5. Implement trade results panel (for sighted observers):
   - Order details row: type, asset, shares, price, total, status
   - 30-day price chart with buy/sell point marked
   - Hover tooltip shows exact date and price at point
   - Settlement time comparison bar:
     - Traditional ETF: "T+1 (next business day)"
     - PVOO: "2.1 seconds"
   - Account balance bar: split showing holdings value and cash
6. Integrate confirmation flow:
   - propose_trade returns → transition to confirm state
   - Enter key or spoken "confirm" → call confirm_trade tool → transition to settling state
   - Escape or spoken "cancel" → call cancel_trade tool → return to answer state
   - Timeout at 60s → show expiry message, return to answer state
7. Portfolio view (after trade or when requested):
   - Show account bar only
   - List all positions with current values
   - Show total value, gain/loss, cash balance
   - Coaching tip every 3 trades (concentration warning, frequent trading, panic selling)

Confirm UI pseudo-code:
{state === 'confirm' && proposal && (
  <div className="confirm-panel">
    <h2>Review your order</h2>
    <div className="details">
      <p className="order">{proposal.side} {proposal.qty} {proposal.symbol}</p>
      <p>Price: ${proposal.price.toFixed(2)} per share</p>
      <p className="total">Total: ${proposal.total.toFixed(2)}</p>
      <p className="risk">{proposal.riskNote}</p>
      <p className="expiry">This price expires in {timeLeft}s</p>
    </div>
    <div className="actions">
      <button className="confirm" onClick={handleConfirm}>Enter ✓ Confirm purchase</button>
      <button className="cancel" onClick={handleCancel}>Esc ✗ Cancel</button>
    </div>
  </div>
)}

Cross-team dependencies:
- Task 8 in the backend tag: Blockchain: PVOO SPL Token on Solana Devnet with Mint/Burn/Supply
- Task 10 in the backend tag: Tutor Brain: Tool Registry and Gemini Function-Calling Loop

**Test Strategy:**

E2E test: Use Practice trading menu to buy 2 PVOO. Verify confirm screen shows correct price and total. Press Enter, verify settling checklist animates. Verify Explorer link is valid devnet URL. Test with chain service offline: verify ledger-only fallback shows warning and example link. Test timeout: wait 60s on confirm screen, verify expiry message. Test cancel: press Escape, verify proposal is cancelled and not executed. Verify portfolio shows updated holdings after trade. Test coaching tip appears after 3rd trade.
