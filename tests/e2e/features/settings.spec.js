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

/** Ensures the menu panel is open, toggling it if currently closed. */
async function openMenuPanel(page) {
	const offcanvas = page.locator(".offcanvas.show");
	if (!(await offcanvas.isVisible())) {
		await page.click(".navbar-toggler");
		await offcanvas.waitFor();
	}
}

/** Opens the Settings panel from the menu. */
async function openSettings(page, name = /settings/i) {
	await openMenuPanel(page);
	await page.getByRole("button", { name }).click();
}

/** Returns the app theme root (the wrapper with data-bs-theme). */
function themeRoot(page) {
	// .onrte-root carries :data-bs-theme="resolvedTheme"; the navbar also has
	// data-bs-theme="dark" (hardcoded) — use .onrte-root to target only our root.
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

test.describe("Opening Settings", () => {
	test("settings link appears at the bottom of the menu panel", async ({
		page,
	}) => {
		await page.goto("/");
		await page.waitForSelector(".onrte-map canvas");

		await openMenuPanel(page);

		// Settings link is present at the bottom
		await expect(
			page.getByRole("button", { name: /settings/i }),
		).toBeVisible();
	});

	test("clicking settings link opens the settings panel", async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".onrte-map canvas");

		await openSettings(page);

		await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
	});
});

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
	test("units value is shown read-only in the settings panel", async ({
		page,
	}) => {
		await page.goto("/");
		await page.waitForSelector(".onrte-map canvas");

		await openSettings(page);

		await expect(page.locator("#settings-units")).toBeVisible();
		// No picker remains.
		await expect(page.locator("select#settings-units")).toHaveCount(0);
	});

	test.describe("OS region — metric (en-GB)", () => {
		test.use({ locale: "en-GB" });

		test("units value is metric for a metric-system locale", async ({ page }) => {
			await page.goto("/");
			await page.waitForSelector(".onrte-map canvas");

			await openSettings(page);

			await expect(page.locator("#settings-units")).toHaveText(
				"Metric (km, m/s)",
			);
		});

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

		test("units value is imperial for an imperial-system locale", async ({
			page,
		}) => {
			await page.goto("/");
			await page.waitForSelector(".onrte-map canvas");

			await openSettings(page);

			await expect(page.locator("#settings-units")).toHaveText(
				"Imperial (mi, mph)",
			);
		});

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

			await openSettings(page);
			await expect(page.locator("#settings-units")).toHaveText(
				"Imperial (mi, mph)",
			);

			await setBrowserLanguages(page, ["fr-FR"]);

			// UI is now French, so the units label is localised as well.
			await expect(page.locator("#settings-units")).toHaveText(
				"Métrique (km, m/s)",
			);
			await expect(page.locator(".maplibregl-ctrl-scale")).toContainText("km");
		});
	});
});

test.describe("Language", () => {
	test("language value is shown read-only in the settings panel", async ({
		page,
	}) => {
		await page.goto("/");
		await page.waitForSelector(".onrte-map canvas");

		await openSettings(page);

		await expect(page.locator("#settings-language")).toBeVisible();
		await expect(page.locator("select#settings-language")).toHaveCount(0);
	});

	test.describe("browser language — French (fr-FR)", () => {
		test.use({ locale: "fr-FR" });

		test("settings panel is in French for a French browser locale", async ({
			page,
		}) => {
			await page.goto("/");
			await page.waitForSelector(".onrte-map canvas");

			// Settings button will be in French
			await openSettings(page, /paramètres/i);

			await expect(page.locator("#settings-language")).toHaveText("français");
		});
	});

	test.describe("runtime language change (en-US → fr-FR)", () => {
		test.use({ locale: "en-US" });

		test("UI updates without reload when the browser language changes", async ({
			page,
		}) => {
			await page.goto("/");
			await page.waitForSelector(".onrte-map canvas");

			await openSettings(page);
			await expect(page.locator("#settings-language")).toHaveText("English");

			await setBrowserLanguages(page, ["fr-FR"]);

			await expect(page.getByRole("heading", { name: /paramètres/i })).toBeVisible();
			await expect(page.locator("#settings-language")).toHaveText("français");
		});
	});
});

test.describe("Persistence", () => {
	test("no settings storage key is written", async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".onrte-map canvas");

		await openSettings(page);

		const stored = await page.evaluate(() =>
			localStorage.getItem("onrte_settings_app"),
		);
		expect(stored).toBeNull();
	});
});
