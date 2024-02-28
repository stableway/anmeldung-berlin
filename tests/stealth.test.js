const { expect } = require("@playwright/test");
const test = require("../src/test");

test.describe("stealth", () => {
  test.describe("SannySoft", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("https://bot.sannysoft.com");
    });
    test("has 20 passed tests", async ({ page }) => {
      const passed = page
        .locator("table > tr > td.passed")
        .filter({ hasText: "ok" });
      await expect(passed).toHaveCount(20);
    });
  });
});
