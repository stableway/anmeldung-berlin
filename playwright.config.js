const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  name: "anmeldung-berlin",
  testDir: "./tests/",
  retries: process.env.RETRIES ? parseInt(process.env.RETRIES, 10) : 0,
  timeout: (process.env.TIMEOUT_IN_SEC ? parseInt(process.env.TIMEOUT_IN_SEC, 10) : 0) * 1000,
  reporter: [["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    ignoreHTTPSErrors: true,
    bypassCSP: true,
    launchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    proxy: process.env.PROXY_URL
      ? { server: process.env.PROXY_URL }
      : undefined,
    actionTimeout: 10 * 1000,
    navigationTimeout: 60 * 1000,
  },
  projects: [
    {
      name: "appointment",
      testMatch: /appointment\.test\./,
    },
    {
      name: "stealth",
      testMatch: /stealth\.test\./,
    },
  ],
});
