import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady } from "../helpers/panel";

/**
 * E2E tests for src/features/routes/
 *
 * Covers the Routes side panel tab, GPX import (valid + invalid), route
 * deletion, navigation start/stop, and persistence across reload.
 */

// The software-rendered CI path (SwiftShader) can stall a click even when the
// target is visible — observed in GH run 37133271143 — so the default 30 s
// budget is too tight.
test.setTimeout(60000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Bounded budget for the asynchronous GPX import to render its row. Generous
// enough for a starved software renderer, but a real backstop, not a wait.
const ROUTE_IMPORT_TIMEOUT = 15000;

/** Seed localStorage with permission granted and a known map view. */
const withGrantedStorage = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      "ogis_locate_app",
      JSON.stringify({ permissionGranted: true }),
    );
    localStorage.setItem(
      "ogis_view_app",
      JSON.stringify({
        mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 14 },
      }),
    );
  });

/** Grant browser geolocation permission and set a fixed position. */
const grantGeolocation = (
  page,
  coords = { latitude: 50.6539, longitude: -128.0094 },
) =>
  page
    .context()
    .grantPermissions(["geolocation"])
    .then(() => page.context().setGeolocation(coords));

/** Open the Routes panel via its side panel nav tab. */
const openRoutesPanel = async (page) => {
  // Desktop auto-opens the Info pane; open the menu pane so the tab strip renders.
  if (!(await page.locator(".panel-nav").isVisible())) {
    await page.locator("#menu-button").click();
    await page.locator(".panel-nav").waitFor();
  }
  await page
    .locator(".panel-nav")
    .getByRole("button", { name: "Routes", exact: true })
    .click();
  await expect(page.locator(".ogis-panel")).toHaveClass(/show/);
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
};

/** Import the fixture GPX file into the Routes panel. */
const importFixture = async (page) => {
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/e2e/fixtures/route.gpx");
  // The import reads the file asynchronously, so the row can lag behind the
  // setInputFiles call under a starved software renderer; wait for the
  // concrete condition with a bounded budget rather than the 5 s default.
  await expect(page.getByText("Test Loop")).toBeVisible({
    timeout: ROUTE_IMPORT_TIMEOUT,
  });
};

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

  test("importing a valid GPX file adds the route to the list", async ({
    page,
  }) => {
    await page
      .locator('input[type="file"]')
      .setInputFiles("tests/e2e/fixtures/route.gpx");

    const routeRow = page.locator(".border-top.py-2", {
      hasText: "Test Loop",
    });
    await expect(routeRow).toBeVisible();
    await expect(routeRow).toContainText(/\d+ m|km/);

    // Route is persisted to localStorage as an array of route objects
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ogis_routes_app")),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Test Loop");
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

// ─── Routes / Delete ─────────────────────────────────────────────────────────

test.describe("Routes / Delete", () => {
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

  test("Delete button removes the route from the list", async ({ page }) => {
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.locator(".border-top.py-2")).toHaveCount(0);
    await expect(
      page.getByText("No routes yet. Import a GPX file to get started."),
    ).toBeVisible();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ogis_routes_app")),
    );
    expect(stored).toEqual([]);
  });
});

// ─── Routes / Navigate ───────────────────────────────────────────────────────

test.describe("Routes / Navigate", () => {
  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);
    await openRoutesPanel(page);
    await importFixture(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("Navigate starts navigation and Stop ends it", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Navigate" })).toBeVisible();

    await page.getByRole("button", { name: "Navigate" }).click();

    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(page.getByText(/Navigation active/)).toBeVisible();

    await page.getByRole("button", { name: "Stop" }).click();

    await expect(page.getByRole("button", { name: "Navigate" })).toBeVisible();
    await expect(page.getByText(/Navigation active/)).toHaveCount(0);
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

  test("imported route persists across a page reload", async ({ page }) => {
    await page.reload();
    await waitForMapReady(page);

    await openRoutesPanel(page);

    // Persisted routes are re-rendered on load (crash recovery)
    await expect(page.getByText("Test Loop")).toBeVisible();
  });
});
