const config = require("./config.json");
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  name: "chromium",
  testDir: './tests/',
  fullyParallel: false,
  concurrency: 1,
  forbidOnly: !!process.env.CI,
  retries: 10000,
  workers: undefined,
  timeout: 0,
  reporter: 'html',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: {
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: process.env.HEADLESS === "false" ? false : true,
        slowMo: config.debug ? 500 : undefined,
    },
    contextOptions: {
        bypassCSP: true,
        ignoreHTTPSErrors: true,
        proxy: process.env.PROXY_URL ? { server: process.env.PROXY_URL } : undefined,
    },
    actionTimeout: 10 * 1000,
    navigationTimeout: 60 * 1000,
  },
});