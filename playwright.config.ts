import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Each test run gets its own isolated state dir + db so the operator's
// real ~/.wavex-os/ is never touched. Vault master key is fixed so vault
// reads/writes are deterministic across runs.
//
// The dir is re-exported as WAVEX_E2E_STATE_DIR so specs that must seed
// files on disk (e2e/work.spec.ts writes a manifest fixture) hit the SAME
// root the webServer reads — workers re-import this config, and the ??
// chain keeps the runner's choice instead of minting a second tempdir.
const stateDir = process.env.WAVEX_OS_STATE_DIR
  ?? process.env.WAVEX_E2E_STATE_DIR
  ?? mkdtempSync(join(tmpdir(), "wavex-pw-"));
process.env.WAVEX_E2E_STATE_DIR = stateDir;

// WAVEX_E2E_FIXTURE_ENGINE=1 points the work engine at the canned fixture
// bin so run-cycle e2e never spawns a real model. Left unset, the work
// spec skips itself and everything else runs as before.
const repoRoot = dirname(fileURLToPath(import.meta.url));
const fixtureEngine = process.env.WAVEX_E2E_FIXTURE_ENGINE
  ? join(repoRoot, "packages/wavex-os-server/test/fixtures/fake-claude.sh")
  : null;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,           // single-state-dir → tests must run serially
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Containers with a pre-provisioned Chromium set PW_CHROMIUM to its
    // binary; unset (CI, laptops) keeps Playwright's own download.
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Vite answers on 5173 in ~1s; the API on 3101 needs far longer (db +
  // schedulers). globalSetup blocks until the API is actually up.
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    // NOT `pnpm dev` — that runs dev:everything, which reinstalls deps,
    // rebuilds the plugin, and boots Paperclip too. e2e needs exactly two
    // processes: the UI and the API.
    command: 'pnpm --parallel --filter "./packages/onboarding-ui" --filter "./packages/mock-core" dev',
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      WAVEX_OS_STATE_DIR: stateDir,
      PAPERCLIP_DATA_DIR: stateDir,
      WAVEX_DB_DATA_DIR: join(stateDir, "db"),
      WAVEX_AUTH_MODE: "dev",
      WAVEX_COMPOSIO_DISABLED: "1",
      CREDENTIAL_VAULT_MASTER_KEY: "0".repeat(64),
      // apikey mode is the one that RESPECTS a pre-set WAVEX_OS_CLAUDE_BIN —
      // oauth mode always re-points it at the spawn shim (real claude CLI),
      // which would hang the fixture-engine run for 120s per task.
      ...(fixtureEngine ? { WAVEX_OS_CLAUDE_BIN: fixtureEngine, WAVEX_INFERENCE_MODE: "apikey" } : {}),
    },
  },
});
