import { test, expect } from "./helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "./helpers/console.js";
import { waitForMapReady, openMenuTab } from "./helpers/panel";

test.setTimeout(120000);

const START_VIEW = {
  center: { lat: 40.4168, lng: -3.7038 },
  zoom: 11,
};

const TARGET_VIEW = {
  center: { lat: 51.5074, lng: -0.1278 },
  zoom: 12,
  pitch: 25,
  bearing: 40,
};

const readView = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const map = getMapInstance("app");
    const center = map.getCenter();
    return {
      lat: center.lat,
      lng: center.lng,
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    };
  });

const matches = (view, target) =>
  Math.abs(view.lat - target.center.lat) < 1e-4 &&
  Math.abs(view.lng - target.center.lng) < 1e-4 &&
  Math.abs(view.zoom - target.zoom) < 1e-4 &&
  Math.abs(view.pitch - (target.pitch ?? 0)) < 0.01 &&
  Math.abs(view.bearing - (target.bearing ?? 0)) < 0.01;

const waitForView = (page, target, timeout = 30000) =>
  expect
    .poll(async () => matches(await readView(page), target), {
      timeout,
      message: "map view did not match the target",
    })
    .toBe(true);

test.describe("Boot fallback", () => {
  test("shows the static fallback when the main module fails to load", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__ogisBootWatchdogMs = 500;
    });
    await page.route("**/src/main.js", (route) => route.abort());

    await page.goto("/");

    const fallback = page.locator("[data-ogis-boot-fallback]");
    await expect(fallback).toBeVisible({ timeout: 10000 });
    await expect(fallback.locator("[data-ogis-boot-reload]")).toBeVisible();
    await expect(fallback.locator("[data-ogis-boot-reset]")).toBeVisible();
  });

  test("keeps the static fallback when the root component fails to mount", async ({
    page,
  }) => {
    await page.route("**/src/App.vue*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `window.__ogisRootFailure = "loaded"; export default { name: "BrokenRoot", setup() { window.__ogisRootFailure = "setup"; throw new Error("root setup failed"); } };`,
      }),
    );

    await page.goto("/");

    const fallback = page.locator("[data-ogis-boot-fallback]");
    // The default 30 s watchdog is in force: a prompt appearance proves the
    // Vue error handler's immediate fail() signal, not the watchdog.
    await expect(fallback).toBeVisible({ timeout: 5000 });
    await expect(fallback.locator("[data-ogis-boot-reload]")).toBeVisible();
    await expect(fallback.locator("[data-ogis-boot-reset]")).toBeVisible();
    await expect(page.locator(".ogis-root")).toHaveCount(0);
    await expect(page.locator("#app")).toBeEmpty();
    expect(await page.evaluate(() => window.__ogisRootFailure)).toBe("setup");

    // A late ready signal must not hide a fallback already shown.
    await page.evaluate(() => window.__ogisBoot?.ready?.());
    await page.waitForTimeout(1000);
    await expect(fallback).toBeVisible();
  });

  test("reset clears only the current instance's keys", async ({ page }) => {
    trackConsoleErrors(page);

    await page.route("**/src/App.vue*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `export default { name: "BrokenRoot", setup() { throw new Error("root setup failed"); } };`,
      }),
    );

    await page.addInitScript(() => {
      // Seed only on the first load: the reset reloads the page, and the
      // seeded values must not come back for the post-reset assertions.
      if (localStorage.getItem("__ogisE2eSeeded")) return;
      localStorage.setItem("__ogisE2eSeeded", "1");
      localStorage.setItem("ogis_view_app", "x");
      localStorage.setItem("ogis_view_trip_app", "x");
      localStorage.setItem("ogis_locate_app", "x");
      localStorage.setItem("ogis_locate_trip_app", "x");
      sessionStorage.setItem("ogis_navigation_app", "x");
      sessionStorage.setItem("ogis_navigation_trip_app", "x");
    });

    await page.goto("/");

    const fallback = page.locator("[data-ogis-boot-fallback]");
    await expect(fallback).toBeVisible({ timeout: 5000 });

    const reloaded = page.waitForEvent("load", { timeout: 20000 });
    await fallback.locator("[data-ogis-boot-reset]").click();
    await reloaded;

    // The reload boots into the same root failure, so the fallback returns.
    await expect(fallback).toBeVisible({ timeout: 5000 });

    const storage = await page.evaluate(() => ({
      localApp: localStorage.getItem("ogis_view_app"),
      localTripApp: localStorage.getItem("ogis_view_trip_app"),
      localLocateApp: localStorage.getItem("ogis_locate_app"),
      localLocateTripApp: localStorage.getItem("ogis_locate_trip_app"),
      sessionApp: sessionStorage.getItem("ogis_navigation_app"),
      sessionTripApp: sessionStorage.getItem("ogis_navigation_trip_app"),
    }));

    expect(storage.localApp).toBeNull();
    expect(storage.localLocateApp).toBeNull();
    expect(storage.sessionApp).toBeNull();
    expect(storage.localTripApp).toBe("x");
    expect(storage.localLocateTripApp).toBe("x");
    expect(storage.sessionTripApp).toBe("x");

    expectNoConsoleErrors(page);
  });
});

