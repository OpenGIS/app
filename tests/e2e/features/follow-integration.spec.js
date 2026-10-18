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
  startCompassStream,
  stopCompassStream,
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

// Generous backstop for the light camera-settle waits, not an expected
// duration: software rasterisation renders slowly, so a single animation frame
// can be seconds apart.
const CAMERA_TIMEOUT = 60000;

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

/** Ground-plane separation between two centres, in degrees. */
const centreDelta = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng);

/** Drag the map canvas to explore the camera away from the follow pose. */
const dragMap = async (page, { dx = 140, dy = 80 } = {}) => {
  const canvas = page.locator(".ogis-map canvas");
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + dx, y0 + dy, { steps: 12 });
  await page.mouse.up();
  // Wait for pan inertia to finish before reading the settled pose.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { getMapInstance } = await import("/src/composables/useMap.js");
          return getMapInstance("app").isMoving();
        }),
      { timeout: 30000 },
    )
    .toBe(false);
};

/**
 * Publish a stream of fast, course-over-ground fixes so the follow driver is
 * actively chasing while the test interacts. The longitude advances every tick
 * at a speed that matches the reported ~100 km/h.
 */
const startMovingFixes = (page, { lat, lng, heading = 90, intervalMs = 80 }) =>
  page.evaluate(
    ({ lat, lng, heading, interval }) => {
      if (window.__followMoveStream) clearInterval(window.__followMoveStream);
      let offset = 0;
      const emit = () => {
        offset += 0.00003;
        window.__geo.emit({
          latitude: lat,
          longitude: lng + offset,
          speed: 100 / 3.6,
          heading,
          accuracy: 10,
        });
      };
      emit();
      window.__followMoveStream = setInterval(emit, interval);
    },
    { lat, lng, heading, interval: intervalMs },
  );

/** Stop the moving-fix stream. */
const stopMovingFixes = (page) =>
  page.evaluate(() => {
    if (window.__followMoveStream) clearInterval(window.__followMoveStream);
    window.__followMoveStream = null;
  });

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

