import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Tiger Data (Timescale Cloud) signs its server certificates with a private
 * CA, ca.timescale.com, that no OS trusts. We pin that CA so connections stay
 * fully verified (chain + hostname) instead of turning verification off.
 */
const TIMESCALE_CA = path.join(__dirname, "certs", "timescale-ca.pem");
const TIMESCALE_HOST = /\.tsdb\.cloud\.timescale\.com$/;

/**
 * Build pg client options for a connection string. sslmode and friends are
 * stripped from the URL because pg lets them override the `ssl` object.
 */
export function pgOptions(
  connectionString: string,
  password: string | undefined = process.env.DATABASE_PASSWORD,
): pg.ClientConfig {
  const url = new URL(connectionString);
  for (const p of ["sslmode", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(p);
  // The Tiger console hands out the URL and the password separately.
  if (!url.password && password?.trim()) url.password = encodeURIComponent(password.trim());

  if (TIMESCALE_HOST.test(url.hostname)) {
    return {
      connectionString: url.toString(),
      ssl: { ca: fs.readFileSync(TIMESCALE_CA, "utf8"), rejectUnauthorized: true },
    };
  }
  // Local databases (Docker) usually have no TLS; keep the URL as given.
  return { connectionString: url.toString() };
}

export function newClient(connectionString: string): pg.Client {
  return new pg.Client(pgOptions(connectionString));
}

export function newPool(connectionString: string, max = 5): pg.Pool {
  return new pg.Pool({ ...pgOptions(connectionString), max });
}
