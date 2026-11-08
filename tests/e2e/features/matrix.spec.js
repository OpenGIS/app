import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady } from "../helpers/panel";

/** The Matrix showcase theme: always on, always dark, falling code in the panel. */

test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

test.describe("Matrix theme", () => {
  test.use({ colorScheme: "light" });

  test("is always dark, even when the device prefers light", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForMapReady(page);
    await expect(page.locator("html")).toHaveAttribute(
      "data-ogis-theme",
      "matrix",
    );
    await expect(page.locator("html")).toHaveAttribute("data-bs-theme", "dark");
  });

  test("draws falling code behind the side panel only", async ({ page }) => {
    await page.goto("/");
    await waitForMapReady(page);
    await expect(page.locator(".ogis-panel .ogis-matrix-rain")).toHaveCount(1);
    await expect(page.locator(".ogis-map .ogis-matrix-rain")).toHaveCount(0);
  });
});
