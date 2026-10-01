import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * UI-states evidence spec — `.opencode/tmp/ui-states/*.png`
 *
 * Captures every key UI state as a PNG, asserts the UI along the way, and
 * asserts zero console/page errors for each state.
 *
 * Dark is the default scheme (project-wide `colorScheme: "dark"`); every state
 * is captured in dark, and a dedicated test verifies light mode (which the app
 * derives from the OS/browser `prefers-color-scheme` setting).
 *
 * NOTE: these PNGs are EVIDENCE ARTEFACTS, not pixel-diff baselines. Live map
 * tiles make pixel comparisons brittle, so this spec deliberately snapshots
 * rather than compares (an explicit project decision). It runs as part of the
 * manual e2e suite — not CI.
 */

// SwiftShader software rendering starves the renderer: the map-idle wait, a
// multi-step drag and the screenshot can each take tens of seconds. The
// default 30 s test budget intermittently fails the closed/drag states on
// slower machines — match the offline.spec.js budget for slow map work.
test.setTimeout(120000);

const OUT_DIR = ".opencode/tmp/ui-states";

// 3-segment hash is accepted and rewritten to 5 on load. z16 keeps the
// Esri/Mapterhorn raster sources on real imagery (z18 shows placeholder tiles).
const BASE_HASH = "#map=16/50.653900/-128.009400";

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

/**
 * Dismiss the welcome modal if it is present (first-load state).
 *
 * Bounded wait rather than an immediate isVisible() check: the modal is
 * mounted by Vue shortly after the load event, so an instant check can race
 * the render and leave the overlay blocking later clicks.
 */
const dismissAboutModal = async (page) => {
  const modal = page.locator("#about-modal");
  const appeared = await modal
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await page.locator("#about-modal-close").click();
    await modal.waitFor({ state: "hidden" });
  }
};

/** Wait for MapLibre to finish rendering tiles (generous under SwiftShader). */
const waitForMapIdle = (page) =>
  expect(page.locator(".onrte-map")).toHaveAttribute("data-map-idle", "true", {
    timeout: 30000,
  });

/** Seed permission + view storage so the welcome modal does not appear. */
const withGrantedStorage = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      "onrte_locate_app",
      JSON.stringify({ permissionGranted: true }),
    );
    localStorage.setItem(
      "onrte_view_app",
      JSON.stringify({
        mapView: { center: { lat: 50.6539, lng: -128.0094 }, zoom: 14 },
      }),
    );
  });

/** Grant geolocation permission and set a fixed position. */
const grantGeolocation = (page) =>
  page
    .context()
    .grantPermissions(["geolocation"])
    .then(() =>
      page.context().setGeolocation({
        latitude: 50.6539,
        longitude: -128.0094,
      }),
    );

/** Mouse-drag the map canvas horizontally to collapse the attribution chip. */
const dragMap = async (page, dx = 200) => {
  const canvas = page.locator(".onrte-map canvas");
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.mouse.up();
};

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

// ─── Desktop ─────────────────────────────────────────────────────────────────