test.describe("Feature install isolation", () => {
  test("a feature whose install throws is contained", async ({ page }) => {
    trackConsoleErrors(page);

    // Serve a deterministic stand-in for one feature module. Vite requests the
    // source path directly in dev, so the interception is reliable and the
    // replacement has no imports of its own.
    await page.route("**/src/features/offline/index.js*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `export const OfflineFeature = { install() { throw new Error("offline install failed"); } };`,
      }),
    );

    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator(".ogis-root")).toBeVisible();
    await expect(page.locator("[data-ogis-boot-fallback]")).toBeHidden();

    // Later features still installed and the panel chrome is intact.
    await openMenuTab(page, "Recordings");
    await expect(page.getByText("No recordings yet.")).toBeVisible();
    await expect(
      page.locator(".panel-nav").getByRole("button", { name: "Routes" }),
    ).toBeVisible();

    // The failure is contained and reported through the debug channel, not
    // surfaced as a console or page error.
    expectNoConsoleErrors(page);
  });
});

test.describe("Corrupt stored state", () => {
  test("boots with defaults when stored stores are unusable", async ({
    page,
  }) => {
    trackConsoleErrors(page);

    await page.addInitScript(() => {
      localStorage.setItem(
        "ogis_recordings_app",
        JSON.stringify({ saved: "nope" }),
      );
      localStorage.setItem(
        "ogis_offline-regions_app",
        JSON.stringify([
          {
            id: "broken",
            name: "Broken region",
            bounds: { west: 10, south: 0, east: -10, north: 1 },
            minZoom: 60,
            maxZoom: 1,
            tileCount: -5,
            estimatedBytes: -1,
            createdAt: "never",
          },
        ]),
      );
    });

    await page.goto("/");
    await waitForMapReady(page);

    await openMenuTab(page, "Recordings");
    await expect(page.getByText("No recordings yet.")).toBeVisible();

    await openMenuTab(page, "Offline Maps");
    await expect(page.getByText("No regions downloaded yet.")).toBeVisible();

    // The unusable recordings value is preserved for inspection.
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("ogis_quarantine_recordings_app"),
        ),
      )
      .not.toBeNull();

    expectNoConsoleErrors(page);
  });
});

test.describe("Cross-tab view sync", () => {
  test("a move in one tab syncs to the other without an echo", async ({
    context,
    page: pageA,
  }) => {
    const pageB = await context.newPage();
    trackConsoleErrors(pageA);
    trackConsoleErrors(pageB);

    await context.addInitScript((view) => {
      localStorage.setItem("ogis_view_app", JSON.stringify({ mapView: view }));
    }, START_VIEW);

    await pageA.goto("/");
    await waitForMapReady(pageA);
    await pageB.goto("/");
    await waitForMapReady(pageB);

    await expect
      .poll(async () => matches(await readView(pageA), START_VIEW), {
        timeout: 30000,
      })
      .toBe(true);
    await expect
      .poll(async () => matches(await readView(pageB), START_VIEW), {
        timeout: 30000,
      })
      .toBe(true);

    await pageA.evaluate(async (view) => {
      const { getMapInstance } = await import("/src/composables/useMap.js");
      getMapInstance("app").jumpTo({
        center: [view.center.lng, view.center.lat],
        zoom: view.zoom,
        pitch: view.pitch,
        bearing: view.bearing,
      });
    }, TARGET_VIEW);

    await waitForView(pageB, TARGET_VIEW);

    await expect
      .poll(() => pageB.url(), { timeout: 30000 })
      .toContain("#map=12/51.507400/-0.127800/25/40");

    // Losing tab A must keep the applied view: no echo write should bounce it
    // back after the receiving tab settles.
    await pageA.waitForTimeout(1500);
    expect(matches(await readView(pageA), TARGET_VIEW)).toBe(true);

    await pageB.close();

    expectNoConsoleErrors(pageA);
    expectNoConsoleErrors(pageB);
  });
});

test.describe("Map recovery", () => {
  test("a style failure shows the overlay and retry recovers", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__ogisMapStyleTimeoutMs = 500;
    });
    await page.route("**/style.json", (route) => route.abort());

    await page.goto("/");

    const overlay = page.locator('[data-map-status="error"][role="alert"]');
    await expect(overlay).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".ogis-map")).toHaveAttribute(
      "data-map-state",
      "error",
    );
    await expect(page.locator(".ogis-map")).not.toHaveAttribute(
      "data-map-ready",
      "true",
    );

    await page.unroute("**/style.json");
    await overlay.getByRole("button", { name: "Retry" }).click();
    await waitForMapReady(page);

    await expect(page.locator('[data-map-status="error"]')).toHaveCount(0);
    await expect(page.locator(".ogis-map")).toHaveAttribute(
      "data-map-state",
      "ready",
    );
  });

  test("WebGL context loss shows the overlay and restoration recovers", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForMapReady(page);

    await page.evaluate(() => {
      const canvas = document.querySelector(".maplibregl-canvas");
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });

    const overlay = page.locator('[data-map-status="error"][role="alert"]');
    await expect(overlay).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".ogis-map")).toHaveAttribute(
      "data-map-state",
      "error",
    );

    await page.evaluate(() => {
      const canvas = document.querySelector(".maplibregl-canvas");
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });

    await expect(overlay).toHaveCount(0);
    await expect(page.locator(".ogis-map")).toHaveAttribute(
      "data-map-state",
      "ready",
    );
  });

  test("unsupported WebGL shows the unsupported overlay", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === "webgl" || type === "webgl2") return null;
        return original.call(this, type, ...args);
      };
    });

    await page.goto("/");

    await expect(page.locator("#menu-button")).toBeVisible({ timeout: 15000 });
    const overlay = page.locator('[data-map-status="error"][role="alert"]');
    await expect(overlay).toBeVisible({ timeout: 15000 });
    await expect(overlay).toContainText("Your browser cannot display the map.");
    await expect(page.locator(".ogis-map")).toHaveAttribute(
      "data-map-state",
      "error",
    );
    await expect(page.locator(".ogis-map")).not.toHaveAttribute(
      "data-map-ready",
      "true",
    );
  });
});
