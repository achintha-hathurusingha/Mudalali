import { readFileSync } from "node:fs";
import pg from "pg";

/**
 * The console talks to the same Postgres as the agent, with its own role:
 * it reads and writes rows but cannot change the schema. Migrations stay in
 * the agent's db/schema.sql, applied deliberately with `npm run db:setup`.
 */

let pool: pg.Pool | null = null;

function sslOptions(): pg.PoolConfig["ssl"] {
  const url = process.env.DATABASE_URL ?? "";
  if (url.includes("localhost") || url.includes("127.0.0.1")) return undefined;

  // Managed Postgres presents a CA the system store does not know. Without the
  // CA file the connection still works but is not authenticated - and this
  // database holds customers' phone numbers and addresses.
  const ca = process.env.DATABASE_CA_CERT;
  if (ca) return { ca: readFileSync(ca, "utf8"), rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

/**
 * `sslmode` in the URL is parsed by pg-connection-string and overrides the
 * explicit `ssl` option, throwing away the CA. Strip it.
 */
function connectionString(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  try {
    const parsed = new URL(raw);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("uselibpqcompat");
    return parsed.toString();
  } catch {
    return raw;
  }
}

function getPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: connectionString(),
    ssl: sslOptions(),
    connectionTimeoutMillis: 10_000,
    max: 5,
  });
  return pool;
}

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