const runDesktop = () => {
  // Inherits the project-wide `colorScheme: "dark"` default — dark is the
  // screenshot baseline. Light mode is verified by the dedicated test below.
  test.describe("Desktop", () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test.beforeEach(async ({ page }) => {
      trackConsoleErrors(page);
      await page.addInitScript(() => localStorage.removeItem("onrte_view_app"));
      await page.goto(`/${BASE_HASH}`);
      await dismissAboutModal(page);
      await waitForMapIdle(page);
      // Proves the inherited dark default resolves the dark theme.
      await expect(page.locator(".onrte-root")).toHaveAttribute(
        "data-bs-theme",
        "dark",
      );
    });

    test.afterEach(async ({ page }) => {
      expectNoConsoleErrors(page);
    });

    test("menu-pane — desktop opens the menu pane on Recordings", async ({
      page,
    }) => {
      // The Info pane auto-opens on desktop; the menu button switches to the menu.
      await page.locator("#menu-button").click();
      await expect(page.locator(".onrte-panel")).toHaveClass(/show/);
      await expect(page.locator(".panel-nav")).toBeVisible();
      await expect(
        page.locator(".panel-nav").getByRole("button", { name: "Recordings" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#attribution-button")).toContainText(
        /OpenStreetMap/,
      );

      await page.screenshot({
        path: `${OUT_DIR}/desktop-dark-menu-pane.png`,
      });
    });

    test("info-pane-open — desktop load auto-opens the Info pane", async ({
      page,
    }) => {
      await expect(page.locator(".onrte-info-panel")).toBeVisible();
      // The info pane renders without the menu tab strip.
      await expect(page.locator(".panel-nav")).toHaveCount(0);
      // Let the offcanvas slide-in finish so the evidence is not mid-transition.
      await page.waitForTimeout(350);

      await page.screenshot({
        path: `${OUT_DIR}/desktop-dark-info-pane-open.png`,
      });
    });

    test("info-pane-closed — the chip hides the pane", async ({ page }) => {
      await expect(page.locator(".onrte-info-panel")).toBeVisible();

      await page.locator("#attribution-button").click();
      await expect(page.locator(".onrte-info-panel")).toHaveCount(0);
      await expect(page.locator(".onrte-panel")).not.toHaveClass(/show/);
      // Let the offcanvas slide-out finish so the evidence is not mid-transition.
      await page.waitForTimeout(350);

      await page.screenshot({
        path: `${OUT_DIR}/desktop-dark-info-pane-closed.png`,
      });
    });

    test("closed — a second menu click hides the pane", async ({ page }) => {
      // The Info pane auto-opens; open the menu, then close it.
      await page.locator("#menu-button").click();
      await page.locator("#menu-button").click();
      await expect(page.locator(".onrte-panel")).not.toHaveClass(/show/);
      // Let the offcanvas slide-out finish so the evidence is not mid-transition.
      await page.waitForTimeout(350);

      await page.screenshot({
        path: `${OUT_DIR}/desktop-dark-closed.png`,
      });
    });

    test("about-open — About disclosure reveals the full text", async ({
      page,
    }) => {
      // The Info pane auto-opens on desktop, so the About section is already shown.
      await page.locator(".onrte-about-section summary").click();

      const about = page.locator(".onrte-about-section");
      await expect(
        about.locator('a[href="https://github.com/OpenGIS/navigator"]'),
      ).toBeVisible();
      await expect(about).toContainText("OpenStreetMap");
      await expect(about).toContainText("MapLibre GL JS");

      await page.screenshot({
        path: `${OUT_DIR}/desktop-dark-about-open.png`,
      });
    });

    test("drag-collapsed — dragging the map collapses the chip", async ({
      page,
    }) => {
      await expect(
        page.locator("#attribution-button .onrte-attribution-chip__text"),
      ).toHaveCount(1);

      await dragMap(page);

      await expect(
        page.locator("#attribution-button .onrte-attribution-chip__text"),
      ).toHaveCount(0);
      await expect(page.locator("#attribution-button")).not.toContainText(
        /OpenStreetMap/,
      );

      await page.screenshot({
        path: `${OUT_DIR}/desktop-dark-drag-collapsed.png`,
      });
    });

    test("scale-collapsed — scale sits inline beside the collapsed chip", async ({
      page,
    }) => {
      await dragMap(page);
      await expect(
        page.locator("#attribution-button .onrte-attribution-chip__text"),
      ).toHaveCount(0);
      // The root attribute drives the CSS that moves the scale inline.
      await expect(page.locator(".onrte-root")).toHaveAttribute(
        "data-attrib-collapsed",
        "true",
      );
      // Let any layout settle before measuring.
      await page.waitForTimeout(150);

      const chip = await page.locator("#attribution-button").boundingBox();
      const scale = await page.locator(".maplibregl-ctrl-scale").boundingBox();

      // Same row: the vertical centres overlap within a tolerant ±8 px.
      const chipMid = chip.y + chip.height / 2;
      const scaleMid = scale.y + scale.height / 2;
      expect(Math.abs(chipMid - scaleMid)).toBeLessThanOrEqual(8);

      // Inline to the right of the chip (tolerant of the chip's border radius).
      expect(scale.x).toBeGreaterThanOrEqual(chip.x + chip.width - 8);

      await page.screenshot({
        path: `${OUT_DIR}/desktop-dark-scale-collapsed.png`,
      });
    });
  });
};

runDesktop();

// ─── Mobile ──────────────────────────────────────────────────────────────────

const runMobile = () => {
  // Inherits the project-wide dark default.
  test.describe("Mobile", () => {
    // Mirrors offline.spec.js: mobile viewport with touch support. The panel
    // does not auto-open below the desktop breakpoint.
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });

    test.beforeEach(async ({ page }) => {
      trackConsoleErrors(page);
      await page.addInitScript(() => localStorage.removeItem("onrte_view_app"));
      await page.goto(`/${BASE_HASH}`);
      await dismissAboutModal(page);
      await waitForMapIdle(page);
    });

    test.afterEach(async ({ page }) => {
      expectNoConsoleErrors(page);
    });

    test("load — four chips visible, expanded, no horizontal overflow", async ({
      page,
    }) => {
      await expect(page.locator(".onrte-panel")).not.toHaveClass(/show/);

      await expect(page.locator("#menu-button")).toBeVisible();
      await expect(page.locator("#locate-button")).toBeVisible();
      await expect(page.locator("#recordings-button")).toBeVisible();
      await expect(page.locator("#attribution-button")).toBeVisible();
      await expect(page.locator("#attribution-button")).toContainText(
        /OpenStreetMap/,
      );

      const widths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(widths.scrollWidth).toBe(widths.clientWidth);

      await page.screenshot({
        path: `${OUT_DIR}/mobile-dark-load.png`,
      });
    });

    test("panel — attribution chip opens the Info panel", async ({ page }) => {
      await page.locator("#attribution-button").click();

      await expect(page.locator(".onrte-panel")).toHaveClass(/show/);
      await expect(page.locator(".onrte-info-panel")).toBeVisible();
      // Let the offcanvas slide-in finish so the evidence is not mid-transition.
      await page.waitForTimeout(350);

      await page.screenshot({
        path: `${OUT_DIR}/mobile-dark-panel.png`,
      });
    });
  });
};

