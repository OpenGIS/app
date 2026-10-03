import { test, expect } from "@playwright/test";
import { waitForMapReady, openMenuPanel } from "./helpers/panel";

/**
 * Tests for docs/guide/core.md
 *
 * Covers the First load behaviour: Welcome modal, OS-driven language,
 * returning visits, and the Info pane toggled via the attribution chip.
 */

// Chip-click interactions (Info / attribution chips) settle slowly under
// SwiftShader/load — stability checks can take tens of seconds. The default
// 30 s test budget intermittently fails these tests on slower machines — raise
// the file budget; assertions are unchanged.
test.setTimeout(120000);

const withNoViewStorage = (page) =>
  page.addInitScript(() => localStorage.removeItem("ogis_view_app"));

const withViewStorage = (page) =>
  page.addInitScript(() =>
    localStorage.setItem(
      "ogis_view_app",
      JSON.stringify({
        mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 10 },
      }),
    ),
  );

// ─── First load / Welcome modal ───────────────────────────────────────────────

test.describe("First load / Welcome modal", () => {
  test("modal is visible on first visit with welcome text", async ({
    page,
  }) => {
    await withNoViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator("#about-modal")).toBeVisible();
    await expect(page.locator("#about-modal-title")).toBeVisible();
    await expect(page.locator("#about-modal .modal-body")).toContainText(
      "A map for exploring",
    );
  });

  test("modal can be dismissed with Get Started button", async ({ page }) => {
    await withNoViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator("#about-modal")).toBeVisible();
    await page.locator("#about-modal-close").click();
    await expect(page.locator("#about-modal")).toHaveCount(0);
  });

  test("modal can be dismissed with close button", async ({ page }) => {
    await withNoViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator("#about-modal")).toBeVisible();
    await page.locator("#about-modal .btn-close").click();
    await expect(page.locator("#about-modal")).toHaveCount(0);
  });
});

// ─── First load / Language ────────────────────────────────────────────────────

test.describe("First load / Language", () => {
  test("welcome modal has no language picker", async ({ page }) => {
    await withNoViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator("#about-language")).toHaveCount(0);
  });

  test.describe("browser language — French (fr-FR)", () => {
    test.use({ locale: "fr-FR" });

    test("welcome modal content follows the browser language", async ({
      page,
    }) => {
      await withNoViewStorage(page);
      await page.goto("/");
      await waitForMapReady(page);

      await expect(page.locator("#about-modal .modal-body")).toContainText(
        "Une carte pour explorer",
      );
    });
  });
});

// ─── First load / Units ───────────────────────────────────────────────────────

test.describe("First load / Units", () => {
  test("welcome modal has no units picker", async ({ page }) => {
    await withNoViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator("#about-units")).toHaveCount(0);
  });
});

// ─── First load / Returning visits ───────────────────────────────────────────

test.describe("First load / Returning visits", () => {
  test("modal is absent on returning visit", async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator("#about-modal")).toHaveCount(0);
  });

  test("modal is absent after view storage is written and page is reloaded", async ({
    page,
  }) => {
    const VIEW_KEY = "ogis_view_app";

    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator("#about-modal")).toBeVisible();

    await page.locator("#about-modal-close").click();
    await expect(page.locator("#about-modal")).toHaveCount(0);

    await page.evaluate((k) => {
      localStorage.setItem(
        k,
        JSON.stringify({
          mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 10 },
        }),
      );
    }, VIEW_KEY);

    await page.reload();
    await waitForMapReady(page);

    await expect(page.locator("#about-modal")).toHaveCount(0);
  });
});

// ─── Info pane / Pane separation ─────────────────────────────────────────────

