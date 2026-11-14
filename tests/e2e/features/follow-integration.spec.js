import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady } from "../helpers/panel.js";
import { isSwiftShaderRun } from "../helpers/determinism.js";
import {
  LOCATE_FIX,
  emitFix,
  expectedHashRegExp,
  installGeolocationMock,
  orientHash,
  startCompassStream,
  stopCompassStream,
  waitForCameraSettle,
  withCompassCapability,
  withGrantedLocateStorage,
} from "../helpers/locate.js";
import { readStoredState } from "../helpers/storage.js";

/**
 * Tests for the locate -> follow-camera hand-off and the speed-driven chase.
 *
 * Unlike the lean driver smoke spec (`follow.spec.js`), this exercises the real
 * UI path: the locate chip drives the composable, and crafted fixes — with a
 * reported speed and heading, which `context.setGeolocation` cannot express —
 * are published through a stubbed `watchPosition`. The compass is driven by
 * real `deviceorientationabsolute` events, as in the locate spec.
 */

// Ceiling for the light camera-settle waits. SwiftShader quantises interaction
// and animation to multi-second frames, so the software path needs a much
// larger backstop; the GPU path keeps the tight budget.
const CAMERA_TIMEOUT = isSwiftShaderRun() ? 120000 : 60000;

// Heading-refresh cadence for the speed-driven chase assertions. It stays below
// the 8 s heading watchdog so the camera cannot flatten mid-check. Heading
// events only update bearing: they re-feed the last fix's timestamp, so the
// driver's 3 s dead-reckon clock keeps running across the refresh and the
// designed speed-drift goal still forms.
const COMPASS_REFRESH_MS = 6000;

// One cold-load boot plus several camera settles; the pinned software renderer
// needs a wider per-test budget than the GPU path (the heaviest chase reaches
// its final persistence checks around the six-minute mark).
test.setTimeout(isSwiftShaderRun() ? 600000 : 180000);

test.beforeEach(({ page }) => trackConsoleErrors(page));
// Every case enters Following through the locate chip, so pin a capable device.
test.beforeEach(({ page }) => withCompassCapability(page, true));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

/**
 * Snap the follow hand-off on the software renderer.
 *
 * The hand-off caps each frame's zoom movement, so reaching the close
 * navigation pose needs ~16 rendered frames. A pinned SwiftShader frame can
 * take tens of seconds here, turning the 1.6 s glide into minutes and starving
 * every assertion behind it. Reduced motion is a supported production mode
 * that snaps the hand-off in one frame; the chase phases that follow run with
 * normal motion again via {@link restoreMotion}. The GPU path keeps the glide
 * under test.
 */
const snapHandoffForSwiftShader = async (page) => {
  if (!isSwiftShaderRun()) return;
  await page.emulateMedia({ reducedMotion: "reduce" });
};

/** Restore normal motion after a SwiftShader hand-off. */
const restoreMotion = async (page) => {
  if (!isSwiftShaderRun()) return;
  await page.emulateMedia({ reducedMotion: "no-preference" });
};

const hashOf = (url) => new URL(url).hash;

/** Read the persisted view centre, unwrapping the storage envelope. */
const readPersistedCentre = async (page) => {
  const raw = await page.evaluate(() => localStorage.getItem("ogis_view_app"));
  return readStoredState(raw)?.mapView?.center ?? null;
};

/**
 * Wait until the debounced persisted view has gone quiet, then return it.
 *
 * The view store bridges camera changes to localStorage through a 300 ms
 * trailing debounce, while the URL hash is written synchronously on `moveend`.
 * A settled hash therefore does not prove storage has caught up: a legitimate
 * pending write can still land after an immediate snapshot. Two reads
 * separated by more than the debounce window resolve only once that write has
 * fired and the serialised value is stable.
 *
 * The timeout is the camera budget, not a fixed few seconds: under SwiftShader
 * a single `page.evaluate` round-trip can outlast the 350 ms quiet window, so a
 * tight timeout could expire before the second sample is taken even though
 * storage is already stable.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string|null>} The settled serialised stored view.
 */
