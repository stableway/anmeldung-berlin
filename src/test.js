const { test: base } = require("@playwright/test");

module.exports = base.extend({
  context: [
    async ({ playwright, browserName }, use) => {
      const context = await playwright[browserName].launchPersistentContext("");
      await context.addInitScript({ path: "stealth.min.js" });
      await use(context);
    },
    { scope: "test" },
  ],
  page: [
    async ({ context }, use) => {
      await use(context.pages()[0]);
    },
    { scope: "test" },
  ],
});
