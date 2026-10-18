# Task ID: 7

**Title:** Trading Engine: REST API with Market Registry and Two-Step Trades

**Status:** done

**Dependencies:** 2 ✓, 5 ⧖

**Priority:** high

**Description:** Build the Python FastAPI trading engine with pluggable market modules, ledger, and two-step trade flow (propose then confirm). Ensure cash balance never goes negative.

**Details:**

Trading engine implementation:
1. Create services/engine/ directory with FastAPI app
2. Design abstract Market base class: quote(), fill(), settle()
3. Implement equity.py market for VOO, SPY, QQQ, AAPL, MSFT, NVDA
4. Implement pvoo.py market (PVOO tokenized fund)
5. Create ledger.py with double-entry accounting: cash and positions tables
6. Implement trades.py with proposal and confirmation flow
7. Add 60-second expiry on proposals
8. Build REST endpoints:
   - GET /markets - list available assets
   - GET /quote?symbol=VOO - current price
   - GET /history?symbol=VOO&range=1m - price history
   - POST /propose {side, symbol, qty} - create proposal, return id
   - POST /confirm {id} - execute trade if proposal is live
   - POST /cancel {id} - cancel proposal
   - GET /portfolio - current holdings and cash
   - POST /backtest {symbol, amount, start_date} - historical simulation
   - GET /review - trade history
9. Implement portfolio.py with coaching tips (concentration, frequent trading, panic selling)
10. Implement backtest.py with maximum drawdown calculation
11. Add weekend/holiday handling: use last close price and state this clearly
12. Ensure atomicity: proposal confirm either fully succeeds or fully fails

Python pseudo-code:
class Market(ABC):
    @abstractmethod
    def quote(self, symbol: str) -> Quote: pass
    @abstractmethod
    def fill(self, side: str, symbol: str, qty: Decimal) -> Fill: pass
    @abstractmethod
    def settle(self, fill: Fill) -> Settlement: pass

Cash constraint enforcement:
db.execute("UPDATE cash SET balance = balance - ? WHERE balance >= ?", [total, total])
if db.rowcount == 0: raise InsufficientFundsError()

**Test Strategy:**

Unit test: Market registry loads 6 equity symbols and PVOO. API test: POST /propose then /confirm within 60s succeeds, after 60s returns 409. Test /confirm without proposal returns 409. Test insufficient funds prevents trade. Integration test: Buy 2 PVOO, verify cash decreases and position increases. Test weekend fill uses Friday close.
