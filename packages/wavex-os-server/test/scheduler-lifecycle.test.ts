/** registerWavexOsRoutes() starts background jobs — the referral scheduler's
 *  startup run opens the database and migrates it. Those jobs must not
 *  outlive the app that started them.
 *
 *  When they did, `await app.close()` returned with a PGlite still live on
 *  the state directory. Every suite in this package then deleted its temp
 *  state dir in teardown, tearing the backing store out from under the
 *  running emscripten filesystem. That surfaced as an unhandled
 *  `ErrnoError { errno: 44 }` — emscripten's ENOENT — with no stack and no
 *  message, attributed to whichever test happened to be in flight. Seven of
 *  them, counted on vitest's `Errors` line rather than as test failures.
 *
 *  The assertions below are on the invariant, not the symptom: after
 *  `app.close()` the handle is CLOSED, not merely dereferenced. That
 *  distinction is the whole bug — `_resetDbCache()` drops the reference and
 *  leaves the instance running. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { closeDb, getDb, getDbDriver } from "@wavex-os/db";

/** The driver handle Drizzle wraps. PGlite exposes `closed`; postgres-js
 *  does not, so these assertions are pglite-only (the dev/test default). */
type PgliteHandle = { closed: boolean };
function handleOf(db: Awaited<ReturnType<typeof getDb>>): PgliteHandle {
  return (db as unknown as { $client: PgliteHandle }).$client;
}

let tempDir: string;
let app: FastifyInstance;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scheduler-lifecycle-test-"));
  process.env.WAVEX_OS_STATE_DIR = tempDir;
  process.env.PAPERCLIP_DATA_DIR = tempDir;
  process.env.WAVEX_AUTH_MODE = "dev";
  process.env.WAVEX_COMPOSIO_DISABLED = "1";
  process.env.WAVEX_DB_DATA_DIR = join(tempDir, "db");
});

afterEach(async () => {
  await closeDb();
  delete process.env.WAVEX_OS_STATE_DIR;
  delete process.env.PAPERCLIP_DATA_DIR;
  delete process.env.WAVEX_AUTH_MODE;
  delete process.env.WAVEX_COMPOSIO_DISABLED;
  delete process.env.WAVEX_DB_DATA_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("registerWavexOsRoutes background jobs are bound to the app", () => {
  it("app.close() shuts the database down, it does not merely forget it", async () => {
    expect(getDbDriver()).toBe("pglite");

    const { registerWavexOsRoutes } = await import("../src/index.js");
    app = Fastify({ logger: false });
    registerWavexOsRoutes(app);
    await app.ready();

    const opened = await getDb();
    const handle = handleOf(opened);
    expect(handle.closed).toBe(false);

    await app.close();

    // CLOSED — not dereferenced. `_resetDbCache()` leaves this false and the
    // emscripten filesystem still live on a directory the caller is about to
    // delete. If this assertion ever reads false again, errno 44 is back.
    expect(handle.closed).toBe(true);

    // …and the cache is clear, so the next getDb() re-resolves the data dir
    // instead of handing back a handle pointing at a deleted directory.
    const reopened = await getDb();
    expect(reopened).not.toBe(opened);
    expect(handleOf(reopened).closed).toBe(false);
  }, 60_000);

  it("deleting the state dir after close is quiet — nothing is still writing", async () => {
    const { registerWavexOsRoutes } = await import("../src/index.js");
    app = Fastify({ logger: false });
    registerWavexOsRoutes(app);
    await app.ready();

    const handle = handleOf(await getDb());
    await app.close();
    expect(handle.closed).toBe(true);

    // Safe now, and only now: no live filesystem is rooted here.
    rmSync(join(tempDir, "db"), { recursive: true, force: true });

    // Give any straggling async work a turn to blow up. Nothing should.
    await new Promise((r) => setTimeout(r, 250));
    expect(handle.closed).toBe(true);
  }, 60_000);
});
