import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady, openMenuTab } from "../helpers/panel";
import { projectionType } from "../helpers/mapProjection.js";
import {
  LOCATE_FIX as FIX,
  expectedHashRegExp,
  orientHash,
  waitForCameraSettle,
  withGrantedLocateStorage as withGrantedStorage,
  withNoLocateStorage,
} from "../helpers/locate.js";
import { DEMO } from "../../fixtures/demo.mjs";

/**
 * Tests for docs/guide/features/locate.md
 *
 * Covers the Locate button states, permission flow modals, and map marker.
 */

// Locate's post-activation orientation flight lands at the viewport-fitted
// horizon-disc zoom (≈z12 on the desktop viewport) with terrain/hillshade. A
// FULL tile-render settle (`data-map-idle`) there is prohibitively slow under
// SwiftShader + load, but no assertion here inspects a rendered tile set. The
// cold-load waits use the cheap app-ready signal (`data-map-ready`, see
// waitForMapReady), and the move guards below wait at the moveend / URL-hash
// level (see waitForCameraSettle).

// Ceiling for element/state/URL assertions. They are driven by synchronous app
// state and the moveend hash write (no tile render), so they resolve in seconds.
const LOCATE_TIMEOUT = 60000;

// Multi-wait/multi-load tests do at most one cold-load boot wait plus camera
// settles; the file budget covers that with headroom. Reduced from 900000 now
// that the per-test post-activation tile settles are no longer awaited.
test.setTimeout(420000);

// Assert a clean console for every test in this spec (see helpers/console.js).
test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

const grantGeolocation = (page, coords = FIX) =>
  page
    .context()
    .grantPermissions(["geolocation"])
    .then(() => page.context().setGeolocation(coords));

// The chip glyph is an inline SVG <use> pointing at the sprite symbol. Read the
// resolved reference, which normalises `href` and `xlink:href`, so the
// assertion tracks the rendered icon rather than the binding's attribute form.
// Poll so it tolerates the render tick that follows a mode change.
const expectLocateButtonIcon = async (page, name) => {
  const use = page.locator("#locate-button svg use");
  await expect(use).toHaveCount(1);
  await expect
    .poll(
      () =>
        use.evaluate(
          (el) =>
            el.href?.baseVal ??
            el.getAttribute("href") ??
            el.getAttribute("xlink:href"),
        ),
      { timeout: LOCATE_TIMEOUT },
    )
    .toBe(`#${name}`);
};

// ─── Locate / Button ──────────────────────────────────────────────────────────

