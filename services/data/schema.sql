-- Sonar schema for Tiger Data (Postgres + TimescaleDB)
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS prices (
  ts TIMESTAMPTZ NOT NULL,
  symbol TEXT NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC,
  volume BIGINT,
  UNIQUE (symbol, ts)
);
SELECT create_hypertable('prices', 'ts', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_weekly
WITH (timescaledb.continuous) AS
SELECT time_bucket('7 days', ts) AS bucket, symbol,
       first(open, ts) AS open, max(high) AS high, min(low) AS low, last(close, ts) AS close
FROM prices GROUP BY bucket, symbol
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_monthly
WITH (timescaledb.continuous) AS
SELECT time_bucket('30 days', ts) AS bucket, symbol,
       first(open, ts) AS open, max(high) AS high, min(low) AS low, last(close, ts) AS close
FROM prices GROUP BY bucket, symbol
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_weekly',
  start_offset => INTERVAL '60 days', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);
SELECT add_continuous_aggregate_policy('candles_monthly',
  start_offset => INTERVAL '180 days', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  symbol TEXT NOT NULL,
  qty NUMERIC NOT NULL CHECK (qty > 0),
  price NUMERIC NOT NULL,
  status TEXT NOT NULL,
  tx_sig TEXT,
  settle_ms INT
);

CREATE TABLE IF NOT EXISTS positions (
  symbol TEXT PRIMARY KEY,
  qty NUMERIC NOT NULL,
  avg_cost NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS cash (
  id INT PRIMARY KEY DEFAULT 1,
  balance NUMERIC NOT NULL CHECK (balance >= 0)
);
INSERT INTO cash (id, balance) VALUES (1, 10000) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS lesson_progress (
  lesson_id TEXT PRIMARY KEY,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  best_step INT NOT NULL DEFAULT 0,
  updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