const waitForPersistedViewQuiescent = async (page) => {
  let settled = null;
  await expect
    .poll(
      async () => {
        const before = await page.evaluate(() =>
          localStorage.getItem("ogis_view_app"),
        );
        // Span the debounce window so a pending trailing write fires between
        // the two samples.
        await page.waitForTimeout(350);
        const after = await page.evaluate(() =>
          localStorage.getItem("ogis_view_app"),
        );
        settled = after;
        return before === after;
      },
      { timeout: CAMERA_TIMEOUT },
    )
    .toBe(true);
  return settled;
};

/**
 * Wait for the debounced storage write to reach the stopped camera, then return
 * the persisted centre.
 */
const waitForPersistedCentre = async (page, expected) => {
  await expect
    .poll(
      async () => {
        const centre = await readPersistedCentre(page);
        return centre
          ? Math.abs(centre.lat - expected.lat) +
              Math.abs(centre.lng - expected.lng)
          : Number.POSITIVE_INFINITY;
      },
      { timeout: CAMERA_TIMEOUT },
    )
    .toBeLessThan(1e-6);
  return readPersistedCentre(page);
};

/** Shortest angular distance between two bearings, in degrees. */
const angleDelta = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/** Ground-plane separation between two centres, in degrees. */
const centreDelta = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng);

/**
 * Drag the map canvas to explore the camera away from the follow pose.
 *
 * The pointer can be left held (`hold`), which keeps the driver suspended
 * without arming its idle-resume timer, so a hold assertion cannot race the
 * timer.
 */