test.describe("Locate / Button", () => {
  test.beforeEach(async ({ page }) => {
    await withNoLocateStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("locate chip is visible in the map corner controls", async ({
    page,
  }) => {
    await expect(page.locator("#locate-button")).toBeVisible();
  });

  test("locate button shows Locate label when inactive", async ({ page }) => {
    await expect(page.locator("#locate-button")).toContainText("Locate");
    await expectLocateButtonIcon(page, "position");
  });

  test("locate button is not in pressed state when inactive", async ({
    page,
  }) => {
    const btn = page.locator("#locate-button");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });
});

// ─── Locate / Hover capability ────────────────────────────────────────────────

/**
 * Hover styling is intentionally not used: the inactive chip keeps its resting
 * colour whether or not a pointer is over it, so its colour reflects follow
 * mode alone — consistently across pointer and touch devices. These tests pin
 * that contract on a hover-capable pointer and on a touch device.
 */

const chipColour = (page) =>
  page.locator("#locate-button").evaluate((el) => getComputedStyle(el).color);

test.describe("Locate / Hover capability", () => {
  test.beforeEach(async ({ page }) => {
    await withNoLocateStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("hovering the inactive chip does not change its colour (hover-capable)", async ({
    page,
  }) => {
    const btn = page.locator("#locate-button");
    // Precondition: the chip is inactive, so any tint could only come from :hover.
    await expect(btn).toHaveAttribute("aria-pressed", "false");

    const resting = await chipColour(page);
    await btn.hover();
    // The pointer really is over the chip, so any colour change can only come
    // from a :hover rule (not from a missing hover state).
    expect(await btn.evaluate((el) => el.matches(":hover"))).toBe(true);

    // Let the 0.15 s colour transition settle before reading; a mid-transition
    // value would otherwise mask a latched hover style.
    await page.waitForTimeout(400);
    expect(await chipColour(page)).toBe(resting);
  });
});

test.describe("Locate / Hover capability / touch device", () => {
  // A touch-only context reports no hover and a coarse pointer — the emulated
  // media override (`Emulation.setEmulatedMedia` features) is not honoured by
  // this Chromium build, and `hasTouch` drives the real media state.
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await withNoLocateStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("hovering the inactive chip does not change its colour (touch device)", async ({
    page,
  }) => {
    const btn = page.locator("#locate-button");
    await expect(btn).toHaveAttribute("aria-pressed", "false");

    // The emulation must actually apply before the assertion means anything.
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(
      true,
    );

    const resting = await chipColour(page);
    await btn.hover();
    // The pointer really is over the chip, so any colour change can only come
    // from the :hover rule (not from a missing hover state).
    expect(await btn.evaluate((el) => el.matches(":hover"))).toBe(true);

    // Let the colour transition settle before reading; a mid-transition value
    // would otherwise mask a latched hover style.
    await page.waitForTimeout(400);
    expect(await chipColour(page)).toBe(resting);
  });
});

// ─── Locate / Confirmation modal ─────────────────────────────────────────────

test.describe("Locate / Confirmation modal", () => {
  test.beforeEach(async ({ page }) => {
    await withNoLocateStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("confirmation modal appears on first click with no stored permission", async ({
    page,
  }) => {
    await page.locator("#locate-button").click();
    await expect(page.getByText("Trust")).toBeVisible();
  });

  test("confirmation modal body explains the permission request", async ({
    page,
  }) => {
    await page.locator("#locate-button").click();
    await expect(
      page.getByText(
        /Permission is required to access your current location and compass heading/,
      ),
    ).toBeVisible();
  });

  test("cancelling the confirmation modal keeps the button inactive", async ({
    page,
  }) => {
    await page.locator("#locate-button").click();
    await page.getByText("Cancel").click();
    await expect(page.getByText("Trust")).toBeHidden();
    await expect(page.locator("#locate-button")).toContainText("Locate");
  });

  test("confirming the modal starts location tracking", async ({ page }) => {
    await grantGeolocation(page);
    await page.locator("#locate-button").click();
    await expect(page.getByText("Trust")).toBeVisible();
    await page.getByRole("button", { name: "I Understand" }).click();
    await expect(page.getByText("Trust")).toBeHidden();
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
    await expect(page.getByText("Trust")).toBeHidden();
  });

  test("hovering the modal close control does not change its opacity", async ({
    page,
  }) => {
    await page.locator("#locate-button").click();
    const close = page.getByRole("dialog").locator(".btn-close");
    await expect(close).toBeVisible();

    // Precondition: the close control sits at its resting opacity, so any
    // change could only come from a :hover rule.
    const resting = await close.evaluate((el) => getComputedStyle(el).opacity);
    await close.hover();
    // The pointer really is over the control, so any change can only come from
    // a :hover rule (not from a missing hover state).
    expect(await close.evaluate((el) => el.matches(":hover"))).toBe(true);

    // No transition is declared on .btn-close; allow a frame for any style
    // change to apply before reading.
    await page.waitForTimeout(200);
    expect(await close.evaluate((el) => getComputedStyle(el).opacity)).toBe(
      resting,
    );
  });
});

// ─── Locate / Recordings integration ─────────────────────────────────────────

test.describe("Locate / Recordings integration", () => {
  test.beforeEach(async ({ page }) => {
    await withNoLocateStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
    // The record control lives inside the Recordings panel now.
    await openMenuTab(page, "Recordings");
  });

  test("starting a recording shows the confirmation modal when permission has not been granted", async ({
    page,
  }) => {
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Trust")).toBeVisible();
  });

  test("cancelling the confirmation from Recordings leaves the recording stopped", async ({
    page,
  }) => {
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Trust")).toBeVisible();
    await page.getByText("Cancel").click();
    await expect(page.getByText("Trust")).toBeHidden();
    // Still idle: the start control remains and no status badge is shown.
    await expect(page.locator("#recordings-start-button")).toBeVisible();
    await expect(page.locator(".ogis-menu-badge")).toBeHidden();
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
    await expectLocateButtonIcon(page, "position-unlocked");
  });

  test("button advances to Following on second click", async ({ page }) => {
    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    // Light: the first activation's orientation flight only needs the camera
    // to arrive (moveend/hash), not a full tile render.
    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
    await expectLocateButtonIcon(page, "position-locked");
  });

  test("button returns to Locate on third click", async ({ page }) => {
    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    // Second click → Following, then a third (stop). Wait for the button to
    // reflect Following before the stop click, and for the camera to arrive
    // (orientation flight — moveend/hash level, no tile render).
    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));
    await btn.click();
    await expect(btn).toContainText("Following", {
      timeout: LOCATE_TIMEOUT,
    });

    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });
    await expectLocateButtonIcon(page, "position");
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
    // arrive (orientation flight — moveend/hash level, no tile render).
    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));
    await btn.click();
    await expect(btn).toContainText("Following", {
      timeout: LOCATE_TIMEOUT,
    });

    await btn.click();
    await expect(marker).toHaveCount(0, { timeout: LOCATE_TIMEOUT });
  });
});

