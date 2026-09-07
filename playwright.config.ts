import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
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
    { name: "mobile-320", use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 800 }, browserName: "chromium", channel: "chrome" } },
    { name: "mobile-390", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, browserName: "chromium", channel: "chrome" } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, browserName: "chromium", channel: "chrome" } },
    { name: "desktop-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 }, browserName: "chromium", channel: "chrome" } },
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, browserName: "chromium", channel: "chrome" } },
  ],
});
