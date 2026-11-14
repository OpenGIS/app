import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady } from "../helpers/panel";
import { projectionType } from "../helpers/mapProjection.js";
import {
  LOCATE_FIX as FIX,
  dispatchCompass,
  dispatchIOSCompass,
  dispatchNullCompassReading,
  emitFix,
  emitGeoError,
  expectedHashRegExp,
  installGeolocationMock,
  orientHash,
  resolveIOSOrientationPermission,
  startIOSCompassStream,
  stopIOSCompassStream,
  tapMap,
  waitForCameraSettle,
  withAppleWebKitPromptPermission,
  withCompassCapability,
  withCompassProbeTimeout,
  withDelayedPermissionQuery,
  withDesktopChromeOrientationPermission,
  withGrantedLocateStorage as withGrantedStorage,
  withHangingIOSOrientationPermission,
  withHangingPermissionQuery,
  withIOSOrientationPermission,
  withNoLocateStorage,
} from "../helpers/locate.js";
import { readStoredState } from "../helpers/storage.js";
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

// Publish the shared demo fix through the geolocation stub once the watcher is
// registered. The chip shows "Locating…" until this lands.
const emitDemoFix = async (page) => {
  await expect
    .poll(() => page.evaluate(() => window.__geo.count()), {
      timeout: LOCATE_TIMEOUT,
    })
    .toBeGreaterThan(0);
  await emitFix(page, { lat: FIX.latitude, lng: FIX.longitude });
};

// Re-enable the once-only onboarding hints (the shared fixture disables them)
// and hold each one up so a slow renderer cannot fade it mid-assertion.
const withLocateHints = (page) =>
  page.addInitScript(() => {
    window.__ogisDisableHints = false;
    window.__ogisHintDurationMs = 10 * 60 * 1000;
  });

const HINTS_KEY = "ogis_locate-hints_app";

const hintFor = (page, key) =>
  page.locator(`.ogis-locate-hint[data-hint="${key}"]`);

const seenHints = async (page) => {
  const raw = await page.evaluate(
    (key) => localStorage.getItem(key),
    HINTS_KEY,
  );
  return raw ? (readStoredState(raw)?.seen ?? []) : [];
};

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
    await page.getByRole("button", { name: "I understand" }).click();
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
    const close = page.getByRole("dialog").locator(".ogis-modal-close");
    await expect(close).toBeVisible();

    // Precondition: the close control sits at its resting opacity, so any
    // change could only come from a :hover rule.
    const resting = await close.evaluate((el) => getComputedStyle(el).opacity);
    await close.hover();
    // The pointer really is over the control, so any change can only come from
    // a :hover rule (not from a missing hover state).
    expect(await close.evaluate((el) => el.matches(":hover"))).toBe(true);

    // No transition is declared on .ogis-modal-close; allow a frame for any
    // style change to apply before reading.
    await page.waitForTimeout(200);
    expect(await close.evaluate((el) => getComputedStyle(el).opacity)).toBe(
      resting,
    );
  });
});

// ─── Locate / Active and Following states ────────────────────────────────────

test.describe("Locate / Active and Following states", () => {
  test.beforeEach(async ({ page }) => {
    await withGrantedStorage(page);
    // A capable device offers Following; the no-compass gate has its own cases.
    await withCompassCapability(page, true);
    await installGeolocationMock(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("button shows Located label after location is acquired", async ({
    page,
  }) => {
    await page.locator("#locate-button").click();
    // No fix yet: the chip reports progress and keeps the plain position icon.
    await expect(page.locator("#locate-button")).toContainText("Locating…", {
      timeout: LOCATE_TIMEOUT,
    });
    await expectLocateButtonIcon(page, "position");

    await emitDemoFix(page);
    await expect(page.locator("#locate-button")).toContainText("Located", {
      timeout: LOCATE_TIMEOUT,
    });
    await expectLocateButtonIcon(page, "position-unlocked");
  });

  test("button advances to Following on second click", async ({ page }) => {
    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(btn).toContainText("Locating…", {
      timeout: LOCATE_TIMEOUT,
    });
    await emitDemoFix(page);
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
    await expect(btn).toContainText("Locating…", {
      timeout: LOCATE_TIMEOUT,
    });
    await emitDemoFix(page);
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
    await emitDemoFix(page);
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
    await emitDemoFix(page);
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

// ─── Locate / Following without a compass heading ───────────────────────────

test.describe("Locate / Following without a heading", () => {
  test.beforeEach(async ({ page }) => {
    await withGrantedStorage(page);
    // A capable device offers Following even before any heading arrives.
    await withCompassCapability(page, true);
    await installGeolocationMock(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("a position fix retargets the following camera without a compass heading", async ({
    page,
  }) => {
    const btn = page.locator("#locate-button");

    await btn.click();
    await expect(btn).toContainText("Locating…", { timeout: LOCATE_TIMEOUT });
    await emitDemoFix(page);
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });
    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));

    // Follow is offered from hardware capability alone. No compass event has
    // been dispatched, so the driver starts flat and north-up.
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
    await expect
      .poll(async () => Math.abs(await mapPitch(page)), {
        timeout: LOCATE_TIMEOUT,
        message: "following camera did not start flat without a heading",
      })
      .toBeLessThan(1);
    await expect
      .poll(async () => bearingDifference(await mapBearing(page), 0), {
        timeout: LOCATE_TIMEOUT,
        message: "following camera did not start north-up without a heading",
      })
      .toBeLessThan(1);
    await expect
      .poll(async () => Math.abs((await mapZoom(page)) - 17), {
        timeout: LOCATE_TIMEOUT,
        message: "following camera did not reach the navigation rest zoom",
      })
      .toBeLessThan(0.5);

    const initialCentre = await mapCentre(page);
    const movedFix = {
      lat: FIX.latitude + 0.001,
      lng: FIX.longitude + 0.001,
    };
    expect(
      Math.hypot(
        initialCentre.lat - movedFix.lat,
        initialCentre.lng - movedFix.lng,
      ),
    ).toBeGreaterThan(0.0005);

    // A single moved fix with no compass event must drive a genuine camera
    // move. Speed 0 keeps the pose on the raw fix (no drift, and no look-ahead
    // while flat), so proximity to the new fix proves the per-fix feed.
    await emitFix(page, { ...movedFix, speed: 0 });
    await expect
      .poll(
        async () => {
          const centre = await mapCentre(page);
          return Math.hypot(
            centre.lat - movedFix.lat,
            centre.lng - movedFix.lng,
          );
        },
        {
          timeout: LOCATE_TIMEOUT,
          message: "following camera did not follow the moved position fix",
        },
      )
      .toBeLessThan(1e-4);
    await expect
      .poll(async () => Math.abs((await mapZoom(page)) - 17), {
        timeout: LOCATE_TIMEOUT,
        message: "following camera left the navigation rest zoom on the fix",
      })
      .toBeLessThan(0.5);
  });
});

// ─── Locate / Compass capability gate ───────────────────────────────────────

/**
 * Follow is compass-only, so a device without usable compass hardware is never
 * offered it. The probe is optimistic while it settles, which also means a user
 * can enter Following during that window; these cases pin both the outright
 * refusal and the late downgrade.
 */
test.describe("Locate / Compass capability gate", () => {
  test("an incapable device stops on the second tap instead of entering Following", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await withCompassCapability(page, false);
    await installGeolocationMock(page);
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(btn).toContainText("Locating…", { timeout: LOCATE_TIMEOUT });
    await emitDemoFix(page);
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    // The second tap must not enter Following: with no usable compass the chip
    // stops tracking instead.
    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });
    await expect(btn).toHaveAttribute("aria-pressed", "false");

    expect((await readLocate(page)).mode).toBeNull();
    expect(await readActiveModes(page)).not.toContain("follow");
    expect((await readLocateStorage(page))?.mode ?? null).toBeNull();
    expect(await page.evaluate(() => window.__geo.count())).toBe(0);
  });

  test("a late incapable probe downgrades Following to Located and keeps tracking", async ({
    page,
  }) => {
    await withLocateHints(page);
    await withGrantedStorage(page);
    // Hold the probe open far beyond any CI boot or interaction delay so
    // Following can be entered while capability is still optimistically
    // unknown. The window is not a timer to wait out: the controlled null
    // reading below settles the probe exactly when the spec chooses.
    await withCompassProbeTimeout(page, 600000);
    await installGeolocationMock(page);
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(btn).toContainText("Locating…", { timeout: LOCATE_TIMEOUT });
    await emitDemoFix(page);
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    // Precondition: the probe has not settled yet.
    expect((await readLocate(page)).compassCapability).toBe("unknown");

    // Enter Following straight away; the follow camera cancels the in-flight
    // orientation flight, so no settle wait is needed and the probe stays open.
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    expect((await readLocate(page)).mode).toBe("following");

    // With no heading the chase starts flat and north-up.
    await expect
      .poll(async () => Math.abs(await mapPitch(page)), {
        timeout: LOCATE_TIMEOUT,
        message: "following camera did not start flat without a heading",
      })
      .toBeLessThan(1);

    // The controlled null reading settles the probe incapable. The helper
    // proves capability was still unknown immediately before the dispatch, so
    // the null-event grace — not the probe timeout — decides. The chip must
    // then leave Following for Located, persist `active`, release the follow
    // camera and keep watching.
    expect(await dispatchNullCompassReading(page)).toBe("unknown");
    await expect
      .poll(async () => (await readLocate(page)).mode, {
        timeout: 30000,
        message: "late incapable probe did not leave Following",
      })
      .toBe("active");
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });
    // Located stays an active session, so the chip remains pressed.
    await expect(btn).toHaveAttribute("aria-pressed", "true");

    expect(await readActiveModes(page)).not.toContain("follow");
    // The camera itself must have released the follow mode, not just the chip.
    expect(await readFollowActive(page)).toBe(false);
    // A downgrade is not a heading loss: no recovery flag and no hint. Hints
    // are live here, so past the change delay the dismissed bubble proves the
    // suppression rather than the shared fixture disabling hints.
    expect((await readLocate(page)).headingRecoveryPending).toBe(false);
    await page.waitForTimeout(600);
    await expect(hintFor(page, "heading")).toHaveCount(0);
    await expect(page.locator(".ogis-locate-hint")).toHaveCount(0);
    const stored = await readLocateStorage(page);
    expect(stored?.mode).toBe("active");
    expect(stored?.lastFix).not.toBeNull();
    expect(await page.evaluate(() => window.__geo.count())).toBe(1);
  });

  test("a desktop Chrome null orientation reading settles incapable and never enters Following", async ({
    page,
  }) => {
    await withLocateHints(page);
    // Chrome 151+ offers requestPermission on desktop without compass hardware.
    // The stub counts calls but must not imply capability.
    await withDesktopChromeOrientationPermission(page);
    // Keep the real probe open far beyond the boot allowance, and suppress
    // native orientation events so only the controlled null reading below can
    // settle it promptly. A broken dispatch path therefore cannot false-pass by
    // waiting out the probe timeout.
    await withCompassProbeTimeout(page, 120000);
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    // Restore starts tracking silently, so the orientation call count isolates
    // the probe: a first-use start would issue its own permission request on
    // any platform exposing the API.
    await withLocateState(page, {
      permissionGranted: true,
      mode: "active",
      lastFix: {
        lat: DEMO.center.lat,
        lng: DEMO.center.lng,
        accuracy: 12,
        heading: null,
        at: Date.now(),
      },
    });
    await page.goto("/");
    await waitForMapReady(page);

    // No capability pin: the real probe must decide.
    expect(
      await page.evaluate(() => window.__ogisCompassCapable),
    ).toBeUndefined();

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    // Precondition: the probe is still pending. The null reading below is the
    // only thing that may settle it, because native events are suppressed.
    expect((await readLocate(page)).compassCapability).toBe("unknown");

    // A restored desktop session must never arm the iOS repair. Click the map
    // *before* the null dispatch, while capability is still unknown, so zero
    // requestPermission calls proves restore did not arm the retry rather than
    // that a proven-incapable device ignores it.
    expect((await readLocate(page)).headingRecoveryPending).toBe(false);
    await tapMap(page);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );
    await expect(hintFor(page, "heading")).toHaveCount(0);
    expect((await readLocate(page)).mode).toBe("active");

    // Drive the desktop-Chrome sensor signature through the real probe. The
    // helper returns the capability read immediately before the controlled
    // event, proving the null-event grace settles it, not the probe timeout.
    expect(await dispatchNullCompassReading(page)).toBe("unknown");

    // The short null-reading grace must settle capability well inside the
    // 120 s probe window.
    await expect
      .poll(async () => (await readLocate(page)).compassCapability, {
        timeout: 3000,
        message: "the null orientation reading did not settle capability",
      })
      .toBe("incapable");

    // On a proven-incapable device the Located state carries no hint, even
    // after the 400 ms state-change delay. Any ordinary Located hint already on
    // screen is dismissed when capability settles incapable.
    await page.waitForTimeout(600);
    await expect(page.locator(".ogis-locate-hint")).toHaveCount(0);

    // The chip stops tracking instead of entering Following.
    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    expect((await readLocate(page)).mode).toBeNull();
    expect(await readActiveModes(page)).not.toContain("follow");

    // Neither the probe nor the silent restore requested orientation
    // permission: the API is not a probe path on non-iOS.
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );
  });

  test("a desktop Chrome first-use locate start never requests orientation permission", async ({
    page,
  }) => {
    await withLocateHints(page);
    // Chrome 151+ exposes requestPermission on desktop without a compass; it
    // must never be mistaken for an iOS gesture-gated prompt.
    await withDesktopChromeOrientationPermission(page);
    // Suppress native orientation events: the controlled null reading, not the
    // stretched probe timeout, must settle capability.
    await withCompassProbeTimeout(page, 120000);
    await installGeolocationMock(page);
    await withNoLocateStorage(page);

    await page.goto("/");
    await waitForMapReady(page);

    // No capability pin: the real probe must decide.
    expect(
      await page.evaluate(() => window.__ogisCompassCapable),
    ).toBeUndefined();

    // Settle the real probe incapable through the desktop-Chrome signature.
    // The helper releases native-event suppression and returns the capability
    // read immediately before the controlled event, so the null-event grace —
    // not the 120 s probe timeout — is what settles it.
    expect(await dispatchNullCompassReading(page)).toBe("unknown");
    await expect
      .poll(async () => (await readLocate(page)).compassCapability, {
        timeout: 3000,
        message: "the null orientation reading did not settle capability",
      })
      .toBe("incapable");

    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(page.getByText("Trust")).toBeVisible();
    await page.getByRole("button", { name: "I understand" }).click();

    // The first-use start runs its orientation gate while location begins.
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBeGreaterThan(0);
    await emitDemoFix(page);
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    // The desktop API was never called and no iOS prompt state was entered.
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );
    expect((await readLocate(page)).orientationPromptPending).toBe(false);
  });
});