runMobile();

// ─── Optional: locate-active & record-active ─────────────────────────────────
// Mirror the mock setup from locate.spec.js / recordings.spec.js. Kept to a
// single scheme (desktop dark, the default) since both features already have
// dedicated specs covering their full state machines.

test.describe("Feature states — desktop dark", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await withGrantedStorage(page);
    await grantGeolocation(page);
    await page.goto(`/${BASE_HASH}`);
    await dismissAboutModal(page);
    await waitForMapIdle(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("locate-active — Locate chip becomes Located", async ({ page }) => {
    await page.locator("#locate-button").click();
    // Guards synchronous state (the chip label flips as soon as the locate mode
    // changes), not a map render — a seconds-scale ceiling matches the state
    // philosophy and the recordings.spec.js chip assertions.
    await expect(page.locator("#locate-button")).toContainText("Located", {
      timeout: 5000,
    });

    await page.screenshot({
      path: `${OUT_DIR}/desktop-dark-locate-active.png`,
    });
  });

  test("record-active — Record chip becomes Recording", async ({ page }) => {
    await page.locator("#recordings-button").click();
    await expect
      .poll(() => page.locator("#recordings-button").textContent(), {
        timeout: 20000,
      })
      .toMatch(/Recording/);

    await page.screenshot({
      path: `${OUT_DIR}/desktop-dark-record-active.png`,
    });
  });
});

// ─── Light mode (downstream of OS/browser setting) ───────────────────────────
// The suite defaults to dark; light is a downstream effect of the
// OS/browser `prefers-color-scheme` setting (the app has no in-app toggle).
// This test explicitly requests the light scheme and proves the theme root
// switches to light, complementing the dark assertion in the dark defaults.

test.describe("Light mode — downstream of OS/browser setting", () => {
  test.use({ viewport: { width: 1280, height: 720 }, colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    trackConsoleErrors(page);
    await page.addInitScript(() => localStorage.removeItem("onrte_view_app"));
    await page.goto(`/${BASE_HASH}`);
    await dismissAboutModal(page);
    await waitForMapIdle(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoConsoleErrors(page);
  });

  test("desktop-light-mode — light theme follows the OS/browser preference", async ({
    page,
  }) => {
    await expect(page.locator(".onrte-root")).toHaveAttribute(
      "data-bs-theme",
      "light",
    );

    await page.screenshot({
      path: `${OUT_DIR}/desktop-light-mode.png`,
    });
  });
});
