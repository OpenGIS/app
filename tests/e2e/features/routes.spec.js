import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady } from "../helpers/panel";
import { waitForMapIdle } from "../helpers/mapIdle.js";
import { isSwiftShaderRun } from "../helpers/determinism.js";
import {
  readStoredState,
  writeStoredEnvelope,
  openPeerPage,
} from "../helpers/storage.js";
import {
  emitFix,
  installGeolocationMock,
  withCompassCapability,
} from "../helpers/locate.js";
import { DEMO } from "../../fixtures/demo.mjs";
import { readFileSync } from "node:fs";

/**
 * E2E tests for src/features/routes/
 *
 * Covers the Routes side panel tab, GPX and GeoJSON import, hidden-by-default
 * rows, independent Show/Hide toggles, share downloads, confirmed deletion,
 * navigation start/stop (including stop on hide/delete), and v2 persistence.
 */

// The software-rendered CI path (SwiftShader) can stall a click even when the
// target is visible — observed in GH run 37133271143 — so the default 30 s
// budget is too tight.
test.setTimeout(60000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Bounded budget for the asynchronous GPX import to render its row. Generous
// enough for a starved software renderer, but a real backstop, not a wait.
const ROUTE_IMPORT_TIMEOUT = 15000;

// The committed GPX fixture as a buffer, so a multi-file import can combine it
// with an in-memory GeoJSON file (Playwright cannot mix paths and buffers).
const GPX_FIXTURE = readFileSync("tests/fixtures/route.gpx");

// A small in-memory GeoJSON route with one waypoint: enough to prove the
// importer handles lines and points without a second committed fixture.
const GEOJSON_ROUTE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Geo Route" },
      geometry: {
        type: "LineString",
        coordinates: DEMO.route
          .slice(0, 5)
          .map((point) => [point.lng, point.lat]),
      },
    },
    {
      type: "Feature",
      properties: { name: "Lookout" },
      geometry: {
        type: "Point",
        coordinates: [DEMO.route[2].lng, DEMO.route[2].lat],
      },
    },
  ],
};

/** Seed localStorage with permission granted and a view. */
const withGrantedStorage = (page) =>
  page.addInitScript((center) => {
    localStorage.setItem(
      "ogis_locate_app",
      JSON.stringify({ permissionGranted: true }),
    );
    localStorage.setItem(
      "ogis_view_app",
      JSON.stringify({
        mapView: { center, zoom: 14 },
      }),
    );
  }, DEMO.center);

/** Grant browser geolocation permission and set a fixed position. */
const grantGeolocation = (
  page,
  coords = { latitude: DEMO.center.lat, longitude: DEMO.center.lng },
) =>
  page
    .context()
    .grantPermissions(["geolocation"])
    .then(() => page.context().setGeolocation(coords));

/** Force the share fallback so downloads are deterministic in every browser. */
const withoutWebShare = (page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
  });

/** Open the Routes panel via its side panel nav tab. */
const openRoutesPanel = async (page) => {
  // Desktop auto-opens the Info pane; open the menu pane so the tab strip renders.
  if (!(await page.locator(".panel-nav").isVisible())) {
    await page.locator("#menu-button").click();
    await page.locator(".panel-nav").waitFor();
  }
  const routesTab = page
    .locator(".panel-nav")
    .getByRole("button", { name: "Routes", exact: true });
  await routesTab.click();
  await expect(page.locator(".ogis-panel")).toHaveClass(/show/);
  await expect(routesTab).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.ogis-panel input[type="file"]')).toBeVisible();
};

/** Locate a route row by its displayed name. */
const routeRow = (page, name) =>
  page.locator(".ogis-panel .border-top.py-2", { hasText: name });

/** Read the persisted route documents (envelope or legacy). */
const storedRoutes = async (page) =>
  readStoredState(
    await page.evaluate(() => localStorage.getItem("ogis_routes_app")),
  ) ?? [];

/** Read the persisted navigation document (envelope or legacy). */
const storedNavigation = async (page) =>
  readStoredState(
    await page.evaluate(() => localStorage.getItem("ogis_navigation_app")),
  );

/** Read the live locate mode through the page's own module graph. */
const readLocateMode = (page) =>
  page.evaluate(async () => {
    const { useLocate } = await import("/src/composables/useLocate.js");
    return useLocate("app").mode.value;
  });

/** Whether this tab deferred its locate restore to a live owner in another tab. */
const readLocateRestoreDeferred = (page) =>
  page.evaluate(async () => {
    const { useLocate } = await import("/src/composables/useLocate.js");
    return useLocate("app").restoreDeferred.value;
  });

/** Whether Following may be offered, through the page's own module graph. */
const readCanFollow = (page) =>
  page.evaluate(async () => {
    const { useLocate } = await import("/src/composables/useLocate.js");
    return useLocate("app").canFollow.value;
  });

/** The settled compass-capability probe result, through the module graph. */
const readCompassCapability = (page) =>
  page.evaluate(async () => {
    const { useLocate } = await import("/src/composables/useLocate.js");
    return useLocate("app").compassCapability.value;
  });

/** Call a method on the app's provided routes API through its module graph. */
const callRoutes = (page, method, ...args) =>
  page.evaluate(
    ({ methodName, callArgs }) => {
      const app = document.querySelector("#app")?.__vue_app__;
      const api = app?._context?.provides?.routes;
      if (!api) throw new Error("routes API is not provided");
      return api[methodName](...callArgs);
    },
    { methodName: method, callArgs: args },
  );

/**
 * Record every distinct locate chip label and whether the navigation card ever
 * rendered, from document-start.
 *
 * A MutationObserver observes the document node itself, which exists before
 * `document.documentElement`, so the recorder is live before the chip first
 * renders. A transient Following or navigation card cannot slip between
 * observations.
 */
const withNavigationFlashRecorder = (page) =>
  page.addInitScript(() => {
    window.__routesFlash = { labels: [], navControlSeen: false };
    const record = () => {
      const label = document.querySelector("#locate-button .icon-btn__label");
      const text = label?.textContent?.trim();
      if (text && window.__routesFlash.labels.at(-1) !== text) {
        window.__routesFlash.labels.push(text);
      }
      if (document.querySelector(".ogis-nav-control")) {
        window.__routesFlash.navControlSeen = true;
      }
    };
    record();
    new MutationObserver(record).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });

/** A stored fix for seeded restore cases. */
const STORED_FIX = {
  lat: DEMO.center.lat,
  lng: DEMO.center.lng,
  accuracy: 12,
  heading: null,
  at: 1_700_000_000_000,
};

/** A v2 route document for seeded restore cases. */
const restoreRoute = (id) => ({
  v: 2,
  id,
  kind: "route",
  name: "Restore Loop",
  gpxType: "trk",
  createdAt: null,
  source: { format: "gpx" },
  segments: [
    {
      points: DEMO.route.slice(0, 5).map(({ lat, lng }) => ({ lat, lng })),
    },
  ],
  waypoints: [],
  color: "#3498db",
});

/** Seed persisted stores before the document boots. */
const seedRestoreState = (page, state) =>
  page.addInitScript((stored) => {
    if (stored.routes) {
      localStorage.setItem("ogis_routes_app", JSON.stringify(stored.routes));
    }
    if (stored.navigation) {
      localStorage.setItem(
        "ogis_navigation_app",
        JSON.stringify(stored.navigation),
      );
    }
    if (stored.locate) {
      localStorage.setItem("ogis_locate_app", JSON.stringify(stored.locate));
    }
  }, state);

/**
 * Ensure a stored locate grant without overwriting a restored session on
 * reload. Later seeds may still replace the value entirely.
 */
