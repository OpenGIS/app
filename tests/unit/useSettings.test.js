import { describe, it, expect } from "vitest";
import { nextTick } from "vue";
import { localeDefaultUnits, useSettings } from "@/composables/useSettings";
import { navigatorLanguages } from "@/composables/useLocale";

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

describe("useSettings — no theme logic", () => {
  it("exposes only units and never writes a theme attribute", () => {
    const settings = useSettings();

    expect(Object.keys(settings).sort()).toEqual(["isMetric", "resolvedUnits"]);
    expect(settings.resolvedTheme).toBeUndefined();
    expect(settings.isDark).toBeUndefined();

    expect(document.documentElement.hasAttribute("data-bs-theme")).toBe(false);
  });
});
