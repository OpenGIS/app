import { test, expect } from "@playwright/test";

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
  page.addInitScript(() => localStorage.removeItem("onrte_view_app"));

const withViewStorage = (page) =>
  page.addInitScript(() =>
    localStorage.setItem(
      "onrte_view_app",
      JSON.stringify({ mapView: { center: { lat: 51.5, lng: -0.1 }, zoom: 10 } }),
    ),
  );

// ─── First load / Welcome modal ───────────────────────────────────────────────

test.describe("First load / Welcome modal", () => {
  test("modal is visible on first visit with welcome text", async ({ page }) => {
    await withNoViewStorage(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#about-modal")).toBeVisible();
    await expect(page.locator("#about-modal-title")).toBeVisible();
    await expect(page.locator("#about-modal .modal-body")).toContainText("A map for exploring");
  });

  test("modal can be dismissed with Get Started button", async ({ page }) => {
    await withNoViewStorage(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#about-modal")).toBeVisible();
    await page.locator("#about-modal-close").click();
    await expect(page.locator("#about-modal")).toHaveCount(0);
  });

  test("modal can be dismissed with close button", async ({ page }) => {
    await withNoViewStorage(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#about-language")).toHaveCount(0);
  });

  test.describe("browser language — French (fr-FR)", () => {
    test.use({ locale: "fr-FR" });

    test("welcome modal content follows the browser language", async ({ page }) => {
      await withNoViewStorage(page);
      await page.goto("/");
      await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#about-units")).toHaveCount(0);
  });
});

// ─── First load / Returning visits ───────────────────────────────────────────

test.describe("First load / Returning visits", () => {
  test("modal is absent on returning visit", async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#about-modal")).toHaveCount(0);
  });

  test("modal is absent after view storage is written and page is reloaded", async ({ page }) => {
    const VIEW_KEY = "onrte_view_app";

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#about-modal")).toBeVisible();

    await page.locator("#about-modal-close").click();
    await expect(page.locator("#about-modal")).toHaveCount(0);

    await page.evaluate((k) => {
      localStorage.setItem(
        k,
        JSON.stringify({ mapView: { center: { lat: 51.5, lng: -0.1 }, zoom: 10 } }),
      );
    }, VIEW_KEY);

    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#about-modal")).toHaveCount(0);
  });
});

// ─── Info pane / Pane separation ─────────────────────────────────────────────

test.describe("Info pane / Pane separation", () => {
  test("Info is not a tab in the menu", async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator(".onrte-panel")).toBeVisible({ timeout: 5000 });

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
    await page.waitForLoadState("networkidle");

    // Desktop auto-opens the Info pane, so the first click closes it.
    await expect(page.locator(".onrte-info-panel")).toBeVisible();

    await page.locator("#attribution-button").click();
    await expect(page.locator(".onrte-info-panel")).toHaveCount(0);
    await expect(page.locator(".onrte-panel")).not.toHaveClass(/show/);

    await page.locator("#attribution-button").click();
    await expect(page.locator(".onrte-info-panel")).toBeVisible();
  });

  test("visiting Info keeps the active menu tab", async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator(".onrte-panel")).toBeVisible({ timeout: 5000 });

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
    await expect(page.locator(".onrte-info-panel")).toBeVisible();
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
    await page.waitForLoadState("networkidle");

    // Desktop auto-opens the Info pane, so no chip click is needed.
    const panel = page.locator(".onrte-info-panel");
    await expect(panel).toBeVisible();

    const about = panel.locator(".onrte-about-section");
    await expect(about).toContainText("On Route");
    await expect(about).toContainText("OpenStreetMap");
    await expect(about).toContainText("MapLibre GL JS");
    await expect(about).toContainText("OpenFreeMap");
    await expect(about).toContainText("Vue JS");
    await expect(about).toContainText("Bootstrap");

    const privacy = panel.locator(".onrte-privacy-section");
    await expect(privacy).toContainText("local storage");
    await expect(privacy).toContainText("OpenFreeMap");
    await expect(privacy).toContainText("Locate");
    await expect(privacy).toContainText("no analytics");

    await expect(panel.locator(".onrte-attribution-section")).toContainText(
      /OpenStreetMap/,
    );
  });

  test("Attribution chip opens the Info panel", async ({ page }) => {
    await withViewStorage(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Close the auto-opened Info pane, then reopen it via the chip.
    await expect(page.locator(".onrte-info-panel")).toBeVisible();

    await page.locator("#attribution-button").click();
    await expect(page.locator(".onrte-info-panel")).toHaveCount(0);

    await page.locator("#attribution-button").click();
    await expect(page.locator(".onrte-info-panel")).toBeVisible();
  });
});

