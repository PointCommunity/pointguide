import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://127.0.0.1:3100/api/healthz",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_MODE: "fixture",
      FIXTURE_AUTH_SUBJECT: "e2e-owner",
      FIXTURE_AUTH_EMAIL: "owner@pointguide.test",
      FIXTURE_AUTH_NAME: "E2E Owner",
    },
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium", channel: "chrome" } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], browserName: "chromium", channel: "chrome" } },
  ],
});