// ─── Locate / Programmatic Following guard ──────────────────────────────────

/**
 * `startFollowing` is the routes entry point. It must never report or announce
 * a Following session that the capability guard refused, including when the
 * boot probe settles incapable while the first-use permission modal is open.
 */
test.describe("Locate / Programmatic Following guard", () => {
  /** Call startFollowing through the page's own module graph. */
  const callStartFollowing = (page) =>
    page.evaluate(async () => {
      const { useLocate } = await import("/src/composables/useLocate.js");
      window.__locateOnStartedCalls = 0;
      return useLocate("app").startFollowing({
        onStarted: () => {
          window.__locateOnStartedCalls += 1;
        },
      });
    });

  test("does not fire onStarted when capability downgrades during the permission modal", async ({
    page,
  }) => {
    await withNoLocateStorage(page);
    await installGeolocationMock(page);
    // Hold the probe open so the call starts while capability is optimistic.
    await withCompassProbeTimeout(page, 20000);

    await page.goto("/");
    await waitForMapReady(page);

    // Precondition: the probe has not settled yet.
    expect((await readLocate(page)).compassCapability).toBe("unknown");

    const started = await callStartFollowing(page);
    // The first-use confirmation is still pending, so Following has not begun.
    expect(started).toBe(false);
    await expect(page.getByText("Trust")).toBeVisible();

    // The probe settles incapable while the modal is still open.
    await expect
      .poll(async () => (await readLocate(page)).compassCapability, {
        timeout: 30000,
        message: "the boot probe never downgraded capability",
      })
      .toBe("incapable");

    await page.getByRole("button", { name: "I understand" }).click();

    // Confirming starts a Located session; Following is refused, so the
    // callback must not run and no camera may be claimed.
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(1);
    await expect
      .poll(async () => (await readLocate(page)).mode, {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe("active");
    expect(await page.evaluate(() => window.__locateOnStartedCalls)).toBe(0);
    expect(await readActiveModes(page)).not.toContain("follow");
    expect(await readFollowActive(page)).toBe(false);
  });

  test("does not fire onStarted on an already-incapable device", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await withCompassCapability(page, false);
    await installGeolocationMock(page);

    await page.goto("/");
    await waitForMapReady(page);

    const started = await callStartFollowing(page);

    expect(started).toBe(false);
    expect(await page.evaluate(() => window.__locateOnStartedCalls)).toBe(0);
    expect((await readLocate(page)).mode).toBeNull();
    expect(await page.evaluate(() => window.__geo.count())).toBe(0);
    await expect(page.getByText("Trust")).toBeHidden();
  });

  test("re-opens the error modal before the capability refusal", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await withCompassCapability(page, false);
    // Deliberately no geolocation grant: the first activation errors.
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();
    await expect(page.getByText("Unable to Locate")).toBeVisible({
      timeout: LOCATE_TIMEOUT,
    });
    await page.locator("#locate-error-close").click();
    await expect(page.getByText("Unable to Locate")).toBeHidden();

    const started = await callStartFollowing(page);

    expect(started).toBe(false);
    await expect(page.getByText("Unable to Locate")).toBeVisible();
    expect(await page.evaluate(() => window.__locateOnStartedCalls)).toBe(0);
  });
});

// ─── Locate / Transient timeout ─────────────────────────────────────────────

test.describe("Locate / Transient timeout", () => {
  test("a timeout after the first fix keeps following alive", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await withGrantedStorage(page);
    await withCompassCapability(page, true);
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    const fix = { lat: FIX.latitude, lng: FIX.longitude };

    // Start tracking and follow through the normal button cycle.
    await btn.click();
    await emitFix(page, fix);
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => readActiveModes(page), { timeout: RESTORE_TIMEOUT })
      .toContain("follow");

    // Let the debounced follow-mode write land before the error arrives.
    await expect
      .poll(async () => (await readLocateStorage(page))?.mode ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe("following");

    await emitGeoError(page, 3);

    // Any teardown-triggered write is debounced; give it time to land.
    await page.waitForTimeout(600);

    await expect(btn).toContainText("Following");
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(await readActiveModes(page)).toContain("follow");

    const stored = await readLocateStorage(page);
    expect(stored?.mode).toBe("following");
    expect(stored?.lastFix).not.toBeNull();

    // The watcher was kept rather than torn down and restarted.
    expect(await page.evaluate(() => window.__geo.count())).toBe(1);
  });
});

// ─── Locate / Critical flush ────────────────────────────────────────────────

