import { test, expect } from "./helpers/test.js";
import { waitForMapReady, openMenuPanel } from "./helpers/panel";
import { COUNTRY_BOUNDS } from "../../src/utils/countries.js";
import { DEMO } from "../fixtures/demo.mjs";

/**
 * Core app tests: returning-visit view persistence, the Info pane toggled via
 * the attribution chip, and first-load country focus.
 */

// Chip-click interactions (Info / attribution chips) settle slowly under
// SwiftShader/load — stability checks can take tens of seconds. The default
// 30 s test budget intermittently fails these tests on slower machines — raise
// the file budget; assertions are unchanged.
test.setTimeout(120000);

const withViewStorage = (page) =>
  page.addInitScript((center) => {
    localStorage.setItem(
      "ogis_view_app",
      JSON.stringify({
        mapView: { center, zoom: 10 },
      }),
    );
  }, DEMO.center);

// ─── Returning visits / View persistence ─────────────────────────────────────

test.describe("Returning visits", () => {
  test("view storage is applied on a returning visit and survives a reload", async ({
    page,
  }) => {
    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);

    await expect(page).toHaveURL(/#map=10\//);

    await page.reload();
    await waitForMapReady(page);

    await expect(page).toHaveURL(/#map=10\//);
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
    await expect(page).toHaveURL(/#map=10\//);

    // Desktop auto-opens the Info pane, so no chip click is needed.
    const panel = page.locator(".ogis-info-panel");
    await expect(panel).toBeVisible();

    // The readonly textarea holds the canonical share URL.
    const shareTextarea = panel.locator(".ogis-share-textarea");
    await expect(shareTextarea).toBeVisible();
    await expect(shareTextarea).toHaveValue(page.url());

    // Share is an anchor to the canonical share URL and the panel's only
    // primary-toned action.
    const share = panel.getByRole("link", { name: "Share" });
    await expect(share).toBeVisible();
    await expect(share).toHaveAttribute("href", page.url());
    await expect(share).toHaveClass(/btn-outline-primary/);

    // Improve opens the OSM note editor at the rounded view.
    const improve = panel.getByRole("link", { name: "Improve" });
    await expect(improve).toBeVisible();
    await expect(improve).toHaveAttribute("target", "_blank");
    await expect(improve).not.toHaveAttribute("href", "#");
    const improveHref = await improve.getAttribute("href");
    expect(
      improveHref.startsWith("https://www.openstreetmap.org/note/new#map="),
    ).toBe(true);
    expect(improveHref.endsWith("&layers=DN")).toBe(true);

    // Random re-enters the app through the same-tab ?country=random easter egg,
    // but in-app: the click fits a random country directly, with no navigation
    // (a full reload would wipe the sentinel below).
    const random = panel.getByRole("link", { name: "Random" });
    await expect(random).toBeVisible();
    await expect(random).toHaveAttribute("href", /country=random/);
    await expect(random).not.toHaveAttribute("target", "_blank");

    const beforeRandom = readHashView(page.url());
    await page.evaluate(() => {
      window.__ogisRandomNoReload = true;
    });
    await random.click();

    // A navigation would clear the sentinel; it must survive the click.
    expect(await page.evaluate(() => window.__ogisRandomNoReload)).toBe(true);

    // The in-app fit moved the camera: the hash is rewritten and no longer the
    // pre-click stored view (zoom 10 at the demo centre).
    await expect
      .poll(() => readHashView(page.url()), {
        timeout: 30000,
        message: "the Random click did not move the camera in-app",
      })
      .not.toEqual(beforeRandom);

    // The superseded copy/view/edit actions must not render any more.
    await expect(panel.getByText("Copy this Link")).toHaveCount(0);
    await expect(panel.getByText("View on OSM")).toHaveCount(0);
    await expect(panel.getByText("Edit on OSM")).toHaveCount(0);

    const about = panel.locator(".ogis-about-section");
    await expect(about).toContainText("Free, private");
    await expect(about).toContainText("Open-Source");
    await expect(
      about.locator('a[href="https://github.com/OpenGIS/app/"]'),
    ).toHaveAttribute("target", "_blank");

    const aboutLogo = about.locator('img[alt="OpenGIS"]');
    await expect(aboutLogo).toBeVisible();
    await expect(aboutLogo).toHaveAttribute("src", /\/icon-192\.png$/);

    const privacy = panel.locator(".ogis-privacy-section");
    await expect(privacy).toContainText("local storage");
    await expect(privacy).toContainText("OpenFreeMap");
    await expect(privacy).toContainText("Locate");
    await expect(privacy).toContainText("no analytics");

    await expect(panel.locator(".ogis-attribution-section")).toContainText(
      /OpenStreetMap/,
    );
  });

  test("Share click copies the URL when Web Share is unavailable", async ({
    page,
    context,
  }) => {
    // Force the clipboard fallback deterministically: no Web Share API, and
    // clipboard permissions granted so the write resolves.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        value: undefined,
        configurable: true,
      });
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
    await expect(page).toHaveURL(/#map=10\//);

    const panel = page.locator(".ogis-info-panel");
    // While copied, the label swaps to "Copied!" (and the icon to a check), so
    // a name-based locator would stop matching mid-test. `w-100` is unique to
    // the Share anchor among the panel's button-styled links.
    const share = panel.locator("a.btn.w-100");
    await expect(share).toBeVisible();
    await expect(share).toContainText("Share");

    const href = await share.getAttribute("href");
    const urlBefore = page.url();

    // A window marker detects a real navigation (e.g. a same-URL reload);
    // it stays in place when the click default is prevented.
    await page.evaluate(() => {
      window.__ogisE2eNoReload = true;
    });

    await share.click();

    // The label flips to "Copied!" for the 2 s copied state.
    await expect(share).toContainText("Copied!");

    // The handler prevented navigation, and the clipboard holds the share URL.
    expect(page.url()).toBe(urlBefore);
    expect(await page.evaluate(() => window.__ogisE2eNoReload)).toBe(true);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(href);
  });

  test("Share click uses the Web Share API when available", async ({
    page,
  }) => {
    // Stub the Web Share API so the primary path is observable without a real
    // OS share sheet.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        value: (data) => {
          window.__ogisShared = data;
          return Promise.resolve();
        },
        configurable: true,
      });
    });

    await withViewStorage(page);
    await page.goto("/");
    await waitForMapReady(page);
    await expect(page).toHaveURL(/#map=10\//);

    const share = page.locator(".ogis-info-panel a.btn.w-100");
    const href = await share.getAttribute("href");

    await share.click();

    // The share payload carries the canonical URL...
    await expect
      .poll(() => page.evaluate(() => window.__ogisShared?.url ?? null))
      .toBe(href);
    // ...and no clipboard fallback runs, so the label stays "Share".
    await expect(share).toContainText("Share");
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

    // Bottom-left Attribution chip in `.ogis-corner--bl`:
    // corner padding-bottom = 12px + 34px = 46px.
    const attributionBox = await page
      .locator("#attribution-button")
      .boundingBox();
    const bottomGap = 844 - (attributionBox.y + attributionBox.height);
    expect(bottomGap).toBeGreaterThanOrEqual(45);

    // No feature registers a bottom-right button, so the cluster is not
    // rendered — an empty cluster would keep `pointer-events: auto` and
    // intercept map clicks.
    await expect(page.locator(".ogis-corner--br")).toHaveCount(0);

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

// ─── First load / Country focus ───────────────────────────────────────────────
//
// On a true cold start (no URL hash, no stored view) the map resolves a country
// by cascade: IANA timezone → raw browser locale → random. An explicit
// `?country=XX` forces that country (outranking hash and stored view), and
// `?country=random` forces a fresh random fit on every load. The fit is instant
// (`duration: 0`) and, being a programmatic move, is persisted to the URL hash
// (`#map=zoom/lat/lng/...`) and localStorage by the existing `moveend` handler.

// E2E web-server base URL. Overridable via E2E_PORT; defaults to 5184 to match
// the Playwright webServer config and CI.
const BASE_URL = `http://localhost:${process.env.E2E_PORT ?? 5184}`;

// Bounds from COUNTRY_BOUNDS.GB (lat 49.96–58.64, lng -7.57–1.68).
const GB = { minLat: 49.96, maxLat: 58.64, minLng: -7.57, maxLng: 1.68 };

// Parse the `#map={zoom}/{lat}/{lng}/...` hash into a plain view object.
const readHashView = (url) => {
  const match = new URL(url).hash.match(
    /^#map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/,
  );
  if (!match) return null;
  return {
    zoom: parseFloat(match[1]),
    lat: parseFloat(match[2]),
    lng: parseFloat(match[3]),
  };
};

// Wait for the app to persist a camera view to the URL hash, then return it.
const waitForFittedView = async (page, timeout = 30000) => {
  await expect
    .poll(() => readHashView(page.url()), {
      timeout,
      message: "no #map= view was written to the URL",
    })
    .not.toBeNull();
  return readHashView(page.url());
};

// Remove any stored view so the next load is a genuine cold start. The clear
// runs once per tab, so a later load within the same test can genuinely restore
// what the first load persisted.
const withFreshView = (page) =>
  page.addInitScript(() => {
    if (sessionStorage.getItem("ogis-e2e-fresh") !== "1") {
      localStorage.removeItem("ogis_view_app");
      sessionStorage.setItem("ogis-e2e-fresh", "1");
    }
  });

// True when [lat, lng] lies inside a [west, south, east, north] bbox
// (antimeridian-safe: west > east means the bbox wraps the 180th meridian).
const insideBounds = (lat, lng, [west, south, east, north]) => {
  if (lat < south || lat > north) return false;
  if (west <= east) return lng >= west && lng <= east;
  return lng >= west || lng <= east;
};

// True when [lat, lng] lies inside at least one country bbox.
const insideAnyCountry = (lat, lng) =>
  Object.values(COUNTRY_BOUNDS).some((bounds) =>
    insideBounds(lat, lng, bounds),
  );

// Load the app cold in a supplied context and return its fitted view.
const coldStartView = async (context) => {
  const page = await context.newPage();
  await withFreshView(page);
  await page.goto("/");
  await waitForMapReady(page);
  return waitForFittedView(page);
};

test.describe("First load / Country focus", () => {
  // Timezone resolution sits above locale in the cascade, so pinning the
  // timezone makes the fitted country deterministic on any host machine.
  test.describe("timezone region — Europe/London", () => {
    test.use({ timezoneId: "Europe/London" });

    test("cold start fits the timezone country and no welcome modal exists", async ({
      page,
    }) => {
      await withFreshView(page);
      await page.goto("/");
      await waitForMapReady(page);

      // The map settles before the hash is trusted (tiles finish loading).
      await expect(page.locator(".ogis-map")).toHaveAttribute(
        "data-map-idle",
        "true",
        { timeout: 30000 },
      );

      const view = await waitForFittedView(page);
      expect(view.zoom).toBeGreaterThan(1);
      expect(view.lat).toBeGreaterThanOrEqual(GB.minLat);
      expect(view.lat).toBeLessThanOrEqual(GB.maxLat);
      expect(view.lng).toBeGreaterThanOrEqual(GB.minLng);
      expect(view.lng).toBeLessThanOrEqual(GB.maxLng);

      // The welcome/about modal was removed — it must not exist anywhere.
      await expect(page.locator("#about-modal")).toHaveCount(0);
    });

    test("a smaller viewport fits the country at a lower zoom", async ({
      browser,
    }) => {
      const phone = await browser.newContext({
        baseURL: BASE_URL,
        timezoneId: "Europe/London",
        viewport: { width: 390, height: 844 },
      });
      const desktop = await browser.newContext({
        baseURL: BASE_URL,
        timezoneId: "Europe/London",
        viewport: { width: 1280, height: 720 },
      });

      try {
        const phoneView = await coldStartView(phone);
        const desktopView = await coldStartView(desktop);
        // Padding scales with the smaller axis, so the narrower device zooms out.
        expect(desktopView.zoom).toBeGreaterThan(phoneView.zoom);
      } finally {
        await phone.close();
        await desktop.close();
      }
    });

    test("cold start persists the fitted view and a returning visit honours storage", async ({
      page,
    }) => {
      await withFreshView(page);
      await page.goto("/");
      await waitForMapReady(page);

      const fitted = await waitForFittedView(page);
      expect(fitted.lat).toBeGreaterThanOrEqual(GB.minLat);
      expect(fitted.lat).toBeLessThanOrEqual(GB.maxLat);

      // The programmatic fit is persisted so a later visit can restore it.
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("ogis_view_app")))
        .not.toBeNull();

      // Return with no hash: the stored fitted view wins over a fresh fit.
      await page.goto("/");
      await waitForMapReady(page);

      const restored = await waitForFittedView(page);
      expect(restored.lat).toBeGreaterThanOrEqual(GB.minLat);
      expect(restored.lat).toBeLessThanOrEqual(GB.maxLat);
      expect(restored.lng).toBeGreaterThanOrEqual(GB.minLng);
      expect(restored.lng).toBeLessThanOrEqual(GB.maxLng);
    });

    test("a URL hash takes precedence over country focus", async ({ page }) => {
      await withFreshView(page);
      await page.goto("/#map=10/48.8566/2.3522");
      await waitForMapReady(page);

      const view = await waitForFittedView(page);
      expect(view.zoom).toBe(10);
      expect(view.lat).toBeCloseTo(48.8566, 3);
      expect(view.lng).toBeCloseTo(2.3522, 3);
    });

    test("a stored view takes precedence over country focus", async ({
      page,
    }) => {
      await withViewStorage(page);
      await page.goto("/");
      await waitForMapReady(page);

      const view = await waitForFittedView(page);
      expect(view.zoom).toBe(10);
      expect(view.lat).toBeCloseTo(DEMO.center.lat, 3);
      expect(view.lng).toBeCloseTo(DEMO.center.lng, 3);
    });
  });

  test.describe("cascade exhaustion — no timezone or locale region", () => {
    // UTC resolves to no country, so the cascade falls through to the locale.
    test.use({ timezoneId: "UTC" });

    test("cold start falls back to a random country focus", async ({
      page,
    }) => {
      // "zxx" maximizes to no region, so both cascade hints are exhausted and
      // the app falls back to a random-country focus.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "languages", {
          get: () => ["zxx"],
        });
        Object.defineProperty(navigator, "language", {
          get: () => "zxx",
        });
      });
      await withFreshView(page);
      await page.goto("/");
      await waitForMapReady(page);

      const view = await waitForFittedView(page);
      expect(view.zoom).toBeGreaterThan(1);

      if (!insideAnyCountry(view.lat, view.lng)) {
        // Antimeridian-spanning bbox or globe-fit rounding: still a focused
        // view, not the [0, 0] world default.
        expect(view.lat === 0 && view.lng === 0).toBe(false);
      }
    });
  });

  test.describe("?country override", () => {
    test("?country=ch outranks a conflicting URL hash", async ({ page }) => {
      await withFreshView(page);
      // A demo-area hash that would otherwise win is ignored in favour of CH.
      await page.goto(
        `/?country=ch#map=10/${DEMO.center.lat}/${DEMO.center.lng}`,
      );
      await waitForMapReady(page);

      // The URL already carries a hash, so wait for the forced fit to settle
      // and overwrite it before reading the persisted view.
      await expect(page.locator(".ogis-map")).toHaveAttribute(
        "data-map-idle",
        "true",
        { timeout: 30000 },
      );
      const view = readHashView(page.url());
      expect(view).not.toBeNull();
      expect(insideBounds(view.lat, view.lng, COUNTRY_BOUNDS.CH)).toBe(true);
    });

    test("?country=ch outranks a stored view", async ({ page }) => {
      await withViewStorage(page);
      await page.goto("/?country=ch");
      await waitForMapReady(page);

      const view = await waitForFittedView(page);
      expect(insideBounds(view.lat, view.lng, COUNTRY_BOUNDS.CH)).toBe(true);
    });

    test("?country=random fits a random country and re-rolls on reload", async ({
      page,
    }) => {
      await withFreshView(page);
      await page.goto("/?country=random");
      await waitForMapReady(page);

      const first = await waitForFittedView(page);
      expect(first.zoom).toBeGreaterThan(1);
      if (!insideAnyCountry(first.lat, first.lng)) {
        expect(first.lat === 0 && first.lng === 0).toBe(false);
      }

      // The query is preserved by replaceState, so a reload forces a fresh
      // random fit (which may, by chance, repeat the previous country — the
      // two views are deliberately not compared).
      await page.reload();
      await waitForMapReady(page);
      expect(page.url()).toContain("country=random");

      await expect(page.locator(".ogis-map")).toHaveAttribute(
        "data-map-idle",
        "true",
        { timeout: 30000 },
      );
      const second = readHashView(page.url());
      expect(second).not.toBeNull();
      expect(second.zoom).toBeGreaterThan(1);
    });
  });
});
