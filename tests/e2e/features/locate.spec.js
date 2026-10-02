import { test, expect } from "@playwright/test";

/**
 * Tests for docs/guide/features/locate.md
 *
 * Covers the Locate button states, permission flow modals, and map marker.
 */

// Locate's post-activation fly-to lands at z16 with terrain/hillshade. Under
// SwiftShader + load its FULL tile-render settle (`data-map-idle`) has been
// measured at ~246–275 s, but no assertion here inspects a rendered tile set.
// The cold-load waits use the cheap app-ready signal (`data-map-ready`, see
// waitForMapReady), and the move guards below wait at the moveend / URL-hash
// level (see waitForCameraSettle).

// Per-wait ceiling for the light camera-settle waits. The camera should arrive
// in seconds; this is a generous backstop, not an expected duration.
const CAMERA_SETTLE_TIMEOUT = 30000;

// Ceiling for element/state/URL assertions. They are driven by synchronous app
// state and the moveend hash write (no tile render), so they resolve in seconds.
const LOCATE_TIMEOUT = 60000;

// Multi-wait/multi-load tests do at most one cold-load boot wait plus camera
// settles; the file budget covers that with headroom. Reduced from 900000 now
// that the per-test post-activation tile settles are no longer awaited.
test.setTimeout(420000);

const withNoLocateStorage = (page) =>
  page.addInitScript(() => {
    localStorage.removeItem("ogis_locate_app");
    localStorage.removeItem("ogis_view_app");
  });

const withGrantedStorage = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      "ogis_locate_app",
      JSON.stringify({ permissionGranted: true }),
    );
    // Seed view storage so the About modal doesn't appear
    localStorage.setItem(
      "ogis_view_app",
      JSON.stringify({
        mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 10 },
      }),
    );
  });

const grantGeolocation = (
  page,
  coords = { latitude: 50.6539, longitude: -128.0094 },
) =>
  page
    .context()
    .grantPermissions(["geolocation"])
    .then(() => page.context().setGeolocation(coords));

/**
 * Dismiss the About modal if it appears (first-load state). The bounded visible
 * wait avoids racing the first render; if it never appears, this is a no-op.
 */
const dismissAboutModal = async (page) => {
  const modal = page.locator("#about-modal");
  const appeared = await modal
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await page.locator("#about-modal-close").click();
    await modal.waitFor({ state: "hidden" });
  }
};

/**
 * Cold-load wait: the chrome is mounted, the map's style is loaded and its
 * instance published (`data-map-ready`), and the side panel's Bootstrap show
 * transition has settled. Cheap and deterministic — no network wait and no map
 * render settle.
 */
const waitForMapReady = async (page) => {
  await page.locator("#menu-button").waitFor({ state: "visible" });
  // `data-map-ready` is set by useMap when the style has loaded and the map
  // instance is published (the app's own `map:ready` point), so features are
  // wired up and the map is usable. Unlike MapLibre's render-bound `load`
  // event (~26 s under SwiftShader) or the full `data-map-idle` settle, this
  // is cheap and deterministic.
  await expect(page.locator(".ogis-map")).toHaveAttribute(
    "data-map-ready",
    "true",
    { timeout: 30000 },
  );
  // Bootstrap auto-shows the .offcanvas on window load and holds it in a
  // `showing` state until its transition completes; its queued callback
  // re-adds `show`, so interacting mid-transition corrupts panel state.
  await expect(page.locator(".ogis-panel")).not.toHaveClass(/showing|hiding/);
};

/**
 * Light wait: the camera has ARRIVED, without waiting for every tile to render.
 *
 * `useMap.js` writes the URL hash on MapLibre `moveend`, so matching the
 * EXPECTED hash proves the camera has settled. Anchoring on the expected value
 * (rather than generic hash stability) is what makes this race-safe: while a
 * fly/pan is pending the pre-move hash differs from `expectedHash`, so the wait
 * cannot resolve early even when it is called immediately after the click that
 * triggers the move; if the hash already matches, the move has already
 * completed and resolving at once is correct.
 *
 * `expect.poll` is used rather than `page.waitForURL` because the app updates
 * the hash with `history.replaceState` (a same-document update).
 *
 * @param {import('@playwright/test').Page} page
 * @param {RegExp} expectedHash - hash the camera must reach, e.g. /#map=16\//
 * @param {number} [timeout]
 */
