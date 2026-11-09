import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { expectDefaultTheme } from "../helpers/theme.js";

// Assert a clean console for every test in this spec (see helpers/console.js).
test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

/** Simulates the browser/OS changing its preferred language at runtime. */
async function setBrowserLanguages(page, languages) {
  await page.evaluate((langs) => {
    Object.defineProperty(navigator, "languages", {
      value: langs,
      configurable: true,
    });
    Object.defineProperty(navigator, "language", {
      value: langs[0] ?? "en",
      configurable: true,
    });
    window.dispatchEvent(new Event("languagechange"));
  }, languages);
}

test.describe("Appearance", () => {
  test.describe("OS prefers dark", () => {
    test.use({ colorScheme: "dark" });

    test("the default theme renders when the OS prefers dark", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForSelector(".ogis-map canvas");

      await expectDefaultTheme(page);
    });
  });

  test.describe("OS prefers light", () => {
    test.use({ colorScheme: "light" });

    test("the default theme renders when the OS prefers light", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForSelector(".ogis-map canvas");

      await expectDefaultTheme(page);
    });
  });

  test("the default theme survives a runtime OS preference flip", async ({
    page,
  }) => {
    // Start in light, then simulate the OS switching to dark while the app is
    // open. The app no longer follows the preference, so nothing should change.
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");

    await expectDefaultTheme(page);

    await page.emulateMedia({ colorScheme: "dark" });
    await expectDefaultTheme(page);

    // ...and back to light again.
    await page.emulateMedia({ colorScheme: "light" });
    await expectDefaultTheme(page);
  });

  test.describe("OS prefers light — teleported modal", () => {
    test.use({ colorScheme: "light" });

    test("a teleported modal inherits the default theme from <html>", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForSelector(".ogis-map canvas");

      // No stored locate permission, so clicking Locate opens the teleported
      // confirmation modal (rendered on <body>, outside .ogis-root).
      await page.locator("#locate-button").click();
      await page.waitForSelector("#locate-confirm-title");

      await expectDefaultTheme(page, { modal: true });
    });
  });
});

test.describe("Units", () => {
  test.describe("OS region — metric (en-GB)", () => {
    test.use({ locale: "en-GB" });

    test("scale bar shows metric units by default for metric-system locale", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForSelector(".maplibregl-ctrl-scale");

      const scale = page.locator(".maplibregl-ctrl-scale");
      await expect(scale).toBeVisible();
      await expect(scale).toContainText("km");
    });
  });

  test.describe("OS region — imperial (en-US)", () => {
    test.use({ locale: "en-US" });

    test("scale bar shows imperial units by default for imperial-system locale", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForSelector(".maplibregl-ctrl-scale");

      const scale = page.locator(".maplibregl-ctrl-scale");
      await expect(scale).toBeVisible();
      await expect(scale).toContainText("mi");
    });
  });

  test.describe("runtime language change (en-US → fr-FR)", () => {
    test.use({ locale: "en-US" });

    test("units update without reload when the browser language changes", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForSelector(".ogis-map canvas");
      await page.waitForSelector(".maplibregl-ctrl-scale");

      await expect(page.locator(".maplibregl-ctrl-scale")).toContainText("mi");

      await setBrowserLanguages(page, ["fr-FR"]);

      await expect(page.locator(".maplibregl-ctrl-scale")).toContainText("km");
    });
  });
});

test.describe("Language", () => {
  test.describe("browser language — French (fr-FR)", () => {
    test.use({ locale: "fr-FR" });

    test("locale-sensitive UI strings are French for a French browser locale", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForSelector(".ogis-map canvas");

      await expect(page.locator("#locate-button")).toContainText("Localiser");
    });
  });

  test.describe("runtime language change (en-US → fr-FR)", () => {
    test.use({ locale: "en-US" });

    test("UI updates without reload when the browser language changes", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForSelector(".ogis-map canvas");

      const locate = page.locator("#locate-button");
      await expect(locate).toContainText("Locate");

      await setBrowserLanguages(page, ["fr-FR"]);

      await expect(locate).toContainText("Localiser");
    });
  });
});

test.describe("Settings panel removed", () => {
  test("no Settings tab or panel exists", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");

    await expect(page.locator("#settings-button")).toHaveCount(0);

    // Desktop auto-opens the Info pane; open the menu so the tab strip renders.
    if (!(await page.locator(".panel-nav").isVisible())) {
      await page.locator("#menu-button").click();
      await page.locator(".panel-nav").waitFor();
    }

    await expect(
      page.locator(".panel-nav").getByRole("button", { name: /^settings$/i }),
    ).toHaveCount(0);
  });
});

test.describe("Persistence", () => {
  test("no settings storage key is written", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");

    const stored = await page.evaluate(() =>
      localStorage.getItem("ogis_settings_app"),
    );
    expect(stored).toBeNull();
  });
});