// ─── Locate / Orientation reset ──────────────────────────────────────────────

test.describe("Locate / Orientation reset", () => {
  test("map flies to the user's position fitted to the horizon disc on first fix", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();

    await expect(page.locator("#locate-button")).toContainText("Located", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect(page).toHaveURL(expectedHashRegExp(await orientHash(page)), {
      timeout: LOCATE_TIMEOUT,
    });
  });

  test("orientation flight keeps the globe projection", async ({ page }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);

    // Precondition: style.load applies the globe projection before the
    // app-ready signal. The live read returns the stylesheet specification,
    // e.g. { type: "globe" }.
    expect(await projectionType(page)).toBe("globe");

    await page.locator("#locate-button").click();

    await expect(page.locator("#locate-button")).toContainText("Located", {
      timeout: LOCATE_TIMEOUT,
    });
    // The camera has settled at the fitted, north-up view.
    await expect(page).toHaveURL(expectedHashRegExp(await orientHash(page)), {
      timeout: LOCATE_TIMEOUT,
    });

    // The flight is projection-neutral: the globe stays active throughout.
    await expect
      .poll(() => projectionType(page), { timeout: LOCATE_TIMEOUT })
      .toBe("globe");
  });

  test("orientation flight fires again when locate is re-activated after stopping", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");

    // First activation — the orientation flight refits the horizon disc.
    await btn.click();
    await expect(page).toHaveURL(expectedHashRegExp(await orientHash(page)), {
      timeout: LOCATE_TIMEOUT,
    });

    // Stop locate (active → following → inactive). The camera already
    // arrived (URL asserted above), so settle at the hash level — no tile
    // render wait, and the Following click below is not blocked by one.
    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });

    // Seed a stored view at zoom 10 in the NEXT document, then load a
    // HASH-LESS URL so that storage is actually applied. A hash survives a
    // reload and outranks storage, which would mask whether the re-activation
    // flight fired. Seeding via an init script keeps the write in the fresh
    // document: the previous page — including the still-running camera
    // animation from the Following click, whose programmatic moveend persists
    // the old fitted view — is already gone, so no late persist can clobber it.
    await page.addInitScript((center) => {
      const stored = JSON.parse(localStorage.getItem("ogis_view_app") || "{}");
      stored.mapView = { center, zoom: 10 };
      localStorage.setItem("ogis_view_app", JSON.stringify(stored));
    }, DEMO.center);
    await page.goto("/");
    await waitForMapReady(page);

    // Precondition: the map really is at the stored zoom 10 before the
    // re-activation, so a later fitted hash proves the flight fired again.
    await expect(page).toHaveURL(/#map=10\//, { timeout: LOCATE_TIMEOUT });
    await waitForCameraSettle(page, /#map=10\//);

    // Re-activate locate — the flight refits the horizon disc again.
    await btn.click();
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });
    await expect(page).toHaveURL(expectedHashRegExp(await orientHash(page)), {
      timeout: LOCATE_TIMEOUT,
    });
  });

  test("one-shot flight resets a user-rotated view to north-up", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);

    // Boot on a full 5-segment hash: a user-rotated view (pitch 45, bearing
    // 120) centred on the mocked fix position.
    const startHash = `#map=13/${FIX.latitude.toFixed(6)}/${FIX.longitude.toFixed(6)}/45/120`;
    await page.goto(`/${startHash}`);
    await waitForMapReady(page);

    // Precondition: the app applies the rotated view, so the flight really
    // starts from pitch/bearing rather than from north-up.
    await expect(page).toHaveURL(expectedHashRegExp(startHash));

    await page.locator("#locate-button").click();

    await expect(page.locator("#locate-button")).toContainText("Located", {
      timeout: LOCATE_TIMEOUT,
    });

    // The settled hash's trailing /0/0 proves the flight reset both pitch and
    // bearing, alongside the fitted zoom and the mocked fix position.
    await expect(page).toHaveURL(expectedHashRegExp(await orientHash(page)), {
      timeout: LOCATE_TIMEOUT,
    });
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
    await expect(page.getByText("Unable to Locate")).toBeVisible({
      timeout: LOCATE_TIMEOUT,
    });
  });

  test("error modal shows re-enable instructions", async ({ page }) => {
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();

    await expect(page.getByText("Unable to Locate")).toBeVisible({
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

    await expect(page.getByText("Unable to Locate")).toBeVisible({
      timeout: LOCATE_TIMEOUT,
    });

    await page.locator("#locate-error-close").click();
    await expect(page.getByText("Unable to Locate")).toBeHidden();
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
    await expect(page.getByText("Unable to Locate")).toBeHidden();

    await page.locator("#locate-button").click();
    await expect(page.getByText("Unable to Locate")).toBeVisible();
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
    await expect(page.getByText("Unable to Locate")).toBeHidden();

    // Locate button should exit error state
    await expect(page.locator("#locate-button")).not.toContainText("Error", {
      timeout: LOCATE_TIMEOUT,
    });
  });
});

