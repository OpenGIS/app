import { computed } from "vue";
import { navigatorLanguages } from "@/composables/useLocale";

/**
 * Infer the user's preferred unit system from a browser locale string.
 * Only the US, Liberia (LR), and Myanmar (MM) default to imperial.
 * Returns 'imperial' for those locales, 'metric' for everything else.
 */
export function localeDefaultUnits(localeStr) {
  const language =
    localeStr ??
    (typeof navigator !== "undefined" ? navigator.language : undefined);
  if (!language) return "metric";
  try {
    const region = new Intl.Locale(language).maximize().region;
    return ["US", "LR", "MM"].includes(region) ? "imperial" : "metric";
  } catch {
    return "metric";
  }
}

/**
 * User preferences derived from the OS/browser — nothing is stored.
 * Units follow the region of the user's most-preferred language and update
 * live at runtime. There is no theme logic: the app always renders its single
 * default theme.
 */
export const useSettings = () => {
  const resolvedUnits = computed(() =>
    localeDefaultUnits(
      navigatorLanguages.value[0] ??
        (typeof navigator !== "undefined" ? navigator.language : undefined),
    ),
  );
  const isMetric = computed(() => resolvedUnits.value === "metric");

  return {
    isMetric,
    resolvedUnits,
  };
};
