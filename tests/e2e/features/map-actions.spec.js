import { mkdirSync } from "node:fs";
import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import {
  waitForMapReady,
  waitForPanelSettled,
  openMenuTab,
} from "../helpers/panel.js";
import {
  installGeolocationMock,
  emitFix,
  LOCATE_FIX,
} from "../helpers/locate.js";
import { DEMO } from "../../fixtures/demo.mjs";
import { isSwiftShaderRun } from "../helpers/determinism.js";

/**
 * Tests for Random while following.
 *
 * Random is an action: before it moves the camera it claims the map, which
 * stops the active Follow mode as a hand-off. The outgoing follow camera
 * releases view suppression without persisting, so the random fit is the move
 * that reaches the URL hash and localStorage. On compact layouts the action
 * also dismisses the Info pane; on desktop the pane stays open.
 */

// Ceiling for the light state and camera waits. SwiftShader needs a much
// larger backstop; the GPU path keeps the tight budget.
const ACTION_TIMEOUT = 30000;
const FOLLOW_TIMEOUT = 60000;

test.setTimeout(isSwiftShaderRun() ? 360000 : 120000);

test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

/**
 * Seed the stored locate grant (skips the permission modal) and a demo-area
 * view at zoom 14 (avoids the cold-start random-country fit) before the
 * document boots.
 */
const seedStorage = (page) =>
  page.addInitScript(
    ({ center }) => {
      localStorage.setItem(
        "ogis_locate_app",
        JSON.stringify({ permissionGranted: true }),
      );
      localStorage.setItem(
        "ogis_view_app",
        JSON.stringify({ mapView: { center, zoom: 14 } }),
      );
    },
    { center: DEMO.center },
  );

/** Seed one route derived from the demo track before the document boots. */
const seedRoute = (page) =>
  page.addInitScript((points) => {
    localStorage.setItem(
      "ogis_routes_app",
      JSON.stringify([
        { id: "seed-route", name: "Test Loop", points, distance: 0 },
      ]),
    );
  }, DEMO.route);

/** Read the live camera centre through the page's own module graph. */
const readCentre = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const map = getMapInstance("app");
    if (!map) return null;
    const centre = map.getCenter();
    return { lat: centre.lat, lng: centre.lng };
  });

/** Read the live camera pose through the page's own module graph. */
const readPose = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const map = getMapInstance("app");
    const centre = map.getCenter();
    return {
      lat: centre.lat,
      lng: centre.lng,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
  });

/**
 * Wait until the live camera pose stops changing between reads.
 *
 * The follow hand-off ends with an eased glide. Its last fractions of a degree
 * decide the six-decimal centre in the OSM note URL, so the pose must be fully
 * settled before it is captured and compared with the click-time URL.
 */
const waitForStablePose = async (page) => {
  let previous = await readPose(page);
  await expect
    .poll(
      async () => {
        const next = await readPose(page);
        const delta =
          Math.abs(next.lat - previous.lat) +
          Math.abs(next.lng - previous.lng) +
          Math.abs(next.zoom - previous.zoom) +
          Math.abs(next.bearing - previous.bearing) +
          Math.abs(next.pitch - previous.pitch);
        previous = next;
        return delta;
      },
      { timeout: ACTION_TIMEOUT },
    )
    .toBeLessThan(1e-9);
  return previous;
};

/** Read the persisted view centre, or null when nothing valid is stored. */
const readStoredCentre = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("ogis_view_app");
    if (!raw) return null;
    try {
      const centre = JSON.parse(raw)?.mapView?.center;
      if (!Number.isFinite(centre?.lat) || !Number.isFinite(centre?.lng)) {
        return null;
      }
      return { lat: centre.lat, lng: centre.lng };
    } catch {
      return null;
    }
  });

/** Ground-plane separation between two centres, in degrees. */
const degreeDistance = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng);

const distanceFromFix = (centre) =>
  degreeDistance(centre, {
    lat: LOCATE_FIX.latitude,
    lng: LOCATE_FIX.longitude,
  });

const hashOf = (url) => new URL(url).hash;

/** Capture a screen as local test evidence; never the committed tree. */
const captureScreen = async (page, name) => {
  mkdirSync(".opencode/tmp", { recursive: true });
  await page.screenshot({ path: `.opencode/tmp/map-actions-${name}.png` });
};

