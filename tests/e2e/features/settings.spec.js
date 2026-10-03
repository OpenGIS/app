import { test, expect } from "../helpers/test.js";

/** Returns the app theme root — <html>, which carries data-bs-theme. */
function themeRoot(page) {
  // The theme attribute lives on <html> (applied by useSettings) so that
  // teleported modals, which render outside .ogis-root, inherit it too.
  return page.locator("html");
}

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

    test("data-bs-theme is dark when the OS prefers dark", async ({ page }) => {
      await page.goto("/");
      await page.waitForSelector(".ogis-map canvas");

      await expect(themeRoot(page)).toHaveAttribute("data-bs-theme", "dark");
    });
  });

  test.describe("OS prefers light", () => {
    test.use({ colorScheme: "light" });

    test("data-bs-theme is light when the OS prefers light", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForSelector(".ogis-map canvas");

      await expect(themeRoot(page)).toHaveAttribute("data-bs-theme", "light");
    });
  });

  test("data-bs-theme follows a runtime OS theme change", async ({ page }) => {
    // Start in light, then simulate the OS switching to dark while the app is open.
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.waitForSelector(".ogis-map canvas");

    const root = themeRoot(page);
    await expect(root).toHaveAttribute("data-bs-theme", "light");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(root).toHaveAttribute("data-bs-theme", "dark");

    // ...and back to light again.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(root).toHaveAttribute("data-bs-theme", "light");
  });

  test.describe("OS prefers dark — teleported modal", () => {
    test.use({ colorScheme: "dark" });

    test("a teleported modal inherits the dark theme from <html>", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForSelector(".ogis-map canvas");

      // No stored locate permission, so clicking Locate opens the teleported
      // confirmation modal (rendered on <body>, outside .ogis-root).
      await page.locator("#locate-button").click();
      await page.waitForSelector("#locate-confirm-title");

      await expect(themeRoot(page)).toHaveAttribute("data-bs-theme", "dark");

      const { modalBg, appBg } = await page.evaluate(() => {
        const content = document
          .querySelector("#locate-confirm-title")
          .closest(".modal-content");
        const root = document.querySelector(".ogis-root");

        // Resolve the dark body background from inside the app root. The root
        // is themed in both builds, so it is a reliable dark reference even if
        // <html> were left un-themed.
        const probe = document.createElement("div");
        probe.style.backgroundColor = "var(--bs-body-bg)";
        root.appendChild(probe);
        const appBg = getComputedStyle(probe).backgroundColor;
        probe.remove();

        return { modalBg: getComputedStyle(content).backgroundColor, appBg };
      });

      // A modal teleported to <body> renders outside .ogis-root, so it only
      // matches the app's dark background when data-bs-theme is on <html>.
      expect(modalBg).toBe(appBg);
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
