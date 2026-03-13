/**
 * playwright.config.js — Configuration Playwright pour LaRuche
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.spec.js",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["line"],
    ["html", { outputFolder: "test-results/playwright", open: "never" }],
  ],
  timeout: 30000,
  use: {
    baseURL: process.env.DASHBOARD_URL || "http://localhost:8080",
    headless: true,
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
