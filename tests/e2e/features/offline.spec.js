import { test, expect } from "@playwright/test";

/**
 * E2E tests for src/features/offline/
 *
 * Covers the Offline Maps side panel tab, region selection + estimate, the
 * real-network download flow, and deleting a downloaded region.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Seed a known map view (so the About modal does not appear) and clear regions. */
const withViewStorage = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      "ogis_view_app",
      JSON.stringify({
        mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 14 },
      }),
    );
    localStorage.removeItem("ogis_offline-regions_app");
  });

/** Seed one downloaded region directly into localStorage. */
const withOneRegion = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      "ogis_view_app",
      JSON.stringify({
        mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 14 },
      }),
    );
    localStorage.setItem(
      "ogis_offline-regions_app",
      JSON.stringify([
        {
          id: "test-region-1",
          name: "Test Region",
          createdAt: Date.now(),
          bounds: {
            west: -128.02,
            south: 50.64,
            east: -128.0,
            north: 50.66,
          },
          minZoom: 10,
          maxZoom: 11,
          tileCount: 12,
          estimatedBytes: 720000,
        },
      ]),
    );
  });

/** Seed one downloaded region with bounds around the default coords (for Show). */
const withShowRegion = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      "ogis_view_app",
      JSON.stringify({
        mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 14 },
      }),
    );
    localStorage.setItem(
      "ogis_offline-regions_app",
      JSON.stringify([
        {
          id: "show-region-1",
          name: "Test Region",
          createdAt: Date.now(),
          bounds: {
            west: -129,
            south: 49.5,
            east: -127,
            north: 52,
          },
          minZoom: 10,
          maxZoom: 11,
          tileCount: 12,
          estimatedBytes: 720000,
        },
      ]),
    );
  });

/** Open the Offline Maps panel via its side panel nav tab. */
const openOfflinePanel = async (page) => {
  // Desktop auto-opens the Info pane; open the menu pane so the tab strip renders.
  if (!(await page.locator(".panel-nav").isVisible())) {
    await page.locator("#menu-button").click();
    await page.locator(".panel-nav").waitFor();
  }
  await page
    .locator(".panel-nav")
    .getByRole("button", { name: /offline maps/i })
    .click();
  await expect(page.locator(".ogis-panel")).toHaveClass(/show/);
  await expect(
    page.getByRole("heading", { name: "Offline Maps" }),
  ).toBeVisible();
};

/** Drag a small box on the map canvas to select a region. */
const drawRegion = async (page) => {
  const canvas = page.locator(".ogis-map canvas");
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  const x0 = box.x + box.width * 0.35;
  const y0 = box.y + box.height * 0.35;
  const x1 = box.x + box.width * 0.55;
  const y1 = box.y + box.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 8 });
  await page.mouse.up();
};

// ─── Offline / Panel tab ─────────────────────────────────────────────────────

test.describe("Offline / Panel tab", () => {
  test.beforeEach(async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");
  });

  test("no offline corner chip is present", async ({ page }) => {
    await expect(page.locator("#offline-button")).toHaveCount(0);
    await expect(page.locator("[data-custom-button=offline]")).toHaveCount(0);
  });

  test("Offline Maps tab appears in the side panel nav", async ({ page }) => {
    // Dismiss the first-load welcome modal if it appears (seeded view storage
    // usually prevents it).
    const modal = page.locator("#about-modal");
    if (await modal.isVisible().catch(() => false)) {
      await page.locator("#about-modal-close").click();
      await modal.waitFor({ state: "hidden" });
    }
    await expect(page.locator(".ogis-panel")).toHaveClass(/show/);

    // Desktop auto-opens the Info pane; open the menu pane so the tab strip renders.
    if (!(await page.locator(".panel-nav").isVisible())) {
      await page.locator("#menu-button").click();
      await page.locator(".panel-nav").waitFor();
    }

    await expect(
      page.locator(".panel-nav").getByRole("button", { name: /offline maps/i }),
    ).toBeVisible();
  });

  test("clicking the Offline Maps tab opens the Offline Maps panel", async ({
    page,
  }) => {
    await openOfflinePanel(page);
    await expect(
      page.getByRole("button", { name: "Select region" }),
    ).toBeVisible();
    await expect(page.locator("#offline-minzoom")).toBeVisible();
    await expect(page.locator("#offline-maxzoom")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Estimate size" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download region" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Downloaded Regions" }),
    ).toBeVisible();
  });
});

// ─── Offline / Estimate ──────────────────────────────────────────────────────

test.describe("Offline / Estimate", () => {
  test.beforeEach(async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");
    await openOfflinePanel(page);
  });

  test("drawing a region and estimating shows tile count and size", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Select region" }).click();
    await drawRegion(page);

    // Selected region bounds are shown
    await expect(page.getByText("Selected region")).toBeVisible();

    await page.getByRole("button", { name: "Estimate size" }).click();

    await expect(page.getByText("Tiles", { exact: true })).toBeVisible();
    await expect(page.getByText("Est. size")).toBeVisible();
  });
});

// ─── Offline / Download ──────────────────────────────────────────────────────

test.describe("Offline / Download", () => {
  test.beforeEach(async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");
    await openOfflinePanel(page);
  });

  test("downloading a region adds it to the Downloaded Regions list", async ({
    page,
  }) => {
    // Real-network download of tiles + glyphs can take a while.
    test.setTimeout(180000);

    // Keep the download small: a small box at a narrow zoom range.
    await page.locator("#offline-minzoom").fill("10");
    await page.locator("#offline-maxzoom").fill("11");

    await page.getByRole("button", { name: "Select region" }).click();
    await drawRegion(page);
    await page.getByRole("button", { name: "Estimate size" }).click();
    await expect(page.getByText("Est. size")).toBeVisible();

    await page.getByRole("button", { name: "Download region" }).click();

    // The Cancel button appears while downloading
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

    // The region appears in the list once the download completes
    await expect
      .poll(() => page.getByRole("button", { name: "Delete" }).count(), {
        timeout: 120000,
      })
      .toBeGreaterThan(0);
    await expect(page.getByText("Region 1")).toBeVisible();
  });
});

