const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  name: "chromium",
  testDir: './tests/',
  retries: 10_000,
  timeout: 0,
  reporter: 'html',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: {
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
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