import { test, expect } from "../helpers/test.js";
import { waitForMapReady, openMenuTab } from "../helpers/panel";
import { DEMO } from "../../fixtures/demo.mjs";

/**
 * E2E tests for src/features/recordings/
 *
 * Covers the start control inside the Recordings panel, the menu-chip status
 * badge, the permission flow, the recording lifecycle (start, pause, resume,
 * save, discard), saved list management, and GPX export.
 */

// Reload and panel interactions settle slowly under SwiftShader/load —
// stability checks can take tens of seconds. The default 30 s test budget
// intermittently fails these tests on slower machines — raise the file budget;
// assertions are unchanged.
test.setTimeout(120000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Seed localStorage with permission granted and a known map view. */
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

/** Clear all app storage so the permission flow appears fresh. */
const withNoStorage = (page) =>
  page.addInitScript(() => {
    localStorage.removeItem("ogis_locate_app");
    localStorage.removeItem("ogis_view_app");
    localStorage.removeItem("ogis_recordings_app");
  });

/** Grant browser geolocation permission and set a fixed position. */
const grantGeolocation = (
  page,
  coords = { latitude: DEMO.center.lat, longitude: DEMO.center.lng },
) =>
  page
    .context()
    .grantPermissions(["geolocation"])
    .then(() => page.context().setGeolocation(coords));

// ─── Recordings / Panel entry point ──────────────────────────────────────────

test.describe("Recordings / Panel entry point", () => {
  test.beforeEach(async ({ page }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("start control is visible in the Recordings panel when idle", async ({
    page,
  }) => {
    await openMenuTab(page, "Recordings");
    await expect(page.locator("#recordings-start-button")).toBeVisible();
  });

  test("menu badge is hidden while no recording is active", async ({
    page,
  }) => {
    await expect(page.locator(".ogis-menu-badge")).toBeHidden();
  });
});

// ─── Recordings / Permission modal ───────────────────────────────────────────

test.describe("Recordings / Permission modal", () => {
  test.beforeEach(async ({ page }) => {
    await withNoStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("clicking Start shows the permission confirmation modal on first use", async ({
    page,
  }) => {
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Permission Required")).toBeVisible();
  });

  test("cancelling the permission modal does not start recording", async ({
    page,
  }) => {
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Permission Required")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Permission Required")).toBeHidden();
    await expect(page.locator("#recordings-start-button")).toBeVisible();
    await expect(page.locator(".ogis-menu-badge")).toBeHidden();
  });

  test("confirming the modal starts recording", async ({ page }) => {
    await grantGeolocation(page);
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Permission Required")).toBeVisible();
    await page.getByRole("button", { name: "I Understand" }).click();
    await expect(page.getByText("Permission Required")).toBeHidden();
    await expect(page.getByText("Current Recording")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(".ogis-menu-badge")).toHaveAttribute(
      "data-state",
      "recording",
    );
  });

  test("permission modal is not shown when permission was already granted", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Permission Required")).toBeHidden();
  });
});

// ─── Recordings / Start and Pause ────────────────────────────────────────────

test.describe("Recordings / Start and Pause", () => {
  test.beforeEach(async ({ page }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("clicking Start begins a recording and shows the active state", async ({
    page,
  }) => {
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Current Recording")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(".ogis-menu-badge")).toHaveAttribute(
      "data-state",
      "recording",
    );
  });

  test("starting a recording shows Duration and Distance in the panel", async ({
    page,
  }) => {
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Current Recording")).toBeVisible();
    await expect(page.getByText("Duration")).toBeVisible();
    await expect(page.getByText("Distance")).toBeVisible();
  });

  test("Pause button pauses the recording and the badge shows paused", async ({
    page,
  }) => {
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Current Recording")).toBeVisible();

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.locator(".ogis-menu-badge")).toHaveAttribute(
      "data-state",
      "paused",
    );
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  });

  test("Resume button resumes the recording after pausing", async ({
    page,
  }) => {
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Current Recording")).toBeVisible();

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.locator(".ogis-menu-badge")).toHaveAttribute(
      "data-state",
      "paused",
    );

    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.locator(".ogis-menu-badge")).toHaveAttribute(
      "data-state",
      "recording",
    );
  });
});

