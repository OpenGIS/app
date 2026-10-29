import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady, openMenuTab } from "../helpers/panel";
import { readStoredState } from "../helpers/storage.js";
import { DEMO } from "../../fixtures/demo.mjs";

/**
 * E2E tests for src/features/recordings/
 *
 * Covers the start control inside the Recordings panel, the menu-chip status
 * badge, the permission flow, the recording lifecycle (start, pause, resume,
 * save, discard), saved list management, legacy migration, confirmed deletion,
 * independent Show/Hide toggles, and GPX/GeoJSON share downloads.
 */

// Reload and panel interactions settle slowly under SwiftShader/load —
// stability checks can take tens of seconds. The default 30 s test budget
// intermittently fails these tests on slower machines — raise the file budget;
// assertions are unchanged.
test.setTimeout(120000);

// Assert a clean console for every test in this spec (see helpers/console.js).
test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

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

/** Force the share fallback so downloads are deterministic in every browser. */
const withoutWebShare = (page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
  });

/** Open the Recordings panel via its side panel nav tab. */
const openRecordingsPanel = async (page) => {
  if (!(await page.locator(".panel-nav").isVisible())) {
    await page.locator("#menu-button").click();
    await page.locator(".panel-nav").waitFor();
  }
  await page
    .locator(".panel-nav")
    .getByRole("button", { name: "Recordings", exact: true })
    .click();
  await expect(page.locator(".ogis-panel")).toHaveClass(/show/);
};

/** Register a native-confirm handler and capture the message it carried. */
const handleConfirm = (page, action, messages) => {
  page.once("dialog", async (dialog) => {
    messages.push(dialog.message());
    await dialog[action]();
  });
};

/** Read the persisted recordings storage object (envelope or legacy). */
const storedRecordings = async (page) =>
  readStoredState(
    await page.evaluate(() => localStorage.getItem("ogis_recordings_app")),
  ) ?? {};

/**
 * Read the sorted ids of features currently held by the app's GeoJSON source,
 * optionally scoped to an id prefix.
 */
const mapFeatureIds = (page, prefix = "") =>
  page.evaluate(async (idPrefix) => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const map = getMapInstance("app");
    const data = map?.getSource("ogis-geojson")?.serialize()?.data;
    const features =
      data && typeof data === "object" && Array.isArray(data.features)
        ? data.features
        : [];
    return features
      .map((feature) => String(feature.id))
      .filter((id) => id.startsWith(idPrefix))
      .sort();
  }, prefix);

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
    await expect(page.getByText("Trust")).toBeVisible();
  });

  test("cancelling the permission modal does not start recording", async ({
    page,
  }) => {
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Trust")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Trust")).toBeHidden();
    await expect(page.locator("#recordings-start-button")).toBeVisible();
    await expect(page.locator(".ogis-menu-badge")).toBeHidden();
  });

  test("confirming the modal starts recording", async ({ page }) => {
    await grantGeolocation(page);
    await openMenuTab(page, "Recordings");
    await page.locator("#recordings-start-button").click();
    await expect(page.getByText("Trust")).toBeVisible();
    await page.getByRole("button", { name: "I understand" }).click();
    await expect(page.getByText("Trust")).toBeHidden();
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
    await expect(page.getByText("Trust")).toBeHidden();
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

    // Verify saved to storage in the v2 document shape. Writes are debounced,
    // so wait for the persisted envelope rather than reading immediately.
    await expect
      .poll(async () =>
        readStoredState(
          await page.evaluate(() =>
            localStorage.getItem("ogis_recordings_app"),
          ),
        ),
      )
      .toMatchObject({ saved: [{ v: 2, kind: "recording" }] });

    const persisted =
      readStoredState(
        await page.evaluate(() => localStorage.getItem("ogis_recordings_app")),
      ) ?? {};
    expect(persisted.saved).toHaveLength(1);
    expect(persisted.saved[0].createdAt).toEqual(expect.any(Number));
    expect(persisted.saved[0].segments).toHaveLength(1);
    expect(persisted.saved[0].segments[0].points.length).toBeGreaterThan(0);

    // Reload and check it's still there
    await page.reload();
    await waitForMapReady(page);
    await openMenuTab(page, "Recordings");
    await expect(page.locator(".border-top")).toBeVisible();
  });
});

// ─── Recordings / Saved list management ──────────────────────────────────────