/**
 * Drive the locate chip to the following state: activate tracking, publish a
 * fix so the follow camera has a target, then advance to following.
 *
 * The one-shot orientation flight is deliberately not awaited: the second
 * click starts the follow camera, whose `map.stop()` cancels any in-flight
 * flight before it can affect the test.
 */
const startFollowing = async (page) => {
  const button = page.locator("#locate-button");

  await button.click();
  await expect(button).toContainText("Located", { timeout: FOLLOW_TIMEOUT });

  // The watcher is registered asynchronously after the chip reports Located;
  // wait for it before publishing a fix.
  await expect
    .poll(() => page.evaluate(() => window.__geo.count()), {
      timeout: FOLLOW_TIMEOUT,
    })
    .toBeGreaterThan(0);

  await emitFix(page, {
    lat: LOCATE_FIX.latitude,
    lng: LOCATE_FIX.longitude,
  });
  await expect
    .poll(() => page.locator(".ogis-locate-position").count(), {
      timeout: FOLLOW_TIMEOUT,
    })
    .toBeGreaterThan(0);

  await button.click();
  await expect(button).toContainText("Following", { timeout: FOLLOW_TIMEOUT });
  await expect(page.locator(".ogis-root")).toHaveAttribute(
    "data-modes",
    /follow/,
    { timeout: FOLLOW_TIMEOUT },
  );
};

/** Assert the camera and the stored view have left the followed position. */
const expectCameraAndStorageAwayFromFix = async (page) => {
  await expect
    .poll(
      async () => {
        const centre = await readCentre(page);
        return centre ? distanceFromFix(centre) : null;
      },
      {
        timeout: ACTION_TIMEOUT,
        message: "the camera snapped back to the followed position",
      },
    )
    .toBeGreaterThan(1);

  await expect
    .poll(
      async () => {
        const centre = await readStoredCentre(page);
        return centre ? distanceFromFix(centre) : null;
      },
      {
        timeout: ACTION_TIMEOUT,
        message: "the random fit was not persisted to the stored view",
      },
    )
    .toBeGreaterThan(1);
};

// ─── Phone ───────────────────────────────────────────────────────────────────

test.describe("Map actions / Random while following / phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await installGeolocationMock(page);
    await seedStorage(page);
  });

  test("ends following, dismisses the pane and keeps the random fit", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForMapReady(page);

    await startFollowing(page);
    await captureScreen(page, "phone-following");

    const root = page.locator(".ogis-root");
    const panel = page.locator(".ogis-panel");

    // Compact layout: Info starts closed, so the attribution chip opens it.
    await page.locator("#attribution-button").click();
    await expect(panel).toHaveClass(/show/, { timeout: FOLLOW_TIMEOUT });
    await waitForPanelSettled(page);
    await expect(root).toHaveAttribute("data-pane", "info", {
      timeout: FOLLOW_TIMEOUT,
    });

    const beforeHash = hashOf(page.url());

    await page.getByRole("link", { name: "Random" }).click();

    const locate = page.locator("#locate-button");
    await expect(locate).toContainText("Located", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).not.toHaveAttribute("data-modes", /follow/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).toHaveAttribute("data-pane", "closed", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(panel).not.toHaveClass(/show/, { timeout: ACTION_TIMEOUT });

    await expectCameraAndStorageAwayFromFix(page);

    await expect
      .poll(() => hashOf(page.url()), { timeout: ACTION_TIMEOUT })
      .not.toBe(beforeHash);

    await captureScreen(page, "phone-random");
  });
});

// ─── Desktop ─────────────────────────────────────────────────────────────────

