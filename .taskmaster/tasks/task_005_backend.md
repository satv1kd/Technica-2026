# Task ID: 5

**Title:** Market Data: Price Ingestion from Alpaca with CSV Fallback

**Status:** in-progress

**Dependencies:** 2 ✓

**Priority:** high

**Description:** Implement price data ingestion for 6 symbols (VOO, SPY, QQQ, AAPL, MSFT, NVDA) from Alpaca API, backfilling 2 years of daily bars. Include CSV fallback for when database is unreachable.

**Details:**

Price ingestion implementation:
1. Create services/data/ingest_alpaca.py using Alpaca Market Data API
2. Fetch 2 years (approximately 500 trading days) of daily OHLCV bars for each of 6 symbols
3. Insert into prices hypertable with proper timestamptz handling
4. Create CSV fallback files in data/fallback/*.csv with same schema
5. Implement fallback.py module that reads CSVs when database connection fails
6. Add automatic fallback trigger on database connection errors
7. Log all fallback usage for monitoring
8. Schedule refresh script to run every 15 minutes during market hours (9:30 AM - 4:00 PM ET)
9. Handle market holidays and weekends gracefully
10. Store last successful fetch timestamp

Alpaca API pseudo-code:
from alpaca.data import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from datetime import datetime, timedelta

client = StockHistoricalDataClient(api_key, secret_key)
request = StockBarsRequest(
    symbol_or_symbols=["VOO", "SPY", "QQQ", "AAPL", "MSFT", "NVDA"],
    timeframe=TimeFrame.Day,
    start=datetime.now() - timedelta(days=730)
)
bars = client.get_stock_bars(request)
# Insert into TimescaleDB

**Test Strategy:**

Integration test with database down: Verify CSV fallback is triggered and returns correct data structure. Integration test with Alpaca: Fetch 1 week of data for AAPL and verify 5 rows inserted. Verify refresh during weekend uses Friday's close. Mock test for market hours check.
