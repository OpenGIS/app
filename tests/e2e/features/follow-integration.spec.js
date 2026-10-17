import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady } from "../helpers/panel.js";
import {
  LOCATE_FIX,
  dispatchCompass,
  emitFix,
  expectedHashRegExp,
  installGeolocationMock,
  orientHash,
  waitForCameraSettle,
  withGrantedLocateStorage,
} from "../helpers/locate.js";

/**
 * Tests for the locate -> follow-camera hand-off and the speed-driven chase.
 *
 * Unlike the lean driver smoke spec (`follow.spec.js`), this exercises the real
 * UI path: the locate chip drives the composable, and crafted fixes — with a
 * reported speed and heading, which `context.setGeolocation` cannot express —
 * are published through a stubbed `watchPosition`. The compass is driven by
 * real `deviceorientationabsolute` events, as in the locate spec.
 */

const CAMERA_TIMEOUT = 30000;

// One cold-load boot plus several camera settles; ample headroom under
// SwiftShader.
test.setTimeout(180000);

test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

const hashOf = (url) => new URL(url).hash;

/** Shortest angular distance between two bearings, in degrees. */
const angleDelta = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/** Read the live camera through the page's own module graph. */
const readCamera = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const map = getMapInstance("app");
    const c = map.getCenter();
    return {
      center: { lat: c.lat, lng: c.lng },
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      zoom: map.getZoom(),
    };
  });

/** The horizon-fit zoom the follow camera rests at for a latitude. */
const followFit = (page, latitude) =>
  page.evaluate(async (lat) => {
    const { followFitZoom } = await import("/src/utils/follow.js");
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const canvas = getMapInstance("app").getCanvas();
    return followFitZoom({
      widthPx: canvas.clientWidth,
      heightPx: canvas.clientHeight,
      latitude: lat,
    });
  }, latitude);

/** Begin recording the live camera pose every animation frame. */
const startCameraSampler = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const map = getMapInstance("app");
    window.__camSamples = [];
    const tick = () => {
      const c = map.getCenter();
      window.__camSamples.push({
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        zoom: map.getZoom(),
        lat: c.lat,
        lng: c.lng,
      });
      window.__camRaf = requestAnimationFrame(tick);
    };
    window.__camRaf = requestAnimationFrame(tick);
  });

/** Stop recording and return the captured poses. */
const stopCameraSampler = (page) =>
  page.evaluate(() => {
    if (window.__camRaf !== null) cancelAnimationFrame(window.__camRaf);
    window.__camRaf = null;
    return window.__camSamples;
  });