// ─── Offline / Delete ────────────────────────────────────────────────────────

test.describe("Offline / Delete", () => {
  test.beforeEach(async ({ page }) => {
    await withOneRegion(page);
    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");
    await openOfflinePanel(page);
  });

  test("Delete button removes a downloaded region from the list", async ({
    page,
  }) => {
    await expect(page.getByText("Test Region")).toBeVisible();

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Test Region")).toHaveCount(0);
    await expect(page.getByText("No regions downloaded yet.")).toBeVisible();
  });
});

// ─── Offline / Show ─────────────────────────────────────────────────────────

test.describe("Offline / Show", () => {
  test.beforeEach(async ({ page }) => {
    await withShowRegion(page);
    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");
    await openOfflinePanel(page);
  });

  test("Show button navigates the map to the region's bounds", async ({
    page,
  }) => {
    // The seeded region appears in the list with a Show button
    await expect(page.getByText("Test Region")).toBeVisible();
    await expect(
      page
        .locator(".ogis-panel")
        .getByRole("button", { name: "Show", exact: true }),
    ).toBeVisible();

    // The map starts at the seeded view (zoom 14 at the default coords)
    await expect
      .poll(() => page.url(), { timeout: 6000 })
      .toMatch(/#map=14\/50\.653900\/-128\.009400/);

    // The map canvas is visible while the panel is open
    await expect(page.locator(".ogis-map canvas")).toBeVisible();

    await page
      .locator(".ogis-panel")
      .getByRole("button", { name: "Show", exact: true })
      .click();

    // The map navigates (fitBounds) to the region — the URL hash updates
    // on moveend with the new centre and zoom. The globe projection may
    // offset the centre slightly from the geometric centre, so assert it
    // lies within the region's bounds rather than an exact value.
    const isWithinRegion = () => {
      const match = page.url().match(/#map=(\d+)\/(-?[\d.]+)\/(-?[\d.]+)/);
      if (!match) return false;
      const zoom = Number(match[1]);
      const lat = Number(match[2]);
      const lng = Number(match[3]);
      return lat > 49.5 && lat < 52 && lng > -129 && lng < -127 && zoom < 14;
    };

    await expect.poll(isWithinRegion, { timeout: 15000 }).toBe(true);
  });
});

// ─── Offline / Mobile (touch) ────────────────────────────────────────────────

test.describe("Offline / Mobile (touch)", () => {
  // Mobile viewport with touch support: the panel no longer auto-opens and
  // region drawing must work via touch events (touchstart/move/end).
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  /** Open the side panel via the hamburger, then switch to the Offline Maps tab. */
  const openOfflinePanelMobile = async (page) => {
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.locator(".ogis-panel")).toHaveClass(/show/);
    await page
      .locator(".panel-nav")
      .getByRole("button", { name: /offline maps/i })
      .click();
    await expect(
      page.getByRole("heading", { name: "Offline Maps" }),
    ).toBeVisible();
  };

  /** Wait for the offcanvas slide-out transition so it no longer intercepts touches. */
  const waitForPanelHidden = async (page) => {
    await page.waitForFunction(() => {
      const panel = document.querySelector(".ogis-panel");
      if (!panel) return true;
      return panel.getBoundingClientRect().right <= 0;
    });
  };

  test.beforeEach(async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");
  });

  test("Select region closes the panel on mobile", async ({ page }) => {
    await openOfflinePanelMobile(page);
    await expect(
      page.getByRole("button", { name: "Select region" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Select region" }).click();

    // The panel closes, revealing the map; the mobile backdrop disappears.
    await expect(page.locator(".ogis-panel")).not.toHaveClass(/show/);
    await expect(page.locator(".offcanvas-backdrop")).toHaveCount(0);
  });

  test("touch-drag draws a region and the panel reopens", async ({ page }) => {
    await openOfflinePanelMobile(page);
    await page.getByRole("button", { name: "Select region" }).click();
    await expect(page.locator(".ogis-panel")).not.toHaveClass(/show/);
    await waitForPanelHidden(page);

    const canvas = page.locator(".ogis-map canvas");
    const box = await canvas.boundingBox();
    const x0 = box.x + box.width * 0.35;
    const y0 = box.y + box.height * 0.35;
    const x1 = box.x + box.width * 0.55;
    const y1 = box.y + box.height * 0.55;

    // Playwright has no built-in touch-drag, so dispatch touch events via CDP.
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: x0, y: y0 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x1, y: y1 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    // The panel auto-reopens with the selected region shown.
    await expect(page.locator(".ogis-panel")).toHaveClass(/show/);
    await expect(page.getByText("Selected region")).toBeVisible();
  });

  test("tap without drag does NOT select a region", async ({ page }) => {
    await openOfflinePanelMobile(page);
    await page.getByRole("button", { name: "Select region" }).click();
    await expect(page.locator(".ogis-panel")).not.toHaveClass(/show/);
    await waitForPanelHidden(page);

    const canvas = page.locator(".ogis-map canvas");
    const box = await canvas.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    // A <4px tap aborts the draw: the panel stays closed, no region shown.
    await expect(page.locator(".ogis-panel")).not.toHaveClass(/show/);
    await expect(page.getByText("Selected region")).toHaveCount(0);
  });
});