test.describe("Locate / Critical flush", () => {
  test("starting following and accepting the first fix persist immediately", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await withGrantedStorage(page);
    await withCompassCapability(page, true);
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(btn).toContainText("Locating…", { timeout: LOCATE_TIMEOUT });

    // The chip can enter Following before a fix exists; it still reports
    // progress until the first position arrives.
    await btn.click();
    await expect(btn).toContainText("Locating…", { timeout: LOCATE_TIMEOUT });

    await emitDemoFix(page);
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });

    // No polling: the critical transitions write synchronously, so the stored
    // envelope must already hold the following session and its first fix.
    const stored = await readLocateStorage(page);
    expect(stored?.mode).toBe("following");
    expect(stored?.lastFix).not.toBeNull();
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
    await withCompassCapability(page, true);
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
      const raw = localStorage.getItem("ogis_view_app");
      const parsed = raw ? JSON.parse(raw) : null;
      const stored = parsed && parsed.__ogisState === 1 ? parsed.data : parsed;
      if (!stored || typeof stored !== "object") return;
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

    await expect(page.getByText(/Reload this page/)).toBeVisible();
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

  test("an unavailable position auto-opens the cause-specific modal", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(1);

    await emitGeoError(page, 2);

    await expect(page.locator("#locate-button")).toContainText("Error", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect(page.locator("#locate-error-title")).toHaveText(
      "Location Unavailable",
      { timeout: LOCATE_TIMEOUT },
    );
    const modal = page.locator(
      '.ogis-modal[aria-labelledby="locate-error-title"]',
    );
    await expect(modal.locator(".modal-body")).toContainText(
      "Your device could not determine a location.",
    );
    await expect(modal.locator("ol")).toHaveCount(0);
    await expect(page.locator("#locate-error-retry")).toBeVisible();
  });

  test("a timeout before the first fix shows the timeout copy", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(1);

    await emitGeoError(page, 3);

    await expect(page.locator("#locate-button")).toContainText("Error", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect(page.locator("#locate-error-title")).toHaveText(
      "Location Timed Out",
      { timeout: LOCATE_TIMEOUT },
    );
    const modal = page.locator(
      '.ogis-modal[aria-labelledby="locate-error-title"]',
    );
    await expect(modal.locator(".modal-body")).toContainText(
      "No location arrived in time.",
    );
    await expect(modal.locator("ol")).toHaveCount(0);
    await expect(page.locator("#locate-error-retry")).toBeVisible();
  });

  test("a synchronous watcher failure shows the generic error copy", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.evaluate(() => {
      navigator.geolocation.watchPosition = () => {
        throw new Error("watchPosition is unavailable");
      };
    });

    await page.locator("#locate-button").click();

    await expect(page.locator("#locate-button")).toContainText("Error", {
      timeout: LOCATE_TIMEOUT,
    });
    const modal = page.locator(
      '.ogis-modal[aria-labelledby="locate-error-title"]',
    );
    await expect(modal.locator(".modal-body")).toContainText(
      "Something went wrong while acquiring your location.",
      { timeout: LOCATE_TIMEOUT },
    );
    await expect(modal.locator("ol")).toHaveCount(0);
    await expect(page.locator("#locate-error-retry")).toBeVisible();
  });

  test("an error without a code shows the generic error copy", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(1);

    await page.evaluate(() => window.__geo.fail(undefined));

    await expect(page.locator("#locate-button")).toContainText("Error", {
      timeout: LOCATE_TIMEOUT,
    });
    const modal = page.locator(
      '.ogis-modal[aria-labelledby="locate-error-title"]',
    );
    await expect(modal.locator(".modal-body")).toContainText(
      "Something went wrong while acquiring your location.",
      { timeout: LOCATE_TIMEOUT },
    );
    await expect(modal.locator("ol")).toHaveCount(0);
  });

  test("retrying a non-denial error clears the cause and restarts the watcher", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(1);

    await emitGeoError(page, 2);

    await expect(page.locator("#locate-error-retry")).toBeVisible({
      timeout: LOCATE_TIMEOUT,
    });
    expect(await page.evaluate(() => window.__geo.count())).toBe(0);

    await page.locator("#locate-error-retry").click();

    await expect(page.locator("#locate-button")).toContainText("Locating…", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect(page.getByText("Location Unavailable")).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(1);
    expect((await readLocate(page)).errorCause).toBeNull();

    await emitDemoFix(page);
    await expect(page.locator("#locate-button")).toContainText("Located", {
      timeout: LOCATE_TIMEOUT,
    });
  });

  test("an unsupported browser shows the access copy without retry", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await page.addInitScript(() => {
      delete Navigator.prototype.geolocation;
      delete navigator.geolocation;
    });
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();

    await expect(page.locator("#locate-button")).toContainText("Error", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect(page.locator("#locate-error-title")).toHaveText(
      "Location Unavailable",
      { timeout: LOCATE_TIMEOUT },
    );
    const modal = page.locator(
      '.ogis-modal[aria-labelledby="locate-error-title"]',
    );
    await expect(modal.locator(".modal-body")).toContainText(
      "This browser does not provide location access.",
    );
    await expect(modal.locator("ol")).toHaveCount(0);
    await expect(page.locator("#locate-error-retry")).toHaveCount(0);
    await expect(page.locator("#locate-error-close")).toBeVisible();
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

    // Scope the X button to this modal's own .ogis-modal-close. The error
    // modal also renders a visible "Fermer" footer button, so an unscoped
    // role-name lookup could match more than the X.
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
    await expect(modal.locator(".ogis-modal-close")).toHaveAttribute(
      "aria-label",
      "Fermer",
    );
    await expect(modal.locator(".ogis-modal-close use")).toHaveAttribute(
      "href",
      "#x",
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
    await expect(modal.locator(".ogis-modal-close")).toHaveAttribute(
      "aria-label",
      "Fermer",
    );
  });
});

// ─── Locate / Restore ────────────────────────────────────────────────────────

// A stored fix used by every restore case. Fixed coordinates and timestamp keep
// the seed deterministic; the heading is optional by design.
const RESTORE_FIX = {
  lat: DEMO.center.lat,
  lng: DEMO.center.lng,
  accuracy: 12,
  heading: null,
  at: 1_700_000_000_000,
};

// The debounced storage write needs a little room, and SwiftShader may stretch
// the restore microtask under load.
const RESTORE_TIMEOUT = 30000;

/** Seed the locate envelope into localStorage before the document boots. */
const withLocateState = (page, state) =>
  page.addInitScript((stored) => {
    localStorage.setItem("ogis_locate_app", JSON.stringify(stored));
  }, state);

/** Seed a legacy sessionStorage locate value so the boot migration moves it. */
const withLegacyLocateState = (page, state) =>
  page.addInitScript((stored) => {
    sessionStorage.setItem("ogis_locate_app", JSON.stringify(stored));
  }, state);

/**
 * Record every distinct locate chip label from document-start.
 *
 * The restore cases assert the chip never flashes a state. A MutationObserver
 * records each committed label rather than sampling on a timer, so a transient
 * Following cannot slip between observations. Observing the document node —
 * which exists before `documentElement` — from the init script closes the boot
 * window: the recorder is already live when the button first renders, rather
 * than starting at DOMContentLoaded.
 */
const withLocateLabelRecorder = (page) =>
  page.addInitScript(() => {
    window.__locateLabels = [];
    const record = () => {
      const label = document.querySelector("#locate-button .icon-btn__label");
      const text = label?.textContent?.trim();
      if (!text) return;
      if (window.__locateLabels.at(-1) !== text) {
        window.__locateLabels.push(text);
      }
    };
    record();
    new MutationObserver(record).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });

/** Read the live locate state through the page's own module graph. */
const readLocate = (page) =>
  page.evaluate(async () => {
    const { useLocate } = await import("/src/composables/useLocate.js");
    const locate = useLocate("app");
    const position = locate.position.value;
    return {
      mode: locate.mode.value,
      errorCause: locate.errorCause.value,
      headingRecoveryPending: locate.headingRecoveryPending.value,
      orientationPromptPending: locate.orientationPromptPending.value,
      restoreSettled: locate.restoreSettled.value,
      restoreDeferred: locate.restoreDeferred.value,
      compassCapability: locate.compassCapability.value,
      compassHeading: locate.compassHeading.value,
      position: position
        ? {
            lat: position.lat,
            lng: position.lng,
            accuracy: position.accuracy,
            heading: position.heading,
            speed: position.speed,
          }
        : null,
      hasRestoreComplete:
        locate.restoreComplete &&
        typeof locate.restoreComplete.then === "function",
    };
  });

/** Read the persisted locate envelope, unwrapping the versioned wrapper. */
const readLocateStorage = async (page) =>
  readStoredState(
    await page.evaluate(() => localStorage.getItem("ogis_locate_app")),
  );

/** Read the active map modes through the page's own module graph. */
const readActiveModes = (page) =>
  page.evaluate(async () => {
    const { useActions } = await import("/src/composables/useActions.js");
    return useActions("app").activeModes.value;
  });

/** Whether the follow camera is genuinely active, through the module graph. */
const readFollowActive = (page) =>
  page.evaluate(async () => {
    const { useFollowCamera } =
      await import("/src/composables/useFollowCamera.js");
    return useFollowCamera("app").isActive.value;
  });

/** Read the live map bearing through the page's own module graph. */
const mapBearing = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    return getMapInstance("app").getBearing();
  });

/** Read the live map pitch through the page's own module graph. */
const mapPitch = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    return getMapInstance("app").getPitch();
  });

/** Read the live map centre through the page's own module graph. */
const mapCentre = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const centre = getMapInstance("app").getCenter();
    return { lat: centre.lat, lng: centre.lng };
  });

/** Read the live map zoom through the page's own module graph. */
const mapZoom = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    return getMapInstance("app").getZoom();
  });

/** Smallest absolute angular difference between two bearings, in degrees. */
const bearingDifference = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Poll the live follow-camera bearing until it settles within `tolerance`.
 *
 * The camera holds its last target after the compass heading goes stale, so
 * this is a stable product-level assertion even on slow software rendering.
 */
