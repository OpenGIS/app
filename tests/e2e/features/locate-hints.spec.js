import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady } from "../helpers/panel";
import {
  LOCATE_FIX as FIX,
  expectedHashRegExp,
  orientHash,
  waitForCameraSettle,
  withGrantedLocateStorage,
} from "../helpers/locate.js";
import { readStoredState } from "../helpers/storage.js";

/**
 * Locate onboarding hints (docs/5.ui.md — Locate hints).
 *
 * The shared fixture disables hints for every other spec; this one opts back
 * in, then walks the chip through Locate → Located → Follow and checks the
 * once-only explanation for each state.
 */

const LOCATE_TIMEOUT = 60000;
const HINTS_KEY = "ogis_locate-hints_app";

test.setTimeout(240000);

test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

/**
 * Re-enable hints after the shared fixture's opt-out, and hold each one up
 * until the next state replaces it: SwiftShader frames are slow enough during
 * the locate flight that the normal 8 s display can lapse between assertions.
 */
const withHints = (page) =>
  page.addInitScript(() => {
    window.__ogisDisableHints = false;
    window.__ogisHintDurationMs = 10 * 60 * 1000;
  });

const hint = (page) => page.locator(".ogis-locate-hint");

// A replaced hint can linger in its leave transition on a slow renderer, so
// address each state's bubble by its key.
const hintFor = (page, key) =>
  page.locator(`.ogis-locate-hint[data-hint="${key}"]`);

test.describe("Locate / Hints", () => {
  test.beforeEach(async ({ page }) => {
    await withHints(page);
    await withGrantedLocateStorage(page);
    await page
      .context()
      .grantPermissions(["geolocation"])
      .then(() => page.context().setGeolocation(FIX));
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("explains each chip state once", async ({ page }) => {
    const btn = page.locator("#locate-button");

    await expect(hintFor(page, "idle")).toContainText("show where you are", {
      timeout: LOCATE_TIMEOUT,
    });

    await btn.click();
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });
    await expect(hintFor(page, "active")).toContainText("follow you", {
      timeout: LOCATE_TIMEOUT,
    });

    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));
    await btn.click();
    await expect(btn).toContainText("Follow", { timeout: LOCATE_TIMEOUT });
    await expect(hintFor(page, "following")).toContainText(
      "Tap again to stop",
      { timeout: LOCATE_TIMEOUT },
    );

    await expect
      .poll(
        async () => {
          const raw = await page.evaluate(
            (key) => localStorage.getItem(key),
            HINTS_KEY,
          );
          return raw === null ? null : [...readStoredState(raw).seen].sort();
        },
        { timeout: 5000 },
      )
      .toEqual(["active", "following", "idle"]);
  });

  test("the close button dismisses a hint and it does not return", async ({
    page,
  }) => {
    await expect(hint(page)).toBeVisible({ timeout: LOCATE_TIMEOUT });
    await hint(page).getByRole("button", { name: "Dismiss tip" }).click();
    await expect(hint(page)).toHaveCount(0, { timeout: LOCATE_TIMEOUT });

    // Let the debounced seen-write land, then reload.
    await page.waitForTimeout(600);
    await page.reload();
    await waitForMapReady(page);
    await page.waitForTimeout(2500);
    await expect(hint(page)).toHaveCount(0);
  });
});
