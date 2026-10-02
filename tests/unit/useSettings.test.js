import { describe, it, expect, vi, afterEach } from "vitest";
import { nextTick } from "vue";
import { localeDefaultUnits, useSettings } from "@/composables/useSettings";
import { navigatorLanguages } from "@/composables/useLocale";

/**
 * Load a fresh copy of useSettings with a controllable window.matchMedia.
 * useSettings reads matchMedia at import time, so the stub must be installed
 * (and modules reset) before the dynamic import.
 */
async function loadSystemTheme(initialMatches) {
  vi.resetModules();

  const listeners = [];
  let matches = initialMatches;

  const mql = {
    media: "(prefers-color-scheme: dark)",
    get matches() {
      return matches;
    },
    addEventListener: (type, listener) => {
      if (type === "change") listeners.push(listener);
    },
    removeEventListener: () => {},
  };

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );

  const { useSettings } = await import("@/composables/useSettings");
  const { emitter } = await import("@/emitter.js");

  /** Simulate the OS switching theme, notifying captured change listeners. */
  const setMatches = (value) => {
    matches = value;
    for (const listener of listeners) {
      listener({ matches, media: mql.media });
    }
  };

  return { useSettings, emitter, setMatches };
}

describe("localeDefaultUnits", () => {
  it("returns 'imperial' for en-US", () => {
    expect(localeDefaultUnits("en-US")).toBe("imperial");
  });

  it("returns 'imperial' for en (US region when maximized)", () => {
    expect(localeDefaultUnits("en")).toBe("imperial");
  });

  it("returns 'metric' for en-GB", () => {
    expect(localeDefaultUnits("en-GB")).toBe("metric");
  });

  it("returns 'metric' for en-CA", () => {
    expect(localeDefaultUnits("en-CA")).toBe("metric");
  });

  it("returns 'metric' for en-AU", () => {
    expect(localeDefaultUnits("en-AU")).toBe("metric");
  });

  it("returns 'metric' for fr-FR", () => {
    expect(localeDefaultUnits("fr-FR")).toBe("metric");
  });

  it("returns 'metric' for fr", () => {
    expect(localeDefaultUnits("fr")).toBe("metric");
  });

  it("returns 'metric' for de-DE", () => {
    expect(localeDefaultUnits("de-DE")).toBe("metric");
  });

  it("returns 'metric' for ja-JP", () => {
    expect(localeDefaultUnits("ja-JP")).toBe("metric");
  });

  it("returns 'imperial' for Liberia (en-LR)", () => {
    expect(localeDefaultUnits("en-LR")).toBe("imperial");
  });

  it("returns 'imperial' for Myanmar (my-MM)", () => {
    expect(localeDefaultUnits("my-MM")).toBe("imperial");
  });

  it("returns 'metric' for invalid locale string", () => {
    expect(localeDefaultUnits("not-a-locale-!!!")).toBe("metric");
  });

  it("falls back to navigator.language when no argument given", () => {
    // happy-dom defaults to 'en-US'
    const result = localeDefaultUnits();
    expect(["metric", "imperial"]).toContain(result);
  });
});

describe("useSettings — OS-derived units", () => {
  const setLanguages = (langs) => {
    navigatorLanguages.value = langs;
  };

  it("derives imperial for en-US", () => {
    setLanguages(["en-US"]);
    const { resolvedUnits, isMetric } = useSettings();
    expect(resolvedUnits.value).toBe("imperial");
    expect(isMetric.value).toBe(false);
  });

  it("derives metric for fr-CA", () => {
    setLanguages(["fr-CA"]);
    expect(useSettings().resolvedUnits.value).toBe("metric");
  });

  it("derives metric for en-GB", () => {
    setLanguages(["en-GB"]);
    expect(useSettings().resolvedUnits.value).toBe("metric");
  });

  it("uses the most-preferred language to infer the region", () => {
    setLanguages(["fr-CA", "en-US"]);
    expect(useSettings().resolvedUnits.value).toBe("metric");

    setLanguages(["en-US", "fr"]);
    expect(useSettings().resolvedUnits.value).toBe("imperial");
  });

  it("falls back to metric for an invalid language tag", () => {
    setLanguages(["not-a-locale-!!!"]);
    expect(useSettings().resolvedUnits.value).toBe("metric");
  });

  it("reacts to a runtime change in preferred languages", async () => {
    setLanguages(["en-US"]);
    const { isMetric } = useSettings();
    expect(isMetric.value).toBe(false);

    setLanguages(["fr-CA"]);
    await nextTick();
    expect(isMetric.value).toBe(true);
  });
});

describe("useSettings — system theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves dark when the system prefers dark", async () => {
    const { useSettings } = await loadSystemTheme(true);
    const { resolvedTheme, isDark } = useSettings("unit-theme-dark");

    expect(resolvedTheme.value).toBe("dark");
    expect(isDark.value).toBe(true);
  });

  it("resolves light when the system prefers light", async () => {
    const { useSettings } = await loadSystemTheme(false);
    const { resolvedTheme, isDark } = useSettings("unit-theme-light");

    expect(resolvedTheme.value).toBe("light");
    expect(isDark.value).toBe(false);
  });

  it("reacts to a runtime system theme change via the change listener", async () => {
    const { useSettings, setMatches } = await loadSystemTheme(false);
    const { resolvedTheme, isDark } = useSettings("unit-theme-change");

    expect(resolvedTheme.value).toBe("light");

    setMatches(true);
    await nextTick();
    expect(resolvedTheme.value).toBe("dark");
    expect(isDark.value).toBe(true);

    setMatches(false);
    await nextTick();
    expect(resolvedTheme.value).toBe("light");
    expect(isDark.value).toBe(false);
  });

  it("emits theme:change with the resolved theme on system changes", async () => {
    const { useSettings, emitter, setMatches } = await loadSystemTheme(false);
    useSettings("unit-theme-emit");

    const received = [];
    const listener = (theme) => received.push(theme);
    emitter.on("theme:change", listener);

    setMatches(true);
    await nextTick();
    setMatches(false);
    await nextTick();

    emitter.off("theme:change", listener);
    expect(received).toEqual(["dark", "light"]);
  });

  it("shares the module-level system preference across instances", async () => {
    const { useSettings, setMatches } = await loadSystemTheme(false);
    const first = useSettings("unit-theme-instance-a");
    const second = useSettings("unit-theme-instance-b");

    setMatches(true);
    await nextTick();

    expect(first.resolvedTheme.value).toBe("dark");
    expect(second.resolvedTheme.value).toBe("dark");
  });
});