const waitForCameraSettle = async (
  page,
  expectedHash,
  timeout = CAMERA_SETTLE_TIMEOUT,
) => {
  await expect
    .poll(() => page.url(), {
      timeout,
      message: `camera did not settle to ${expectedHash}`,
    })
    .toMatch(expectedHash);
};

// ─── Locate / Button ──────────────────────────────────────────────────────────

test.describe("Locate / Button", () => {
  test.beforeEach(async ({ page }) => {
    await withNoLocateStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
    await dismissAboutModal(page);
  });

  test("locate chip is visible in the map corner controls", async ({
    page,
  }) => {
    await expect(page.locator("#locate-button")).toBeVisible();
  });

  test("locate button shows Locate label when inactive", async ({ page }) => {
    await expect(page.locator("#locate-button")).toContainText("Locate");
  });

  test("locate button is not in pressed state when inactive", async ({
    page,
  }) => {
    const btn = page.locator("#locate-button");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });
});

// ─── Locate / Confirmation modal ─────────────────────────────────────────────

test.describe("Locate / Confirmation modal", () => {
  test.beforeEach(async ({ page }) => {
    await withNoLocateStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
    await dismissAboutModal(page);
  });

  test("confirmation modal appears on first click with no stored permission", async ({
    page,
  }) => {
    await page.locator("#locate-button").click();
    await expect(page.getByText("Permission Required")).toBeVisible();
  });

  test("confirmation modal body explains the permission request", async ({
    page,
  }) => {
    await page.locator("#locate-button").click();
    await expect(
      page.getByText(/To display your current location and compass heading/),
    ).toBeVisible();
  });

  test("cancelling the confirmation modal keeps the button inactive", async ({
    page,
  }) => {
    await page.locator("#locate-button").click();
    await page.getByText("Cancel").click();
    await expect(page.getByText("Permission Required")).toBeHidden();
    await expect(page.locator("#locate-button")).toContainText("Locate");
  });

  test("confirming the modal starts location tracking", async ({ page }) => {
    await grantGeolocation(page);
    await page.locator("#locate-button").click();
    await expect(page.getByText("Permission Required")).toBeVisible();
    await page.getByRole("button", { name: "I Understand" }).click();
    await expect(page.getByText("Permission Required")).toBeHidden();
    await expect(page.locator("#locate-button")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: LOCATE_TIMEOUT },
    );
  });

  test("confirmation modal is not shown when permission was previously granted", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();
    await expect(page.getByText("Permission Required")).toBeHidden();
  });
});

// ─── Locate / Recordings integration ─────────────────────────────────────────

