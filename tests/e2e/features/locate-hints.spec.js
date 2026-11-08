import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady } from "../helpers/panel";
import {
  LOCATE_FIX as FIX,
  dispatchIOSCompass,
  expectedHashRegExp,
  installGeolocationMock,
  orientHash,
  waitForCameraSettle,
  withGrantedLocateStorage,
  withIOSOrientationPermission,
  withLocateSession,
} from "../helpers/locate.js";
import { readStoredState } from "../helpers/storage.js";

/**
 * Locate onboarding hints (docs/5.ui.md — Locate hints).
 *
 * The shared fixture disables hints for every other spec; this one opts back
 * in, then walks the chip through Locate → Located → Following and checks the
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
    await expect(hintFor(page, "idle").getByRole("button")).toHaveCount(0);

    await btn.click();
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });
    await expect(hintFor(page, "active")).toContainText("follow you", {
      timeout: LOCATE_TIMEOUT,
    });

    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
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

  test("a hint shows once and does not return", async ({ page }) => {
    await expect(hint(page)).toBeVisible({ timeout: LOCATE_TIMEOUT });

    // Let the debounced seen-write land, then reload.
    await page.waitForTimeout(600);
    await page.reload();
    await waitForMapReady(page);
    await page.waitForTimeout(2500);
    await expect(hint(page)).toHaveCount(0);
  });
});

// ─── Locate / Hints / Restored heading ──────────────────────────────────────

// A recent Following session restored on iOS: the geolocation grant survives
// in storage, but the session-only orientation grant does not, so the compass
// starts pending until the next user gesture. These cases pin the hint that
// explains the pending compass.
const recentFollowingSession = {
  permissionGranted: true,
  mode: "following",
  lastFix: {
    lat: FIX.latitude,
    lng: FIX.longitude,
    accuracy: 12,
    heading: null,
    at: Date.now(),
  },
  ownerId: "dead-owner",
};

test.describe("Locate / Hints / Restored heading", () => {
  test.beforeEach(async ({ page }) => {
    await withHints(page);
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withIOSOrientationPermission(page);
    await withLocateSession(page, recentFollowingSession);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("shows the heading hint while the restored compass is pending", async ({
    page,
  }) => {
    const btn = page.locator("#locate-button");

    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
    await expect(hintFor(page, "heading")).toContainText("Compass is off", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect(hintFor(page, "following")).toHaveCount(0);

    // The chip tap is the repair gesture: it requests orientation permission
    // without leaving Following.
    await btn.click();
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(1);

    await expect(hintFor(page, "heading")).toHaveCount(0);
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });

    // `retryOrientation` attaches its listener only once the permission
    // promise settles, so retry the dispatch until the heading marker exists.
    await expect
      .poll(
        async () => {
          await dispatchIOSCompass(page, 90);
          return page.locator(".ogis-locate-heading").count();
        },
        { timeout: LOCATE_TIMEOUT },
      )
      .toBe(1);
  });

  test("does not repeat the heading hint after it has been seen", async ({
    page,
  }) => {
    await expect(hintFor(page, "heading")).toContainText("Compass is off", {
      timeout: LOCATE_TIMEOUT,
    });

    // Let the debounced seen-write land, then reload into the same session.
    await page.waitForTimeout(600);
    await page.reload();
    await waitForMapReady(page);

    // Cover the boot and change delays before asserting it stayed away. A
    // different hint may appear here; only the heading hint must not.
    await page.waitForTimeout(2500);
    await expect(hintFor(page, "heading")).toHaveCount(0);
  });
});

test.describe("Locate / Hints / Restored heading (non-iOS)", () => {
  test.beforeEach(async ({ page }) => {
    await withHints(page);
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withLocateSession(page, recentFollowingSession);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("does not show the heading hint without an orientation permission request", async ({
    page,
  }) => {
    const btn = page.locator("#locate-button");

    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
    await expect(hintFor(page, "heading")).toHaveCount(0);
    await expect(hintFor(page, "following")).toContainText(
      "Tap again to stop",
      { timeout: LOCATE_TIMEOUT },
    );
  });
});
