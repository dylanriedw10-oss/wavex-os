/** Wait for the API — and its DATABASE — before any test runs.
 *
 *  Playwright's `webServer.url` only polls the Vite dev server on 5173, and
 *  Vite is ready in about a second. The API on 3101 boots much more slowly —
 *  it opens the database and starts its background schedulers first — so
 *  without this gate the first specs navigate to a page whose every fetch is
 *  still hitting a dead port, and they fail as "element not found" while the
 *  UI sits on "loading…".
 *
 *  TWO gates, because one is not enough and the difference was costing a
 *  test on every run. `/health` is `async () => ({ status: "ok" })` — a
 *  literal, with no database access anywhere in it. Fastify answers it the
 *  instant the port is bound, while PGlite is still booting its WASM
 *  Postgres and applying migrations. Measured on this machine: the port
 *  opens in ~0.6s and `/health` answers immediately, but the first
 *  DB-touching request takes ~10s. `dashboard.spec.ts` seeds in `beforeAll`
 *  and paid that cost against Playwright's 15s request timeout — under a
 *  parallel Vite build and a browser launch it lost the race, and the first
 *  test of the run failed while every later test passed.
 *
 *  So gate 1 proves the process is listening and gate 2 proves the database
 *  actually answers. `/api/users/me` is the probe because it is parameterless
 *  and upsert-on-read: reaching a row proves the connection is open AND that
 *  migrations have been applied, which is the failure this repo has already
 *  been bitten by (four migrations missing from the drizzle journal made
 *  every users query 500). It writes one row for `local-operator` into a
 *  throwaway per-run state dir.
 *
 *  One poll loop here is cheaper than a retry in every spec. */

const API = process.env.WAVEX_E2E_API_URL ?? "http://127.0.0.1:3101";
const DEADLINE_MS = 120_000;

async function poll(label: string, path: string, started: number): Promise<void> {
  let lastError = "";
  while (Date.now() - started < DEADLINE_MS) {
    try {
      const r = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(15_000) });
      if (r.ok) {
        console.log(`[e2e] ${label} ready after ${Math.round((Date.now() - started) / 1000)}s`);
        return;
      }
      lastError = `HTTP ${r.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(
    `[e2e] ${label} at ${API}${path} never became ready in ${DEADLINE_MS / 1000}s (last: ${lastError})`,
  );
}

export default async function waitForApi(): Promise<void> {
  const started = Date.now();
  await poll("API", "/health", started);
  // The one that actually matters: a request that opens the database.
  await poll("DB", "/api/users/me", started);
}
