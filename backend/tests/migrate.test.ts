import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate, splitSql } from "@services/data/migrate";

const schema = fs.readFileSync(path.resolve(__dirname, "../services/data/schema.sql"), "utf8");

function fakeClient(failOn?: RegExp) {
  const seen: string[] = [];
  const client = {
    query: async (sql: string) => {
      if (failOn?.test(sql)) throw new Error("boom");
      seen.push(sql);
      return { rows: [] };
    },
  } as unknown as pg.ClientBase;
  return { client, seen };
}

describe("splitSql", () => {
  it("splits on top-level semicolons and drops comments", () => {
    expect(splitSql("SELECT 1; -- note; here\nSELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("does not split inside string literals, including escaped quotes", () => {
    expect(splitSql("SELECT 'a;b', 'it''s; fine'; SELECT 3;")).toEqual([
      "SELECT 'a;b', 'it''s; fine'",
      "SELECT 3",
    ]);
  });

  it("does not split inside dollar-quoted bodies", () => {
    const sql = "DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;\nDO $x$ BEGIN PERFORM 3; END $x$;";
    expect(splitSql(sql)).toEqual([
      "DO $$ BEGIN PERFORM 1; PERFORM 2; END $$",
      "DO $x$ BEGIN PERFORM 3; END $x$",
    ]);
  });
});

describe("schema.sql", () => {
  const statements = splitSql(schema);

  it("keeps each continuous aggregate as one whole statement", () => {
    const views = statements.filter((s) => s.startsWith("CREATE MATERIALIZED VIEW"));
    expect(views.map((v) => v.split(/\s+/)[6])).toEqual(["prices_weekly", "prices_monthly"]);
    for (const v of views) {
      expect(v).toContain("timescaledb.continuous");
      expect(v).toMatch(/WITH NO DATA$/);
    }
  });

  it("creates every table the live database has", () => {
    for (const table of ["accounts", "prices", "positions", "trades", "learning_events"]) {
      expect(statements.some((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${table} `))).toBe(true);
    }
  });

  it("makes prices, trades, and learning_events hypertables", () => {
    for (const t of ["prices", "trades", "learning_events"]) {
      expect(statements.some((s) => s.includes(`create_hypertable('${t}', 'time'`))).toBe(true);
    }
  });

  it("refreshes both candle views hourly", () => {
    const policies = statements.filter((s) => s.includes("add_continuous_aggregate_policy"));
    expect(policies).toHaveLength(2);
    expect(policies.every((p) => p.includes("schedule_interval => INTERVAL '1 hour'"))).toBe(true);
  });

  it("adds the guard constraints in a single DO block", () => {
    const guard = statements.find((s) => s.startsWith("DO $$"));
    expect(guard).toBeDefined();
    for (const c of ["accounts_cash_nonnegative", "positions_quantity_nonnegative", "trades_quantity_positive"]) {
      expect(guard).toContain(c);
    }
  });
});

describe("migrate", () => {
  it("runs each statement as its own query", async () => {
    const { client, seen } = fakeClient();
    await migrate(client, "SELECT 1;\nSELECT 2;\n");
    expect(seen).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("names the failing statement", async () => {
    const { client } = fakeClient(/prices_weekly/);
    await expect(migrate(client, schema)).rejects.toThrow(
      /Migration failed at: CREATE MATERIALIZED VIEW IF NOT EXISTS prices_weekly/,
    );
  });
});