test.describe("Locate / Recordings integration", () => {
  test.beforeEach(async ({ page }) => {
    await withNoLocateStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
    await dismissAboutModal(page);
  });

  test("starting a recording shows the confirmation modal when permission has not been granted", async ({
    page,
  }) => {
    // Open Recordings panel and click Record
    await page.locator("#recordings-button").click();
    await expect(page.getByText("Permission Required")).toBeVisible();
  });

  test("cancelling the confirmation from Recordings leaves the recording stopped", async ({
    page,
  }) => {
    await page.locator("#recordings-button").click();
    await expect(page.getByText("Permission Required")).toBeVisible();
    await page.getByText("Cancel").click();
    await expect(page.getByText("Permission Required")).toBeHidden();
    // Recording should not have started
    await expect(page.locator("#recordings-button")).not.toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

// ─── Locate / Active and Following states ────────────────────────────────────

test.describe("Locate / Active and Following states", () => {
  test.beforeEach(async ({ page }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("button shows Located label after location is acquired", async ({
    page,
  }) => {
    await page.locator("#locate-button").click();
    await expect(page.locator("#locate-button")).toContainText("Located", {
      timeout: LOCATE_TIMEOUT,
    });
  });

  test("button advances to Following on second click", async ({ page }) => {
    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    // Light: the first activation's fly-to z16 only needs the camera to
    // arrive (moveend/hash), not a full tile render.
    await waitForCameraSettle(page, /#map=16\//);
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
  });

  test("button returns to Locate on third click", async ({ page }) => {
    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    // Second click → Following, then a third (stop). Wait for the button to
    // reflect Following before the stop click, and for the camera to arrive
    // (fly-to z16 — moveend/hash level, no tile render).
    await waitForCameraSettle(page, /#map=16\//);
    await btn.click();
    await expect(btn).toContainText("Following", {
      timeout: LOCATE_TIMEOUT,
    });

    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });
  });

  test("position marker appears on the map when active", async ({ page }) => {
    await page.locator("#locate-button").click();
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBeGreaterThan(0);
  });

  test("position marker is removed when locate is stopped", async ({
    page,
  }) => {
    const btn = page.locator("#locate-button");
    const marker = page.locator(".ogis-locate-position");

    await btn.click();
    await expect
      .poll(() => marker.count(), { timeout: LOCATE_TIMEOUT })
      .toBeGreaterThan(0);

    // Second click → Following, then third (stop). Wait for the camera to
    // arrive (fly-to z16 — moveend/hash level, no tile render).
    await waitForCameraSettle(page, /#map=16\//);
    await btn.click();
    await expect(btn).toContainText("Following", {
      timeout: LOCATE_TIMEOUT,
    });

    await btn.click();
    await expect(marker).toHaveCount(0, { timeout: LOCATE_TIMEOUT });
  });
});

// ─── Locate / Initial zoom ───────────────────────────────────────────────────

test.describe("Locate / Initial zoom", () => {
  test("map flies to the user's position at zoom 16 on first fix", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page, { latitude: 50.6539, longitude: -128.0094 });
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();

    await expect(page.locator("#locate-button")).toContainText("Located", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect(page).toHaveURL(/#map=16\//, { timeout: LOCATE_TIMEOUT });
  });

  test("initial zoom fires again when locate is re-activated after stopping", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page, { latitude: 50.6539, longitude: -128.0094 });
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");

    // First activation — map flies to zoom 16
    await btn.click();
    await expect(page).toHaveURL(/#map=16\//, { timeout: LOCATE_TIMEOUT });

    // Stop locate (active → following → inactive). The camera already
    // arrived at z16 (URL asserted above), so settle at the hash level — no
    // tile render wait, and the Following click below is not blocked by one.
    await waitForCameraSettle(page, /#map=16\//);
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });

    // Persist a stored view at zoom 10, then load a HASH-LESS URL so that
    // storage is actually applied. A hash survives a reload and outranks
    // storage, which would mask whether the re-activation zoom fired.
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("ogis_view_app") || "{}");
      stored.mapView = { center: { lat: 50.6539, lng: -128.0094 }, zoom: 10 };
      localStorage.setItem("ogis_view_app", JSON.stringify(stored));
    });
    await page.goto("/");
    await waitForMapReady(page);

    // Precondition: the map really is at the stored zoom 10 before the
    // re-activation, so a later #map=16 proves the initial zoom fired again.
    await expect(page).toHaveURL(/#map=10\//, { timeout: LOCATE_TIMEOUT });
    await waitForCameraSettle(page, /#map=10\//);

    // Re-activate locate — should zoom back to 16
    await btn.click();
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });
    await expect(page).toHaveURL(/#map=16\//, { timeout: LOCATE_TIMEOUT });
  });
});

// ─── Locate / Error state ─────────────────────────────────────────────────────

test.describe("Locate / Error state", () => {
  test("error modal appears when geolocation permission is denied", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    // Do NOT grant geolocation — denial triggers the error callback
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();

    await expect(page.locator("#locate-button")).toContainText("Error", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect(page.getByText("Location Permission Denied")).toBeVisible({
      timeout: LOCATE_TIMEOUT,
    });
  });

  test("error modal shows re-enable instructions", async ({ page }) => {
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();

    await expect(page.getByText("Location Permission Denied")).toBeVisible({
      timeout: LOCATE_TIMEOUT,
    });

    await expect(page.getByText(/Reloading this page/)).toBeVisible();
  });

  test("closing the error modal does not clear the error state", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();

    await expect(page.getByText("Location Permission Denied")).toBeVisible({
      timeout: LOCATE_TIMEOUT,
    });

    await page.locator("#locate-error-close").click();
    await expect(page.getByText("Location Permission Denied")).toBeHidden();
    await expect(page.locator("#locate-button")).toContainText("Error");
  });

  test("clicking the Error button re-opens the error modal", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();

    await expect(page.locator("#locate-error-close")).toBeVisible({
      timeout: LOCATE_TIMEOUT,
    });

    await page.locator("#locate-error-close").click();
    await expect(page.getByText("Location Permission Denied")).toBeHidden();

    await page.locator("#locate-button").click();
    await expect(page.getByText("Location Permission Denied")).toBeVisible();
  });
});

// ─── Locate / Heading marker ──────────────────────────────────────────────────

test.describe("Locate / Heading marker", () => {
  test("compass heading uses webkitCompassHeading when available (iOS)", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);

    // Simulate iOS: remove deviceorientationabsolute so code falls back to
    // deviceorientation, then provide webkitCompassHeading on the event.
    await page.addInitScript(() => {
      delete window.ondeviceorientationabsolute;
    });

    await page.goto("/");
    await waitForMapReady(page);

    // Start locate tracking
    await page.locator("#locate-button").click();
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBeGreaterThan(0);

    // Dispatch a deviceorientation event with webkitCompassHeading = 180.
    // The relative alpha is 0, which would incorrectly produce 0° bearing
    // if the code ignores webkitCompassHeading.
    await page.evaluate(() => {
      const event = new DeviceOrientationEvent("deviceorientation", {
        alpha: 0,
        beta: 0,
        gamma: 0,
      });
      Object.defineProperty(event, "webkitCompassHeading", {
        value: 180,
        writable: false,
      });
      window.dispatchEvent(event);
    });

    // The heading marker should appear and be rotated to ~180°, not 0°. Poll
    // the rotation directly (tolerating transient detach while the app syncs
    // position/heading) rather than a count-then-read, which is racy.
    const headingEl = page.locator(".ogis-locate-heading");
    const readRotation = () =>
      headingEl
        .evaluate((el) => {
          const transform = el.style.transform || "";
          const match = transform.match(/rotateZ\(([^)]+)deg\)/);
          return match ? parseFloat(match[1]) : null;
        })
        .catch(() => null);

    let rotation = null;
    await expect
      .poll(
        async () => {
          rotation = await readRotation();
          return rotation !== null && rotation > 90 && rotation < 270;
        },
        { timeout: LOCATE_TIMEOUT },
      )
      .toBe(true);

    // Should be 180°, not 0°. Allow some tolerance for smoothing.
    expect(rotation).not.toBeNull();
    expect(rotation).toBeGreaterThan(90);
    expect(rotation).toBeLessThan(270);
  });

  test("compass heading falls back to alpha for absolute events", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);

    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBeGreaterThan(0);

    // Dispatch an absolute orientation event (no webkitCompassHeading)
    // alpha=90, absolute=true → bearing should be (360-90)=270°
    await page.evaluate(() => {
      const event = new DeviceOrientationEvent("deviceorientationabsolute", {
        alpha: 90,
        beta: 0,
        gamma: 0,
        absolute: true,
      });
      window.dispatchEvent(event);
    });

    // Poll the rotation directly (tolerating transient detach while the app
    // syncs position/heading) rather than a count-then-read, which is racy.
    const headingEl = page.locator(".ogis-locate-heading");
    const readRotation = () =>
      headingEl
        .evaluate((el) => {
          const transform = el.style.transform || "";
          const match = transform.match(/rotateZ\(([^)]+)deg\)/);
          return match ? parseFloat(match[1]) : null;
        })
        .catch(() => null);

    let rotation = null;
    await expect
      .poll(
        async () => {
          rotation = await readRotation();
          return rotation !== null && rotation > 180 && rotation < 360;
        },
        { timeout: LOCATE_TIMEOUT },
      )
      .toBe(true);

    // (360 - 90) % 360 = 270°
    expect(rotation).not.toBeNull();
    expect(rotation).toBeGreaterThan(180);
    expect(rotation).toBeLessThan(360);
  });
});

// ─── Locate / Error modal retry ───────────────────────────────────────────────

test.describe("Locate / Error modal retry", () => {
  test("error modal shows a retry button that resets the error state", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    // Trigger error — no geolocation permission in context
    await page.locator("#locate-button").click();

    await expect(page.locator("#locate-error-retry")).toBeVisible({
      timeout: LOCATE_TIMEOUT,
    });

    // Grant geolocation so the retry attempt succeeds
    await grantGeolocation(page);

    await page.locator("#locate-error-retry").click();

    // Modal should close
    await expect(page.getByText("Location Permission Denied")).toBeHidden();

    // Locate button should exit error state
    await expect(page.locator("#locate-button")).not.toContainText("Error", {
      timeout: LOCATE_TIMEOUT,
    });
  });
});
