import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "../config.js";
import { log } from "../log.js";

let activePool: pg.Pool | null = null;
let warnedAboutTls = false;

function sslOptions(): pg.PoolConfig["ssl"] {
  const url = config.databaseUrl;
  if (url.includes("localhost") || url.includes("127.0.0.1")) return undefined;

  // Managed Postgres (Aiven, Supabase, Neon) presents a CA the system store
  // does not know. With the CA file, the connection is properly authenticated.
  if (config.databaseCaCertPath) {
    return { ca: readFileSync(config.databaseCaCertPath, "utf8"), rejectUnauthorized: true };
  }

  if (!warnedAboutTls) {
    warnedAboutTls = true;
    log.warn(
      "connecting over TLS without verifying the server certificate - set DATABASE_CA_CERT " +
        "to the provider's CA file. This database holds customer names, phones and addresses.",
    );
  }
  return { rejectUnauthorized: false };
}

/**
 * `sslmode` in the URL is parsed by pg-connection-string and wins over the
 * explicit `ssl` option, which throws away our CA. Strip it - TLS is decided
 * by sslOptions() - so the URL can be pasted from the provider unchanged.
 */
function connectionStringWithoutSslMode(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("uselibpqcompat");
    return parsed.toString();
  } catch {
    return url;
  }
}

function defaultPool(): pg.Pool {
  return new pg.Pool({
    connectionString: connectionStringWithoutSslMode(config.databaseUrl),
    ssl: sslOptions(),
    connectionTimeoutMillis: 10_000,
  });
}

/** Lazily created so importing this module never opens a socket. */
export function getPool(): pg.Pool {
  activePool ??= defaultPool();
  return activePool;
}

/** Tests swap in an in-memory Postgres. Not used in production paths. */
export function setPool(pool: pg.Pool): void {
  activePool = pool;
}

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function closeDb(): Promise<void> {
  await activePool?.end();
  activePool = null;
}
