import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, nextTick } from "vue";
import { matchLocale } from "@/composables/useLocale";

/**
 * Cleanups registered by `loadLocale` — each freshly imported module instance
 * registers a `languagechange` listener on `window`, so they are captured and
 * removed after each test to stop listeners accumulating across reloads.
 */
const pendingCleanups = [];

/**
 * Load a fresh copy of useLocale with a controllable navigator.
 * useLocale reads `navigator.languages` at import time and registers a
 * `languagechange` listener, so the stub must be installed (and modules reset)
 * before the dynamic import.
 */
async function loadLocale(initialLanguages = ["en-US"]) {
  vi.resetModules();

  let languages = initialLanguages;

  vi.stubGlobal("navigator", {
    get languages() {
      return languages;
    },
    get language() {
      return languages[0] ?? "en";
    },
  });

  const listeners = [];
  const originalAddEventListener = window.addEventListener;
  const addListenerSpy = vi
    .spyOn(window, "addEventListener")
    .mockImplementation((type, handler, options) => {
      if (type === "languagechange") listeners.push(handler);
      return originalAddEventListener.call(window, type, handler, options);
    });

  let mod;
  try {
    mod = await import("@/composables/useLocale");
  } finally {
    addListenerSpy.mockRestore();
  }

  pendingCleanups.push(() => {
    for (const handler of listeners) {
      window.removeEventListener("languagechange", handler);
    }
  });

  const setLanguages = (value) => {
    languages = value;
  };

  return { ...mod, setLanguages };
}

function createLocaleInstance(useLocale, options = {}) {
  const {
    instanceId = `test-${Math.random()}`,
    defaultLocale = null,
    customMessages = {},
  } = options;

  let result;
  const app = createApp({
    setup() {
      result = useLocale();
      return {};
    },
    template: "<div></div>",
  });

  app.provide("ogisAppId", instanceId);
  app.provide("navigatorLocale", defaultLocale);
  app.provide("navigatorMessages", customMessages);

  const el = document.createElement("div");
  app.mount(el);

  return { result, app, el };
}

