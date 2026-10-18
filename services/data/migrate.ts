import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import { newClient } from "./db";

const SCHEMA_PATH = path.join(__dirname, "schema.sql");

export const CANDLE_VIEWS = ["prices_weekly", "prices_monthly"] as const;

/**
 * Split a SQL file into statements on top-level semicolons. Understands
 * `--` comments (dropped), 'string literals', and $tag$ dollar-quoted bodies
 * such as DO blocks, so semicolons inside those don't split.
 */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === "'") {
      // '' is an escaped quote inside a literal.
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const tag = ch === "$" ? /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0] : undefined;
    if (tag) {
      const close = sql.indexOf(tag, i + tag.length);
      const end = close === -1 ? sql.length : close + tag.length;
      current += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === ";") {
      statements.push(current);
      current = "";
    } else {
      current += ch;
    }
    i++;
  }
  statements.push(current);
  return statements.map((s) => s.trim()).filter(Boolean);
}

/**
 * Apply schema.sql. Each statement runs on its own (autocommit), because
 * CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous) fails inside a
 * transaction block.
 */
export async function migrate(client: pg.ClientBase, sql = fs.readFileSync(SCHEMA_PATH, "utf8")) {
  for (const statement of splitSql(sql)) {
    try {
      await client.query(statement);
    } catch (err) {
      const preview = statement.split("\n")[0].slice(0, 80);
      throw new Error(`Migration failed at: ${preview}\n${(err as Error).message}`);
    }
  }
}

/**
 * Materialize every candle bucket now. Call after a historical backfill; the
 * hourly policy only covers the recent window.
 */
export async function refreshCandles(client: pg.ClientBase) {
  for (const view of CANDLE_VIEWS) {
    await client.query(`CALL refresh_continuous_aggregate('${view}', NULL, NULL)`);
  }
}

async function main() {
  // Migrations only need the database, not every app key.
  const DATABASE_URL = process.env.DATABASE_URL?.trim();
  if (!DATABASE_URL || !/^postgres(ql)?:\/\//.test(DATABASE_URL)) {
    throw new Error("DATABASE_URL is missing or not a postgres:// URL. Set it in .env at the repo root.");
  }
  const client = newClient(DATABASE_URL);
  await client.connect();
  try {
    if (process.argv.includes("--refresh")) {
      await refreshCandles(client);
      console.log("Refreshed prices_weekly and prices_monthly.");
    } else {
      await migrate(client);
      console.log("Schema is up to date.");
    }
  } finally {
    await client.end();
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