// ─── Recordings / Save and Discard ───────────────────────────────────────────

test.describe("Recordings / Save and Discard", () => {
  test.beforeEach(async ({ page }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("Discard stops the recording and returns the panel to idle", async ({
    page,
  }) => {
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Current Recording")).toBeVisible();

    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.locator("#recordings-start-button")).toBeVisible();
    await expect(page.getByText("Duration")).toBeHidden();
    await expect(page.locator(".ogis-menu-badge")).toBeHidden();
  });

  test("Save saves the recording and it appears in the saved list", async ({
    page,
  }) => {
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Current Recording")).toBeVisible();

    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    // Panel returns to idle…
    await expect(page.locator("#recordings-start-button")).toBeVisible();
    // …and the menu badge clears.
    await expect(page.locator(".ogis-menu-badge")).toBeHidden();
    // Saved list shows the recording
    await expect(page.getByText("Duration")).toBeHidden();
    await expect(page.locator(".border-top")).toBeVisible();
  });

  test("saved recording persists across page reload", async ({ page }) => {
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Current Recording")).toBeVisible();

    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    // Verify saved to storage
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ogis_recordings_app") || "{}"),
    );
    expect(stored.saved).toHaveLength(1);

    // Reload and check it's still there
    await page.reload();
    await waitForMapReady(page);
    await openMenuTab(page, "Recordings");
    await expect(page.locator(".border-top")).toBeVisible();
  });
});

// ─── Recordings / Saved list management ──────────────────────────────────────

