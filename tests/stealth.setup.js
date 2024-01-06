const { test: setup } = require("@playwright/test");

setup("init stealth", async ({ context }) => {
  await context.addInitScript("stealth.min.js");
});