/** The navigation zoom the follow camera derives for a ground speed. */
const navigationZoom = (page, speedKmh) =>
  page.evaluate(async (speed) => {
    const { navigationZoomForSpeed } = await import("/src/utils/follow.js");
    return navigationZoomForSpeed(speed);
  }, speedKmh);

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
    // Start a live compass stream: a single event would be cleared by the ~8 s
    // heading watchdog before the (slow) follow click reads it.
    await startCompassStream(page, 90);

    await waitForCameraSettle(
      page,
      expectedHashRegExp(await orientHash(page)),
      CAMERA_TIMEOUT,
    );

    // 2. Following: capture the settled rest pose. The hand-off glides from
    // the wide locate flight into the close third-person navigation view,
    // which rests at 45° and is yawed to the compass, while the hash and
    // localStorage stay put — persistence is suppressed until stop.
    const flightHash = hashOf(page.url());
    const storedBefore = await page.evaluate(() =>
      localStorage.getItem("ogis_view_app"),
    );
    const restZoom = await navigationZoom(page, 0);
    const fastZoom = await navigationZoom(page, 100);

    // Start sampling before the hand-off so the transition itself is captured.
    await startCameraSampler(page);

    // The compass stream is already live, so the heading is fresh at the click.
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: CAMERA_TIMEOUT });

    await expect
      .poll(async () => Math.abs((await readCamera(page)).bearing - 90), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);

    // The hand-off glides in from the wide locate flight; wait for the close
    // navigation zoom to settle before reading the rest pose.
    await expect
      .poll(async () => Math.abs((await readCamera(page)).zoom - restZoom), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(0.02);

    const rest = await readCamera(page);
    expect(rest.pitch).toBeCloseTo(45, 1);
    expect(rest.zoom).toBeCloseTo(restZoom, 1);
    expect(hashOf(page.url())).toBe(flightHash);
    expect(
      await page.evaluate(() => localStorage.getItem("ogis_view_app")),
    ).toBe(storedBefore);
    await stopCompassStream(page);

    // 3. Walking (~5 km/h east): the pitch stays on the 45° third-person rest
    // floor, which still out-tilts the 32° speed-curve keyframe.
    await emitFix(page, {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude + 0.0005,
      speed: 5 / 3.6,
      heading: 90,
    });
    await expect
      .poll(async () => Math.abs((await readCamera(page)).pitch - 45), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);

    // 4. Fast (100 km/h, course turned south): pitch 60°, the bearing turns to
    // the course over ground, and the zoom pulls back to the navigation
    // high-speed baseline.
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
      .poll(async () => Math.abs((await readCamera(page)).zoom - fastZoom), {
        timeout: CAMERA_TIMEOUT,
      })
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

  test("suspends on a user drag, resumes after the idle delay, then persists once on stop", async ({
    page,
  }) => {
    await withGrantedLocateStorage(page);
    await installGeolocationMock(page);
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");

    // 1. Reach following with a settled third-person rest pose (45°, yawed to
    // the compass).
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

    await dispatchCompass(page, 90);
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(async () => Math.abs((await readCamera(page)).bearing - 90), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);

    const restPose = await readCamera(page);

    // 2. A user drag suspends the driver: the camera stays where it was left
    // and the chip still reads Following (no mode change, no immediate
    // recentre).
    await dragMap(page, { dx: 140, dy: 80 });
    await expect(btn).toContainText("Following");

    const draggedPose = await readCamera(page);
    expect(centreDelta(draggedPose.center, restPose.center)).toBeGreaterThan(
      0.0005,
    );

    // Well within the idle delay the camera holds the user's pose.
    await page.waitForTimeout(1500);
    const heldPose = await readCamera(page);
    expect(centreDelta(heldPose.center, draggedPose.center)).toBeLessThan(
      0.0005,
    );
    await expect(btn).toContainText("Following");

    // 3. Past the idle delay plus glide, the camera returns to the follow pose.
    await expect
      .poll(
        async () =>
          angleDelta((await readCamera(page)).bearing, restPose.bearing),
        { timeout: CAMERA_TIMEOUT },
      )
      .toBeLessThan(2);
    await expect
      .poll(
        async () =>
          centreDelta((await readCamera(page)).center, restPose.center),
        { timeout: CAMERA_TIMEOUT },
      )
      .toBeLessThan(0.0005);
    await expect(btn).toContainText("Following");

    // 4. Stop: the final camera is persisted exactly once, through the normal
    // view-persistence path, then stays put.
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

  test("takes a fast drag while the camera is moving, then glides back", async ({
    page,
  }) => {
    await withGrantedLocateStorage(page);
    await installGeolocationMock(page);
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");

    // 1. Reach following with a settled rest pose.
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
    await startCompassStream(page, 90);
    await waitForCameraSettle(
      page,
      expectedHashRegExp(await orientHash(page)),
      CAMERA_TIMEOUT,
    );

    await btn.click();
    await expect(btn).toContainText("Following", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(async () => Math.abs((await readCamera(page)).bearing - 90), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);

    const restPose = await readCamera(page);

    // 2. Put the driver under load: a fast fix stream tilts and pulls the
    // camera back while it chases, so the drag below starts mid-motion.
    await startMovingFixes(page, LOCATE_FIX);
    await expect
      .poll(async () => (await readCamera(page)).pitch, {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeGreaterThan(5);

    // 3. A fast drag with the button held. The capture-phase pointerdown must
    // stop the loop before MapLibre resets its gesture handlers.
    const canvas = page.locator(".ogis-map canvas");
    const box = await canvas.boundingBox();
    const x0 = box.x + box.width / 2;
    const y0 = box.y + box.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 220, y0 + 140, { steps: 2 });

    const draggedPose = await readCamera(page);
    expect(centreDelta(draggedPose.center, restPose.center)).toBeGreaterThan(
      0.0005,
    );

    // The fixes keep arriving, but the camera holds the dragged pose for as
    // long as the pointer is down, and the chip still reads Following.
    await page.waitForTimeout(900);
    const heldPose = await readCamera(page);
    expect(centreDelta(heldPose.center, draggedPose.center)).toBeLessThan(
      0.0005,
    );
    await expect(btn).toContainText("Following");

    // 4. Release: the idle timer starts from pointerup. Stop the stream at a
    // known rest fix so the follow pose is deterministic.
    await page.mouse.up();
    await stopMovingFixes(page);
    const finalFix = {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude + 0.0005,
    };
    await emitFix(page, { ...finalFix, speed: 0 });
    await expect(btn).toContainText("Following");

    // 5. Past the idle delay plus glide, the camera returns to the follow pose.
    await expect
      .poll(
        async () => centreDelta((await readCamera(page)).center, finalFix),
        {
          timeout: CAMERA_TIMEOUT,
        },
      )
      .toBeLessThan(0.0005);
    await expect(btn).toContainText("Following");

    await stopCompassStream(page);
  });
});