const withLocatePermission = (page) =>
  page.addInitScript(() => {
    if (!localStorage.getItem("ogis_locate_app")) {
      localStorage.setItem(
        "ogis_locate_app",
        JSON.stringify({ permissionGranted: true }),
      );
    }
  });

/**
 * Seed a known map view on first boot only, so later reloads keep whatever
 * view the app persisted.
 */
const withKnownView = (page) =>
  page.addInitScript((center) => {
    if (!localStorage.getItem("ogis_view_app")) {
      localStorage.setItem(
        "ogis_view_app",
        JSON.stringify({ mapView: { center, zoom: 14 } }),
      );
    }
  }, DEMO.center);

/**
 * Read the features currently held by the app's GeoJSON source.
 *
 * The source data is the public map representation of every track rendered by
 * the app, so it proves what Show/Hide actually put on (or removed from) the
 * map without depending on pixels.
 */
const mapFeatures = (page, prefix = "") =>
  page.evaluate(async (idPrefix) => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const map = getMapInstance("app");
    const data = map?.getSource("ogis-geojson")?.serialize()?.data;
    const features =
      data && typeof data === "object" && Array.isArray(data.features)
        ? data.features
        : [];
    return features.filter((feature) =>
      String(feature.id).startsWith(idPrefix),
    );
  }, prefix);

/** Read the sorted ids of the features currently held by the GeoJSON source. */
const mapFeatureIds = async (page, prefix = "") =>
  (await mapFeatures(page, prefix)).map((feature) => String(feature.id)).sort();

/** Import the fixture GPX file into the Routes panel. */
const importFixture = async (page) => {
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/route.gpx");
  // The import reads the file asynchronously, so the row can lag behind the
  // setInputFiles call under a starved software renderer; wait for the
  // concrete condition with a bounded budget rather than the 5 s default.
  await expect(page.getByText("Test Loop")).toBeVisible({
    timeout: ROUTE_IMPORT_TIMEOUT,
  });
};

/** Import the in-memory GeoJSON fixture into the Routes panel. */
const importGeoJSONFixture = async (page) => {
  await page.locator('input[type="file"]').setInputFiles({
    name: "geo-route.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(GEOJSON_ROUTE)),
  });
  await expect(page.getByText("Geo Route")).toBeVisible({
    timeout: ROUTE_IMPORT_TIMEOUT,
  });
};

/** Register a native-confirm handler and capture the message it carried. */
const handleConfirm = (page, action, messages) => {
  page.once("dialog", async (dialog) => {
    messages.push(dialog.message());
    await dialog[action]();
  });
};

// ─── Navigation fixtures ────────────────────────────────────────────────────

// Camera hops and follow glides need more than the default element budget, and
// SwiftShader's software-rendered frames stretch them further still.
const NAV_TIMEOUT = isSwiftShaderRun() ? 120000 : 60000;

// The GPX fixture is the opening of the demo track, so its first coordinate is
// the demo route's first point. Derive every navigation fix from it rather than
// hardcoding unrelated coordinates.
const ROUTE_START = { lat: DEMO.route[0].lat, lng: DEMO.route[0].lng };
const ROUTE_POINT = { lat: DEMO.route[3].lat, lng: DEMO.route[3].lng };

const ROUTE_CENTRE = {
  lat:
    (Math.min(...DEMO.route.map((point) => point.lat)) +
      Math.max(...DEMO.route.map((point) => point.lat))) /
    2,
  lng:
    (Math.min(...DEMO.route.map((point) => point.lng)) +
      Math.max(...DEMO.route.map((point) => point.lng))) /
    2,
};

/** A fix roughly `metres` due north of the route start. */
const northOfRoute = (metres) => ({
  lat: ROUTE_START.lat + metres / 111_320,
  lng: ROUTE_START.lng,
});

// 30 m is comfortably outside the 5 m on-route tolerance and well inside the
// 1 km connector radius.
const OFF_ROUTE_FIX = northOfRoute(30);
const TWO_KM_FIX = northOfRoute(2_000);
// Just beyond the 1 km connector radius, but still close enough to reach the
// off-route state promptly.
const BEYOND_CONNECTOR_FIX = northOfRoute(1_200);

// Real land roughly 1,900 km from the route. The far case must settle on valid
// terrain and tiles; a point projected far out to sea or over the Arctic can
// leave the map without DEM data and never exercises the follow-marker recovery.
const FAR_FIX = { lat: 43.6532, lng: -79.3832 };
const toGeolocation = ({ lat, lng }) => ({ latitude: lat, longitude: lng });

/** Boot the app, open the Routes panel and import the fixture. */
const bootRoutes = async (
  page,
  { fix = ROUTE_START, mockGeolocation = false } = {},
) => {
  if (mockGeolocation) {
    await installGeolocationMock(page);
  } else {
    await grantGeolocation(page, toGeolocation(fix));
  }
  await page.goto("/");
  await waitForMapReady(page);
  await openRoutesPanel(page);
  await importFixture(page);
};

/** The top-centre navigation status control. */
const navControl = (page) => page.locator(".ogis-nav-control");
const navControlValue = (page) =>
  navControl(page).locator(".ogis-nav-control__value");
const navControlCaption = (page) =>
  navControl(page).locator(".ogis-nav-control__caption");

/** The SVG connector from the locate marker to the nearest route point. */
const navConnector = (page) => page.locator(".ogis-nav-connector polyline");

/** The locate chip's text label, without the surrounding button. */
const locateLabel = (page) => page.locator("#locate-button .icon-btn__label");

/** Show the imported fixture route and wait for its line feature. */
const showRoute = async (page) => {
  const row = routeRow(page, "Test Loop");
  await row.getByRole("button", { name: "Show", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Hide", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => mapFeatureIds(page, "routes-route-"), { timeout: NAV_TIMEOUT })
    .toHaveLength(1);
};

/**
 * Start navigation from the open panel and wait for the chrome-level contract:
 * the panel closes and the top-centre navigation control appears as the default
 * card variant.
 *
 * Navigation starts following immediately, before the first position fix. With
 * a real granted fix the chip settles on Following straight away; under the
 * geolocation stub no fix exists yet, so pass `hasFix: false` to pin the
 * intentional pre-fix window (the chip reports Locating… and the caller
 * publishes a fix afterwards).
 */
const startNavigation = async (page, { hasFix = true } = {}) => {
  await routeRow(page, "Test Loop")
    .getByRole("button", { name: "Navigate", exact: true })
    .click();
  await expect(page.locator(".ogis-panel")).not.toHaveClass(/show/);
  await expect(locateLabel(page)).toHaveText(
    hasFix ? "Following" : "Locating…",
    { timeout: NAV_TIMEOUT },
  );
  await expect(navControl(page)).toBeVisible();
  await expect(navControl(page)).toHaveAttribute("data-variant", "card");
};

/** Publish a fix once the navigation-started watcher is live. */
const emitNavigationFix = async (page, fix) => {
  await expect
    .poll(() => page.evaluate(() => window.__geo.count()), {
      timeout: NAV_TIMEOUT,
    })
    .toBeGreaterThan(0);
  await emitFix(page, fix);
};

/** Reopen the Routes panel and stop navigation through its Stop control. */
const stopNavigationFromPanel = async (page) => {
  await openRoutesPanel(page);
  await routeRow(page, "Test Loop")
    .getByRole("button", { name: "Stop", exact: true })
    .click();
};

/** Read the live map centre through the page's own module graph. */
const readMapCentre = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const centre = getMapInstance("app").getCenter();
    return { lat: centre.lat, lng: centre.lng };
  });

/** Ground-plane separation between two centres, in degrees. */
const centreDelta = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng);

// ─── Routes / Panel ──────────────────────────────────────────────────────────