test.describe("Follow / Locate chase", () => {
  test("hands locate off to the speed-driven camera with no jump cut", async ({
    page,
  }) => {
    await withGrantedLocateStorage(page);
    await installGeolocationMock(page);
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");

    // 1. Active: publish a rest fix (carrying a null speed/heading), a compass
    // event, then let the one-shot orientation flight settle.
    await btn.click();
    await expect(btn).toContainText("Located", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeGreaterThan(0);

    await emitFix(page, {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude,
    });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeGreaterThan(0);
    await dispatchCompass(page, 90);

    await waitForCameraSettle(
      page,
      expectedHashRegExp(await orientHash(page)),
      CAMERA_TIMEOUT,
    );

    // 2. Following: capture the settled rest pose. It is flat, fitted to the
    // horizon disc and yawed to the compass, while the hash and localStorage
    // stay put — persistence is suppressed until stop.
    const flightHash = hashOf(page.url());
    const storedBefore = await page.evaluate(() =>
      localStorage.getItem("ogis_view_app"),
    );
    const fitZoom = await followFit(page, LOCATE_FIX.latitude);

    // Start sampling before the hand-off so the transition itself is captured.
    await startCameraSampler(page);

    // The heading watchdog clears a stale reading after ~8 s, so refresh the
    // compass right before the click that feeds it to the camera.
    await dispatchCompass(page, 90);
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: CAMERA_TIMEOUT });

    await expect
      .poll(async () => Math.abs((await readCamera(page)).bearing - 90), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);

    const rest = await readCamera(page);
    expect(rest.pitch).toBeLessThan(1);
    expect(rest.zoom).toBeCloseTo(fitZoom, 1);
    expect(hashOf(page.url())).toBe(flightHash);
    expect(
      await page.evaluate(() => localStorage.getItem("ogis_view_app")),
    ).toBe(storedBefore);

    // 3. Walking (~5 km/h east): the pitch rises to the 32° keyframe.
    await emitFix(page, {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude + 0.0005,
      speed: 5 / 3.6,
      heading: 90,
    });
    await expect
      .poll(async () => Math.abs((await readCamera(page)).pitch - 32), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);

    // 4. Fast (100 km/h, course turned south): pitch 60°, the bearing turns to
    // the course over ground, and the zoom pulls back one level from the fit.
    await emitFix(page, {
      lat: LOCATE_FIX.latitude - 0.002,
      lng: LOCATE_FIX.longitude,
      speed: 100 / 3.6,
      heading: 180,
    });
    await expect
      .poll(async () => Math.abs((await readCamera(page)).pitch - 60), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);
    await expect
      .poll(async () => angleDelta((await readCamera(page)).bearing, 180), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(5);
    await expect
      .poll(
        async () => Math.abs((await readCamera(page)).zoom - (fitZoom - 1)),
        { timeout: CAMERA_TIMEOUT },
      )
      .toBeLessThan(0.2);

    // 5. Bound the per-frame camera delta across the whole hand-off and chase:
    // damped motion never produces a jump cut.
    const samples = await stopCameraSampler(page);
    expect(samples.length).toBeGreaterThan(10);

    let maxBearingDelta = 0;
    let maxPitchDelta = 0;
    let maxZoomDelta = 0;
    for (let i = 1; i < samples.length; i++) {
      maxBearingDelta = Math.max(
        maxBearingDelta,
        angleDelta(samples[i].bearing, samples[i - 1].bearing),
      );
      maxPitchDelta = Math.max(
        maxPitchDelta,
        Math.abs(samples[i].pitch - samples[i - 1].pitch),
      );
      maxZoomDelta = Math.max(
        maxZoomDelta,
        Math.abs(samples[i].zoom - samples[i - 1].zoom),
      );
    }
    expect(maxBearingDelta).toBeLessThan(45);
    expect(maxPitchDelta).toBeLessThan(45);
    expect(maxZoomDelta).toBeLessThan(0.6);

    // 6. Stop: the final camera is persisted exactly once, through the normal
    // view-persistence path, and then stays put.
    await btn.click();
    await expect(btn).toContainText("Locate", { timeout: CAMERA_TIMEOUT });

    const stopped = await readCamera(page);
    const expectedHash = await page.evaluate(async () => {
      const { getMapInstance } = await import("/src/composables/useMap.js");
      const { formatUrlHash } = await import("/src/composables/useUrlHash.js");
      const map = getMapInstance("app");
      const c = map.getCenter();
      return formatUrlHash(
        map.getZoom(),
        c.lat,
        c.lng,
        map.getPitch(),
        map.getBearing(),
      );
    });
    await expect
      .poll(() => hashOf(page.url()), { timeout: CAMERA_TIMEOUT })
      .toBe(expectedHash);

    const persisted = await page.evaluate(() => {
      const raw = localStorage.getItem("ogis_view_app");
      return raw ? JSON.parse(raw).mapView : null;
    });
    expect(persisted.center.lat).toBeCloseTo(stopped.center.lat, 6);
    expect(persisted.center.lng).toBeCloseTo(stopped.center.lng, 6);

    const afterStop = hashOf(page.url());
    await page.waitForTimeout(600);
    expect(hashOf(page.url())).toBe(afterStop);
  });
});