describe("useLocale", () => {
  afterEach(() => {
    for (const cleanup of pendingCleanups.splice(0)) cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("locale resolution", () => {
    it("falls back to English for an unsupported browser language", async () => {
      const { useLocale } = await loadLocale(["xx-XX"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.locale.value).toBe("en");
    });

    it("resolves French from a regional browser language (fr-CA)", async () => {
      const { useLocale } = await loadLocale(["fr-CA"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.locale.value).toBe("fr");
    });

    it("walks navigator.languages in order and picks the first supported", async () => {
      const { useLocale } = await loadLocale(["fr-CA", "en-US"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.locale.value).toBe("fr");
    });

    it("skips unsupported languages and continues down the list", async () => {
      const { useLocale } = await loadLocale(["de-DE", "fr-FR", "en-US"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.locale.value).toBe("fr");
    });

    it("uses the ?locale= default when supported", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        defaultLocale: "fr",
      });
      expect(result.locale.value).toBe("fr");
    });

    it("matches the ?locale= default by base code (fr-CA → fr)", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        defaultLocale: "fr-CA",
      });
      expect(result.locale.value).toBe("fr");
    });

    it("falls through to the browser list when ?locale= is unsupported", async () => {
      const { useLocale } = await loadLocale(["fr"]);
      const { result } = createLocaleInstance(useLocale, {
        defaultLocale: "de",
      });
      expect(result.locale.value).toBe("fr");
    });

    it("reacts to a runtime languagechange event", async () => {
      const { useLocale, setLanguages } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.locale.value).toBe("en");

      setLanguages(["fr-CA"]);
      window.dispatchEvent(new Event("languagechange"));
      await nextTick();

      expect(result.locale.value).toBe("fr");
    });

    it("keeps document.documentElement.lang in sync with the locale", async () => {
      const { useLocale, setLanguages } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale);
      expect(document.documentElement.lang).toBe("en");

      setLanguages(["fr-CA"]);
      window.dispatchEvent(new Event("languagechange"));
      await nextTick();

      expect(result.locale.value).toBe("fr");
      expect(document.documentElement.lang).toBe("fr");
    });
  });

  describe("formatLocale", () => {
    it("keeps the regional browser tag for the active UI language (en-CA)", async () => {
      const { useLocale } = await loadLocale(["en-CA"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.locale.value).toBe("en");
      expect(result.formatLocale.value).toBe("en-CA");
    });

    it("uses the ?locale= tag when it drives the active UI language", async () => {
      const { useLocale } = await loadLocale(["en-CA"]);
      const { result } = createLocaleInstance(useLocale, {
        defaultLocale: "fr",
      });
      expect(result.locale.value).toBe("fr");
      expect(result.formatLocale.value).toBe("fr");
    });

    it("keeps the regional browser tag for the active UI language (fr-CA)", async () => {
      const { useLocale } = await loadLocale(["fr-CA"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.locale.value).toBe("fr");
      expect(result.formatLocale.value).toBe("fr-CA");
    });

    it("falls back to the locale code when the browser language is unsupported", async () => {
      const { useLocale } = await loadLocale(["de-DE"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.locale.value).toBe("en");
      expect(result.formatLocale.value).toBe("en");
    });

    it("prefers the ?locale= tag when it resolves the UI language", async () => {
      const { useLocale } = await loadLocale(["fr-FR"]);
      const { result } = createLocaleInstance(useLocale, {
        defaultLocale: "en-GB",
      });
      expect(result.locale.value).toBe("en");
      expect(result.formatLocale.value).toBe("en-GB");
    });
  });

  describe("matchLocale", () => {
    it("matches a script-region tag against a script-level code", () => {
      expect(matchLocale("zh-Hans-CN", ["en", "fr", "zh-Hans"])).toBe(
        "zh-Hans",
      );
    });

    it("matches case-insensitively and returns the registered casing", () => {
      expect(matchLocale("zh-hans-cn", ["en", "fr", "zh-Hans"])).toBe(
        "zh-Hans",
      );
    });

    it("matches a regional tag against its base code (fr-CA → fr)", () => {
      expect(matchLocale("fr-CA", ["en", "fr"])).toBe("fr");
    });

    it("matches exact codes as-is", () => {
      expect(matchLocale("zh-Hans", ["en", "zh-Hans"])).toBe("zh-Hans");
      expect(matchLocale("fr", ["en", "fr"])).toBe("fr");
    });

    it("returns null when no registered code matches", () => {
      expect(matchLocale("de-DE", ["en", "fr"])).toBeNull();
    });

    it("prefers the longest matching prefix", () => {
      expect(matchLocale("zh-Hans-CN", ["en", "zh", "zh-Hans"])).toBe(
        "zh-Hans",
      );
    });
  });

  describe("glob-loaded locales", () => {
    it("registers locales from the src/locales/*.json files", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale);
      // `en` and `fr` are discovered from the JSON files, not a hard-coded map.
      expect(result.t("nav.menu")).toBe("Menu");

      const { useLocale: useFr } = await loadLocale(["fr-FR"]);
      const { result: frResult } = createLocaleInstance(useFr);
      expect(frResult.t("panel.privacy.title")).toBe("Confidentialité");
    });
  });

  describe("t() translation", () => {
    it("translates a known English key", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.t("nav.menu")).toBe("Menu");
    });

    it("translates to French when the locale is French", async () => {
      const { useLocale } = await loadLocale(["fr-FR"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.t("nav.menu")).toBeTruthy();
    });

    it("returns the key itself when no translation exists", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.t("nonexistent.key.xyz")).toBe("nonexistent.key.xyz");
    });

    it("custom messages override built-in translations", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: { en: { "nav.menu": "Custom Menu" } },
      });
      expect(result.t("nav.menu")).toBe("Custom Menu");
    });

    it("custom messages only apply to their locale", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: { fr: { "nav.menu": "Menu Personnalisé" } },
      });
      expect(result.t("nav.menu")).toBe("Menu");
    });
  });

  describe("t() interpolation", () => {
    it("replaces a single token", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: { en: { "greeting.hello": "Hello {name}" } },
      });
      expect(result.t("greeting.hello", { name: "Ada" })).toBe("Hello Ada");
    });

    it("replaces multiple tokens in one message", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: { en: { "route.summary": "{from} to {to}" } },
      });
      expect(result.t("route.summary", { from: "A", to: "B" })).toBe("A to B");
    });

    it("leaves tokens without a matching parameter untouched", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: { en: { "greeting.hello": "Hello {name}" } },
      });
      expect(result.t("greeting.hello", { other: "Ada" })).toBe("Hello {name}");
    });

    it("coerces non-string parameters with String()", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: { en: { "stats.total": "Total: {total}" } },
      });
      expect(result.t("stats.total", { total: 3 })).toBe("Total: 3");
      expect(result.t("stats.total", { total: 0 })).toBe("Total: 0");
      expect(result.t("stats.total", { total: true })).toBe("Total: true");
    });

    it("behaves exactly as before when called without params", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.t("nav.menu")).toBe("Menu");
      expect(result.t("nonexistent.key.xyz")).toBe("nonexistent.key.xyz");
    });
  });

  describe("t() plurals", () => {
    const pluralMessages = (one, other) => ({
      en: { "item.count_one": one, "item.count_other": other },
      fr: { "item.count_one": one, "item.count_other": other },
    });

    it("selects the one form for English count 1", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: pluralMessages("One item", "{count} items"),
      });
      expect(result.t("item.count", { count: 1 })).toBe("One item");
    });

    it("selects the other form for English count 0 and 2", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: pluralMessages("One item", "{count} items"),
      });
      expect(result.t("item.count", { count: 0 })).toBe("0 items");
      expect(result.t("item.count", { count: 2 })).toBe("2 items");
    });

    it("selects the one form for French count 0 and 1", async () => {
      const { useLocale } = await loadLocale(["fr-FR"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: pluralMessages("Un article", "{count} articles"),
      });
      expect(result.t("item.count", { count: 0 })).toBe("Un article");
      expect(result.t("item.count", { count: 1 })).toBe("Un article");
    });

    it("selects the other form for French count 2", async () => {
      const { useLocale } = await loadLocale(["fr-FR"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: pluralMessages("Un article", "{count} articles"),
      });
      expect(result.t("item.count", { count: 2 })).toBe("2 articles");
    });

    it("falls back from a missing category form to the other form", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: { en: { "item.count_other": "{count} items" } },
      });
      expect(result.t("item.count", { count: 1 })).toBe("1 items");
    });

    it("falls back from missing plural forms to the base key", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: { en: { "item.count": "Total items: {count}" } },
      });
      expect(result.t("item.count", { count: 2 })).toBe("Total items: 2");
    });

    it("returns the key itself when no plural form or base exists", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.t("missing.key", { count: 1 })).toBe("missing.key");
    });

    it("prefers custom plural forms over the base translation", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale, {
        customMessages: {
          en: {
            "nav.menu_one": "Custom menu",
            "nav.menu_other": "Custom menus",
          },
        },
      });
      expect(result.t("nav.menu", { count: 1 })).toBe("Custom menu");
      expect(result.t("nav.menu", { count: 2 })).toBe("Custom menus");
    });
  });

  describe("mapLanguageTag", () => {
    it("returns the locale code for standard locales", async () => {
      const { useLocale } = await loadLocale(["en-US"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.mapLanguageTag.value).toBe("en");
    });

    it("returns fr when the locale is French", async () => {
      const { useLocale } = await loadLocale(["fr-FR"]);
      const { result } = createLocaleInstance(useLocale);
      expect(result.mapLanguageTag.value).toBe("fr");
    });
  });
});
