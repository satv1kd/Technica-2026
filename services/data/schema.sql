-- Sonar schema for Tiger Data (Postgres + TimescaleDB).
-- Mirrors the live database. Idempotent: run with `npm run db:migrate`.
-- Statements run one at a time outside a transaction, because continuous
-- aggregates cannot be created inside a transaction block.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Accounts -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cash NUMERIC NOT NULL DEFAULT 10000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the practice account on an empty database.
INSERT INTO accounts (name)
SELECT 'Demo learner'
WHERE NOT EXISTS (SELECT 1 FROM accounts);

-- Prices -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS prices (
  time TIMESTAMPTZ NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL DEFAULT 'equity',
  open DOUBLE PRECISION,
  high DOUBLE PRECISION,
  low DOUBLE PRECISION,
  close DOUBLE PRECISION,
  volume BIGINT,
  source TEXT,
  -- Makes ingest idempotent (ON CONFLICT) and serves symbol lookups.
  UNIQUE (symbol, time)
);

SELECT create_hypertable('prices', 'time', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- Candles: continuous aggregates. materialized_only = false lets queries see
-- rows newer than the last refresh, so a fresh ingest shows up immediately.

CREATE MATERIALIZED VIEW IF NOT EXISTS prices_weekly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('7 days', time) AS bucket, symbol,
       first(open, time) AS open, max(high) AS high, min(low) AS low, last(close, time) AS close
FROM prices
GROUP BY bucket, symbol
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS prices_monthly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 month', time) AS bucket, symbol,
       first(open, time) AS open, max(high) AS high, min(low) AS low, last(close, time) AS close
FROM prices
GROUP BY bucket, symbol
WITH NO DATA;

SELECT add_continuous_aggregate_policy('prices_weekly',
  start_offset => INTERVAL '3 months', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

SELECT add_continuous_aggregate_policy('prices_monthly',
  start_offset => INTERVAL '1 year', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

-- Positions and trades -----------------------------------------------------

CREATE TABLE IF NOT EXISTS positions (
  account_id UUID NOT NULL REFERENCES accounts (id),
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, symbol)
);

CREATE TABLE IF NOT EXISTS trades (
  time TIMESTAMPTZ NOT NULL DEFAULT now(),
  id TEXT NOT NULL,
  account_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  -- 'T+1', 'onchain', or 'simulated' (devnet unreachable).
  settlement TEXT,
  -- Solana transaction signature when settlement = 'onchain'.
  settlement_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);

SELECT create_hypertable('trades', 'time', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- Learner activity: lesson steps, quiz answers, settings changes, trades.

CREATE TABLE IF NOT EXISTS learning_events (
  time TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id UUID NOT NULL,
  kind TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'
);

SELECT create_hypertable('learning_events', 'time', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- Guard rails (added on top of the original schema) -------------------------
-- The PRD requires that cash never goes negative and that every trade and
-- position is well formed. Constraints have no IF NOT EXISTS, hence DO blocks.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_cash_nonnegative') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_cash_nonnegative CHECK (cash >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_quantity_nonnegative') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_quantity_nonnegative CHECK (quantity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_quantity_positive') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_quantity_positive CHECK (quantity > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_price_nonnegative') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_price_nonnegative CHECK (price >= 0);
  END IF;
END
$$;

-- Indexes ------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS trades_account_time_idx ON trades (account_id, time DESC);
CREATE INDEX IF NOT EXISTS learning_events_account_time_idx ON learning_events (account_id, time DESC);
