const { test } = require("@playwright/test");

module.exports = (defaultParams) => test.extend({
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
