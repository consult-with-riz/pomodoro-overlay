import { defineConfig, devices } from "@playwright/test";

/**
 * The static server mirrors Next's public/ mapping, so the test page requests
 * /fonts/... exactly as the real app does. The core bundle is rebuilt before
 * the run rather than being a committed artefact that can drift from src/.
 */
const PORT = 4173;
const APP_PORT = 4302;

/** Stand-in for a Stripe Payment Link; never opened, only inspected. */
export const TIP_URL = "https://donate.stripe.test/test-link";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Encoding needs the real Chrome codec set, not the headless shell's.
        channel: "chromium",
      },
    },
  ],

  webServer: [
    {
      // Static server for the isolated core tests (goldens and encoding).
      command: `node scripts/build-test-bundle.mjs && node scripts/serve.mjs ${PORT}`,
      url: `http://127.0.0.1:${PORT}/tests/core-page.html`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // The real app, for the smoke tests. Built first so these run against
      // production output rather than dev-mode behaviour.
      //
      // The tip URL is set here because NEXT_PUBLIC_* is inlined at build
      // time: without it the support links compile out entirely and none of
      // their behaviour can be tested.
      command:
        `NEXT_PUBLIC_TIP_URL=${TIP_URL} npx next build && npx next start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