const expectMapBearing = async (page, expectedBearing, tolerance = 10) => {
  let bearing = null;
  await expect
    .poll(
      async () => {
        bearing = await mapBearing(page);
        return (
          bearing !== null &&
          bearingDifference(bearing, expectedBearing) < tolerance
        );
      },
      {
        timeout: RESTORE_TIMEOUT,
        message: `map did not rotate to ${expectedBearing}°`,
      },
    )
    .toBe(true);
  expect(bearingDifference(bearing, expectedBearing)).toBeLessThan(tolerance);
};

test.describe("Locate / Restore", () => {
  test.beforeEach(async ({ page }) => {
    // These restore and Follow cases run on a capable device; the incapable
    // restore case below overrides the fixture after this hook.
    await withCompassCapability(page, true);
  });

  test("restores an active session with the stored last fix", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withLocateState(page, {
      permissionGranted: true,
      mode: "active",
      lastFix: RESTORE_FIX,
    });

    await page.goto("/");
    await waitForMapReady(page);

    await expect
      .poll(async () => (await readLocate(page)).mode, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe("active");

    // The restored position is the stored fix, before any test-emitted fix.
    const state = await readLocate(page);
    expect(state.hasRestoreComplete).toBe(true);
    expect(state.position).not.toBeNull();
    expect(state.position.lat).toBeCloseTo(RESTORE_FIX.lat, 6);
    expect(state.position.lng).toBeCloseTo(RESTORE_FIX.lng, 6);

    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    const options = await page.evaluate(() => window.__geo.lastOptions());
    expect(options.enableHighAccuracy).toBe(true);
    expect(Number.isFinite(options.timeout)).toBe(true);
    expect(options.timeout).toBeGreaterThan(0);
  });

  test("migrates a legacy sessionStorage session into localStorage", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withLegacyLocateState(page, {
      permissionGranted: true,
      mode: "active",
      lastFix: RESTORE_FIX,
    });

    await page.goto("/");
    await waitForMapReady(page);

    await expect
      .poll(async () => (await readLocateStorage(page))?.mode ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe("active");

    expect(
      await page.evaluate(() => sessionStorage.getItem("ogis_locate_app")),
    ).toBeNull();
    expect(
      await page.evaluate(() => localStorage.getItem("ogis_locate_app")),
    ).not.toBeNull();

    await expect
      .poll(async () => (await readLocate(page)).mode, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe("active");
    const state = await readLocate(page);
    expect(state.position).not.toBeNull();
    expect(state.position.lat).toBeCloseTo(RESTORE_FIX.lat, 6);
    expect(state.position.lng).toBeCloseTo(RESTORE_FIX.lng, 6);
  });

  test("restores a following session and keeps following a live fix", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withLocateState(page, {
      permissionGranted: true,
      mode: "following",
      lastFix: RESTORE_FIX,
    });

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => readActiveModes(page), { timeout: RESTORE_TIMEOUT })
      .toContain("follow");

    const next = {
      lat: RESTORE_FIX.lat + 0.0005,
      lng: RESTORE_FIX.lng,
    };
    await emitFix(page, next);

    await expect
      .poll(async () => (await readLocate(page)).position?.lat, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeCloseTo(next.lat, 6);
    await expect(btn).toContainText("Following");
    expect(await readActiveModes(page)).toContain("follow");
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeGreaterThan(0);
  });

  test("restores a stored Following session as Located on the desktop null compass signature without flashing Following", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    // Override the capable fixture from the describe hook so the real probe
    // decides, and keep native orientation events suppressed: only the
    // controlled null reading may settle it.
    await page.addInitScript(() => {
      delete window.__ogisCompassCapable;
    });
    await withDesktopChromeOrientationPermission(page);
    await withCompassProbeTimeout(page, 120000);
    await withLocateHints(page);
    await withLocateLabelRecorder(page);
    await withLocateState(page, {
      permissionGranted: true,
      mode: "following",
      lastFix: RESTORE_FIX,
      ownerId: "dead-owner",
    });

    await page.goto("/");
    await waitForMapReady(page);

    // The restore is parked on the still-pending probe, so no mode has been
    // chosen yet. A map click here must not arm the iOS retry (desktop Chrome
    // exposes requestPermission, but the platform gate is false).
    const parked = await readLocate(page);
    expect(parked.compassCapability).toBe("unknown");
    expect(parked.mode).toBeNull();
    expect(parked.restoreSettled).toBe(false);
    expect(parked.headingRecoveryPending).toBe(false);
    await tapMap(page);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );

    // The controlled desktop-Chrome null signature settles the real probe.
    // The helper proves capability was still unknown immediately before the
    // dispatch, so the null-event grace — not the 120 s probe timeout — decides.
    expect(await dispatchNullCompassReading(page)).toBe("unknown");
    // Pin the exact signature the helper delivered, so a future platform that
    // mangles the reading fails here rather than as an opaque capability wait.
    expect(await page.evaluate(() => window.__ogisLastNullReading)).toEqual({
      alpha: null,
      beta: null,
      gamma: null,
      absolute: true,
    });
    await expect
      .poll(async () => (await readLocate(page)).compassCapability, {
        timeout: 3000,
        message: "the null orientation reading did not settle capability",
      })
      .toBe("incapable");

    await expect
      .poll(async () => (await readLocate(page)).restoreSettled, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(true);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Located", { timeout: RESTORE_TIMEOUT });
    // Located stays an active session, so the chip remains pressed.
    await expect(btn).toHaveAttribute("aria-pressed", "true");

    const state = await readLocate(page);
    expect(state.mode).toBe("active");
    expect(state.position?.lat).toBeCloseTo(RESTORE_FIX.lat, 6);
    expect(state.position?.lng).toBeCloseTo(RESTORE_FIX.lng, 6);

    await expect
      .poll(async () => (await readLocateStorage(page))?.mode ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe("active");
    expect(await readActiveModes(page)).not.toContain("follow");
    expect(await page.evaluate(() => window.__geo.count())).toBe(1);

    // Hints are live for this case, so the empty bubble past the change delay
    // proves the incapable Located state suppresses the hint rather than the
    // shared fixture disabling hints.
    await page.waitForTimeout(600);
    await expect(page.locator(".ogis-locate-hint")).toHaveCount(0);
    expect(await seenHints(page)).not.toContain("active");

    // Neither the probe nor the silent restore requested orientation
    // permission: the API is not a probe path on non-iOS.
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );

    // The recorder proves Following was never rendered, not merely replaced
    // later: it must have captured the restored Located label.
    const labels = await page.evaluate(() => window.__locateLabels);
    expect(labels).toContain("Located");
    expect(labels).not.toContain("Following");
  });

  test("restores a stored Following session as Located after awaiting a pending probe", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    // Override the capable fixture so the probe is genuinely pending, then
    // settle it incapable well after the delayed permission query resolves.
    await page.addInitScript(() => {
      delete window.__ogisCompassCapable;
    });
    await withCompassProbeTimeout(page, 20000);
    await withDelayedPermissionQuery(page, { delayMs: 1000, timeoutMs: 6000 });
    await withLocateLabelRecorder(page);
    await withLocateState(page, {
      permissionGranted: true,
      mode: "following",
      lastFix: RESTORE_FIX,
    });

    await page.goto("/");
    await waitForMapReady(page);

    // The permission query resolves first; the restore is then genuinely
    // parked on the still-pending probe, so the mode must not have moved yet.
    await expect
      .poll(() => page.evaluate(() => window.__permissionQueryResolved), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);
    const during = await readLocate(page);
    expect(during.compassCapability).toBe("unknown");
    expect(during.mode).toBeNull();

    // Only the probe timeout can settle the restore now; it must do so as
    // Located, never Following (removing the probe await would flash it).
    await expect
      .poll(async () => (await readLocate(page)).restoreSettled, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(true);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Located", { timeout: RESTORE_TIMEOUT });
    await expect(btn).toHaveAttribute("aria-pressed", "true");

    const state = await readLocate(page);
    expect(state.mode).toBe("active");
    expect(state.position?.lat).toBeCloseTo(RESTORE_FIX.lat, 6);
    expect(state.position?.lng).toBeCloseTo(RESTORE_FIX.lng, 6);

    await expect
      .poll(async () => (await readLocateStorage(page))?.mode ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe("active");
    expect(await readActiveModes(page)).not.toContain("follow");
    expect(await page.evaluate(() => window.__geo.count())).toBe(1);

    const labels = await page.evaluate(() => window.__locateLabels);
    expect(labels).toContain("Located");
    expect(labels).not.toContain("Following");
  });

  test("dispose wakes a restore parked on the probe so restoreComplete settles", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await page.addInitScript(() => {
      delete window.__ogisCompassCapable;
    });
    // The probe outlives the test's dispose call; only the disposal signal can
    // settle the restore from this point.
    await withCompassProbeTimeout(page, 30000);
    await withDelayedPermissionQuery(page, { delayMs: 1000, timeoutMs: 6000 });
    await withLocateState(page, {
      permissionGranted: true,
      mode: "following",
      lastFix: RESTORE_FIX,
    });

    await page.goto("/");

    // Wait until the permission query has resolved, which leaves the restore
    // awaiting the probe's (still pending) ready promise.
    await expect
      .poll(() => page.evaluate(() => window.__permissionQueryResolved), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);
    const during = await readLocate(page);
    expect(during.compassCapability).toBe("unknown");
    expect(during.mode).toBeNull();
    expect(during.restoreSettled).toBe(false);

    await page.evaluate(async () => {
      const { useLocate } = await import("/src/composables/useLocate.js");
      useLocate("app").dispose();
    });

    // The app's own promise is captured before disposal, so this reads the
    // restore that was parked, not a fresh instance.
    const settled = await page.evaluate(() => {
      const promise = window.__ogisLocateRestoreComplete;
      if (!promise || typeof promise.then !== "function") return "missing";

      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve("pending"), 10000);
        promise.then(
          () => {
            clearTimeout(timer);
            resolve("settled");
          },
          () => {
            clearTimeout(timer);
            resolve("rejected");
          },
        );
      });
    });

    expect(settled).toBe("settled");
  });

  test("restores a following session when Apple WebKit reports a prompt", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    // No grant: Apple WebKit reports `prompt` even after the user granted.
    await withAppleWebKitPromptPermission(page);
    await withLocateState(page, {
      permissionGranted: true,
      mode: "following",
      lastFix: { ...RESTORE_FIX, at: Date.now() },
    });

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => readActiveModes(page), { timeout: RESTORE_TIMEOUT })
      .toContain("follow");

    // The persisted session survives: the restore was not declined and cleared.
    const stored = await readLocateStorage(page);
    expect(stored.mode).toBe("following");
    expect(stored.lastFix).not.toBeNull();
  });

  test("a hanging permission query times out and clears the restore", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await withHangingPermissionQuery(page);
    await withLocateState(page, {
      permissionGranted: true,
      mode: "following",
      lastFix: RESTORE_FIX,
    });

    await page.goto("/");
    await waitForMapReady(page);

    // The bounded query must settle the app's own restore even though the
    // permission promise never resolves. Reading the E2E hook avoids a second
    // module instance (and a different promise) created by a dynamic import.
    // On Chromium an unknown state cannot restore.
    const settled = await page.evaluate(() => {
      const promise = window.__ogisLocateRestoreComplete;
      if (!promise || typeof promise.then !== "function") return "missing";

      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve("pending"), 15000);
        promise.then(
          () => {
            clearTimeout(timer);
            resolve("settled");
          },
          () => {
            clearTimeout(timer);
            resolve("rejected");
          },
        );
      });
    });
    expect(settled).toBe("settled");

    await expect
      .poll(async () => (await readLocateStorage(page))?.mode ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();
    await expect
      .poll(async () => (await readLocateStorage(page))?.lastFix ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();

    expect((await readLocate(page)).mode).toBeNull();
    expect(await page.evaluate(() => window.__geo.count())).toBe(0);
    await expect(page.getByText("Unable to Locate")).toBeHidden();
    await expect(page.getByText("Trust")).toBeHidden();
  });

  test("does not auto-resume without OS geolocation permission", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    // Deliberately no grant: the OS permission query must block the restore.
    await withLocateState(page, {
      permissionGranted: true,
      mode: "following",
      lastFix: RESTORE_FIX,
    });

    await page.goto("/");
    await waitForMapReady(page);

    // The clear is the proof that auto-restore ran and declined.
    await expect
      .poll(async () => (await readLocateStorage(page))?.mode ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();
    await expect
      .poll(async () => (await readLocateStorage(page))?.lastFix ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();

    expect((await readLocate(page)).mode).toBeNull();
    expect(await page.evaluate(() => window.__geo.count())).toBe(0);
    await expect(page.getByText("Unable to Locate")).toBeHidden();
    await expect(page.getByText("Trust")).toBeHidden();
  });

  test("fails a restore silently when geolocation errors before the first fix", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withLocateState(page, {
      permissionGranted: true,
      mode: "active",
      lastFix: RESTORE_FIX,
    });

    await page.goto("/");
    await waitForMapReady(page);

    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    await emitGeoError(page, 1);

    await expect
      .poll(async () => (await readLocate(page)).mode, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();
    await expect(page.getByText("Unable to Locate")).toBeHidden();
    await expect(
      page.locator('.ogis-modal[aria-labelledby="locate-error-title"]'),
    ).toBeHidden();
    await expect(page.getByText("Trust")).toBeHidden();

    await expect
      .poll(async () => (await readLocateStorage(page))?.mode ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();
    await expect
      .poll(async () => (await readLocateStorage(page))?.lastFix ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();
  });

  test("persists the last accepted fix after a restored active session", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withLocateState(page, {
      permissionGranted: true,
      mode: "active",
      lastFix: RESTORE_FIX,
    });

    await page.goto("/");
    await waitForMapReady(page);

    await expect
      .poll(async () => (await readLocate(page)).mode, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe("active");

    const fix = {
      lat: RESTORE_FIX.lat + 0.001,
      lng: RESTORE_FIX.lng - 0.001,
    };
    await emitFix(page, fix);

    await expect
      .poll(
        async () => {
          const stored = await readLocateStorage(page);
          if (stored?.mode !== "active" || !stored.lastFix) {
            return Number.POSITIVE_INFINITY;
          }
          return (
            Math.abs(stored.lastFix.lat - fix.lat) +
            Math.abs(stored.lastFix.lng - fix.lng)
          );
        },
        { timeout: RESTORE_TIMEOUT },
      )
      .toBeLessThan(1e-9);

    const stored = await readLocateStorage(page);
    expect(stored.mode).toBe("active");
    expect(stored.lastFix.lat).toBeCloseTo(fix.lat, 6);
    expect(stored.lastFix.lng).toBeCloseTo(fix.lng, 6);
  });

  test("following in one tab is not restored in another tab", async ({
    context,
    page: pageA,
  }) => {
    await installGeolocationMock(pageA);
    await grantGeolocation(pageA);
    await withGrantedStorage(pageA);
    await pageA.goto("/");
    await waitForMapReady(pageA);

    const button = pageA.locator("#locate-button");
    await button.click();
    await expect(button).toContainText("Locating…", {
      timeout: LOCATE_TIMEOUT,
    });
    await emitDemoFix(pageA);
    await expect(button).toContainText("Located", { timeout: LOCATE_TIMEOUT });
    await button.click();
    await expect(button).toContainText("Following", {
      timeout: LOCATE_TIMEOUT,
    });

    await expect
      .poll(async () => (await readLocateStorage(pageA))?.mode ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe("following");

    const pageB = await context.newPage();
    await pageB.goto("/");
    await waitForMapReady(pageB);

    await expect
      .poll(async () => (await readLocate(pageB)).mode, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();

    // The owner's durable session is untouched and still live. Page A's
    // Vue-rendered chip proves its live mode while B is open: a second
    // SwiftShader map can stall A's main thread for tens of seconds, so the
    // module-graph read below waits until B is closed.
    expect((await readLocateStorage(pageA))?.mode).toBe("following");
    await expect(button).toContainText("Following", {
      timeout: LOCATE_TIMEOUT,
    });

    await pageB.close();

    // With B gone the live read clears the second map's backlog; allow the
    // same budget as the element assertions above for the remaining stalls.
    await expect
      .poll(async () => (await readLocate(pageA)).mode, {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe("following");
  });

  test("keeps the permission grant after an app quit", async ({
    context,
    page,
  }) => {
    await installGeolocationMock(page);
    await context.grantPermissions(["geolocation"]);
    await page.goto("/");
    await waitForMapReady(page);

    // First-ever request shows the explainer; confirming grants permission.
    await page.locator("#locate-button").click();
    await expect(page.getByText("Trust")).toBeVisible();
    await page.getByRole("button", { name: "I Understand" }).click();
    // No fix is emitted here: this test only proves the permission grant
    // survives the quit, so the chip correctly reports progress.
    await expect(page.locator("#locate-button")).toContainText("Locating…", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect
      .poll(
        async () => (await readLocateStorage(page))?.permissionGranted ?? false,
        { timeout: RESTORE_TIMEOUT },
      )
      .toBe(true);

    // A new page in the same context has fresh sessionStorage but shared
    // localStorage, simulating an app quit and reopen.
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto("/");
    await waitForMapReady(reopened);

    await reopened.locator("#locate-button").click();
    await expect(reopened.getByText("Trust")).toBeHidden();
    await expect(reopened.locator("#locate-button")).toContainText(
      "Locating…",
      {
        timeout: LOCATE_TIMEOUT,
      },
    );
  });

  test("restores a following session from localStorage with a dead owner", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withLocateState(page, {
      permissionGranted: true,
      mode: "following",
      lastFix: RESTORE_FIX,
      ownerId: "dead-owner",
    });

    await page.goto("/");
    await waitForMapReady(page);

    await expect
      .poll(async () => (await readLocate(page)).mode, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe("following");
    const stored = await readLocateStorage(page);
    expect(stored.mode).toBe("following");
    expect(stored.ownerId).not.toBe("dead-owner");
  });

  test("restores a following session after a same-tab reload", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await page.addInitScript(() => {
      if (!localStorage.getItem("ogis_locate_app")) {
        localStorage.setItem(
          "ogis_locate_app",
          JSON.stringify({ permissionGranted: true }),
        );
      }
    });
    await page.goto("/");
    await waitForMapReady(page);

    await page.locator("#locate-button").click();
    await expect(page.locator("#locate-button")).toContainText("Locating…", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBeGreaterThan(0);
    await emitFix(page, {
      lat: RESTORE_FIX.lat,
      lng: RESTORE_FIX.lng,
    });
    await expect(page.locator("#locate-button")).toContainText("Located", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect
      .poll(async () => (await readLocateStorage(page))?.lastFix ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .not.toBeNull();
    await page.locator("#locate-button").click();
    await expect(page.locator("#locate-button")).toContainText("Following", {
      timeout: LOCATE_TIMEOUT,
    });

    await page.reload();
    await waitForMapReady(page);

    await expect(page.locator("#locate-button")).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
  });
});

// ─── Locate / Restore / Compass permission ───────────────────────────────────

/**
 * A boot restore cannot prompt for iOS orientation permission, so it listens
 * silently and arms a one-shot retry on the first map click/tap. These cases
 * pin that contract: the iOS prompt on the first map tap, the non-iOS
 * auto-listen, and a graceful denial that leaves the position marker in place.
 */
test.describe("Locate / Restore / Compass permission", () => {
  // No blanket capability pin: the emulated iOS navigator exercises the real
  // probe's iOS permission-API shortcut, and each non-iOS case that needs a
  // capable fixture pins capability itself.

  const recentFollowingSession = {
    permissionGranted: true,
    mode: "following",
    lastFix: { ...RESTORE_FIX, at: Date.now() },
    ownerId: "dead-owner",
  };

  // The Active fixture mirrors the Following one; only the restored mode differs.
  const recentActiveSession = { ...recentFollowingSession, mode: "active" };

  /**
   * True-north bearing for an iOS magnetic compass heading at the stored fix.
   *
   * The stored fix supplies the magnetic declination before any live fix
   * arrives, so the production `magvar` package at those coordinates corrects
   * the heading, as in the map-gesture cases above.
   */
  const expectedIOSBearing = (page, magneticHeading) =>
    page.evaluate(
      async ({ heading, fix }) => {
        // Vite serves the optimised package with a default export.
        const { magvar } = (await import("/@id/magvar")).default;
        return (heading + magvar(fix.lat, fix.lng) + 360) % 360;
      },
      {
        heading: magneticHeading,
        fix: { lat: RESTORE_FIX.lat, lng: RESTORE_FIX.lng },
      },
    );

  /**
   * Dispatch iOS compass headings until the repaired listener receives one.
   *
   * `retryOrientation` attaches its listener only after the permission promise
   * settles, so a dispatch issued immediately after the chip tap can land
   * before the listener exists. Retrying through `expect.poll` waits for the
   * attachment without relying on a fixed sleep.
   */
  const dispatchIOSCompassUntilHeading = async (page, headingDeg) => {
    await expect
      .poll(
        async () => {
          await dispatchIOSCompass(page, headingDeg);
          return page.locator(".ogis-locate-heading").count();
        },
        { timeout: RESTORE_TIMEOUT },
      )
      .toBe(1);
  };

  /** Dispatch absolute compass headings until the heading marker appears. */
  const dispatchCompassUntilHeading = async (page, bearingDeg) => {
    await expect
      .poll(
        async () => {
          await dispatchCompass(page, bearingDeg);
          return page.locator(".ogis-locate-heading").count();
        },
        { timeout: RESTORE_TIMEOUT },
      )
      .toBe(1);
  };

  test("requests compass permission on the first map gesture after an iOS restore", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withIOSOrientationPermission(page);
    await withLocateState(page, recentFollowingSession);

    // Snap the follow camera so the hand-off glide cannot stretch the bearing
    // assertion on a slow software renderer.
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);
    await expect(page.locator(".ogis-locate-heading")).toHaveCount(0);
    await expect(page.getByText("Trust")).toBeHidden();

    // Restoring a session must never prompt on its own.
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );

    // The emulated iOS navigator satisfies the real platform gate, so the boot
    // probe short-circuits capable instead of waiting for sensor events.
    expect((await readLocate(page)).compassCapability).toBe("capable");

    await tapMap(page);
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // Keep a live iOS compass heartbeat so the heading stays alive through the
    // damped bearing assertion. Under SwiftShader the 8 s heading watchdog can
    // clear a one-shot dispatch before the camera reaches the target. Stop it
    // before the second tap so the one-shot retry assertion stays valid.
    await startIOSCompassStream(page, 180);
    try {
      // The stored fix supplies the magnetic declination before any live GPS fix
      // arrives, so a magnetic 180° heading is corrected to true north using the
      // production `magvar` package at the stored coordinates.
      const expectedBearing = await page.evaluate(
        async (fix) => {
          // Vite serves the optimised package with a default export.
          const { magvar } = (await import("/@id/magvar")).default;
          return (180 + magvar(fix.lat, fix.lng) + 360) % 360;
        },
        { lat: RESTORE_FIX.lat, lng: RESTORE_FIX.lng },
      );

      // The follow camera holds its last target after the compass heading goes
      // stale, so the map bearing is the stable product-level assertion. The
      // marker's CSS transform is map-relative and unreliable during the glide.
      await expectMapBearing(page, expectedBearing);
    } finally {
      await stopIOSCompassStream(page);
    }

    // The retry is one-shot: a later map tap must not prompt again.
    await tapMap(page);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      1,
    );
  });

  test("a map pointerdown does not consume the retry, a click does", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withIOSOrientationPermission(page);
    await withLocateState(page, recentFollowingSession);

    // Snap the follow camera so the hand-off glide cannot stretch the bearing
    // assertion on a slow software renderer.
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // Restoring a session must never prompt on its own.
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );

    // Regression: a `pointerdown` must not consume the retry. WebKit only
    // treats a mouse pointerdown as transient activation, so listening on it
    // would silently use up the one-shot retry on a touch tap.
    await page.locator(".ogis-map").dispatchEvent("pointerdown");
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );
    await expect(btn).toContainText("Following");

    // The click is the gesture that requests permission, without leaving
    // Following.
    await page.locator(".ogis-map").dispatchEvent("click");
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);
    await expect(btn).toContainText("Following", { timeout: RESTORE_TIMEOUT });

    // The repaired compass rotates the follow camera. Keep a live heartbeat so
    // the heading survives the damped bearing assertion on a slow renderer.
    await startIOSCompassStream(page, 180);
    try {
      await expectMapBearing(page, await expectedIOSBearing(page, 180));
    } finally {
      await stopIOSCompassStream(page);
    }
  });

  test("starts orientation listening on restore without a prompt on non-iOS", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    // Non-iOS with no sensor fixture: pin capability so the restore can
    // genuinely enter the Following state this case asserts.
    await withCompassCapability(page, true);
    await withLocateState(page, recentFollowingSession);

    // Snap the follow camera so the hand-off glide cannot stretch the bearing
    // assertion on a slow software renderer.
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // Absolute alpha 90 yields a 270° true-north bearing.
    await dispatchCompassUntilHeading(page, 270);
    await expectMapBearing(page, 270);
  });

  test("arms the retry from the map container before the map is ready", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withIOSOrientationPermission(page);
    await withLocateState(page, recentFollowingSession);

    // Hold the style response so the restore finishes before MapLibre publishes
    // its instance at `style.load`. The `.ogis-map` container rendered by the
    // app already exists, so this exercises the DOM-container fallback. (The
    // `map:ready` path is the further fallback for when neither exists.)
    let releaseStyle;
    const styleGate = new Promise((resolve) => {
      releaseStyle = resolve;
    });
    await page.route("**/style.json", async (route) => {
      await styleGate;
      // Fall through to the suite's map-asset stub, which serves the fixture
      // style rather than reaching the real network.
      await route.fallback().catch(() => {});
    });

    await page.goto("/");

    // Deliberately no `waitForMapReady`: the following restore must complete
    // first for this case to prove anything.
    await expect(page.locator("#locate-button")).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });

    // Precondition: the map instance is not yet published, but its container is.
    expect(
      await page.evaluate(async () => {
        const { getMapInstance } = await import("/src/composables/useMap.js");
        return (
          getMapInstance("app") === null &&
          document.querySelector(".ogis-map") !== null
        );
      }),
    ).toBe(true);

    await tapMap(page);
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // Let the map finish loading so teardown is clean.
    releaseStyle();
    await expect(page.locator(".ogis-map")).toHaveAttribute(
      "data-map-ready",
      "true",
      { timeout: RESTORE_TIMEOUT },
    );
  });

  test("renders the restored marker when the map becomes ready after the restore", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    // Non-iOS with no sensor fixture: pin capability so the restore reaches
    // Following, which is the state this marker case needs.
    await withCompassCapability(page, true);
    await withLocateState(page, recentFollowingSession);

    // Hold the style response so the restore finishes before MapLibre publishes
    // its instance at `style.load`. The stored fix is the only position — the
    // mock never auto-emits and no compass event runs — so the position marker
    // can only appear via the one-shot `map:ready` retry armed by `syncMarkers`.
    let releaseStyle;
    const styleGate = new Promise((resolve) => {
      releaseStyle = resolve;
    });
    await page.route("**/style.json", async (route) => {
      await styleGate;
      // Fall through to the suite's map-asset stub, which serves the fixture
      // style rather than reaching the real network.
      await route.fallback().catch(() => {});
    });

    await page.goto("/");

    // Deliberately no `waitForMapReady`: the restore must complete first.
    await expect(page.locator("#locate-button")).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });

    // Precondition: the stored fix is restored but MapLibre has not published
    // its instance, so no marker can exist yet.
    const mapPublished = () =>
      page.evaluate(async () => {
        const { getMapInstance } = await import("/src/composables/useMap.js");
        return getMapInstance("app") !== null;
      });
    expect(await mapPublished()).toBe(false);
    await expect(page.locator(".ogis-locate-position")).toHaveCount(0);
    await expect(page.locator(".ogis-locate-heading")).toHaveCount(0);

    releaseStyle();
    await waitForMapReady(page);

    // The armed one-shot retry must add the stored-fix position marker.
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);
    await expect(page.locator(".ogis-locate-heading")).toHaveCount(0);
    expect(await mapPublished()).toBe(true);
  });

  test("a denied compass retry leaves the position marker and no error UI", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withIOSOrientationPermission(page, "denied");
    await withLocateState(page, recentFollowingSession);

    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator("#locate-button")).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    await tapMap(page);
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // The retry settles with no heading and no error surface.
    await page.waitForTimeout(200);
    await expect(page.locator(".ogis-locate-heading")).toHaveCount(0);
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);
    await expect(page.getByText("Unable to Locate")).toBeHidden();
    await expect(page.getByText("Trust")).toBeHidden();
  });

  test("a restored follow camera starts flat, tilts on a compass event, then flattens when the heading is lost", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withIOSOrientationPermission(page);
    await withLocateState(page, recentFollowingSession);

    // Snap the follow camera so the hand-off glide cannot stretch the bearing
    // assertion on a slow software renderer.
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // Restoring a session must never prompt on its own.
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );

    // Compass-only 3D: with no live heading the restored follow camera holds
    // the flat, north-up navigation pose rather than a stale tilted one.
    await expect
      .poll(async () => Math.abs(await mapPitch(page)), {
        timeout: RESTORE_TIMEOUT,
        message: "restored follow camera started tilted",
      })
      .toBeLessThan(1);
    await expect
      .poll(async () => bearingDifference(await mapBearing(page), 0), {
        timeout: RESTORE_TIMEOUT,
        message: "restored follow camera did not start north-up",
      })
      .toBeLessThan(1);

    // Positive proof of the restored follow pose: a cold-start flat view (the
    // un-followed map at its default centre and zoom) must not satisfy the flat
    // north-up checks above. At rest the driver seats the camera on the stored
    // fix at the navigation rest zoom, with no look-ahead while flat.
    await expect
      .poll(
        async () => {
          const centre = await mapCentre(page);
          return Math.hypot(
            centre.lat - RESTORE_FIX.lat,
            centre.lng - RESTORE_FIX.lng,
          );
        },
        {
          timeout: RESTORE_TIMEOUT,
          message: "restored follow camera was not centred on the stored fix",
        },
      )
      .toBeLessThan(1e-4);
    await expect
      .poll(async () => Math.abs((await mapZoom(page)) - 17), {
        timeout: RESTORE_TIMEOUT,
        message: "restored follow camera was not at the navigation rest zoom",
      })
      .toBeLessThan(0.5);

    await tapMap(page);
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // The restored fix supplies the magnetic declination before any live GPS
    // fix arrives, so a magnetic 180° heading is corrected to true north using
    // the production `magvar` package at the stored coordinates.
    const expectedBearing = await page.evaluate(
      async (fix) => {
        // Vite serves the optimised package with a default export.
        const { magvar } = (await import("/@id/magvar")).default;
        return (180 + magvar(fix.lat, fix.lng) + 360) % 360;
      },
      { lat: RESTORE_FIX.lat, lng: RESTORE_FIX.lng },
    );

    // The restored `lastFix` is the only position throughout: the geolocation
    // mock never auto-emits, so any rotation or tilt can only come from this
    // compass event rotating the follow camera directly. Dispatch until the
    // heading marker is live: the repaired listener attaches only after the
    // permission promise settles, so a one-shot event could land before it.
    await dispatchIOSCompassUntilHeading(page, 180);

    // Keep a live iOS compass heartbeat through the positive bearing and pitch
    // assertions. Under SwiftShader the 8 s heading watchdog clears the
    // one-shot dispatch before the camera finishes tilting, so the assertions
    // would never see the authorised 3D pose. The heartbeat stops after them,
    // leaving its final event to arm the watchdog that the flatten poll below
    // proves.
    await startIOSCompassStream(page, 180);
    try {
      let bearing = null;
      await expect
        .poll(
          async () => {
            bearing = await mapBearing(page);
            return (
              bearing !== null &&
              bearingDifference(bearing, expectedBearing) < 10
            );
          },
          {
            timeout: RESTORE_TIMEOUT,
            message: `follow camera did not rotate to ${expectedBearing}°`,
          },
        )
        .toBe(true);
      expect(bearingDifference(bearing, expectedBearing)).toBeLessThan(10);

      // The heading authorises the 3D chase, so the camera also reaches the
      // third-person rest pitch.
      await expect
        .poll(async () => Math.abs((await mapPitch(page)) - 45), {
          timeout: RESTORE_TIMEOUT,
          message: "follow camera did not tilt to the chase pitch",
        })
        .toBeLessThan(1);
    } finally {
      await stopIOSCompassStream(page);
    }

    // The compass heartbeat armed the 8 s heading watchdog. No further fix
    // ever arrives, so only the watchdog can retarget the driver: it clears the
    // heading and the camera must return to flat north-up. Allow the grace
    // period plus easing on a slow renderer.
    await expect
      .poll(
        async () => {
          const [pitch, currentBearing] = await Promise.all([
            mapPitch(page),
            mapBearing(page),
          ]);
          return (
            Math.abs(pitch) < 1 && bearingDifference(currentBearing, 0) < 1
          );
        },
        {
          timeout: 30000,
          message: "follow camera did not flatten after the heading was lost",
        },
      )
      .toBe(true);
  });

  test("a chip tap repairs a restored iOS Following session and stays Following", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withIOSOrientationPermission(page);
    await withLocateState(page, recentFollowingSession);

    // Snap the follow camera so the hand-off glide cannot stretch the bearing
    // assertion on a slow software renderer.
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // Restoring a session must never prompt on its own.
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );

    // The first chip tap is the repair gesture: it requests orientation
    // permission inside the click and must leave the tracking mode untouched.
    await btn.click();
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // A magnetic 180° heading is corrected to true north at the stored fix, and
    // the follow camera damps towards that bearing. Keep a live heartbeat so the
    // heading survives the marker and damped bearing assertions on a slow
    // renderer; the 8 s heading watchdog would otherwise clear a one-shot event.
    await startIOSCompassStream(page, 180);
    try {
      await expect(page.locator(".ogis-locate-heading")).toHaveCount(1);

      const expectedBearing = await expectedIOSBearing(page, 180);
      let bearing = null;
      await expect
        .poll(
          async () => {
            bearing = await mapBearing(page);
            return (
              bearing !== null &&
              bearingDifference(bearing, expectedBearing) < 10
            );
          },
          {
            timeout: RESTORE_TIMEOUT,
            message: `follow camera did not rotate to ${expectedBearing}°`,
          },
        )
        .toBe(true);
      expect(bearingDifference(bearing, expectedBearing)).toBeLessThan(10);
    } finally {
      await stopIOSCompassStream(page);
    }

    // The repair is consumed by the first tap: a second tap stops normally.
    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });
    await expect(page.locator(".ogis-locate-position")).toHaveCount(0);
    await expect(page.locator(".ogis-locate-heading")).toHaveCount(0);
  });

  test("a chip tap enters Following from a restored iOS Active session and repairs", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withIOSOrientationPermission(page);
    await withLocateState(page, recentActiveSession);

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Located", { timeout: RESTORE_TIMEOUT });
    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      0,
    );

    // The first chip tap follows and repairs in one gesture.
    await btn.click();
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });

    // Keep a live heartbeat so the heading marker stays present through the
    // assertion on a slow renderer.
    await startIOSCompassStream(page, 90);
    try {
      await expect(page.locator(".ogis-locate-heading")).toHaveCount(1);
    } finally {
      await stopIOSCompassStream(page);
    }
  });

  test("a denied chip repair keeps Following without an error", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    await withIOSOrientationPermission(page, "denied");
    await withLocateState(page, recentFollowingSession);

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    await btn.click();
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // The denial settles quietly: Following, the position marker and no error
    // surface stay exactly as they were.
    await page.waitForTimeout(200);
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);
    await expect(page.locator(".ogis-locate-heading")).toHaveCount(0);
    await expect(
      page.locator('.ogis-modal[aria-labelledby="locate-error-title"]'),
    ).toHaveCount(0);
    await expect(page.getByText("Unable to Locate")).toBeHidden();

    // A second tap then behaves normally and stops.
    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });
    await expect(page.locator(".ogis-locate-position")).toHaveCount(0);
    await expect(page.locator(".ogis-locate-heading")).toHaveCount(0);
  });

  test("a chip tap stops a non-iOS restored Following session without a repair", async ({
    page,
  }) => {
    await installGeolocationMock(page);
    await page.context().grantPermissions(["geolocation"]);
    // Non-iOS with no sensor fixture: pin capability so the restore can enter
    // the Following state this stop case starts from.
    await withCompassCapability(page, true);
    await withLocateState(page, recentFollowingSession);

    // Snap the follow camera so the hand-off glide cannot stretch the bearing
    // assertion on a slow software renderer.
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await expect(btn).toContainText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);

    // Off iOS there is no deferred permission repair to arm.
    expect((await readLocate(page)).headingRecoveryPending).toBe(false);

    // The non-iOS restore listens immediately: absolute alpha 90 yields a 270°
    // true-north bearing. The heading marker proves the compass is live; this
    // case only needs to verify the chip stop, not the camera bearing.
    await dispatchCompassUntilHeading(page, 270);

    // One tap stops immediately; no repair gesture intervenes.
    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });
    await expect(page.locator(".ogis-locate-position")).toHaveCount(0);
    await expect(page.locator(".ogis-locate-heading")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__orientationPermissionCalls),
    ).toBeUndefined();
  });

  // A real touch tap must also arm the retry: Chromium derives a synthetic
  // click from a tap, which is the gesture WebKit grants transient activation
  // for (unlike a non-mouse pointerdown).
  test.describe("touch device", () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test("a touch tap on the map requests compass permission", async ({
      page,
    }) => {
      await installGeolocationMock(page);
      await page.context().grantPermissions(["geolocation"]);
      await withIOSOrientationPermission(page);
      await withLocateState(page, recentFollowingSession);

      await page.goto("/");
      await waitForMapReady(page);

      const btn = page.locator("#locate-button");
      await expect(btn).toContainText("Following", {
        timeout: RESTORE_TIMEOUT,
      });
      await expect
        .poll(() => page.locator(".ogis-locate-position").count(), {
          timeout: RESTORE_TIMEOUT,
        })
        .toBe(1);
      expect(
        await page.evaluate(() => window.__orientationPermissionCalls),
      ).toBe(0);

      // Tap the lower-left map area, clear of the corner controls and the
      // attribution chip.
      const mapBox = await page.locator(".ogis-map").boundingBox();
      await page.touchscreen.tap(mapBox.x + 48, mapBox.y + mapBox.height - 260);

      await expect
        .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
          timeout: RESTORE_TIMEOUT,
        })
        .toBe(1);
      await expect(btn).toContainText("Following", {
        timeout: RESTORE_TIMEOUT,
      });
    });
  });
});

