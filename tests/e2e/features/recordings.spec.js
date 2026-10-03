import { test, expect } from "@playwright/test";
import { waitForMapReady } from "../helpers/panel";

/**
 * E2E tests for src/features/recordings/
 *
 * Covers the record button states, permission flow, recording lifecycle
 * (start, pause, resume, save, discard), saved list management, and GPX export.
 */

// Reload and chip-click interactions settle slowly under SwiftShader/load —
// stability checks can take tens of seconds. The default 30 s test budget
// intermittently fails these tests on slower machines — raise the file budget;
// assertions are unchanged.
test.setTimeout(120000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  coords = { latitude: 50.6539, longitude: -128.0094 },
) =>
  page
    .context()
    .grantPermissions(["geolocation"])
    .then(() => page.context().setGeolocation(coords));

// ─── Recordings / Button ─────────────────────────────────────────────────────

test.describe("Recordings / Button", () => {
  test.beforeEach(async ({ page }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("record chip is visible in the map corner controls", async ({
    page,
  }) => {
    await expect(page.locator("#recordings-button")).toBeVisible();
  });

  test("record button shows Record label when inactive", async ({ page }) => {
    await expect(page.locator("#recordings-button")).toContainText("Record");
  });
});

// ─── Recordings / Permission modal ───────────────────────────────────────────

test.describe("Recordings / Permission modal", () => {
  test.beforeEach(async ({ page }) => {
    await withNoStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
  });

  test("clicking Record shows the permission confirmation modal on first use", async ({
    page,
  }) => {
    await page.locator("#recordings-button").click();
    await expect(page.getByText("Permission Required")).toBeVisible();
  });

  test("cancelling the permission modal does not start recording", async ({
    page,
  }) => {
    await page.locator("#recordings-button").click();
    await expect(page.getByText("Permission Required")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Permission Required")).toBeHidden();
    await expect(page.locator("#recordings-button")).toContainText("Record");
  });

  test("confirming the modal starts recording", async ({ page }) => {
    await grantGeolocation(page);
    await page.locator("#recordings-button").click();
    await expect(page.getByText("Permission Required")).toBeVisible();
    await page.getByRole("button", { name: "I Understand" }).click();
    await expect(page.getByText("Permission Required")).toBeHidden();
    await expect
      .poll(() => page.locator("#recordings-button").textContent(), {
        timeout: 5000,
      })
      .toMatch(/Recording/);
  });

  test("permission modal is not shown when permission was already granted", async ({
    page,
  }) => {
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto("/");
    await waitForMapReady(page);
    await page.locator("#recordings-button").click();
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

  test("clicking Record starts a recording and shows Recording label", async ({
    page,
  }) => {
    await page.locator("#recordings-button").click();
    await expect
      .poll(() => page.locator("#recordings-button").textContent(), {
        timeout: 5000,
      })
      .toMatch(/Recording/);
  });

  test("clicking Record opens the Recordings panel showing Duration and Distance", async ({
    page,
  }) => {
    await page.locator("#recordings-button").click();
    await expect
      .poll(() => page.locator("#recordings-button").textContent(), {
        timeout: 5000,
      })
      .toMatch(/Recording/);
    await expect(page.getByText("Duration")).toBeVisible();
    await expect(page.getByText("Distance")).toBeVisible();
  });

  test("Pause button pauses the recording and shows Paused label on button", async ({
    page,
  }) => {
    await page.locator("#recordings-button").click();
    await expect
      .poll(() => page.locator("#recordings-button").textContent(), {
        timeout: 5000,
      })
      .toMatch(/Recording/);

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.locator("#recordings-button")).toContainText("Paused");
  });

  test("Resume button resumes the recording after pausing", async ({
    page,
  }) => {
    await page.locator("#recordings-button").click();
    await expect
      .poll(() => page.locator("#recordings-button").textContent(), {
        timeout: 5000,
      })
      .toMatch(/Recording/);

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.locator("#recordings-button")).toContainText("Paused");

    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.locator("#recordings-button")).toContainText("Recording");
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

  test("Discard button stops the recording and returns button to Record", async ({
    page,
  }) => {
    await page.locator("#recordings-button").click();
    await expect
      .poll(() => page.locator("#recordings-button").textContent(), {
        timeout: 5000,
      })
      .toMatch(/Recording/);

    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.locator("#recordings-button")).toContainText("Record");
    await expect(page.getByText("Duration")).toBeHidden();
  });

  test("Save button saves the recording and it appears in the saved list", async ({
    page,
  }) => {
    await page.locator("#recordings-button").click();
    await expect
      .poll(() => page.locator("#recordings-button").textContent(), {
        timeout: 5000,
      })
      .toMatch(/Recording/);

    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    // Button returns to idle
    await expect(page.locator("#recordings-button")).toContainText("Record");
    // Saved list shows the recording
    await expect(page.getByText("Duration")).toBeHidden();
    await expect(page.locator(".border-top")).toBeVisible();
  });

  test("saved recording persists across page reload", async ({ page }) => {
    await page.locator("#recordings-button").click();
    await expect
      .poll(() => page.locator("#recordings-button").textContent(), {
        timeout: 5000,
      })
      .toMatch(/Recording/);

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
    await page.locator("#recordings-button").click();
    await expect(page.locator(".border-top")).toBeVisible();
  });
});

// ─── Recordings / Saved list management ──────────────────────────────────────

test.describe("Recordings / Saved list management", () => {
  /** Seed one saved recording directly into localStorage. */
  const withOneSavedRecording = (page) =>
    page.addInitScript(() => {
      localStorage.setItem(
        "ogis_locate_app",
        JSON.stringify({ permissionGranted: true }),
      );
      localStorage.setItem(
        "ogis_view_app",
        JSON.stringify({
          mapView: {
            center: { lat: 50.6539, lng: -128.0094 },
            zoom: 14,
          },
        }),
      );
      localStorage.setItem(
        "ogis_recordings_app",
        JSON.stringify({
          saved: [
            {
              id: "test-rec-1",
              timestamp: Date.now(),
              duration: 120000,
              distance: 500,
              points: [
                { lat: 50.6539, lng: -128.0094, t: Date.now() - 120000 },
                { lat: 50.655, lng: -128.008, t: Date.now() },
              ],
            },
          ],
          active: null,
        }),
      );
    });

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

// ─── Recordings / GPX export ──────────────────────────────────────────────────

test.describe("Recordings / GPX export", () => {
  const withOneSavedRecording = (page) =>
    page.addInitScript(() => {
      localStorage.setItem(
        "ogis_locate_app",
        JSON.stringify({ permissionGranted: true }),
      );
      localStorage.setItem(
        "ogis_view_app",
        JSON.stringify({
          mapView: {
            center: { lat: 50.6539, lng: -128.0094 },
            zoom: 14,
          },
        }),
      );
      localStorage.setItem(
        "ogis_recordings_app",
        JSON.stringify({
          saved: [
            {
              id: "gpx-test-rec",
              timestamp: Date.now(),
              duration: 60000,
              distance: 200,
              points: [
                { lat: 50.6539, lng: -128.0094, t: Date.now() - 60000 },
                { lat: 50.654, lng: -128.009, t: Date.now() },
              ],
            },
          ],
          active: null,
        }),
      );
    });

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