const dragMap = async (page, { dx = 140, dy = 80, hold = false } = {}) => {
  const canvas = page.locator(".ogis-map canvas");
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  // A couple of large steps clear the drag threshold; more steps only add
  // multi-second input dispatches under software rasterisation.
  await page.mouse.move(x0 + dx, y0 + dy, { steps: 2 });
  if (hold) return;
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
 * Record the exact pointerup time in-page, so the idle delay can be measured
 * from the release rather than from a slow `evaluate` round-trip.
 */
const markPointerRelease = (page) =>
  page.evaluate(() => {
    window.__dragRelease = null;
    window.addEventListener(
      "pointerup",
      () => {
        window.__dragRelease = performance.now();
      },
      { capture: true, once: true },
    );
  });

/**
 * Publish a stream of fast, course-over-ground fixes so the follow driver is
 * actively chasing while the test interacts. The longitude advances each tick
 * at a speed that matches the reported ~100 km/h.
 *
 * The stream is self-scheduling rather than a fixed `setInterval`: under
 * SwiftShader a single fix callback can outlast the interval, and an interval
 * would then queue callbacks back-to-back until the page's main thread is
 * starved. Re-arming after each emission bounds the work to the renderer's own
 * pace while still keeping fixes arriving through the drag.
 */
const startMovingFixes = (page, { lat, lng, heading = 90, intervalMs = 200 }) =>
  page.evaluate(
    ({ lat, lng, heading, interval }) => {
      if (window.__followMoveStream) clearTimeout(window.__followMoveStream);
      const metresPerTick = (100 / 3.6) * (interval / 1000);
      const lngPerTick =
        metresPerTick / (111_320 * Math.cos((lat * Math.PI) / 180));
      let offset = 0;
      const emit = () => {
        offset += lngPerTick;
        window.__geo.emit({
          latitude: lat,
          longitude: lng + offset,
          speed: 100 / 3.6,
          heading,
          accuracy: 10,
        });
        window.__followMoveStream = setTimeout(emit, interval);
      };
      emit();
    },
    { lat, lng, heading, interval: intervalMs },
  );

/** Stop the moving-fix stream. */
const stopMovingFixes = (page) =>
  page.evaluate(() => {
    if (window.__followMoveStream) clearTimeout(window.__followMoveStream);
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

/**
 * The camera centre the follow driver settles on for a fix: the fix
 * dead-reckoned forward along the bearing by the speed drift (capped at the
 * driver's 3 s window), then displaced by the composition look-ahead, which
 * seats the user in the lower third of the tilted view instead of at the exact
 * centre. Mirrors `resolveTarget` and the goal composition in
 * `useFollowCamera` through the production helpers, so the expectation follows
 * the tuning constants rather than restating them.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ lat: number, lng: number }} fix
 * @param {{ bearing: number, speedKmh?: number }} motion - Settled bearing and
 *   ground speed the driver resolved for the fix.
 * @returns {Promise<{ lat: number, lng: number }>} Settled centre.
 */
const followGoal = (page, fix, { bearing, speedKmh = 0 }) =>
  page.evaluate(
    async ({ lat, lng, bearing, speedKmh }) => {
      const {
        deadReckon,
        lookAheadMetres,
        navigationZoomForSpeed,
        pitchForSpeedKmh,
      } = await import("/src/utils/follow.js");
      const { followCameraDefaults } =
        await import("/src/defaults/maplibre.js");
      const { getMapInstance } = await import("/src/composables/useMap.js");
      const map = getMapInstance("app");
      const heightPx = map.getCanvas().clientHeight;
      const pitch = Math.max(
        pitchForSpeedKmh(speedKmh),
        followCameraDefaults.restPitch,
      );
      const zoom = navigationZoomForSpeed(speedKmh);
      const lookAhead = lookAheadMetres({
        pitchDeg: pitch,
        zoom,
        latitude: lat,
        viewportHeightPx: heightPx,
        maxOffsetFraction: followCameraDefaults.maxOffsetFraction,
        offsetRampPitchDeg: followCameraDefaults.offsetRampPitchDeg,
      });
      // A moving fix is dead-reckoned at most 3 s ahead, so its goal
      // saturates at this drift.
      const driftMetres = (speedKmh / 3.6) * 3;
      const drifted = deadReckon({ lat, lng }, bearing, driftMetres);
      return deadReckon(drifted, bearing, lookAhead);
    },
    { lat: fix.lat, lng: fix.lng, bearing, speedKmh },
  );

/**
 * The position the follow driver dead-reckons a moving fix to once its clock
 * saturates: the fix advanced along the travel bearing by the 3 s speed drift,
 * with no composition look-ahead. This is the target a heading-loss retarget
 * resolves to, because a flattened pose contributes no look-ahead.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ lat: number, lng: number }} fix
 * @param {{ bearing: number, speedKmh: number }} motion
 * @returns {Promise<{ lat: number, lng: number }>}
 */
const followDriftGoal = (page, fix, { bearing, speedKmh }) =>
  page.evaluate(
    async ({ lat, lng, bearing, speedKmh }) => {
      const { deadReckon } = await import("/src/utils/follow.js");
      // Mirrors the driver's 3 s dead-reckon cap.
      return deadReckon({ lat, lng }, bearing, (speedKmh / 3.6) * 3);
    },
    { lat: fix.lat, lng: fix.lng, bearing, speedKmh },
  );

/**
 * Begin recording the live camera pose every animation frame. Each sample
 * carries its rAF timestamp so motion can be judged as a rate over real time.
 */
const startCameraSampler = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const map = getMapInstance("app");
    window.__camSamples = [];
    const tick = (now) => {
      const c = map.getCenter();
      window.__camSamples.push({
        t: now,
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
    await expect(btn).toContainText("Locating…", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeGreaterThan(0);

    await emitFix(page, {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude,
    });
    await expect(btn).toContainText("Located", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeGreaterThan(0);
    // Start a live compass stream: a single event would be cleared by the ~8 s
    // heading watchdog before the (slow) follow click reads it. The slower
    // heartbeat keeps the heading live through the fast phase without resetting
    // the dead-reckon clock faster than the driver's 3 s cap.
    await startCompassStream(page, 90, COMPASS_REFRESH_MS);

    await waitForCameraSettle(
      page,
      expectedHashRegExp(await orientHash(page)),
      CAMERA_TIMEOUT,
    );

    // 2. Following: capture the settled rest pose. The hand-off glides from
    // the wide locate flight into the close third-person navigation view,
    // which rests at 45° and is yawed to the compass, while the hash and
    // localStorage stay put — persistence is suppressed until stop.
    //
    // The hash settles synchronously on `moveend`, but the view store debounces
    // its localStorage write by 300 ms, so the last orientation-flight write
    // can land after the hash. Let storage go quiet before snapshotting it, or
    // that legitimate write races the snapshot.
    const flightHash = hashOf(page.url());
    const storedBefore = await waitForPersistedViewQuiescent(page);
    const restZoom = await navigationZoom(page, 0);
    const fastZoom = await navigationZoom(page, 100);

    // On SwiftShader the hand-off glide would need ~16 rendered frames at tens
    // of seconds each; snap it with reduced motion and sample only the chase.
    const swiftshader = isSwiftShaderRun();
    await snapHandoffForSwiftShader(page);

    // Start sampling before the hand-off so the transition itself is captured.
    if (!swiftshader) await startCameraSampler(page);

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

    // The chase phases below run with normal motion so the damping rate and
    // pose assertions still cover the real driver.
    await restoreMotion(page);
    if (swiftshader) await startCameraSampler(page);

    // The compass stream stays live through the walking and fast phases: with
    // compass-only 3D, the 8 s heading watchdog would otherwise flatten the
    // camera mid-test once the stream stops.

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
    const fastFix = {
      lat: LOCATE_FIX.latitude - 0.002,
      lng: LOCATE_FIX.longitude,
    };
    await emitFix(page, { ...fastFix, speed: 100 / 3.6, heading: 180 });
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

    // The centre converges on the fast fix's designed follow goal: the fix
    // dead-reckoned south by the capped speed drift, then displaced by the
    // composition look-ahead of the 60° tilted view.
    const fastGoal = await followGoal(page, fastFix, {
      bearing: 180,
      speedKmh: 100,
    });
    await expect
      .poll(
        async () => centreDelta((await readCamera(page)).center, fastGoal),
        { timeout: CAMERA_TIMEOUT },
      )
      .toBeLessThan(0.0002);

    // 5. The camera glides without teleporting: the invariant is the rate of
    // change, not a per-frame delta. The driver damps on real elapsed time, so
    // after a slow frame it deliberately closes the whole remaining gap in one
    // step — a large per-frame delta is expected, but it spans a
    // correspondingly long frame, keeping the designed rate: the damped
    // bearing (τ 0.3 s over at most a 90° chase per leg) and the eased
    // hand-off glide both peak below ~300°/s, whereas a jumpTo-style
    // discontinuity would move the bearing by thousands of degrees per second.
    const samples = await stopCameraSampler(page);
    expect(samples.length).toBeGreaterThan(10);

    let maxBearingRate = 0;
    let maxPitchDelta = 0;
    let maxZoomDelta = 0;
    for (let i = 1; i < samples.length; i++) {
      // The damped step is sized from the interval before it but measured over
      // the interval after it, so an uneven frame inflates the quotient by
      // dt_prev / dt_next. Dividing by the longer bracketing interval removes
      // that inflation, upper-bounding the true step rate.
      const dtOwn = (samples[i].t - samples[i - 1].t) / 1000;
      const dtPrev =
        i < 2 ? dtOwn : (samples[i - 1].t - samples[i - 2].t) / 1000;
      const dtSeconds = Math.max(dtOwn, dtPrev);
      if (dtSeconds > 0) {
        maxBearingRate = Math.max(
          maxBearingRate,
          angleDelta(samples[i].bearing, samples[i - 1].bearing) / dtSeconds,
        );
      }
      maxPitchDelta = Math.max(
        maxPitchDelta,
        Math.abs(samples[i].pitch - samples[i - 1].pitch),
      );
      maxZoomDelta = Math.max(
        maxZoomDelta,
        Math.abs(samples[i].zoom - samples[i - 1].zoom),
      );
    }
    expect(maxBearingRate).toBeLessThan(400);
    expect(maxPitchDelta).toBeLessThan(45);
    expect(maxZoomDelta).toBeLessThan(0.6);

    // Every pose-dependent check above is complete, so the stream can stop: the
    // 8 s heading watchdog would otherwise flatten the camera mid-check once the
    // last orientation event ages out.
    await stopCompassStream(page);

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

    const persisted = await waitForPersistedCentre(page, stopped.center);
    expect(persisted.lat).toBeCloseTo(stopped.center.lat, 6);
    expect(persisted.lng).toBeCloseTo(stopped.center.lng, 6);

    const afterStop = hashOf(page.url());
    await page.waitForTimeout(600);
    expect(hashOf(page.url())).toBe(afterStop);
  });

  test("keeps dead reckoning across a GPS gap while the compass streams", async ({
    page,
  }) => {
    await withGrantedLocateStorage(page);
    await installGeolocationMock(page);
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");

    await btn.click();
    await expect(btn).toContainText("Locating…", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeGreaterThan(0);
    await emitFix(page, {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude,
    });
    await expect(btn).toContainText("Located", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(() => page.locator(".ogis-locate-position").count(), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeGreaterThan(0);

    // A 1 s heartbeat is aggressive enough to expose the old bug: every
    // orientation event re-fed the camera with a fresh timestamp, resetting
    // the dead-reckon clock and pinning the centre to the raw fix. Heading
    // events must instead keep the last fix's time so the position drift still
    // reaches its 3 s cap.
    await startCompassStream(page, 90, 1000);
    await waitForCameraSettle(
      page,
      expectedHashRegExp(await orientHash(page)),
      CAMERA_TIMEOUT,
    );

    await snapHandoffForSwiftShader(page);
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(async () => Math.abs((await readCamera(page)).bearing - 90), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);
    await restoreMotion(page);

    // One moving fix, then no more: only dead reckoning can carry the camera
    // east while the compass heartbeat continues.
    const fix = {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude,
    };
    await emitFix(page, { ...fix, speed: 100 / 3.6, heading: 90 });

    const goal = await followGoal(page, fix, { bearing: 90, speedKmh: 100 });
    await expect
      .poll(async () => centreDelta((await readCamera(page)).center, goal), {
        timeout: CAMERA_TIMEOUT,
        message:
          "follow camera did not dead-reckon across the GPS gap while the compass streamed",
      })
      .toBeLessThan(0.0002);

    await stopCompassStream(page);
  });

  test("flattens on heading loss without snapping the dead-reckoned centre back to the fix", async ({
    page,
  }) => {
    await withGrantedLocateStorage(page);
    await installGeolocationMock(page);
    await page.goto("/");
    await waitForMapReady(page);

    const btn = page.locator("#locate-button");

    await btn.click();
    await expect(btn).toContainText("Locating…", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeGreaterThan(0);
    await emitFix(page, {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude,
    });
    await expect(btn).toContainText("Located", { timeout: CAMERA_TIMEOUT });
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

    await snapHandoffForSwiftShader(page);
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(async () => Math.abs((await readCamera(page)).bearing - 90), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);
    await restoreMotion(page);

    // One recent moving fix: the chase dead-reckons east from it. Wait for the
    // designed goal to form, which also proves the driver's clock is running.
    const fix = {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude,
    };
    await emitFix(page, { ...fix, speed: 100 / 3.6, heading: 90 });
    const chaseGoal = await followGoal(page, fix, {
      bearing: 90,
      speedKmh: 100,
    });
    await expect
      .poll(
        async () => centreDelta((await readCamera(page)).center, chaseGoal),
        {
          timeout: CAMERA_TIMEOUT,
        },
      )
      .toBeLessThan(0.0002);

    // Sample every frame across the loss, then stop the compass. The watchdog
    // fires 8 s later; the flatten and the centre's glide are captured on-page
    // so a slow evaluate round-trip cannot miss the moment the pose flattens.
    await startCameraSampler(page);
    await stopCompassStream(page);
    const lossStartedAt = await page.evaluate(() => performance.now());

    await expect
      .poll(
        async () => {
          const cam = await readCamera(page);
          return Math.abs(cam.pitch) + Math.abs(cam.bearing);
        },
        {
          timeout: CAMERA_TIMEOUT,
          message: "camera did not flatten after the heading watchdog fired",
        },
      )
      .toBeLessThan(2);

    const samples = await stopCameraSampler(page);
    const flattened = samples.find(
      (sample) =>
        sample.t > lossStartedAt &&
        Math.abs(sample.pitch) < 1 &&
        Math.abs(sample.bearing) < 1,
    );
    expect(flattened).toBeTruthy();

    // Heading loss flattens the pose, but the centre must keep the position
    // dead-reckoned from the existing fix timestamp rather than restarting the
    // clock and snapping back to the raw fix.
    const driftGoal = await followDriftGoal(page, fix, {
      bearing: 90,
      speedKmh: 100,
    });
    expect(Math.abs(flattened.pitch)).toBeLessThan(1);
    expect(Math.abs(flattened.bearing)).toBeLessThan(1);
    expect(flattened.lng).toBeGreaterThan(driftGoal.lng - 0.0002);
    expect(flattened.lng).toBeLessThan(driftGoal.lng + 0.0002);
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
    await expect(btn).toContainText("Locating…", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeGreaterThan(0);
    await emitFix(page, {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude,
    });
    await expect(btn).toContainText("Located", { timeout: CAMERA_TIMEOUT });
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

    // The stream stays live through the slow follow click, so the heading
    // cannot be cleared before the driver starts.
    await snapHandoffForSwiftShader(page);
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(async () => Math.abs((await readCamera(page)).bearing - 90), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);
    await restoreMotion(page);

    // Keep the compass stream live through the drag, the idle delay and the
    // resume: compass-only 3D authorises the 45° pose only while a heading is
    // fresh, and the 8 s watchdog would flatten the camera mid-test if the
    // stream stopped here. It is stopped after the final pose check below.
    const restPose = await readCamera(page);

    // 2. A user drag suspends the driver: hold the pointer down so the idle
    // timer cannot start mid-assertion, and confirm the camera stays where it
    // was left with the chip still reading Following (no mode change, no
    // immediate recentre).
    const idleResumeDelayMs = await page.evaluate(async () => {
      const { followCameraDefaults } =
        await import("/src/defaults/maplibre.js");
      return followCameraDefaults.idleResumeDelayMs;
    });
    await startCameraSampler(page);
    await markPointerRelease(page);
    await dragMap(page, { dx: 140, dy: 80, hold: true });
    await expect(btn).toContainText("Following");

    const draggedPose = await readCamera(page);
    expect(centreDelta(draggedPose.center, restPose.center)).toBeGreaterThan(
      0.0005,
    );

    // Timer-free: while the pointer is held the driver cannot resume, so this
    // hold cannot race the idle delay even when each read is slow.
    await page.waitForTimeout(900);
    const heldPose = await readCamera(page);
    expect(centreDelta(heldPose.center, draggedPose.center)).toBeLessThan(
      0.0005,
    );
    await expect(btn).toContainText("Following");

    // 3. Release: the idle delay starts from pointerup. Past the delay plus
    // glide, the camera returns to the follow pose.
    await page.mouse.up();
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

    // The continuous sampler records the release-to-resume gap on-page, so the
    // idle delay is not sampled through slow round-trips: the camera must not
    // reach the follow pose before the delay has elapsed.
    const releaseAt = await page.evaluate(() => window.__dragRelease);
    expect(releaseAt).not.toBeNull();
    const samples = await stopCameraSampler(page);
    const resumed = samples.find(
      (sample) =>
        sample.t > releaseAt && centreDelta(sample, restPose.center) < 0.0005,
    );
    expect(resumed).toBeTruthy();
    expect(resumed.t - releaseAt).toBeGreaterThanOrEqual(
      idleResumeDelayMs - 100,
    );

    // The resume returned to the chase pose, so the heading is no longer
    // needed; stop the stream before the terminal stop (the 8 s watchdog would
    // flatten the camera once the last orientation event ages out).
    await stopCompassStream(page);

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

    const persisted = await waitForPersistedCentre(page, stopped.center);
    expect(persisted.lat).toBeCloseTo(stopped.center.lat, 6);
    expect(persisted.lng).toBeCloseTo(stopped.center.lng, 6);

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
    await expect(btn).toContainText("Locating…", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeGreaterThan(0);
    await emitFix(page, {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude,
    });
    await expect(btn).toContainText("Located", { timeout: CAMERA_TIMEOUT });
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

    await snapHandoffForSwiftShader(page);
    await btn.click();
    await expect(btn).toContainText("Following", { timeout: CAMERA_TIMEOUT });
    await expect
      .poll(async () => Math.abs((await readCamera(page)).bearing - 90), {
        timeout: CAMERA_TIMEOUT,
      })
      .toBeLessThan(1);
    await restoreMotion(page);

    const restPose = await readCamera(page);

    // 2. Put the driver under load: a fast fix stream tilts and pulls the
    // camera back while it chases, so the drag below starts mid-motion.
    await startMovingFixes(page, {
      lat: LOCATE_FIX.latitude,
      lng: LOCATE_FIX.longitude,
    });
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

    // 5. Past the idle delay plus glide, the camera returns to the designed
    // follow pose for the final fix (0 km/h, so no drift): the fix displaced
    // along the bearing by the composition look-ahead, which seats the user in
    // the lower third of the tilted view — the centre does not rest on the
    // raw fix, and this assertion fails if the camera strays from the pose.
    const finalGoal = await followGoal(page, finalFix, { bearing: 90 });
    await expect
      .poll(
        async () => centreDelta((await readCamera(page)).center, finalGoal),
        {
          timeout: CAMERA_TIMEOUT,
        },
      )
      .toBeLessThan(0.0002);
    await expect(btn).toContainText("Following");

    await stopCompassStream(page);
  });
});