test.describe("Recordings / Saved list management", () => {
  /** Seed one saved recording directly into localStorage. */
  const withOneSavedRecording = (page) =>
    page.addInitScript(
      ({ center, points }) => {
        const now = Date.now();
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
        localStorage.setItem(
          "ogis_recordings_app",
          JSON.stringify({
            saved: [
              {
                id: "test-rec-1",
                timestamp: now,
                duration: 120000,
                distance: 500,
                points: points.map((point, index) => ({
                  lat: point.lat,
                  lng: point.lng,
                  t: now - (points.length - 1 - index) * 120000,
                })),
              },
            ],
            active: null,
          }),
        );
      },
      { center: DEMO.center, points: [DEMO.route[0], DEMO.route.at(-1)] },
    );

  test.beforeEach(async ({ page }) => {
    await withOneSavedRecording(page);
    await page.goto("/");
    await waitForMapReady(page);
    // Desktop auto-opens the Info pane; open the menu pane so the tab strip renders.
    if (!(await page.locator(".panel-nav").isVisible())) {
      await page.locator("#menu-button").click();
      await page.locator(".panel-nav").waitFor();
    }
    await page
      .locator(".panel-nav")
      .getByRole("button", { name: "Recordings" })
      .click();
    await expect(page.locator(".ogis-panel")).toHaveClass(/show/);
  });

  test("saved recording is listed in the panel", async ({ page }) => {
    await expect(page.locator(".border-top")).toBeVisible();
    await expect(page.getByRole("button", { name: "GPX" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
  });

  test("Delete button removes the recording from the list", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(".border-top")).toHaveCount(0);
    await expect(page.getByText("No recordings yet.")).toBeVisible();
  });

  test("Show button displays the track on the map", async ({ page }) => {
    await page.getByRole("button", { name: "Show" }).click();
    // The GeoJSON line layer should be present on the map canvas
    await expect(page.locator(".ogis-map canvas")).toBeVisible();
  });
});

// ─── Recordings / Saved list order ───────────────────────────────────────────

test.describe("Recordings / Saved list order", () => {
  // Fixed, clearly distinct timestamps (epoch ms) — the older recording is
  // inserted first, matching the order recordings are push()ed onto state.saved.
  const OLDER_TIMESTAMP = Date.UTC(2025, 0, 15, 9, 30, 0);
  const NEWER_TIMESTAMP = Date.UTC(2025, 6, 20, 14, 45, 0);

  /** Seed two saved recordings, oldest first in storage. */
  const withTwoSavedRecordings = (page) =>
    page.addInitScript(
      ({ center, points, older, newer }) => {
        const seed = (id, timestamp, duration) => ({
          id,
          timestamp,
          duration,
          distance: 500,
          points: points.map((point, index) => ({
            lat: point.lat,
            lng: point.lng,
            t: timestamp - (points.length - 1 - index) * duration,
          })),
        });
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
        localStorage.setItem(
          "ogis_recordings_app",
          JSON.stringify({
            saved: [
              seed("test-rec-1", older, 60000),
              seed("test-rec-2", newer, 120000),
            ],
            active: null,
          }),
        );
      },
      {
        center: DEMO.center,
        points: [DEMO.route[0], DEMO.route.at(-1)],
        older: OLDER_TIMESTAMP,
        newer: NEWER_TIMESTAMP,
      },
    );

  test.beforeEach(async ({ page }) => {
    await withTwoSavedRecordings(page);
    await page.goto("/");
    await waitForMapReady(page);
    // Desktop auto-opens the Info pane; open the menu pane so the tab strip renders.
    if (!(await page.locator(".panel-nav").isVisible())) {
      await page.locator("#menu-button").click();
      await page.locator(".panel-nav").waitFor();
    }
    await page
      .locator(".panel-nav")
      .getByRole("button", { name: "Recordings" })
      .click();
    await expect(page.locator(".ogis-panel")).toHaveClass(/show/);
  });

  test("saved recordings are listed newest first", async ({ page }) => {
    const items = page.locator(".border-top");
    await expect(items).toHaveCount(2);

    // Format the expected labels in the page's own locale, matching the
    // component's `new Date(rec.timestamp).toLocaleString()` rendering.
    const [newerLabel, olderLabel] = await page.evaluate(
      ([newer, older]) =>
        [newer, older].map((timestamp) => new Date(timestamp).toLocaleString()),
      [NEWER_TIMESTAMP, OLDER_TIMESTAMP],
    );

    await expect(items.nth(0)).toContainText(newerLabel);
    await expect(items.nth(1)).toContainText(olderLabel);
  });
});

// ─── Recordings / GPX export ──────────────────────────────────────────────────

test.describe("Recordings / GPX export", () => {
  const withOneSavedRecording = (page) =>
    page.addInitScript(
      ({ center, points }) => {
        const now = Date.now();
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
        localStorage.setItem(
          "ogis_recordings_app",
          JSON.stringify({
            saved: [
              {
                id: "gpx-test-rec",
                timestamp: now,
                duration: 60000,
                distance: 200,
                points: points.map((point, index) => ({
                  lat: point.lat,
                  lng: point.lng,
                  t: now - (points.length - 1 - index) * 60000,
                })),
              },
            ],
            active: null,
          }),
        );
      },
      { center: DEMO.center, points: [DEMO.route[0], DEMO.route.at(-1)] },
    );

  test("GPX button triggers a file download", async ({ page }) => {
    await withOneSavedRecording(page);
    await page.goto("/");
    await waitForMapReady(page);
    // Desktop auto-opens the Info pane; open the menu pane so the tab strip renders.
    if (!(await page.locator(".panel-nav").isVisible())) {
      await page.locator("#menu-button").click();
      await page.locator(".panel-nav").waitFor();
    }
    await page
      .locator(".panel-nav")
      .getByRole("button", { name: "Recordings" })
      .click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "GPX" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.gpx$/);
  });
});
