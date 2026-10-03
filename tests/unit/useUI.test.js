import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

let injectReturn = "test-instance";

vi.mock("vue", () => ({
  ref: (v) => ({ value: v }),
  computed: (fn) => ({
    get value() {
      return fn();
    },
  }),
  inject: () => injectReturn,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reset the module-level instance cache between tests. */
async function freshUseUI(opts = {}) {
  const { width = 1280 } = opts;

  // Set window.innerWidth
  Object.defineProperty(window, "innerWidth", {
    value: width,
    writable: true,
    configurable: true,
  });

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
    expect(ui.activePanel.value).toBe("record");

    ui.setActivePanel("offline");
    expect(ui.activePanel.value).toBe("offline");
  });
});

describe("useUI / Pane separation", () => {
  it("toggleInfo opens the info pane without changing the menu tab", async () => {
    const ui = await freshUseUI();
    ui.setActivePanel("record");

    ui.toggleInfo();

    expect(ui.visiblePane.value).toBe("info");
    expect(ui.isInfoVisible.value).toBe(true);
    expect(ui.isMenuVisible.value).toBe(false);
    expect(ui.isPanelVisible.value).toBe(true);
    expect(ui.activePanel.value).toBe("record");
  });

  it("toggleInfo closes the info pane on the second call", async () => {
    const ui = await freshUseUI();

    ui.toggleInfo();
    expect(ui.isInfoVisible.value).toBe(true);

    ui.toggleInfo();
    expect(ui.visiblePane.value).toBe(null);
    expect(ui.isPanelVisible.value).toBe(false);
  });

  it("togglePanel opens the menu pane and leaves info hidden", async () => {
    const ui = await freshUseUI();

    ui.togglePanel();

    expect(ui.visiblePane.value).toBe("menu");
    expect(ui.isMenuVisible.value).toBe(true);
    expect(ui.isInfoVisible.value).toBe(false);
  });

  it("togglePanel closes the menu pane when it is already showing", async () => {
    const ui = await freshUseUI();
    ui.togglePanel();

    ui.togglePanel();

    expect(ui.visiblePane.value).toBe(null);
    expect(ui.isPanelVisible.value).toBe(false);
  });

  it("togglePanel switches from the info pane to the menu pane", async () => {
    const ui = await freshUseUI();
    ui.toggleInfo();

    ui.togglePanel();

    expect(ui.visiblePane.value).toBe("menu");
    expect(ui.isInfoVisible.value).toBe(false);
  });

  it("toggleInfo switches from the menu pane to the info pane", async () => {
    const ui = await freshUseUI();
    ui.togglePanel();

    ui.toggleInfo();

    expect(ui.visiblePane.value).toBe("info");
    expect(ui.isMenuVisible.value).toBe(false);
  });

  it("openPanel opens the menu pane without touching info state", async () => {
    const ui = await freshUseUI();

    ui.openPanel();

    expect(ui.isMenuVisible.value).toBe(true);
    expect(ui.isInfoVisible.value).toBe(false);
    expect(ui.activePanel.value).toBe("record");
  });

  it("openInfo opens the info pane without changing the menu tab", async () => {
    const ui = await freshUseUI();
    ui.setActivePanel("offline");

    ui.openInfo();

    expect(ui.isInfoVisible.value).toBe(true);
    expect(ui.activePanel.value).toBe("offline");
  });

  it("closePanel closes whichever pane is visible", async () => {
    const ui = await freshUseUI();
    ui.toggleInfo();

    ui.closePanel();

    expect(ui.visiblePane.value).toBe(null);
    expect(ui.isPanelVisible.value).toBe(false);
  });

  it("keeps the menu tab when visiting info and back to the menu", async () => {
    const ui = await freshUseUI();
    ui.openPanel();
    ui.setActivePanel("routes");

    ui.toggleInfo();
    ui.togglePanel();

    expect(ui.isMenuVisible.value).toBe(true);
    expect(ui.activePanel.value).toBe("routes");
  });
});

describe("useUI / Instance isolation", () => {
  it("different instanceIds get independent state", async () => {
    injectReturn = "instance-a";
    const uiA = await freshUseUI({ width: 1280 });

    injectReturn = "instance-b";
    // Don't reset modules — reuse the same import to test the cache
    const { useUI } = await import("../../src/composables/useUI.js");
    Object.defineProperty(window, "innerWidth", {
      value: 500,
      writable: true,
      configurable: true,
    });
    const uiB = useUI();

    // A is desktop, B is mobile — independent state
    expect(uiA.isDesktop.value).toBe(true);
    expect(uiB.isDesktop.value).toBe(false);
  });
});