// ─── Locate / First-use compass denial ──────────────────────────────────────

/**
 * A denial on a normal first-use start must reach the same honest pending state
 * as a restore: the persistent heading hint, plus the chip and map repair
 * gestures. The iOS stub holds its permission promise so the denial can land
 * after the user has entered Following — the timing a real native prompt can
 * take — then the repair is asserted from that live Following session.
 */
test.describe("Locate / First-use compass denial", () => {
  /**
   * Start a first-use session, enter Following while the orientation prompt is
   * still outstanding, then settle that prompt as denied.
   *
   * @returns {Promise<import('@playwright/test').Locator>} The locate chip.
   */
  const startFollowingWithDeniedCompass = async (page) => {
    await withNoLocateStorage(page);
    await withLocateHints(page);
    await installGeolocationMock(page);
    await withHangingIOSOrientationPermission(page);

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(page.getByText("Trust")).toBeVisible();
    await page.getByRole("button", { name: "I understand" }).click();

    // The GPS watcher is live while the native prompt is outstanding, so the
    // fix can land before the prompt is answered.
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(1);
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBeGreaterThan(0);
    await emitFix(page, { lat: FIX.latitude, lng: FIX.longitude });
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });

    // Deny only now, on a live Following session.
    expect(await resolveIOSOrientationPermission(page, "denied")).toBe(true);
    await expect
      .poll(async () => (await readLocate(page)).headingRecoveryPending, {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(true);

    return btn;
  };

  test("a denied first-use prompt shows the persistent heading hint", async ({
    page,
  }) => {
    const btn = await startFollowingWithDeniedCompass(page);

    expect((await readLocate(page)).mode).toBe("following");
    await expect(hintFor(page, "heading")).toContainText("Compass is off", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect(hintFor(page, "following")).toHaveCount(0);
    await expect(btn).toContainText("Following");
  });

  test("a chip tap repairs a denied first-use session and stays Following", async ({
    page,
  }) => {
    const btn = await startFollowingWithDeniedCompass(page);

    await expect(hintFor(page, "heading")).toContainText("Compass is off", {
      timeout: LOCATE_TIMEOUT,
    });

    // The chip tap is the repair gesture: it requests orientation permission
    // again inside the click without leaving Following.
    await btn.click();
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(2);
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
    expect((await readLocate(page)).mode).toBe("following");

    // Settle the outstanding repair prompt so the page closes cleanly.
    expect(await resolveIOSOrientationPermission(page, "denied")).toBe(true);
  });

  test("a map click repairs a denied first-use session", async ({ page }) => {
    const btn = await startFollowingWithDeniedCompass(page);

    expect(await page.evaluate(() => window.__orientationPermissionCalls)).toBe(
      1,
    );

    await tapMap(page);
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(2);
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });

    expect(await resolveIOSOrientationPermission(page, "denied")).toBe(true);
  });

  test("a granted repair clears the heading hint and resumes Following", async ({
    page,
  }) => {
    const btn = await startFollowingWithDeniedCompass(page);

    await expect(hintFor(page, "heading")).toContainText("Compass is off", {
      timeout: LOCATE_TIMEOUT,
    });

    await btn.click();
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(2);
    expect(await resolveIOSOrientationPermission(page, "granted")).toBe(true);

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

    await expect(hintFor(page, "heading")).toHaveCount(0);
    await expect(hintFor(page, "following")).toContainText(
      "Tap again to stop",
      {
        timeout: LOCATE_TIMEOUT,
      },
    );
    expect((await readLocate(page)).headingRecoveryPending).toBe(false);
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });
  });

  test("stopping while a retry permission prompt is pending stays stopped", async ({
    page,
  }) => {
    const btn = await startFollowingWithDeniedCompass(page);

    // The map click starts `retryOrientation`; its second permission promise
    // stays outstanding until this test settles it.
    await tapMap(page);
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(2);
    expect(
      await page.evaluate(() => window.__orientationPermissionPending),
    ).toBe(true);

    // `retryOrientation` clears the recovery flag synchronously, so the chip
    // now stops rather than repairing again.
    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });
    expect((await readLocate(page)).mode).toBeNull();

    // The stale continuation must not resurrect orientation watching.
    expect(await resolveIOSOrientationPermission(page, "granted")).toBe(true);
    await dispatchIOSCompass(page, 90);
    await page.waitForTimeout(200);

    const state = await readLocate(page);
    expect(state.mode).toBeNull();
    expect(state.compassHeading).toBeNull();
    await expect(page.locator(".ogis-locate-heading")).toHaveCount(0);
    await expect(page.locator(".ogis-locate-position")).toHaveCount(0);
  });
});

