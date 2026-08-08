/** Driver factory: returns a Drizzle instance backed by either PGlite (dev,
 *  zero-install embedded Postgres) or node-postgres (prod). The choice is
 *  controlled by WAVEX_DB_DRIVER env var ("pglite" | "pg"); default is
 *  "pglite" so `pnpm dev` boots without Docker.
 *
 *  All schema + queries written against this returned drizzle instance work
 *  identically against both drivers — same SQL dialect (Postgres), same
 *  Drizzle API. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type DbDriver = "pglite" | "pg";

export type Db = ReturnType<typeof drizzlePglite<typeof schema>> | ReturnType<typeof drizzlePostgres<typeof schema>>;

let cached: Db | undefined;
/** The live driver handle behind `cached`. Held separately because the
 *  Drizzle wrapper does not own the connection lifecycle — dropping the
 *  Drizzle instance leaves the PGlite (or postgres-js) client open. */
let cachedClient: { close: () => Promise<void> } | undefined;

export function getDbDriver(): DbDriver {
  const v = (process.env.WAVEX_DB_DRIVER ?? "").toLowerCase();
  if (v === "pg" || v === "postgres") return "pg";
  return "pglite";
}

/** PGlite data dir resolution priority:
 *    1. WAVEX_DB_DATA_DIR (explicit override)
 *    2. WAVEX_OS_STATE_DIR/db/pglite (when wavex root is set)
 *    3. ~/.wavex-os/db/pglite (default home location) */
export function getDataDir(): string {
  if (process.env.WAVEX_DB_DATA_DIR) return process.env.WAVEX_DB_DATA_DIR;
  if (process.env.WAVEX_OS_STATE_DIR) return join(process.env.WAVEX_OS_STATE_DIR, "db", "pglite");
  return `${process.env.HOME}/.wavex-os/db/pglite`;
}

export async function getDb(): Promise<Db> {
  if (cached) return cached;
  const driver = getDbDriver();
  if (driver === "pg") {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("WAVEX_DB_DRIVER=pg requires DATABASE_URL");
    const client = postgres(url, { max: 10 });
    cachedClient = { close: () => client.end() };
    cached = drizzlePostgres(client, { schema });
    return cached;
  }
  const dir = getDataDir();
  // Auto-create the pglite data dir so first-call doesn't ENOENT.
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  cachedClient = { close: () => (client.closed ? Promise.resolve() : client.close()) };
  cached = drizzlePglite(client, { schema });
  return cached;
}

/** Shut the cached driver down and drop it, so getDb() re-resolves.
 *
 *  This is the ONLY safe way to stop pointing at a data directory. PGlite
 *  runs Postgres on an emscripten filesystem whose backing store is the
 *  data dir; the instance keeps that dir open and keeps writing to it long
 *  after the last awaited query resolves. Dropping the JS reference does
 *  not stop that — deleting the directory under a live instance surfaces
 *  as an unhandled `ErrnoError { errno: 44 }` (emscripten's ENOENT) with no
 *  stack and no message, attributed to whichever test happens to be in
 *  flight. Await this before removing the directory. */
export async function closeDb(): Promise<void> {
  const client = cachedClient;
  cached = undefined;
  cachedClient = undefined;
  if (client) await client.close();
}

/** Test-only: drop the cached instance so getDb() re-resolves.
 *
 *  Does NOT close the driver — see {@link closeDb}. Safe only when the data
 *  directory outlives the process (the default `~/.wavex-os` root). If the
 *  data dir is a temp dir you are about to delete, `await closeDb()`
 *  instead. */
export function _resetDbCache(): void {
  cached = undefined;
  cachedClient = undefined;
}