// ─── Locate / French locale ──────────────────────────────────────────────────

test.describe("Locate / French locale", () => {
  // Same approach as the language tests in settings.spec.js: the browser
  // context advertises fr-FR, so the app resolves its locale to French.
  test.use({ locale: "fr-FR" });

  test("confirmation modal renders French text for a French browser locale", async ({
    page,
  }) => {
    await withNoLocateStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();

    // Scope the X button to this modal's own .btn-close. The error modal also
    // renders a visible "Fermer" footer button, so an unscoped role-name
    // lookup could match more than the X.
    const modal = page.locator(
      '.ogis-modal[aria-labelledby="locate-confirm-title"]',
    );

    await expect(page.locator("#locate-confirm-title")).toHaveText("Confiance");
    await expect(modal.locator(".modal-body")).toContainText(
      "Une autorisation est nécessaire pour accéder à votre position actuelle et au cap de la boussole. Votre position est utilisée uniquement sur cet appareil. Lorsque vous y êtes invité, veuillez autoriser les deux.",
    );
    await expect(modal.getByRole("button", { name: "Annuler" })).toHaveText(
      "Annuler",
    );
    await expect(page.locator("#locate-confirm-allow")).toHaveText(
      "Je comprends",
    );
    await expect(modal.locator(".btn-close")).toHaveAttribute(
      "aria-label",
      "Fermer",
    );
  });

  test("error modal renders French text when geolocation permission is denied", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    // Do NOT grant geolocation — denial triggers the error callback
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();

    const modal = page.locator(
      '.ogis-modal[aria-labelledby="locate-error-title"]',
    );

    await expect(page.locator("#locate-error-title")).toHaveText(
      "Localisation impossible",
      { timeout: LOCATE_TIMEOUT },
    );
    await expect(modal.locator(".modal-body")).toContainText(
      "L'application n'a pas pu obtenir votre localisation, peut-être en raison d'un refus d'autorisation préalable. Pour la réactiver, essayez :",
    );
    await expect(page.locator("#locate-error-retry")).toHaveText("Réessayer");
    await expect(page.locator("#locate-error-close")).toHaveText("Fermer");
    await expect(modal.locator(".btn-close")).toHaveAttribute(
      "aria-label",
      "Fermer",
    );
  });
});