// ─── Locate / First-use compass denial / non-iOS ────────────────────────────

test.describe("Locate / First-use compass denial / non-iOS", () => {
  test("following keeps the normal hint without an orientation request", async ({
    page,
  }) => {
    await withNoLocateStorage(page);
    await withLocateHints(page);
    await installGeolocationMock(page);
    // This non-iOS case genuinely enters Following.
    await withCompassCapability(page, true);

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(page.getByText("Trust")).toBeVisible();
    await page.getByRole("button", { name: "I understand" }).click();

    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBeGreaterThan(0);
    await emitFix(page, { lat: FIX.latitude, lng: FIX.longitude });
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });

    await expect(hintFor(page, "following")).toContainText(
      "Tap again to stop",
      {
        timeout: LOCATE_TIMEOUT,
      },
    );
    await expect(hintFor(page, "heading")).toHaveCount(0);
    expect((await readLocate(page)).headingRecoveryPending).toBe(false);
    expect(
      await page.evaluate(() => window.__orientationPermissionCalls),
    ).toBeUndefined();
  });
});

// ─── Locate / Hung orientation prompt ────────────────────────────────────────

/**
 * Geolocation must not wait for the iOS Motion & Orientation prompt. These
 * cases pin the new ordering: the GPS watcher is already live while the native
 * orientation prompt is outstanding, and the active hint is suppressed until
 * that prompt settles.
 */