test.describe("Info pane / Pane separation", () => {
  test("Info is not a tab in the menu", async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator(".ogis-panel")).toBeVisible({ timeout: 5000 });

    // Desktop auto-opens the Info pane; open the menu pane so the tab strip renders.
    if (!(await page.locator(".panel-nav").isVisible())) {
      await page.locator("#menu-button").click();
      await page.locator(".panel-nav").waitFor();
    }

    await expect(page.locator("#info-button")).toHaveCount(0);
    await expect(
      page.locator(".panel-nav").getByRole("button", { name: /^info$/i }),
    ).toHaveCount(0);
  });

  test("attribution chip toggles the Info pane open and closed", async ({
    page,
  }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    // Desktop auto-opens the Info pane, so the first click closes it.
    await expect(page.locator(".ogis-info-panel")).toBeVisible();

    await page.locator("#attribution-button").click();
    await expect(page.locator(".ogis-info-panel")).toHaveCount(0);
    await expect(page.locator(".ogis-panel")).not.toHaveClass(/show/);

    await page.locator("#attribution-button").click();
    await expect(page.locator(".ogis-info-panel")).toBeVisible();
  });

  test("visiting Info keeps the active menu tab", async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await expect(page.locator(".ogis-panel")).toBeVisible({ timeout: 5000 });

    // Desktop auto-opens the Info pane; open the menu pane so the tab strip renders.
    if (!(await page.locator(".panel-nav").isVisible())) {
      await page.locator("#menu-button").click();
      await page.locator(".panel-nav").waitFor();
    }

    const offlineTab = page
      .locator(".panel-nav")
      .getByRole("button", { name: /offline maps/i });
    await offlineTab.click();
    await expect(offlineTab).toHaveAttribute("aria-pressed", "true");

    // Open Info via the chip, then reopen the menu pane.
    await page.locator("#attribution-button").click();
    await expect(page.locator(".ogis-info-panel")).toBeVisible();
    await page.locator("#menu-button").click();

    await expect(
      page.locator(".panel-nav").getByRole("button", { name: /offline maps/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

// ─── Info panel ───────────────────────────────────────────────────────────────

test.describe("Info panel", () => {
  test("Info panel shows map view, about, privacy and attribution content", async ({
    page,
  }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    // Desktop auto-opens the Info pane, so no chip click is needed.
    const panel = page.locator(".ogis-info-panel");
    await expect(panel).toBeVisible();

    await expect(panel.locator(".ogis-share-textarea")).toBeVisible();

    const about = panel.locator(".ogis-about-section");
    await expect(about).toContainText("Free, private");
    await expect(about).toContainText("Open-Source");
    await expect(
      about.locator('a[href="https://github.com/OpenGIS/app/"]'),
    ).toHaveAttribute("target", "_blank");

    const aboutLogo = about.locator('img[alt="OpenGIS"]');
    await expect(aboutLogo).toBeVisible();
    await expect(aboutLogo).toHaveAttribute("src", /\/favicon\.png$/);

    const privacy = panel.locator(".ogis-privacy-section");
    await expect(privacy).toContainText("local storage");
    await expect(privacy).toContainText("OpenFreeMap");
    await expect(privacy).toContainText("Locate");
    await expect(privacy).toContainText("no analytics");

    await expect(panel.locator(".ogis-attribution-section")).toContainText(
      /OpenStreetMap/,
    );
  });

  test("Attribution chip opens the Info panel", async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    // Close the auto-opened Info pane, then reopen it via the chip.
    await expect(page.locator(".ogis-info-panel")).toBeVisible();

    await page.locator("#attribution-button").click();
    await expect(page.locator(".ogis-info-panel")).toHaveCount(0);

    await page.locator("#attribution-button").click();
    await expect(page.locator(".ogis-info-panel")).toBeVisible();
  });

  test("Privacy disclosure toggles its label between Read more and Read less", async ({
    page,
  }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    // Scope to the Privacy section disclosure.
    const privacy = page.locator(".ogis-privacy-section");
    await expect(privacy).toBeVisible();

    const summary = privacy.locator("summary");
    const more = privacy.locator(".ogis-disclosure-more");
    const less = privacy.locator(".ogis-disclosure-less");

    // Collapsed: "Read more" shows and "Read less" is hidden.
    await expect(more).toBeVisible();
    await expect(less).toBeHidden();

    // Expanded: the labels swap.
    await summary.click();
    await expect(less).toBeVisible();
    await expect(more).toBeHidden();

    // Collapsed again: back to "Read more".
    await summary.click();
    await expect(more).toBeVisible();
    await expect(less).toBeHidden();
  });

  test("Attribution footer is pinned with sticky positioning", async ({
    page,
  }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    const attribution = page.locator(".ogis-attribution-section");
    await expect(attribution).toBeVisible();

    const { position, bottom } = await attribution.evaluate((el) => {
      const styles = getComputedStyle(el);
      return { position: styles.position, bottom: styles.bottom };
    });

    expect(position).toBe("sticky");
    expect(bottom).toBe("0px");
  });
});

// ─── Panel geometry / responsive cap + backdrop strip ────────────────────────
//
// `--ogis-panel-width: min(340px, calc(100vw - 4rem))` caps the panel on small
// screens so a strip of dismiss backdrop always remains tappable beside it.
// The width is pinned to ±1px per viewport, and dismissal goes through a real
// pointer click on the visible strip (not a dispatched synthetic event).

test.describe("Panel geometry / capped width and backdrop strip", () => {
  for (const vp of [
    { width: 320, height: 568, panelWidth: 256 },
    { width: 390, height: 844, panelWidth: 326 },
  ]) {
    test.describe(`${vp.width}×${vp.height}`, () => {
      test.use({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: true,
      });

      test("panel is capped and the visible strip closes it", async ({
        page,
      }) => {
        await withViewStorage(page);
        await page.goto("/");
        await waitForMapReady(page);

        await openMenuPanel(page);

        const panelBox = await page.locator(".ogis-panel").boundingBox();
        const viewport = page.viewportSize();

        // min(340px, 100vw - 4rem): 256px at 320, 326px at 390.
        expect(panelBox.width).toBeGreaterThanOrEqual(vp.panelWidth - 1);
        expect(panelBox.width).toBeLessThanOrEqual(vp.panelWidth + 1);

        // The panel leaves a visible strip (≈ 4rem) of backdrop to its right.
        expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(
          viewport.width - 56,
        );

        // A real pointer click on the strip closes the panel via the backdrop.
        const x = Math.min(
          panelBox.x + panelBox.width + 16,
          viewport.width - 8,
        );
        await page.mouse.click(x, viewport.height / 2);

        await expect(page.locator(".ogis-panel")).not.toHaveClass(/show/);
        await expect(page.locator(".offcanvas-backdrop")).toHaveCount(0);
      });
    });
  }
});

// ─── Panel geometry / safe-area insets ───────────────────────────────────────

test.describe("Panel geometry / safe-area insets", () => {
  // Phone portrait with touch; Playwright cannot emulate env(safe-area-inset-*),
  // so the tests set the custom properties the CSS consumes instead.
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("insets shift corner chips and panel content", async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    // 44/34 mirror a notched phone (status bar / home indicator).
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--ogis-safe-top", "44px");
      document.documentElement.style.setProperty("--ogis-safe-bottom", "34px");
    });

    // Top-left Menu chip: corner padding-top = 0.75rem (12px) + 44px = 56px.
    const menuBox = await page.locator("#menu-button").boundingBox();
    expect(menuBox.y).toBeGreaterThanOrEqual(55);

    await openMenuPanel(page);

    // Panel padding-top: 44px, so the sticky nav starts below the inset.
    const navBox = await page.locator(".panel-nav").boundingBox();
    expect(navBox.y).toBeGreaterThanOrEqual(43);

    // Bottom-right Record chip in `.ogis-corner--br`:
    // corner padding-bottom = 12px + 34px = 46px.
    const recordBox = await page.locator("#recordings-button").boundingBox();
    const bottomGap = 844 - (recordBox.y + recordBox.height);
    expect(bottomGap).toBeGreaterThanOrEqual(45);

    // Restore the root variables so later assertions in this context are clean.
    await page.evaluate(() => {
      document.documentElement.style.removeProperty("--ogis-safe-top");
      document.documentElement.style.removeProperty("--ogis-safe-bottom");
    });
  });
});

// ─── Panel geometry / desktop unchanged ──────────────────────────────────────

test.describe("Panel geometry / desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("panel width stays at the full 340px", async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    // Desktop auto-opens the Info pane (App.vue calls openInfo at setup), and
    // 1280px leaves room for the uncapped $offcanvas-horizontal-width.
    await expect(page.locator(".ogis-info-panel")).toBeVisible();
    await expect(page.locator(".ogis-panel")).toHaveClass(/show/);

    const panelBox = await page.locator(".ogis-panel").boundingBox();
    expect(panelBox.width).toBeGreaterThanOrEqual(339);
    expect(panelBox.width).toBeLessThanOrEqual(341);

    // No backdrop on desktop — the controls stay reachable beside the panel.
    await expect(page.locator(".offcanvas-backdrop")).toHaveCount(0);
  });
});
