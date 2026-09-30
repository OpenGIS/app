import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

let injectReturn = "test-instance";

vi.mock("vue", () => ({
	ref: (v) => ({ value: v }),
	computed: (fn) => ({ get value() { return fn(); } }),
	inject: () => injectReturn,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reset the module-level instance cache between tests. */
async function freshUseUI(opts = {}) {
	const { width = 1280, storageKey } = opts;

	// Set window.innerWidth
	Object.defineProperty(window, "innerWidth", {
		value: width,
		writable: true,
		configurable: true,
	});

	// Optionally seed localStorage for isFirstLoad check
	const key = `onrte_view_${injectReturn}`;
	if (storageKey === false) {
		localStorage.removeItem(key);
	} else {
		localStorage.setItem(key, JSON.stringify({ mapView: { center: { lat: 0, lng: 0 }, zoom: 1 } }));
	}

	// Re-import to get a fresh module (cache cleared)
	vi.resetModules();
	const { useUI } = await import("../../src/composables/useUI.js");
	return useUI();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
	injectReturn = "test-instance";
	localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useUI / Responsive breakpoints", () => {
	it("isDesktop is true when width >= 992", async () => {
		const ui = await freshUseUI({ width: 992 });
		expect(ui.isDesktop.value).toBe(true);
		expect(ui.isTablet.value).toBe(false);
		expect(ui.isMobile.value).toBe(false);
	});

	it("isTablet is true when 768 <= width < 992", async () => {
		const ui = await freshUseUI({ width: 800 });
		expect(ui.isDesktop.value).toBe(false);
		expect(ui.isTablet.value).toBe(true);
		expect(ui.isMobile.value).toBe(false);
	});

	it("isMobile is true when width < 768", async () => {
		const ui = await freshUseUI({ width: 500 });
		expect(ui.isDesktop.value).toBe(false);
		expect(ui.isTablet.value).toBe(false);
		expect(ui.isMobile.value).toBe(true);
	});
});

describe("useUI / Panel", () => {
	it("openPanel sets isPanelVisible and isPanelExpanded to true", async () => {
		const ui = await freshUseUI();
		expect(ui.isPanelVisible.value).toBe(false);

		ui.openPanel();

		expect(ui.isPanelVisible.value).toBe(true);
		expect(ui.isPanelExpanded.value).toBe(true);
	});

	it("closePanel sets isPanelVisible to false", async () => {
		const ui = await freshUseUI();
		ui.openPanel();
		expect(ui.isPanelVisible.value).toBe(true);

		ui.closePanel();
		expect(ui.isPanelVisible.value).toBe(false);
	});

	it("togglePanel opens when panel is closed", async () => {
		const ui = await freshUseUI();
		expect(ui.isPanelVisible.value).toBe(false);

		ui.togglePanel();

		expect(ui.isPanelVisible.value).toBe(true);
	});

	it("togglePanel closes when panel is already open on desktop", async () => {
		const ui = await freshUseUI({ width: 1280 });
		ui.openPanel();
		expect(ui.isPanelVisible.value).toBe(true);

		ui.togglePanel();

		expect(ui.isPanelVisible.value).toBe(false);
	});

	it("togglePanelExpanded toggles the expanded state", async () => {
		const ui = await freshUseUI();
		ui.openPanel();
		expect(ui.isPanelExpanded.value).toBe(true);

		ui.togglePanelExpanded();
		expect(ui.isPanelExpanded.value).toBe(false);

		ui.togglePanelExpanded();
		expect(ui.isPanelExpanded.value).toBe(true);
	});

	it("setActivePanel updates the activePanel id", async () => {
		const ui = await freshUseUI();
		expect(ui.activePanel.value).toBe("info");

		ui.setActivePanel("settings");
		expect(ui.activePanel.value).toBe("settings");
	});
});

describe("useUI / First load", () => {
	it("isFirstLoad is true when no view storage exists", async () => {
		const ui = await freshUseUI({ storageKey: false });
		expect(ui.isFirstLoad.value).toBe(true);
		expect(ui.showAboutModal.value).toBe(true);
	});

	it("isFirstLoad is false when view storage exists", async () => {
		const ui = await freshUseUI();
		expect(ui.isFirstLoad.value).toBe(false);
		expect(ui.showAboutModal.value).toBe(false);
	});

	it("closeAboutModal sets showAboutModal to false and marks first load complete", async () => {
		const ui = await freshUseUI({ storageKey: false });
		expect(ui.showAboutModal.value).toBe(true);
		expect(ui.isFirstLoad.value).toBe(true);

		ui.closeAboutModal();

		expect(ui.showAboutModal.value).toBe(false);
		expect(ui.isFirstLoad.value).toBe(false);
	});

	it("openAboutModal sets showAboutModal to true", async () => {
		const ui = await freshUseUI();
		expect(ui.showAboutModal.value).toBe(false);

		ui.openAboutModal();
		expect(ui.showAboutModal.value).toBe(true);
	});
});

describe("useUI / Instance isolation", () => {
	it("different instanceIds get independent state", async () => {
		injectReturn = "instance-a";
		const uiA = await freshUseUI({ width: 1280 });

		injectReturn = "instance-b";
		// Don't reset modules — reuse the same import to test the cache
		const { useUI } = await import("../../src/composables/useUI.js");
		Object.defineProperty(window, "innerWidth", { value: 500, writable: true, configurable: true });
		localStorage.removeItem("onrte_view_instance-b");
		const uiB = useUI();

		// A is desktop, B is mobile — independent state
		expect(uiA.isDesktop.value).toBe(true);
		expect(uiB.isDesktop.value).toBe(false);
	});
});
