import { defineConfig, devices } from "@playwright/test";

const PORT = 4331;
/** Scratch workspace for browser tests. Inside the repo (required) and gitignored. */
export const E2E_WORKSPACE = ".motion-studio/tmp/e2e/projects";

export default defineConfig({
  testDir: "e2e",
  // Tests share one workspace on disk, so run them in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // --ignore-lock keeps `astro dev` in the foreground and independent of any running studio.
    command: `pnpm --filter @motion-studio/studio exec astro dev --ignore-lock --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { MOTION_STUDIO_WORKSPACE: E2E_WORKSPACE, ASTRO_TELEMETRY_DISABLED: "1" },
  },
});
