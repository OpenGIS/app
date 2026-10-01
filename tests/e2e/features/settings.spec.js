import { test, expect } from "@playwright/test";

// Seed view storage so the About modal does not appear on fresh contexts
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		if (!localStorage.getItem("onrte_view_app")) {
			localStorage.setItem(
				"onrte_view_app",
				JSON.stringify({ mapView: { center: { lat: 51.5, lng: -0.1 }, zoom: 10 } }),
			);
		}
	});
});

/** Returns the app theme root (the wrapper with data-bs-theme). */
function themeRoot(page) {
	// Theme binding lives on .onrte-root only: it carries
	// :data-bs-theme="resolvedTheme" for the whole UI (panel, chips, modals).
	return page.locator(".onrte-root");
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
			await page.waitForSelector(".onrte-map canvas");

			await expect(themeRoot(page)).toHaveAttribute("data-bs-theme", "dark");
		});
	});

	test.describe("OS prefers light", () => {
		test.use({ colorScheme: "light" });

		test("data-bs-theme is light when the OS prefers light", async ({ page }) => {
			await page.goto("/");
			await page.waitForSelector(".onrte-map canvas");

			await expect(themeRoot(page)).toHaveAttribute("data-bs-theme", "light");
		});
	});

	test("data-bs-theme follows a runtime OS theme change", async ({ page }) => {
		// Start in light, then simulate the OS switching to dark while the app is open.
		await page.emulateMedia({ colorScheme: "light" });
		await page.goto("/");
		await page.waitForSelector(".onrte-map canvas");

		const root = themeRoot(page);
		await expect(root).toHaveAttribute("data-bs-theme", "light");

		await page.emulateMedia({ colorScheme: "dark" });
		await expect(root).toHaveAttribute("data-bs-theme", "dark");

		// ...and back to light again.
		await page.emulateMedia({ colorScheme: "light" });
		await expect(root).toHaveAttribute("data-bs-theme", "light");
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
			await page.waitForSelector(".onrte-map canvas");
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
			await page.waitForSelector(".onrte-map canvas");

			await expect(page.locator("#locate-button")).toContainText("Localiser");
		});
	});

	test.describe("runtime language change (en-US → fr-FR)", () => {
		test.use({ locale: "en-US" });

		test("UI updates without reload when the browser language changes", async ({
			page,
		}) => {
			await page.goto("/");
			await page.waitForSelector(".onrte-map canvas");

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
		await page.waitForSelector(".onrte-map canvas");

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
		await page.waitForSelector(".onrte-map canvas");

		const stored = await page.evaluate(() =>
			localStorage.getItem("onrte_settings_app"),
		);
		expect(stored).toBeNull();
	});
});
