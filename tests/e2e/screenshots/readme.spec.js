import { test } from "@playwright/test";

/**
 * README screenshot — assets/screenshots/app-preview.png
 *
 * Captures the app in desktop mode on initial load (first visit, panel open,
 * about modal visible) at the standard test view to use as the main
 * README preview image.
 */

// Standard test view — Port Hardy area, BC. z16 keeps the Esri/Mapterhorn
// raster sources on real imagery (z18 falls back to placeholder tiles here).
const TEST_HASH = "#map=16/50.653900/-128.009400";

test.use({ viewport: { width: 1280, height: 720 } });

test("README — desktop initial load", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("onrte_view_app"));
  await page.goto(`/${TEST_HASH}`);
  await page.waitForLoadState("networkidle");

  // Dismiss About modal (first-load) to reveal the panel and map
  await page.locator("#about-modal-close").click();
  await page.locator("#about-modal").waitFor({ state: "hidden" });

  // Wait for panel slide-in to complete
  await page.locator(".onrte-panel").waitFor({ state: "visible" });
  await page.waitForTimeout(400);

  await page.screenshot({
    path: "assets/screenshots/app-preview.png",
  });
});