test.describe("Map actions / Random while following / desktop", () => {
  test.beforeEach(async ({ page }) => {
    await installGeolocationMock(page);
    await seedStorage(page);
  });

  test("ends following but leaves the open Info pane in place", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForMapReady(page);

    const root = page.locator(".ogis-root");
    const panel = page.locator(".ogis-panel");

    // Desktop boots with the Info pane open; the chip must not be clicked,
    // because it would close the pane before the test begins.
    await expect(panel).toHaveClass(/show/, { timeout: FOLLOW_TIMEOUT });
    await waitForPanelSettled(page);
    await expect(root).toHaveAttribute("data-pane", "info", {
      timeout: FOLLOW_TIMEOUT,
    });

    await startFollowing(page);
    await captureScreen(page, "desktop-following");

    await expect(root).toHaveAttribute("data-pane", "info", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(panel).toHaveClass(/show/, { timeout: ACTION_TIMEOUT });

    const beforeHash = hashOf(page.url());

    await page.getByRole("link", { name: "Random" }).click();

    const locate = page.locator("#locate-button");
    await expect(locate).toContainText("Located", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).not.toHaveAttribute("data-modes", /follow/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).toHaveAttribute("data-pane", "info", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(panel).toHaveClass(/show/, { timeout: ACTION_TIMEOUT });

    await expectCameraAndStorageAwayFromFix(page);

    await expect
      .poll(() => hashOf(page.url()), { timeout: ACTION_TIMEOUT })
      .not.toBe(beforeHash);

    await captureScreen(page, "desktop-random");
  });

  test("starting a region draw ends following and exposes the draw mode", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForMapReady(page);

    await startFollowing(page);

    const root = page.locator(".ogis-root");
    const panel = page.locator(".ogis-panel");

    await expect(root).toHaveAttribute("data-modes", /follow/, {
      timeout: ACTION_TIMEOUT,
    });

    await openMenuTab(page, "Offline");
    await waitForPanelSettled(page);
    await expect(root).toHaveAttribute("data-pane", "menu", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(panel).toHaveClass(/show/, { timeout: ACTION_TIMEOUT });

    await page.getByRole("button", { name: "Select region" }).click();

    // Starting the draw claims the map: following ends as a hand-off, so the
    // watcher and its marker stay alive while the draw mode owns the camera.
    const locate = page.locator("#locate-button");
    await expect(locate).toContainText("Located", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).toHaveAttribute("data-modes", /draw/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).not.toHaveAttribute("data-modes", /follow/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(panel).toHaveClass(/show/, { timeout: ACTION_TIMEOUT });
    await expect(root).toHaveAttribute("data-pane", "menu", {
      timeout: ACTION_TIMEOUT,
    });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: ACTION_TIMEOUT,
      })
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: /Drawing/ }).click();

    await expect(root).not.toHaveAttribute("data-modes", /draw/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(locate).toContainText("Located", {
      timeout: ACTION_TIMEOUT,
    });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: ACTION_TIMEOUT,
      })
      .toBeGreaterThan(0);
  });

  test("showing a route ends following and keeps the locate watcher", async ({
    page,
  }) => {
    await seedRoute(page);
    await page.goto("/");
    await waitForMapReady(page);

    await startFollowing(page);

    const root = page.locator(".ogis-root");
    const panel = page.locator(".ogis-panel");

    await expect(root).toHaveAttribute("data-modes", /follow/, {
      timeout: ACTION_TIMEOUT,
    });

    await openMenuTab(page, "Routes");
    await waitForPanelSettled(page);
    await expect(root).toHaveAttribute("data-pane", "menu", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(panel).toHaveClass(/show/, { timeout: ACTION_TIMEOUT });

    const show = page.getByRole("button", { name: "Show" });
    await expect(show).toBeVisible({ timeout: ACTION_TIMEOUT });
    await show.click();

    // Showing a route claims the map: following ends as a hand-off, leaving
    // the locate watcher and marker intact.
    const locate = page.locator("#locate-button");
    await expect(locate).toContainText("Located", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).not.toHaveAttribute("data-modes", /follow/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(panel).toHaveClass(/show/, { timeout: ACTION_TIMEOUT });
    await expect(root).toHaveAttribute("data-pane", "menu", {
      timeout: ACTION_TIMEOUT,
    });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: ACTION_TIMEOUT,
      })
      .toBeGreaterThan(0);
  });

  test("starting navigation closes the panel, keeps following and enters navigate mode", async ({
    page,
  }) => {
    await seedRoute(page);
    await page.goto("/");
    await waitForMapReady(page);

    const root = page.locator(".ogis-root");
    const panel = page.locator(".ogis-panel");

    // Navigate is only enabled once the route is visible on the map.
    await openMenuTab(page, "Routes");
    await waitForPanelSettled(page);
    const show = page.getByRole("button", { name: "Show", exact: true });
    await expect(show).toBeVisible({ timeout: ACTION_TIMEOUT });
    await show.click();
    await expect(
      page.getByRole("button", { name: "Hide", exact: true }),
    ).toBeVisible({ timeout: ACTION_TIMEOUT });

    await startFollowing(page);

    await expect(root).toHaveAttribute("data-modes", /follow/, {
      timeout: ACTION_TIMEOUT,
    });

    await openMenuTab(page, "Routes");
    await waitForPanelSettled(page);

    const navigate = page.getByRole("button", { name: "Navigate" });
    await expect(navigate).toBeVisible({ timeout: ACTION_TIMEOUT });
    await navigate.click();

    // Navigation is a hybrid: it dismisses the panel, keeps the follow camera
    // (locate reads Following) while registering the navigate mode alongside
    // it, and surfaces the top-centre card. There is no banner.
    const locate = page.locator("#locate-button");
    await expect(locate).toContainText("Following", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).toHaveAttribute("data-modes", /follow/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).toHaveAttribute("data-modes", /navigate/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).toHaveAttribute("data-pane", "closed", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(panel).not.toHaveClass(/show/, { timeout: ACTION_TIMEOUT });

    const navControl = page.locator(".ogis-nav-control");
    await expect(navControl).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(navControl).toHaveAttribute("data-variant", "card");
    // The demo fix lies about 1.2 km from the seeded route, so navigation is
    // off-route by construction.
    await expect(navControl).toHaveAttribute("data-state", "off-route", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(page.getByText("Navigation active")).toHaveCount(0);

    // Stop from the reopened panel ends navigate mode but leaves the follow
    // the test started before Navigate.
    await openMenuTab(page, "Routes");
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    await expect(root).not.toHaveAttribute("data-modes", /navigate/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).toHaveAttribute("data-modes", /follow/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(navControl).toHaveCount(0);
    await expect(locate).toContainText("Following", {
      timeout: ACTION_TIMEOUT,
    });
    await expect
      .poll(() => page.evaluate(() => window.__geo.count()), {
        timeout: ACTION_TIMEOUT,
      })
      .toBeGreaterThan(0);
  });

  test("Improve orients north-up and opens the OSM note at the live view", async ({
    page,
  }) => {
    // Stub the popup before boot: record the call and avoid a real window.
    await page.addInitScript(() => {
      window.__opened = [];
      window.open = (url, target, features) => {
        window.__opened.push({ url, target, features });
        return null;
      };
    });

    await page.goto("/");
    await waitForMapReady(page);

    await startFollowing(page);

    const root = page.locator(".ogis-root");
    const panel = page.locator(".ogis-panel");

    // The hand-off glide settles at the follow rest pitch.
    await expect
      .poll(async () => Math.abs((await readPose(page)).pitch - 45), {
        timeout: ACTION_TIMEOUT,
      })
      .toBeLessThan(1);

    const pose = await waitForStablePose(page);

    await page.getByRole("link", { name: "Improve" }).click();

    await expect
      .poll(() => page.evaluate(() => window.__opened.length), {
        timeout: ACTION_TIMEOUT,
      })
      .toBe(1);

    const opened = await page.evaluate(() => window.__opened[0]);
    const expectedUrl = `https://www.openstreetmap.org/note/new#map=${Math.round(pose.zoom)}/${pose.lat.toFixed(6)}/${pose.lng.toFixed(6)}&layers=DN`;
    expect(opened).toEqual({
      url: expectedUrl,
      target: "_blank",
      features: "noopener,noreferrer",
    });

    // The orientation reset only changes bearing and pitch, so the centre and
    // zoom in the note URL are the pre-click live values.
    await expect
      .poll(async () => Math.abs((await readPose(page)).pitch), {
        timeout: ACTION_TIMEOUT,
      })
      .toBeLessThan(0.01);
    await expect
      .poll(async () => Math.abs((await readPose(page)).bearing), {
        timeout: ACTION_TIMEOUT,
      })
      .toBeLessThan(0.01);

    const locate = page.locator("#locate-button");
    await expect(locate).toContainText("Located", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).not.toHaveAttribute("data-modes", /follow/, {
      timeout: ACTION_TIMEOUT,
    });
    await expect(root).toHaveAttribute("data-pane", "info", {
      timeout: ACTION_TIMEOUT,
    });
    await expect(panel).toHaveClass(/show/, { timeout: ACTION_TIMEOUT });
  });
});
