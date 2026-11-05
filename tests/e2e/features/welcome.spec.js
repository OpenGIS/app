import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { readStoredState } from "../helpers/storage.js";
import { AFTER_CLOSE } from "../helpers/motion.js";

/**
 * One-time welcome card: shown on a first visit, dismissed with Continue, and
 * never shown again on this device.
 */

test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

// The shared test fixture seeds the card as seen; a first visit has no value.
// Page init scripts run after the context's, so removing the key here wins.
const asFirstVisit = (page) =>
  page.addInitScript(() => {
    if (!sessionStorage.getItem("welcome-spec-booted")) {
      localStorage.removeItem("ogis_welcome_app");
      sessionStorage.setItem("welcome-spec-booted", "1");
    }
  });

test("a first visit shows the welcome card and Continue dismisses it for good", async ({
  page,
}) => {
  await asFirstVisit(page);
  await page.goto("/");

  const card = page.getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Find your way, anywhere");

  await page.locator("#welcome-continue").click();
  await expect(card).toBeHidden(AFTER_CLOSE);

  const stored = await page.evaluate(() =>
    localStorage.getItem("ogis_welcome_app"),
  );
  expect(readStoredState(stored)).toEqual({ seen: true });

  // A reload keeps it dismissed.
  await page.reload();
  await expect(page.locator("#menu-button")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