test.describe("Routes / Panel", () => {
  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("Routes tab appears in the side panel nav", async ({ page }) => {
    await expect(page.locator(".ogis-panel")).toHaveClass(/show/);

    // Desktop auto-opens the Info pane; open the menu pane so the tab strip renders.
    if (!(await page.locator(".panel-nav").isVisible())) {
      await page.locator("#menu-button").click();
      await page.locator(".panel-nav").waitFor();
    }

    await expect(
      page.locator(".panel-nav").getByRole("button", { name: "Routes" }),
    ).toBeVisible();
  });

  test("clicking the Routes tab opens the Routes panel", async ({ page }) => {
    await openRoutesPanel(page);
    await expect(page.locator('input[type="file"]')).toBeVisible();
  });
});

// ─── Routes / Import ─────────────────────────────────────────────────────────

test.describe("Routes / Import", () => {
  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
    await openRoutesPanel(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("importing a valid GPX file adds a hidden route row", async ({
    page,
  }) => {
    await importFixture(page);

    const row = routeRow(page, "Test Loop");
    await expect(row).toBeVisible();
    await expect(row.locator(".ogis-track-swatch")).toHaveAttribute(
      "style",
      /background-color/,
    );
    await expect(row).toContainText(/\d+ m|km/);

    // Hidden by default: the row offers Show and no route feature is rendered.
    const show = row.getByRole("button", { name: "Show", exact: true });
    await expect(show).toBeVisible();
    await expect(show).toHaveAttribute("aria-pressed", "false");
    await expect(show).not.toHaveClass(/btn-primary/);
    await expect.poll(() => mapFeatureIds(page, "routes-route-")).toEqual([]);

    // The imported document is persisted in the v2 shape.
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() =>
          localStorage.getItem("ogis_routes_app"),
        );
        const stored = readStoredState(raw) ?? [];
        return stored.map((route) => ({
          v: route.v,
          kind: route.kind,
          name: route.name,
          segments: route.segments?.length,
          waypoints: route.waypoints?.length,
          color: /^#[0-9a-f]{6}$/i.test(route.color ?? ""),
        }));
      })
      .toEqual([
        {
          v: 2,
          kind: "route",
          name: "Test Loop",
          segments: 1,
          waypoints: 0,
          color: true,
        },
      ]);
  });

  test("importing a GeoJSON file adds its route and waypoint metadata", async ({
    page,
  }) => {
    await importGeoJSONFixture(page);

    const row = routeRow(page, "Geo Route");
    await expect(row).toBeVisible();
    await expect(row).toContainText(/\d+ m|km/);
    await expect(row).toContainText("1 waypoint");
    await expect(row.locator(".ogis-track-swatch")).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Show", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("importing an invalid GPX file shows the error message", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "bad.gpx",
      mimeType: "application/gpx+xml",
      buffer: Buffer.from("<gpx><trk><trkseg></gpx>"),
    });

    await expect(page.locator(".text-danger")).toBeVisible();
    await expect(page.locator(".text-danger")).toContainText(
      "Invalid GPX file",
    );
    await expect(page.getByText("Test Loop")).toHaveCount(0);
  });
});

// ─── Routes / Show and Hide ──────────────────────────────────────────────────

