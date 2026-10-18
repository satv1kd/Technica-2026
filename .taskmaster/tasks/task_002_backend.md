# Task ID: 2

**Title:** Foundation: TimescaleDB Schema and Continuous Aggregates

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Create and deploy the TimescaleDB schema with hypertables for prices, trades, positions, lesson progress, and settings. Set up continuous aggregates for weekly and monthly candles.

**Details:**

Database schema implementation:
1. Review existing services/data/schema.sql
2. Create hypertable for prices (ts, symbol, open, high, low, close, volume)
3. Create tables for trades, positions, cash, lesson_progress, settings
4. Add CHECK constraint on cash.balance >= 0
5. Create continuous aggregates: candles_weekly (7 days) and candles_monthly (30 days)
6. Set up refresh policies to run every hour
7. Add indexes on symbol and ts for query performance
8. Create migration script and deployment instructions

TimescaleDB-specific features:
- Use create_hypertable() for time-series data
- Use time_bucket() in continuous aggregate queries
- Use first(), last(), max(), min() window functions

SQL pseudo-code:
CREATE TABLE prices (ts TIMESTAMPTZ NOT NULL, symbol TEXT NOT NULL, open NUMERIC, high NUMERIC, low NUMERIC, close NUMERIC, volume BIGINT);
SELECT create_hypertable('prices', 'ts');
CREATE MATERIALIZED VIEW candles_weekly WITH (timescaledb.continuous) AS SELECT time_bucket('7 days', ts) AS bucket, symbol, first(open, ts) AS open, max(high) AS high, min(low) AS low, last(close, ts) AS close FROM prices GROUP BY bucket, symbol;

**Test Strategy:**

Integration test: Insert 500 sample rows for one symbol, query candles_weekly and verify aggregation. Test cash balance constraint by attempting to insert negative balance. Verify refresh policy runs.