test.describe("Recordings / Saved list management", () => {
  // A fixed legacy timestamp: the migration must derive `createdAt` from it.
  const SAVED_AT = Date.UTC(2025, 0, 15, 9, 30, 0);

  /** Seed one legacy (pre-v2) saved recording directly into localStorage. */
  const withOneSavedRecording = (page) =>
    page.addInitScript(
      ({ center, points, savedAt }) => {
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
                timestamp: savedAt,
                duration: 120000,
                distance: 500,
                points: points.map((point, index) => ({
                  lat: point.lat,
                  lng: point.lng,
                  t: savedAt - (points.length - 1 - index) * 120000,
                })),
              },
            ],
            active: null,
          }),
        );
      },
      {
        center: DEMO.center,
        points: [DEMO.route[0], DEMO.route.at(-1)],
        savedAt: SAVED_AT,
      },
    );

  test.beforeEach(async ({ page }) => {
    await withoutWebShare(page);
    await withOneSavedRecording(page);
    await page.goto("/");
    await waitForMapReady(page);
    await openRecordingsPanel(page);
  });

  test("saved recording is listed in the panel", async ({ page }) => {
    const row = page.locator(".border-top");
    await expect(row).toBeVisible();
    await expect(row.locator(".ogis-track-swatch")).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Show", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(row.locator("summary")).toContainText("Share");
    await expect(
      row.getByRole("button", { name: "GPX", exact: true }),
    ).toBeHidden();
    await expect(
      row.getByRole("button", { name: "GeoJSON", exact: true }),
    ).toBeHidden();
    await expect(
      row.getByRole("button", { name: "Delete", exact: true }),
    ).toBeVisible();
  });

  test("legacy saved recording migrates to the v2 document shape", async ({
    page,
  }) => {
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() =>
          localStorage.getItem("ogis_recordings_app"),
        );
        const stored = readStoredState(raw) ?? {};
        const [recording] = stored.saved ?? [];
        if (!recording) return null;
        return {
          v: recording.v,
          kind: recording.kind,
          createdAt: recording.createdAt,
          segments: recording.segments?.length,
          points: recording.segments?.[0]?.points?.length,
          waypoints: recording.waypoints?.length,
          source: recording.source?.format,
          color: /^#[0-9a-f]{6}$/i.test(recording.color ?? ""),
          hasLegacyTimestamp: "timestamp" in recording,
        };
      })
      .toEqual({
        v: 2,
        kind: "recording",
        createdAt: SAVED_AT,
        segments: 1,
        points: 2,
        waypoints: 0,
        source: "legacy",
        color: true,
        hasLegacyTimestamp: false,
      });
  });

  test("cancelling Delete keeps the recording and its map feature", async ({
    page,
  }) => {
    const row = page.locator(".border-top");
    await row.getByRole("button", { name: "Show", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "recordings-saved-"))
      .toEqual(["recordings-saved-test-rec-1"]);

    const messages = [];
    handleConfirm(page, "dismiss", messages);
    await row.getByRole("button", { name: "Delete", exact: true }).click();

    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain("Delete the recording from");
    await expect(row).toBeVisible();
    await expect
      .poll(() => mapFeatureIds(page, "recordings-saved-"))
      .toEqual(["recordings-saved-test-rec-1"]);
    expect((await storedRecordings(page)).saved).toHaveLength(1);
  });

  test("accepting Delete removes the recording and its map feature", async ({
    page,
  }) => {
    const row = page.locator(".border-top");
    await row.getByRole("button", { name: "Show", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "recordings-saved-"))
      .toEqual(["recordings-saved-test-rec-1"]);

    const messages = [];
    handleConfirm(page, "accept", messages);
    await row.getByRole("button", { name: "Delete", exact: true }).click();

    await expect.poll(() => messages.length).toBe(1);
    await expect(page.locator(".border-top")).toHaveCount(0);
    await expect(page.getByText("No recordings yet.")).toBeVisible();
    await expect
      .poll(() => mapFeatureIds(page, "recordings-saved-"))
      .toEqual([]);
    expect((await storedRecordings(page)).saved).toEqual([]);
  });

  test("Show displays the track and Hide removes it", async ({ page }) => {
    const row = page.locator(".border-top");
    await row.getByRole("button", { name: "Show", exact: true }).click();

    const hide = row.getByRole("button", { name: "Hide", exact: true });
    await expect(hide).toBeVisible();
    await expect(hide).toHaveAttribute("aria-pressed", "true");
    await expect(hide).toHaveClass(/btn-primary/);
    await expect
      .poll(() => mapFeatureIds(page, "recordings-saved-"))
      .toEqual(["recordings-saved-test-rec-1"]);

    await hide.click();
    await expect(
      row.getByRole("button", { name: "Show", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(() => mapFeatureIds(page, "recordings-saved-"))
      .toEqual([]);
  });

  test("Share downloads the recording as GPX and GeoJSON", async ({ page }) => {
    const row = page.locator(".border-top");
    const summary = row.locator("summary");

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
    // component's `new Date(rec.createdAt).toLocaleString(formatLocale)`
    // rendering. Playwright pins en-CA, so the page locale and the computed
    // formatLocale agree.
    const [newerLabel, olderLabel] = await page.evaluate(
      ([newer, older]) =>
        [newer, older].map((timestamp) => new Date(timestamp).toLocaleString()),
      [NEWER_TIMESTAMP, OLDER_TIMESTAMP],
    );

    await expect(items.nth(0)).toContainText(newerLabel);
    await expect(items.nth(1)).toContainText(olderLabel);
  });

  test("saved recordings are shown and hidden independently", async ({
    page,
  }) => {
    const items = page.locator(".border-top");
    await expect(items).toHaveCount(2);
    const newerRow = items.nth(0);
    const olderRow = items.nth(1);

    await newerRow.getByRole("button", { name: "Show", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "recordings-saved-"))
      .toEqual(["recordings-saved-test-rec-2"]);
    await expect(
      newerRow.getByRole("button", { name: "Hide", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      olderRow.getByRole("button", { name: "Show", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");

    await olderRow.getByRole("button", { name: "Show", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "recordings-saved-"))
      .toEqual(
        ["recordings-saved-test-rec-1", "recordings-saved-test-rec-2"].sort(),
      );

    await newerRow.getByRole("button", { name: "Hide", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "recordings-saved-"))
      .toEqual(["recordings-saved-test-rec-1"]);
    await expect(
      olderRow.getByRole("button", { name: "Hide", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await olderRow.getByRole("button", { name: "Hide", exact: true }).click();
    await expect
      .poll(() => mapFeatureIds(page, "recordings-saved-"))
      .toEqual([]);
    await expect(
      olderRow.getByRole("button", { name: "Show", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
