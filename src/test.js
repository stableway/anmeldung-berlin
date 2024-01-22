const { test } = require("@playwright/test");

module.exports = (defaultParams) =>
  test.extend({
    context: async ({ playwright, browserName }, use) => {
      const context = await playwright[browserName].launchPersistentContext("");
      await context.addInitScript({ path: "stealth.min.js" });
      await use(context);
    },
    page: async ({ context }, use) => {
      const page = await context.newPage();
      await use(page);
    },
    params: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const params = { ...defaultParams };
        for (let key in params) {
          if (process.env[key]) {
            params[key] = process.env[key];
          }
        }
        await use(params);
      },
      { option: true },
    ],
  });