test.describe("Routes / Show and Hide", () => {
  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
    await openRoutesPanel(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("Show renders the route and Hide removes it", async ({ page }) => {
    await importFixture(page);

    const row = routeRow(page, "Test Loop");
    const show = row.getByRole("button", { name: "Show", exact: true });
    await show.click();

    const hide = row.getByRole("button", { name: "Hide", exact: true });
    await expect(hide).toBeVisible();
    await expect(hide).toHaveAttribute("aria-pressed", "true");
    await expect(hide).toHaveClass(/btn-primary/);

    await expect.poll(async () => (await storedRoutes(page)).length).toBe(1);
    const [stored] = await storedRoutes(page);
    const featureId = `routes-route-${stored.id}`;
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"))
      .toEqual([featureId]);

    // Lines opt in to the direction chevron layer and carry the marker.
    const lineFeature = (await mapFeatures(page, "routes-route-")).find(
      (feature) => String(feature.id) === featureId,
    );
    expect(lineFeature?.properties?.["ogis.direction"]).toBe(true);

    // The direction layer is registered asynchronously once the authored
    // arrow image has decoded, so wait for it before asserting its config.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { getMapInstance } = await import("/src/composables/useMap.js");
          return Boolean(
            getMapInstance("app")?.getLayer?.("ogis-geojson-direction"),
          );
        }),
      )
      .toBe(true);

    const directionLayer = await page.evaluate(async () => {
      const { getMapInstance } = await import("/src/composables/useMap.js");
      const style = getMapInstance("app")?.getStyle?.();
      return (
        style?.layers?.find((layer) => layer.id === "ogis-geojson-direction") ??
        null
      );
    });
    expect(directionLayer?.layout?.["symbol-placement"]).toBe("line");
    expect(directionLayer?.layout?.["icon-rotate"]).toBe(90);

    const hasDirectionImage = await page.evaluate(async () => {
      const { getMapInstance } = await import("/src/composables/useMap.js");
      return (
        getMapInstance("app")?.hasImage?.("ogis-geojson-direction-arrow") ===
        true
      );
    });
    expect(hasDirectionImage).toBe(true);

    await hide.click();
    await expect(show).toBeVisible();
    await expect(show).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => mapFeatureIds(page, "routes-route-")).toEqual([]);
  });

  test("two routes from a mixed multi-file import are independent", async ({
    page,
  }) => {
    await page.locator('input[type="file"]').setInputFiles([
      {
        name: "route.gpx",
        mimeType: "application/gpx+xml",
        buffer: GPX_FIXTURE,
      },
      {
        name: "geo-route.geojson",
        mimeType: "application/geo+json",
        buffer: Buffer.from(JSON.stringify(GEOJSON_ROUTE)),
      },
    ]);
    await expect(page.getByText("Test Loop")).toBeVisible({
      timeout: ROUTE_IMPORT_TIMEOUT,
    });
    await expect(page.getByText("Geo Route")).toBeVisible({
      timeout: ROUTE_IMPORT_TIMEOUT,
    });

    await expect.poll(async () => (await storedRoutes(page)).length).toBe(2);
    const stored = await storedRoutes(page);
    const idFor = (name) => stored.find((route) => route.name === name)?.id;
    const testLoopId = idFor("Test Loop");
    const geoRouteId = idFor("Geo Route");

    const testRow = routeRow(page, "Test Loop");
    const geoRow = routeRow(page, "Geo Route");

    await testRow.getByRole("button", { name: "Show", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"))
      .toEqual([`routes-route-${testLoopId}`]);
    await expect(
      testRow.getByRole("button", { name: "Hide", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      geoRow.getByRole("button", { name: "Show", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");

    await geoRow.getByRole("button", { name: "Show", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"))
      .toEqual(
        [`routes-route-${testLoopId}`, `routes-route-${geoRouteId}`].sort(),
      );
    await expect
      .poll(() => mapFeatureIds(page, "routes-waypoint-"))
      .toEqual([`routes-waypoint-${geoRouteId}-0`]);

    await testRow.getByRole("button", { name: "Hide", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"))
      .toEqual([`routes-route-${geoRouteId}`]);
    await expect(
      geoRow.getByRole("button", { name: "Hide", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await geoRow.getByRole("button", { name: "Hide", exact: true }).click();
    await expect.poll(() => mapFeatureIds(page, "routes-route-")).toEqual([]);
    await expect(
      geoRow.getByRole("button", { name: "Show", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

// ─── Routes / Delete ─────────────────────────────────────────────────────────

test.describe("Routes / Delete", () => {
  test.setTimeout(isSwiftShaderRun() ? 180000 : 60000);

  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
    await openRoutesPanel(page);
    await importFixture(page);
    await routeRow(page, "Test Loop")
      .getByRole("button", { name: "Show", exact: true })
      .click();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: ROUTE_IMPORT_TIMEOUT,
      })
      .toHaveLength(1);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("cancelling Delete keeps the route and its map feature", async ({
    page,
  }) => {
    const messages = [];
    handleConfirm(page, "dismiss", messages);

    await routeRow(page, "Test Loop")
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain("Test Loop");

    await expect(routeRow(page, "Test Loop")).toBeVisible();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"))
      .toHaveLength(1);
    await expect.poll(() => storedRoutes(page)).toHaveLength(1);
  });

  test("accepting Delete removes the route and its map feature", async ({
    page,
  }) => {
    const messages = [];
    handleConfirm(page, "accept", messages);

    await routeRow(page, "Test Loop")
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain("Test Loop");

    await expect(routeRow(page, "Test Loop")).toHaveCount(0);
    await expect(
      page.getByText(
        "No routes yet. Import a GPX or GeoJSON file to get started.",
      ),
    ).toBeVisible();
    await expect.poll(() => mapFeatureIds(page, "routes-route-")).toEqual([]);
    // Route persistence is debounced, so the write lands after the UI updates.
    await expect.poll(() => storedRoutes(page)).toEqual([]);
  });
});

// ─── Routes / Share ──────────────────────────────────────────────────────────

test.describe("Routes / Share", () => {
  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
    await withoutWebShare(page);
    await page.goto("/");
    await waitForMapReady(page);
    await openRoutesPanel(page);
    await importFixture(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("Share downloads the route as GPX and GeoJSON", async ({ page }) => {
    const row = routeRow(page, "Test Loop");
    const summary = row.locator("summary");
    await expect(summary).toContainText("Share");

    await summary.click();
    const [gpxDownload] = await Promise.all([
      page.waitForEvent("download"),
      row.getByRole("button", { name: "GPX", exact: true }).click(),
    ]);
    expect(gpxDownload.suggestedFilename()).toMatch(/\.gpx$/);
    await expect(
      row.getByRole("button", { name: "GPX", exact: true }),
    ).toBeHidden();

    await summary.click();
    const [geoJSONDownload] = await Promise.all([
      page.waitForEvent("download"),
      row.getByRole("button", { name: "GeoJSON", exact: true }).click(),
    ]);
    expect(geoJSONDownload.suggestedFilename()).toMatch(/\.geojson$/);
  });
});

// ─── Routes / Navigate ───────────────────────────────────────────────────────

test.describe("Routes / Navigate", () => {
  // The navigation flow drives camera transitions and follow glides; under
  // SwiftShader a single click action can stall for tens of seconds, so the
  // whole block gets a budget sized for the software renderer.
  test.setTimeout(isSwiftShaderRun() ? 180000 : 60000);

  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
    // Navigation starts Following, which needs a capable device.
    await withCompassCapability(page, true);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("Navigate is disabled while the route is hidden and enabled after Show", async ({
    page,
  }) => {
    await bootRoutes(page);

    const navigate = routeRow(page, "Test Loop").getByRole("button", {
      name: "Navigate",
      exact: true,
    });
    await expect(navigate).toBeDisabled();
    await expect(navigate).toHaveAttribute(
      "title",
      "Show the route before navigating",
    );

    await showRoute(page);

    await expect(navigate).toBeEnabled();
    // The hidden/busy hints must clear once the control is actually usable.
    await expect(navigate).not.toHaveAttribute("title", /\S/);
  });

  test("Navigate is disabled on another route while navigation is active", async ({
    page,
  }) => {
    await bootRoutes(page);
    await showRoute(page);
    await importGeoJSONFixture(page);

    const geoRow = routeRow(page, "Geo Route");
    await geoRow.getByRole("button", { name: "Show", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: NAV_TIMEOUT,
      })
      .toHaveLength(2);

    await startNavigation(page);
    await openRoutesPanel(page);

    const other = routeRow(page, "Geo Route").getByRole("button", {
      name: "Navigate",
      exact: true,
    });
    await expect(other).toBeDisabled();
    await expect(other).toHaveAttribute(
      "title",
      "Stop the current navigation first",
    );
    await expect(
      routeRow(page, "Test Loop").getByRole("button", {
        name: "Stop",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("Navigate closes the panel, enters Following and keeps the route rendered", async ({
    page,
  }) => {
    await bootRoutes(page);
    await showRoute(page);
    await startNavigation(page);

    await expect(navControl(page)).toHaveAttribute("data-state", "on-route");
    await expect(navControlValue(page)).toHaveText("On route");
    await expect(navControl(page)).toHaveAttribute("aria-label", "On route");
    await expect(navControlCaption(page)).toHaveCount(0);
    await expect(navConnector(page)).toHaveCount(0);

    // Navigation must not remove the route it is following.
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: NAV_TIMEOUT,
      })
      .toHaveLength(1);

    // Reopening the panel shows Stop in place of Navigate.
    await openRoutesPanel(page);
    const row = routeRow(page, "Test Loop");
    await expect(
      row.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Navigate", exact: true }),
    ).toHaveCount(0);
  });

  test("off-route navigation shows a compact distance, connector and off-route title", async ({
    page,
  }) => {
    await bootRoutes(page, { fix: OFF_ROUTE_FIX });
    await showRoute(page);
    await startNavigation(page);

    await expect(navControl(page)).toHaveAttribute("data-state", "off-route");
    const label = (await navControlValue(page).textContent()).trim();
    expect(label).toMatch(/^\d+\s*m$/);
    const metres = Number(label.replace(/[^\d.]/g, ""));
    expect(metres).toBeGreaterThanOrEqual(15);
    expect(metres).toBeLessThanOrEqual(60);

    // The green dashed connector is an SVG overlay drawing a line from the
    // locate marker to the nearest point on the route.
    await expect(navConnector(page)).toHaveCount(1, {
      timeout: NAV_TIMEOUT,
    });
    const connectorPoints =
      (await navConnector(page).getAttribute("points")) ?? "";
    expect(connectorPoints.trim().split(/\s+/).length).toBeGreaterThanOrEqual(
      2,
    );
    await expect(navControl(page)).toHaveAttribute("aria-label", /off route/);
    await expect(navControlCaption(page)).toHaveText("Off route");
  });

  test("on-route navigation shows On route and removes the connector", async ({
    page,
  }) => {
    await bootRoutes(page, { mockGeolocation: true });
    await showRoute(page);
    await startNavigation(page, { hasFix: false });

    // Navigation starts before the first fix: the chip and the top-centre card
    // both report the intentional pre-fix window rather than a stale state.
    await expect(navControl(page)).toHaveAttribute("data-state", "locating");
    await expect(navControlCaption(page)).toHaveText("Locating…");

    // Publish crafted fixes through the stub: Chromium's context.setGeolocation
    // emits a transient POSITION_UNAVAILABLE when it changes an active watcher.
    await emitNavigationFix(page, {
      lat: OFF_ROUTE_FIX.lat,
      lng: OFF_ROUTE_FIX.lng,
    });
    await expect(locateLabel(page)).toHaveText("Following");
    await expect(navControl(page)).toHaveAttribute("data-state", "off-route");
    await expect(navConnector(page)).toHaveCount(1, {
      timeout: NAV_TIMEOUT,
    });

    await emitFix(page, { lat: ROUTE_POINT.lat, lng: ROUTE_POINT.lng });

    await expect(navControl(page)).toHaveAttribute("data-state", "on-route");
    await expect(navControlValue(page)).toHaveText("On route");
    await expect(navControl(page)).toHaveAttribute("aria-label", "On route");
    await expect(navControlCaption(page)).toHaveCount(0);
    await expect(navConnector(page)).toHaveCount(0);
  });

  test("a ~1900 km fix shows a huge distance, no connector, and follows the user", async ({
    page,
  }, testInfo) => {
    await bootRoutes(page, { fix: FAR_FIX });
    await showRoute(page);
    await startNavigation(page);

    await expect(navControl(page)).toHaveAttribute("data-state", "off-route", {
      timeout: NAV_TIMEOUT,
    });
    const label = (await navControlValue(page).textContent()).trim();
    expect(label).toMatch(/^\d+(?:[.,]\d+)?\s*km$/);
    // The label is ~1,900 km; allow a generous band rather than a brittle exact
    // string.
    const distanceKm = Number(label.replace(/[^\d.]/g, ""));
    expect(distanceKm).toBeGreaterThan(1800);
    expect(distanceKm).toBeLessThan(2000);

    // Beyond 1 km there is no connector overlay.
    await expect(navConnector(page)).toHaveCount(0);

    // Follow owns the camera: its centre tracks the user, not the route.
    await expect
      .poll(async () => centreDelta(await readMapCentre(page), FAR_FIX), {
        timeout: NAV_TIMEOUT,
      })
      .toBeLessThan(0.02);
    const centre = await readMapCentre(page);
    expect(centreDelta(centre, ROUTE_CENTRE)).toBeGreaterThan(0.01);

    // The follow marker must recover to the far fix. A terrain DEM error used to
    // abort move dispatch and leave it frozen at a stale, off-screen
    // projection; `useLocate` now re-syncs markers on `moveend` and keeps
    // retrying until the map settles, since a far navigation may never emit
    // `idle`.
    await waitForMapIdle(page, testInfo);
    const followMarker = page
      .locator(".ogis-locate-position, .ogis-locate-heading")
      .first();
    await expect(followMarker).toBeVisible();
    // Playwright's visibility check accepts off-screen elements, so poll the
    // box: the post-move retry can land its final sync a tick after idle.
    await expect
      .poll(
        async () => {
          const box = await followMarker.boundingBox();
          if (!box) return false;
          const viewport = page.viewportSize();
          // A 1 px tolerance covers sub-pixel rounding at the viewport edges.
          return (
            box.x >= -1 &&
            box.y >= -1 &&
            box.x + box.width <= viewport.width + 1 &&
            box.y + box.height <= viewport.height + 1
          );
        },
        { timeout: NAV_TIMEOUT },
      )
      .toBe(true);
  });

  test("Stop from the panel clears the indicator, connector and owned follow", async ({
    page,
  }) => {
    await bootRoutes(page, { fix: OFF_ROUTE_FIX });
    await showRoute(page);
    await startNavigation(page);
    await expect(navControl(page)).toHaveAttribute("data-state", "off-route");
    await expect(navConnector(page)).toHaveCount(1, {
      timeout: NAV_TIMEOUT,
    });

    await stopNavigationFromPanel(page);

    await expect(navControl(page)).toHaveCount(0);
    await expect(navConnector(page)).toHaveCount(0);
    await expect(locateLabel(page)).toHaveText("Locate");
    await expect(
      routeRow(page, "Test Loop").getByRole("button", {
        name: "Navigate",
        exact: true,
      }),
    ).toBeEnabled();
  });

  test("stopping navigation leaves a follow the user started before Navigate", async ({
    page,
  }) => {
    await bootRoutes(page);
    await showRoute(page);

    // The user owns follow mode before navigation starts.
    await page.locator("#locate-button").click();
    await expect(locateLabel(page)).toHaveText("Located", {
      timeout: NAV_TIMEOUT,
    });
    await page.locator("#locate-button").click();
    await expect(locateLabel(page)).toHaveText("Following", {
      timeout: NAV_TIMEOUT,
    });

    await startNavigation(page);
    await expect(navControl(page)).toBeVisible();

    await stopNavigationFromPanel(page);

    await expect(navControl(page)).toHaveCount(0);
    await expect(locateLabel(page)).toHaveText("Following");
  });

  test("hiding the navigating route stops navigation and owned follow", async ({
    page,
  }) => {
    await bootRoutes(page, { fix: OFF_ROUTE_FIX });
    await showRoute(page);
    await startNavigation(page);
    await expect(navConnector(page)).toHaveCount(1, {
      timeout: NAV_TIMEOUT,
    });

    await openRoutesPanel(page);
    await routeRow(page, "Test Loop")
      .getByRole("button", { name: "Hide", exact: true })
      .click();

    await expect(navControl(page)).toHaveCount(0);
    await expect(navConnector(page)).toHaveCount(0);
    await expect(locateLabel(page)).toHaveText("Locate");
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: NAV_TIMEOUT,
      })
      .toEqual([]);
    await expect(
      routeRow(page, "Test Loop").getByRole("button", {
        name: "Navigate",
        exact: true,
      }),
    ).toBeDisabled();
  });

  test("deleting the navigating route stops navigation and owned follow", async ({
    page,
  }) => {
    await bootRoutes(page, { fix: OFF_ROUTE_FIX });
    await showRoute(page);
    await startNavigation(page);
    await expect(navConnector(page)).toHaveCount(1, {
      timeout: NAV_TIMEOUT,
    });

    await openRoutesPanel(page);
    const messages = [];
    handleConfirm(page, "accept", messages);
    await routeRow(page, "Test Loop")
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    await expect.poll(() => messages.length, { timeout: NAV_TIMEOUT }).toBe(1);
    await expect(routeRow(page, "Test Loop")).toHaveCount(0);
    await expect(navControl(page)).toHaveCount(0);
    await expect(navConnector(page)).toHaveCount(0);
    await expect(locateLabel(page)).toHaveText("Locate");
    await expect
      .poll(() => storedRoutes(page), { timeout: NAV_TIMEOUT })
      .toEqual([]);
  });

  test("pressing Locate while following stops navigation and clears the indicator", async ({
    page,
  }) => {
    await bootRoutes(page, { fix: OFF_ROUTE_FIX });
    await showRoute(page);
    await startNavigation(page);
    await expect(navControl(page)).toHaveAttribute("data-state", "off-route");
    await expect(navConnector(page)).toHaveCount(1, {
      timeout: NAV_TIMEOUT,
    });

    // Following → stopped; the locate watcher stops and navigation follows it.
    await page.locator("#locate-button").click();

    await expect(locateLabel(page)).toHaveText("Locate");
    await expect(navControl(page)).toHaveCount(0);
    await expect(navConnector(page)).toHaveCount(0);
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: NAV_TIMEOUT,
      })
      .toHaveLength(1);
  });

  test("navigation owns exactly one geolocation watcher and releases it on Stop", async ({
    page,
  }) => {
    await bootRoutes(page, { mockGeolocation: true });
    await showRoute(page);
    await startNavigation(page, { hasFix: false });

    const watcherCount = () => page.evaluate(() => window.__geo.count());
    await expect.poll(watcherCount, { timeout: NAV_TIMEOUT }).toBe(1);

    // Drive a fix through the stub so the chip leaves its pre-fix window and
    // the indicator is genuinely live.
    await emitFix(page, { lat: OFF_ROUTE_FIX.lat, lng: OFF_ROUTE_FIX.lng });
    await expect(locateLabel(page)).toHaveText("Following");
    await expect(navControl(page)).toHaveAttribute("data-state", "off-route");

    await stopNavigationFromPanel(page);

    await expect.poll(watcherCount, { timeout: NAV_TIMEOUT }).toBe(0);
    await expect(locateLabel(page)).toHaveText("Locate");
  });

  test("a 1.2 km fix shows the off-route distance without a connector", async ({
    page,
  }) => {
    await bootRoutes(page, { fix: BEYOND_CONNECTOR_FIX });
    await showRoute(page);
    await startNavigation(page);

    // 1.2 km is beyond the 1 km connector radius, so the distance stays but the
    // overlay does not draw.
    await expect(navControl(page)).toHaveAttribute("data-state", "off-route", {
      timeout: NAV_TIMEOUT,
    });
    const label = (await navControlValue(page).textContent()).trim();
    expect(label).toMatch(/^\d+(?:[.,]\d+)?\s*km$/);
    await expect(navConnector(page)).toHaveCount(0);
    await expect(navControlCaption(page)).toHaveText("Off route");
  });

  test("follow centres the camera on a fix 2 km off route, not on the route", async ({
    page,
  }) => {
    await bootRoutes(page, { fix: TWO_KM_FIX });
    await showRoute(page);
    await startNavigation(page);

    await expect(navControl(page)).toHaveAttribute("data-state", "off-route", {
      timeout: NAV_TIMEOUT,
    });
    // The 2 km fix is beyond the 1 km connector radius.
    await expect(navConnector(page)).toHaveCount(0);

    await expect
      .poll(async () => centreDelta(await readMapCentre(page), TWO_KM_FIX), {
        timeout: NAV_TIMEOUT,
      })
      .toBeLessThan(0.01);
    const centre = await readMapCentre(page);
    expect(centreDelta(centre, ROUTE_CENTRE)).toBeGreaterThan(0.01);
  });

  test("starting navigation persists immediately", async ({ page }) => {
    await bootRoutes(page, { fix: OFF_ROUTE_FIX });
    await showRoute(page);
    await startNavigation(page);

    // The route import writes through the debounced store, so wait for it to
    // flush. Navigation persistence, by contrast, is a critical write: the
    // stored envelope must already carry the route id without polling.
    await expect
      .poll(async () => (await storedRoutes(page)).length, {
        timeout: ROUTE_IMPORT_TIMEOUT,
      })
      .toBe(1);
    const [route] = await storedRoutes(page);
    const stored = await storedNavigation(page);
    expect(stored).not.toBeNull();
    expect(stored.routeId).toBe(route.id);
  });
});

// ─── Routes / Compass gate ──────────────────────────────────────────────────

test.describe("Routes / Compass gate", () => {
  test.setTimeout(isSwiftShaderRun() ? 180000 : 60000);

  const GATE_TIMEOUT = isSwiftShaderRun() ? 120000 : 60000;

  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
  });

  test.afterEach(({ page }) => expectNoConsoleErrors(page));

  test("Navigate is disabled with a compass explanation on an incapable device", async ({
    page,
  }) => {
    await withCompassCapability(page, false);
    await bootRoutes(page);
    await showRoute(page);

    // Capability is optimistic while unknown, so wait for the real probe to
    // settle — and assert its result, not just the derived gate boolean.
    await expect
      .poll(() => readCompassCapability(page), { timeout: GATE_TIMEOUT })
      .toBe("incapable");
    await expect
      .poll(() => readCanFollow(page), { timeout: GATE_TIMEOUT })
      .toBe(false);

    const row = routeRow(page, "Test Loop");
    const navigate = row.getByRole("button", {
      name: "Navigate",
      exact: true,
    });
    await expect(navigate).toBeVisible();
    await expect(navigate).toBeDisabled();
    await expect(navigate).toHaveAttribute(
      "title",
      "Navigation needs a compass, which this device doesn't have",
    );

    // Only navigation is gated: the row stays viewable and editable.
    await expect(row).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Hide", exact: true }),
    ).toBeEnabled();
    await expect(
      row.getByRole("button", { name: "Delete", exact: true }),
    ).toBeEnabled();
  });

  test("startNavigation refuses programmatically on an incapable device", async ({
    page,
  }) => {
    await withCompassCapability(page, false);
    await bootRoutes(page);
    await showRoute(page);

    await expect
      .poll(() => readCompassCapability(page), { timeout: GATE_TIMEOUT })
      .toBe("incapable");
    await expect
      .poll(() => readCanFollow(page), { timeout: GATE_TIMEOUT })
      .toBe(false);
    await expect
      .poll(async () => (await storedRoutes(page)).length, {
        timeout: ROUTE_IMPORT_TIMEOUT,
      })
      .toBe(1);
    const [route] = await storedRoutes(page);

    const result = await callRoutes(page, "startNavigation", route.id);
    expect(result).toBe(false);

    // No navigation state, card, map-mode claim or locate activation.
    await expect(navControl(page)).toHaveCount(0);
    const modes =
      (await page.locator(".ogis-root").getAttribute("data-modes")) ?? "";
    expect(modes).not.toContain("navigate");
    expect(modes).not.toContain("follow");
    expect(await readLocateMode(page)).toBeNull();
    expect((await storedNavigation(page))?.routeId ?? null).toBeNull();

    // The refusal has no side effects on the open panel either.
    await expect(page.locator(".ogis-panel")).toHaveClass(/show/);
  });

  test("an incapable device restores Located and clears stored navigation without a flash", async ({
    page,
  }) => {
    const routeId = "no-compass-route";

    await withCompassCapability(page, false);
    await withNavigationFlashRecorder(page);
    await seedRestoreState(page, {
      routes: [restoreRoute(routeId)],
      navigation: { routeId, visible: [routeId], followOwned: true },
      locate: {
        permissionGranted: true,
        mode: "following",
        lastFix: STORED_FIX,
      },
    });
    await grantGeolocation(page);

    await page.goto("/");
    await waitForMapReady(page);

    await expect(locateLabel(page)).toHaveText("Located", {
      timeout: GATE_TIMEOUT,
    });
    // Tie the restored Located state to the real probe result rather than the
    // optimistic/incapable gate boolean alone.
    await expect
      .poll(() => readCompassCapability(page), { timeout: GATE_TIMEOUT })
      .toBe("incapable");
    await expect
      .poll(() => readCanFollow(page), { timeout: GATE_TIMEOUT })
      .toBe(false);
    expect(await readLocateMode(page)).toBe("active");

    // Navigation never resumes, and its stored session is cleared.
    await expect(navControl(page)).toHaveCount(0);
    await expect
      .poll(async () => (await storedNavigation(page))?.routeId ?? null, {
        timeout: GATE_TIMEOUT,
      })
      .toBeNull();
    await expect
      .poll(async () => (await storedNavigation(page))?.followOwned, {
        timeout: GATE_TIMEOUT,
      })
      .toBe(false);

    // The route itself stays visible: only navigation is gated.
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: GATE_TIMEOUT,
      })
      .toEqual([`routes-route-${routeId}`]);

    // The recorder proves Following and the navigation card never rendered,
    // rather than merely being replaced later.
    const flash = await page.evaluate(() => window.__routesFlash);
    expect(flash.labels).toContain("Located");
    expect(flash.labels).not.toContain("Following");
    expect(flash.navControlSeen).toBe(false);
  });
});

// ─── Routes / Persist across reload ──────────────────────────────────────────

test.describe("Routes / Persist across reload", () => {
  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
    await openRoutesPanel(page);
    await importFixture(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("imported route stays visible and persists as v2 after reload", async ({
    page,
  }) => {
    await routeRow(page, "Test Loop")
      .getByRole("button", { name: "Show", exact: true })
      .click();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"))
      .toHaveLength(1);

    // Visibility is persisted alongside the v2 document, and that write is
    // debounced, so wait for it rather than racing the store's 250 ms flush.
    await expect
      .poll(async () => (await storedRoutes(page)).length, {
        timeout: ROUTE_IMPORT_TIMEOUT,
      })
      .toBe(1);
    const [stored] = await storedRoutes(page);
    expect(stored).toMatchObject({ v: 2, kind: "route", name: "Test Loop" });
    expect(stored.segments).toHaveLength(1);
    expect(stored.segments[0].points.length).toBeGreaterThan(0);
    expect(stored.waypoints).toEqual([]);
    expect(stored.color).toMatch(/^#[0-9a-f]{6}$/i);

    await page.reload();
    await waitForMapReady(page);
    await openRoutesPanel(page);

    const row = routeRow(page, "Test Loop");
    await expect(row).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Hide", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"))
      .toHaveLength(1);

    const [reloaded] = await storedRoutes(page);
    expect(reloaded.v).toBe(2);
    expect(reloaded.id).toBe(stored.id);
  });
});

// ─── Routes / Restore across reload ─────────────────────────────────────────

test.describe("Routes / Restore across reload", () => {
  // Boots, camera settles and a debounced restore need ample headroom under
  // the software renderer.
  test.setTimeout(isSwiftShaderRun() ? 180000 : 90000);

  const RESTORE_TIMEOUT = isSwiftShaderRun() ? 120000 : 60000;

  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    // Restored navigation resumes as Following on a capable device.
    await withCompassCapability(page, true);
  });

  test.afterEach(({ page }) => expectNoConsoleErrors(page));

  /** Boot the app, open the Routes panel and import the fixture. */
  const bootRestoreRoutes = async (page) => {
    await withLocatePermission(page);
    await withKnownView(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);
    await openRoutesPanel(page);
    await importFixture(page);
  };

  test("migrates a legacy sessionStorage navigation value into localStorage", async ({
    page,
  }) => {
    const routeId = "migrate-route";

    await page.addInitScript(
      ({ route, navigation }) => {
        localStorage.setItem("ogis_routes_app", JSON.stringify([route]));
        sessionStorage.setItem(
          "ogis_navigation_app",
          JSON.stringify(navigation),
        );
      },
      {
        route: restoreRoute(routeId),
        navigation: { routeId: null, visible: [routeId], followOwned: false },
      },
    );

    await page.goto("/");
    await waitForMapReady(page);

    await expect
      .poll(async () => (await storedNavigation(page))?.visible ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toEqual([routeId]);
    expect(
      await page.evaluate(() => sessionStorage.getItem("ogis_navigation_app")),
    ).toBeNull();
    expect(
      await page.evaluate(() => localStorage.getItem("ogis_navigation_app")),
    ).not.toBeNull();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: RESTORE_TIMEOUT,
      })
      .toEqual([`routes-route-${routeId}`]);
  });

  test("visible route restores without fitting the stored user view", async ({
    page,
  }) => {
    await bootRestoreRoutes(page);
    await showRoute(page);

    // The imported route's write is debounced, so wait for it to flush before
    // reading the id.
    await expect
      .poll(async () => (await storedRoutes(page)).length, {
        timeout: ROUTE_IMPORT_TIMEOUT,
      })
      .toBe(1);
    const [stored] = await storedRoutes(page);
    const routeId = stored.id;
    const userView = { lat: 40.4168, lng: -3.7038, zoom: 11 };

    await page.evaluate(async (view) => {
      const { getMapInstance } = await import("/src/composables/useMap.js");
      getMapInstance("app").jumpTo({
        center: [view.lng, view.lat],
        zoom: view.zoom,
        pitch: 0,
        bearing: 0,
      });
    }, userView);

    await expect
      .poll(
        async () =>
          readStoredState(
            await page.evaluate(() => localStorage.getItem("ogis_view_app")),
          )?.mapView?.center?.lat ?? null,
        { timeout: RESTORE_TIMEOUT },
      )
      .toBeCloseTo(userView.lat, 4);

    await expect
      .poll(async () => (await storedNavigation(page))?.visible ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toEqual([routeId]);

    await page.reload();
    await waitForMapReady(page);

    // Restored visibility must not fit the route bounds: the stored user view
    // is still the camera centre and it is nowhere near the route.
    await expect
      .poll(async () => centreDelta(await readMapCentre(page), userView), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeLessThan(0.01);
    const centre = await readMapCentre(page);
    expect(centreDelta(centre, ROUTE_CENTRE)).toBeGreaterThan(1);

    await openRoutesPanel(page);
    const row = routeRow(page, "Test Loop");
    await expect(
      row.getByRole("button", { name: "Hide", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: RESTORE_TIMEOUT,
      })
      .toEqual([`routes-route-${routeId}`]);
  });

  test("navigation and owned follow resume after reload when geolocation is granted", async ({
    page,
  }) => {
    await bootRestoreRoutes(page);
    await showRoute(page);

    await expect
      .poll(async () => (await storedRoutes(page))?.length ?? 0, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(1);
    const [stored] = await storedRoutes(page);
    const routeId = stored.id;

    await startNavigation(page);

    await expect
      .poll(async () => (await storedNavigation(page))?.routeId ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(routeId);
    await expect
      .poll(async () => (await storedNavigation(page))?.followOwned, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(true);

    await page.reload();
    await waitForMapReady(page);

    await expect(locateLabel(page)).toHaveText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect(navControl(page)).toBeVisible({ timeout: RESTORE_TIMEOUT });
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: RESTORE_TIMEOUT,
      })
      .toEqual([`routes-route-${routeId}`]);

    // The restored navigation owned follow, so stopping it stops locate too.
    await stopNavigationFromPanel(page);
    await expect(navControl(page)).toHaveCount(0);
    await expect(locateLabel(page)).toHaveText("Locate");
    await expect
      .poll(async () => (await storedNavigation(page))?.routeId ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();
    await expect
      .poll(async () => (await storedNavigation(page))?.followOwned, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(false);
  });

  test("navigation and owned follow resume after an app quit with a dead owner", async ({
    page,
  }) => {
    const routeId = "dead-owner-route";

    await withLocatePermission(page);
    await seedRestoreState(page, {
      routes: [restoreRoute(routeId)],
      navigation: {
        routeId,
        visible: [routeId],
        followOwned: true,
        ownerId: "dead-owner",
      },
      locate: {
        permissionGranted: true,
        mode: "following",
        lastFix: STORED_FIX,
        ownerId: "dead-owner",
      },
    });
    await grantGeolocation(page);

    await page.goto("/");
    await waitForMapReady(page);

    await expect(locateLabel(page)).toHaveText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect(navControl(page)).toBeVisible({ timeout: RESTORE_TIMEOUT });
    await expect
      .poll(async () => (await storedNavigation(page))?.routeId ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(routeId);
    await expect
      .poll(async () => (await storedNavigation(page))?.ownerId ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .not.toBe("dead-owner");
  });

  test("navigation in one tab is not restored in another tab", async ({
    context,
    page: pageA,
  }) => {
    await bootRestoreRoutes(pageA);
    await showRoute(pageA);

    // The imported route's write is debounced, so wait for it to flush before
    // reading the id.
    await expect
      .poll(async () => (await storedRoutes(pageA)).length, {
        timeout: ROUTE_IMPORT_TIMEOUT,
      })
      .toBe(1);
    const [stored] = await storedRoutes(pageA);
    const routeId = stored.id;

    await startNavigation(pageA);
    await expect
      .poll(async () => (await storedNavigation(pageA))?.routeId ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(routeId);

    const pageB = await context.newPage();
    await pageB.goto("/");
    await waitForMapReady(pageB);

    // The secondary tab must not restore the owner's navigation…
    await expect(navControl(pageB)).toHaveCount(0);
    await expect
      .poll(async () => (await storedNavigation(pageB))?.ownerId ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .not.toBeNull();

    // …and its locate restore deferred to page A's live session rather than
    // claiming it, which is what keeps the navigation document untouched.
    await expect
      .poll(() => readLocateRestoreDeferred(pageB), {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(true);

    // …and must not clear it: the owner stays navigating.
    await expect(navControl(pageA)).toBeVisible({ timeout: RESTORE_TIMEOUT });
    await expect
      .poll(async () => (await storedNavigation(pageA))?.routeId ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(routeId);

    await pageB.close();
  });

  test("a follow the user owned before navigation survives stopping the restore", async ({
    page,
  }) => {
    await bootRestoreRoutes(page);
    await showRoute(page);

    // The imported route's write is debounced, so wait for it to flush before
    // reading the id.
    await expect
      .poll(async () => (await storedRoutes(page)).length, {
        timeout: ROUTE_IMPORT_TIMEOUT,
      })
      .toBe(1);
    const [stored] = await storedRoutes(page);
    const routeId = stored.id;

    // The user owns follow mode before navigation starts.
    await page.locator("#locate-button").click();
    await expect(locateLabel(page)).toHaveText("Located", {
      timeout: NAV_TIMEOUT,
    });
    await page.locator("#locate-button").click();
    await expect(locateLabel(page)).toHaveText("Following", {
      timeout: NAV_TIMEOUT,
    });

    await startNavigation(page);

    await expect
      .poll(async () => (await storedNavigation(page))?.routeId ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(routeId);
    await expect
      .poll(async () => (await storedNavigation(page))?.followOwned, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(false);

    await page.reload();
    await waitForMapReady(page);

    await expect(locateLabel(page)).toHaveText("Following", {
      timeout: RESTORE_TIMEOUT,
    });
    await expect(navControl(page)).toBeVisible({ timeout: RESTORE_TIMEOUT });

    // The user-owned follow is not owned by navigation, so it survives Stop.
    await stopNavigationFromPanel(page);
    await expect(navControl(page)).toHaveCount(0);
    await expect(locateLabel(page)).toHaveText("Following");
  });

  test("does not resume navigation without OS geolocation permission", async ({
    page,
  }) => {
    const routeId = "restore-route";

    await withLocatePermission(page);
    await seedRestoreState(page, {
      routes: [restoreRoute(routeId)],
      navigation: { routeId, visible: [routeId], followOwned: true },
      locate: {
        permissionGranted: true,
        mode: "following",
        lastFix: STORED_FIX,
      },
    });

    // Deliberately no grant: the OS permission query must block the restore.
    await page.goto("/");
    await waitForMapReady(page);

    await expect
      .poll(async () => (await storedNavigation(page))?.routeId ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();
    await expect
      .poll(() => readLocateMode(page), { timeout: RESTORE_TIMEOUT })
      .toBeNull();
    await expect(navControl(page)).toHaveCount(0);

    // Navigation failed silently; the seeded route stays visible.
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: RESTORE_TIMEOUT,
      })
      .toEqual([`routes-route-${routeId}`]);
    await expect
      .poll(async () => (await storedNavigation(page))?.visible ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toEqual([routeId]);
  });

  test("missing navigated route clears navigation without errors", async ({
    page,
  }) => {
    await withLocatePermission(page);
    await seedRestoreState(page, {
      navigation: {
        routeId: "missing-route",
        visible: ["missing-route"],
        followOwned: true,
      },
    });

    await page.goto("/");
    await waitForMapReady(page);

    await expect
      .poll(async () => (await storedNavigation(page))?.routeId ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBeNull();
    await expect
      .poll(async () => (await storedNavigation(page))?.followOwned, {
        timeout: RESTORE_TIMEOUT,
      })
      .toBe(false);
    await expect
      .poll(async () => (await storedNavigation(page))?.visible ?? null, {
        timeout: RESTORE_TIMEOUT,
      })
      .toEqual([]);

    await expect(navControl(page)).toHaveCount(0);
    expect(await mapFeatureIds(page, "routes-route-")).toEqual([]);
  });
});

// ─── Routes / Cross-tab sync ────────────────────────────────────────────────

test.describe("Routes / Cross-tab sync", () => {
  test.setTimeout(isSwiftShaderRun() ? 180000 : 60000);

  const ROUTE_ID = "xtab-route";
  const ROUTE_NAME = "Cross-tab Loop";

  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
    await withCompassCapability(page, true);
    await installGeolocationMock(page);
    await page.goto("/");
    await waitForMapReady(page);
    await openRoutesPanel(page);
  });

  test.afterEach(({ page }) => expectNoConsoleErrors(page));

  test("an external add and removal reconcile visibility and navigation", async ({
    page,
    context,
  }) => {
    const peer = await openPeerPage(context);
    trackConsoleErrors(peer);

    await writeStoredEnvelope(peer, "ogis_routes_app", 1, [
      { ...restoreRoute(ROUTE_ID), name: ROUTE_NAME },
    ]);

    const row = routeRow(page, ROUTE_NAME);
    await expect(row).toBeVisible({ timeout: NAV_TIMEOUT });
    await row.getByRole("button", { name: "Show", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: NAV_TIMEOUT,
      })
      .toEqual([`routes-route-${ROUTE_ID}`]);

    await row.getByRole("button", { name: "Navigate", exact: true }).click();
    await expect(navControl(page)).toBeVisible({ timeout: NAV_TIMEOUT });
    // Navigation starts following before the first fix; publish one so the
    // chip settles out of its intentional Locating… window.
    await expect(locateLabel(page)).toHaveText("Locating…", {
      timeout: NAV_TIMEOUT,
    });
    await emitNavigationFix(page, ROUTE_START);
    await expect(locateLabel(page)).toHaveText("Following", {
      timeout: NAV_TIMEOUT,
    });
    expect(await readLocateMode(page)).toBe("following");

    await writeStoredEnvelope(peer, "ogis_routes_app", 1, []);

    await expect(row).toHaveCount(0, { timeout: NAV_TIMEOUT });
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"), {
        timeout: NAV_TIMEOUT,
      })
      .toEqual([]);
    await expect(navControl(page)).toHaveCount(0, { timeout: NAV_TIMEOUT });
    await expect
      .poll(() => readLocateMode(page), { timeout: NAV_TIMEOUT })
      .toBeNull();

    expectNoConsoleErrors(peer);
    await peer.close();
  });

  test("an external geometry loss hides the route and stops navigation", async ({
    page,
    context,
  }) => {
    const peer = await openPeerPage(context);
    trackConsoleErrors(peer);

    await writeStoredEnvelope(peer, "ogis_routes_app", 1, [
      restoreRoute(ROUTE_ID),
    ]);

    const row = routeRow(page, "Restore Loop");
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Show", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "routes-route-"))
      .toEqual([`routes-route-${ROUTE_ID}`]);

    await row.getByRole("button", { name: "Navigate", exact: true }).click();
    await expect(navControl(page)).toBeVisible();

    const geometryless = {
      ...restoreRoute(ROUTE_ID),
      segments: [{ points: [{ lat: DEMO.center.lat, lng: DEMO.center.lng }] }],
    };
    await writeStoredEnvelope(peer, "ogis_routes_app", 1, [geometryless]);

    // The document stays, but it can no longer be shown.
    await openRoutesPanel(page);
    await expect(row).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Show", exact: true }),
    ).toBeVisible();
    await expect.poll(() => mapFeatureIds(page, "routes-route-")).toEqual([]);
    await expect(navControl(page)).toHaveCount(0);
    await expect
      .poll(async () => (await storedNavigation(page))?.visible ?? null)
      .toEqual([]);
    await expect.poll(() => readLocateMode(page)).toBeNull();

    expectNoConsoleErrors(peer);
    await peer.close();
  });
});
