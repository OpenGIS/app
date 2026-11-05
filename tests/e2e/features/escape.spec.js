import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady, openMenuPanel } from "../helpers/panel.js";
import { AFTER_CLOSE } from "../helpers/motion.js";

/**
 * Escape closes the top-most layer: an open pop-up first, then the side panel.
 */

test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

// The shared fixture seeds the welcome card as seen; drop the seed once so the
// card opens over the panel on this visit.
const asFirstVisit = (page) =>
  page.addInitScript(() => {
    if (!sessionStorage.getItem("escape-spec-booted")) {
      localStorage.removeItem("ogis_welcome_app");
      sessionStorage.setItem("escape-spec-booted", "1");
    }
  });

test("Escape closes the side panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForMapReady(page);
  await openMenuPanel(page);

  await page.keyboard.press("Escape");

  await expect(page.locator(".ogis-panel")).not.toHaveClass(/show/);
  await expect(page.locator(".offcanvas-backdrop")).toHaveCount(0, AFTER_CLOSE);
});

test("Escape closes an open pop-up before the panel", async ({ page }) => {
  await asFirstVisit(page);
  await page.goto("/");

  // Desktop boots with the Info pane open; the welcome card sits on top.
  const card = page.getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(page.locator(".ogis-panel")).toHaveClass(/show/);

  await page.keyboard.press("Escape");
  await expect(card).toBeHidden(AFTER_CLOSE);
  await expect(page.locator(".ogis-panel")).toHaveClass(/show/);

  await page.keyboard.press("Escape");
  await expect(page.locator(".ogis-panel")).not.toHaveClass(/show/);
});
