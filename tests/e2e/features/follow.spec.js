import { mkdirSync } from "node:fs";
import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady } from "../helpers/panel.js";
import { projectionType } from "../helpers/mapProjection.js";
import { DEMO } from "../../fixtures/demo.mjs";

/**
 * Tests for the follow-camera driver (`useFollowCamera`).
 *
 * This is a lean driver smoke spec: it drives the composable directly through
 * the page's own module graph, with no feature UI. It proves the driver tilts
 * the camera to the target, frames the user in the lower third, withholds view
 * persistence while active, persists the final pose once on stop, and releases
 * persistence afterwards.
 */

// Ceiling for the light camera-settle waits. The camera should arrive within a
// second; this is a generous backstop, not an expected duration.
const CAMERA_TIMEOUT = 60000;

// Temp artefact — never the committed tree (see AGENTS.md).
const SCREENSHOT_PATH = ".opencode/tmp/follow-driver.png";

// One cold-load boot plus camera settles; keep ample headroom under SwiftShader.
test.setTimeout(180000);

// Assert a clean console for the spec (see helpers/console.js).
test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

const hashOf = (url) => new URL(url).hash;

/** Start the driver and set a target, through the page's own module graph. */
const startDriver = (page, target) =>
  page.evaluate(async (next) => {
    const { useFollowCamera } =
      await import("/src/composables/useFollowCamera.js");
    const driver = useFollowCamera("app");
    window.__followDriver = driver;
    driver.start();
    driver.setTarget(next);
    return driver.isActive.value;
  }, target);

const readPitch = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    return getMapInstance("app").getPitch();
  });

/**
 * The target's projected screen y and the viewport height, read from the live
 * map, proving the lower-third composition.
 */
const targetScreenY = (page, target) =>
  page.evaluate(async (next) => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const map = getMapInstance("app");
    const height = map.getCanvas().clientHeight;
    const { y } = map.project([next.lng, next.lat]);
    return { y, height };
  }, target);

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

test.describe("Follow / Camera driver", () => {
  // The demo-area centre as the followed position; a hard 90° bearing and the
  // maximum pitch frame it in the lower third.
  const TARGET = {
    lat: DEMO.center.lat,
    lng: DEMO.center.lng,
    bearing: 90,
    pitch: 60,
    zoom: 17,
  };

  test("drives a tilted lower-third view, withholds persistence while active and persists once on stop", async ({
    page,
  }) => {
    // Seed a known flat, north-up view and boot from the hash.
    const startHash = `#map=14/${DEMO.center.lat.toFixed(6)}/${DEMO.center.lng.toFixed(6)}/0/0`;
    await page.goto(`/${startHash}`);
    await waitForMapReady(page);

    const seededHash = hashOf(page.url());
    const storedBefore = await page.evaluate(() =>
      localStorage.getItem("ogis_view_app"),
    );

    expect(await startDriver(page, TARGET)).toBe(true);

    // The camera settles at the target tilt, keeping the globe projection.
    await expect
      .poll(() => readPitch(page), { timeout: CAMERA_TIMEOUT })
      .toBeGreaterThan(59.5);
    expect(await projectionType(page)).toBe("globe");

    // Lower third: the followed coordinate projects below the vertical midpoint.
    await expect
      .poll(
        async () => {
          const { y, height } = await targetScreenY(page, TARGET);
          return y > height * 0.55;
        },
        { timeout: CAMERA_TIMEOUT },
      )
      .toBe(true);

    // While the driver owns the camera, neither the hash nor localStorage move.
    expect(hashOf(page.url())).toBe(seededHash);
    expect(
      await page.evaluate(() => localStorage.getItem("ogis_view_app")),
    ).toBe(storedBefore);

    mkdirSync(".opencode/tmp", { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH });

    // Stop: the final camera is persisted exactly once, through the normal path.
    const finalState = await page.evaluate(async () => {
      window.__followDriver.stop();
      const { getMapInstance } = await import("/src/composables/useMap.js");
      const { formatUrlHash } = await import("/src/composables/useUrlHash.js");
      const map = getMapInstance("app");
      const c = map.getCenter();
      return {
        hash: formatUrlHash(
          map.getZoom(),
          c.lat,
          c.lng,
          map.getPitch(),
          map.getBearing(),
        ),
        center: { lat: c.lat, lng: c.lng },
      };
    });

    await expect
      .poll(() => hashOf(page.url()), { timeout: CAMERA_TIMEOUT })
      .toBe(finalState.hash);

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const raw = localStorage.getItem("ogis_view_app");
            return raw ? JSON.parse(raw).mapView : null;
          }),
        { timeout: CAMERA_TIMEOUT },
      )
      .not.toBeNull();

    const persisted = await page.evaluate(() => {
      const raw = localStorage.getItem("ogis_view_app");
      return raw ? JSON.parse(raw).mapView : null;
    });
    expect(persisted.center.lat).toBeCloseTo(finalState.center.lat, 6);
    expect(persisted.center.lng).toBeCloseTo(finalState.center.lng, 6);

    // The camera no longer moves once the driver has stopped.
    const before = await readCamera(page);
    await page.waitForTimeout(800);
    const after = await readCamera(page);
    expect(after.center.lat).toBeCloseTo(before.center.lat, 6);
    expect(after.center.lng).toBeCloseTo(before.center.lng, 6);
    expect(after.bearing).toBeCloseTo(before.bearing, 3);

    // Release sanity: a programmatic move persists again (suppression released).
    const movedHash = await page.evaluate(async () => {
      const { getMapInstance } = await import("/src/composables/useMap.js");
      const { formatUrlHash } = await import("/src/composables/useUrlHash.js");
      const map = getMapInstance("app");
      const c = map.getCenter();
      const center = [c.lng + 0.001, c.lat];
      map.jumpTo({ center, zoom: map.getZoom() });
      return formatUrlHash(
        map.getZoom(),
        center[1],
        center[0],
        map.getPitch(),
        map.getBearing(),
      );
    });
    await expect
      .poll(() => hashOf(page.url()), { timeout: CAMERA_TIMEOUT })
      .toBe(movedHash);
  });
});
