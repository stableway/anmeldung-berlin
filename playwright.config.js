const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/',
  timeout: 0,
  reporter: [['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    ignoreHTTPSErrors: true,
    bypassCSP: true,
    launchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    proxy: process.env.PROXY_URL ? { server: process.env.PROXY_URL } : undefined,
    actionTimeout: 10 * 1000,
    navigationTimeout: 60 * 1000,
  },
  projects: [
    {
      name: 'stealth',
      testMatch: /stealth\.setup\./,
    },
    {
      name: "appointment",
      testMatch: /appointment\.test\./,
      dependencies: ['stealth'],
    },
  ],
});