test.describe("Locate / Hung orientation prompt", () => {
  test("a pending orientation prompt does not block geolocation or leak the active hint", async ({
    page,
  }) => {
    await withNoLocateStorage(page);
    await withLocateHints(page);
    await installGeolocationMock(page);
    await withHangingIOSOrientationPermission(page);

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(page.getByText("Trust")).toBeVisible();
    await page.getByRole("button", { name: "I understand" }).click();

    // The native prompt is outstanding…
    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(1);
    expect(
      await page.evaluate(() => window.__orientationPermissionPending),
    ).toBe(true);

    // …and the GPS watcher is already registered regardless.
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBeGreaterThan(0);

    // A fix lands while orientation permission is still unresolved.
    await emitFix(page, { lat: FIX.latitude, lng: FIX.longitude });
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    const state = await readLocate(page);
    expect(state.mode).toBe("active");
    expect(state.orientationPromptPending).toBe(true);

    // Past the 400 ms state-change delay the active hint stays suppressed by
    // the outstanding prompt, and is not marked seen.
    await page.waitForTimeout(600);
    await expect(page.locator(".ogis-locate-hint")).toHaveCount(0);
    expect(await seenHints(page)).not.toContain("active");

    // Granting the prompt releases the hint.
    expect(await resolveIOSOrientationPermission(page, "granted")).toBe(true);
    await expect(hintFor(page, "active")).toContainText("follow you", {
      timeout: LOCATE_TIMEOUT,
    });
    await expect
      .poll(() => seenHints(page), { timeout: LOCATE_TIMEOUT })
      .toContain("active");
  });
});

