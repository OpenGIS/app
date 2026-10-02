import { test, expect } from "@playwright/test";

/**
 * E2E tests for the app-shell service worker under the opted-in dev path
 * (`VITE_SW=1`, set for the Playwright webServer in playwright.config.js).
 *
 * These specs keep the worker ON — the closest dev equivalent to production —
 * and prove the app both registers it and survives a reload while controlled.
 * The reload-stability test is the regression net for the poisoned-module class
 * of bug (a stale cache-first worker serving Vite's dev module graph).
 *
 * Helpers are duplicated per spec by project convention.
 */

// A cold load plus a reload each wait on a full map-idle settle, which can take
// tens of seconds under SwiftShader; the default 30 s budget is too tight.
test.setTimeout(120000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Start collecting console/page errors; assert empty via expectNoConsoleErrors. */
const trackConsoleErrors = (page) => {
  page.__consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // Ignore external tile-provider 404s: the Mapterhorn raster overlay has no
    // tiles at some zoom/areas, so camera moves 404 expected network noise.
    const url = msg.location()?.url ?? "";
    if (url.includes("tiles.mapterhorn.com")) return;
    page.__consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    page.__consoleErrors.push(err?.message ?? String(err));
  });
};

/** Assert no console/page errors were collected during the test. */
const expectNoConsoleErrors = (page) => {
  const errors = page.__consoleErrors ?? [];
  expect(errors, `Console errors: ${errors.join(" | ")}`).toEqual([]);
};

/** Seed a known map view so the first-load welcome modal does not appear. */
const withViewStorage = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      "onrte_view_app",
      JSON.stringify({
        mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 14 },
      }),
    );
  });

/** Wait for MapLibre to finish rendering tiles. */
const waitForMapIdle = (page) =>
  expect(page.locator(".onrte-map")).toHaveAttribute("data-map-idle", "true", {
    timeout: 30000,
  });

/** Assert the app mounted and its corner-control chips are present. */
const expectAppBooted = async (page) => {
  await expect(page.locator("#menu-button")).toBeVisible();
  await expect(page.locator("#locate-button")).toBeVisible();
  await expect(page.locator("#recordings-button")).toBeVisible();
};

/** Count the service worker registrations for the page origin. */
const serviceWorkerCount = (page) =>
  page.evaluate(() =>
    navigator.serviceWorker.getRegistrations().then((r) => r.length),
  );

// ─── Service worker / Registration + control ─────────────────────────────────

test.describe("Service worker", () => {
  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withViewStorage(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("registers on load and stays in control across a reload", async ({
    page,
  }) => {
    await page.goto("/index.html");
    await waitForMapIdle(page);

    // The opt-in path registered the app-shell worker.
    await expect.poll(() => serviceWorkerCount(page)).toBeGreaterThan(0);

    await page.reload();
    await waitForMapIdle(page);

    // Booted cleanly while controlled by the worker.
    await expectAppBooted(page);
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
  });

  test("reload boots cleanly under SW control", async ({ page }) => {
    await page.goto("/index.html");
    await waitForMapIdle(page);

    await page.reload();
    await waitForMapIdle(page);

    await expectAppBooted(page);
  });
});
