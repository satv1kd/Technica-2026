/**
 * Runs against a real TimescaleDB. Skipped unless TEST_DATABASE_URL (or, as a
 * fallback, DATABASE_URL) is set. It migrates the schema, then writes and
 * deletes rows only for the fake symbol TEST_SONAR and a throwaway account.
 *
 *   npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newClient } from "@services/data/db";
import { migrate, refreshCandles } from "@services/data/migrate";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const SYMBOL = "TEST_SONAR";

describe.skipIf(!url)("TimescaleDB schema", () => {
  let client: ReturnType<typeof newClient>;
  let accountId: string;

  beforeAll(async () => {
    client = newClient(url!);
    await client.connect();
    await migrate(client);
    // Running twice proves the migration is idempotent.
    await migrate(client);
    await client.query("DELETE FROM prices WHERE symbol = $1", [SYMBOL]);

    // 500 consecutive days, close climbing by 1 per day from 100.
    await client.query(
      `INSERT INTO prices (time, symbol, open, high, low, close, volume, source)
       SELECT '2020-01-01'::timestamptz + i * INTERVAL '1 day', $1,
              100 + i, 101 + i, 99 + i, 100 + i, 1000, 'test'
       FROM generate_series(0, 499) AS i`,
      [SYMBOL],
    );
    await refreshCandles(client);

    const { rows } = await client.query(
      `INSERT INTO accounts (name, cash) VALUES ('vitest-schema', 50) RETURNING id`,
    );
    accountId = rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await client.query("DELETE FROM prices WHERE symbol = $1", [SYMBOL]);
    await refreshCandles(client);
    if (accountId) await client.query("DELETE FROM accounts WHERE id = $1", [accountId]);
    await client.end();
  }, 120_000);

  it("prices, trades, and learning_events are hypertables", async () => {
    const { rows } = await client.query(
      `SELECT hypertable_name FROM timescaledb_information.hypertables
       WHERE hypertable_name IN ('prices', 'trades', 'learning_events') ORDER BY 1`,
    );
    expect(rows.map((r) => r.hypertable_name)).toEqual(["learning_events", "prices", "trades"]);
  });

  it("weekly candles aggregate open, high, low, close correctly", async () => {
    const { rows } = await client.query(
      `SELECT bucket, open, high, low, close
       FROM prices_weekly WHERE symbol = $1 ORDER BY bucket`,
      [SYMBOL],
    );
    expect(rows.length).toBeGreaterThanOrEqual(71);
    expect(rows.length).toBeLessThanOrEqual(73);

    // An interior week has 7 consecutive daily rows.
    const week = rows[10];
    expect(week.close - week.open).toBe(6);
    expect(week.high).toBe(week.close + 1);
    expect(week.low).toBe(week.open - 1);

    expect(rows.at(-1).close).toBe(599);
  });

  it("monthly candles cover the same range", async () => {
    const { rows } = await client.query(
      `SELECT min(open) AS first_open, max(close) AS last_close, count(*)::int AS n
       FROM prices_monthly WHERE symbol = $1`,
      [SYMBOL],
    );
    expect(rows[0].first_open).toBe(100);
    expect(rows[0].last_close).toBe(599);
    expect(rows[0].n).toBe(17);
  });

  it("cash can never go negative", async () => {
    await expect(
      client.query("UPDATE accounts SET cash = -1 WHERE id = $1", [accountId]),
    ).rejects.toThrow(/accounts_cash_nonnegative/);
  });

  it("a trade must have a positive quantity", async () => {
    await expect(
      client.query(
        `INSERT INTO trades (id, account_id, symbol, asset_class, side, quantity, price)
         VALUES ('vitest-bad', $1, 'VOO', 'equity', 'buy', 0, 1)`,
        [accountId],
      ),
    ).rejects.toThrow(/trades_quantity_positive/);
  });

  it("both candle views have hourly refresh policies", async () => {
    const { rows } = await client.query(
      `SELECT hypertable_name AS view_name, schedule_interval
       FROM timescaledb_information.jobs
       WHERE hypertable_name IN ('prices_weekly', 'prices_monthly')
         AND proc_name = 'policy_refresh_continuous_aggregate'
       ORDER BY 1`,
    );
    expect(rows.map((r) => r.view_name)).toEqual(["prices_monthly", "prices_weekly"]);
    for (const r of rows) expect(r.schedule_interval).toEqual(expect.objectContaining({ hours: 1 }));
  });

  it("left the team's real price data in place", async () => {
    const { rows } = await client.query(
      `SELECT count(DISTINCT symbol)::int AS symbols, count(*)::int AS n
       FROM prices WHERE symbol <> $1`,
      [SYMBOL],
    );
    expect(rows[0].symbols).toBeGreaterThanOrEqual(6);
    expect(rows[0].n).toBeGreaterThanOrEqual(3000);
  });
});