// ─── Locate / Session lifecycle guards ───────────────────────────────────────

/**
 * A prompt that settles after the session has been torn down must not revive
 * orientation watching. These cases hold the iOS permission promise open, stop
 * the session, then grant it.
 */
test.describe("Locate / Session lifecycle guards", () => {
  test("stopping while the orientation prompt is pending stays stopped", async ({
    page,
  }) => {
    await withNoLocateStorage(page);
    await installGeolocationMock(page);
    await withHangingIOSOrientationPermission(page);

    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");
    await btn.click();
    await expect(page.getByText("Trust")).toBeVisible();
    await page.getByRole("button", { name: "I understand" }).click();

    await expect
      .poll(() => page.evaluate(() => window.__orientationPermissionCalls), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(1);
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: LOCATE_TIMEOUT,
      })
      .toBeGreaterThan(0);
    await emitFix(page, { lat: FIX.latitude, lng: FIX.longitude });
    await expect(btn).toContainText("Located", { timeout: LOCATE_TIMEOUT });

    await waitForCameraSettle(page, expectedHashRegExp(await orientHash(page)));
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: LOCATE_TIMEOUT });

    // Stop through the chip while the initial prompt is still outstanding.
    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: LOCATE_TIMEOUT });
    expect((await readLocate(page)).mode).toBeNull();

    // The stale continuation must not start watching for the dead session.
    expect(await resolveIOSOrientationPermission(page, "granted")).toBe(true);
    await dispatchIOSCompass(page, 90);
    await page.waitForTimeout(200);

    const state = await readLocate(page);
    expect(state.mode).toBeNull();
    expect(state.position).toBeNull();
    expect(state.compassHeading).toBeNull();
    await expect(page.locator(".ogis-locate-heading")).toHaveCount(0);
    await expect(page.locator(".ogis-locate-position")).toHaveCount(0);
  });

  test("restore settles on a boot with no persisted session", async ({
    page,
  }) => {
    await withNoLocateStorage(page);
    await installGeolocationMock(page);

    await page.goto("/");
    await waitForMapReady(page);

    expect((await readLocate(page)).mode).toBeNull();
    await expect
      .poll(async () => (await readLocate(page)).restoreSettled, {
        timeout: LOCATE_TIMEOUT,
      })
      .toBe(true);
  });
});
