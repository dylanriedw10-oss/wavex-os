/** Wait for the API before any test runs.
 *
 *  Playwright's `webServer.url` only polls the Vite dev server on 5173,
 *  and Vite is ready in about a second. The API on 3101 boots much more
 *  slowly — it opens the database and starts its background schedulers
 *  first — so without this gate the first specs navigate to a page whose
 *  every fetch is still hitting a dead port, and they fail as "element
 *  not found" while the UI sits on "loading…".
 *
 *  One poll loop here is cheaper than a retry in every spec. */

const API = process.env.WAVEX_E2E_API_URL ?? "http://127.0.0.1:3101";
const DEADLINE_MS = 120_000;

export default async function waitForApi(): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < DEADLINE_MS) {
    try {
      const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2_000) });
      if (r.ok) {
        console.log(`[e2e] API ready after ${Math.round((Date.now() - started) / 1000)}s`);
        return;
      }
      lastError = `HTTP ${r.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`[e2e] API at ${API} never became ready in ${DEADLINE_MS / 1000}s (last: ${lastError})`);
}
