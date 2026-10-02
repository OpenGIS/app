import { ref, computed, watch } from "vue";
import { emitter } from "@/emitter.js";
import { navigatorLanguages } from "@/composables/useLocale";

// Module-level reactive system preference — the single source of truth for theme.
// Guarded so importing this module outside a browser never throws (defaults to light).
const darkQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

const systemDark = ref(darkQuery ? darkQuery.matches : false);

if (darkQuery) {
  darkQuery.addEventListener("change", (e) => {
    systemDark.value = e.matches;
  });
}

// Notify subscribers (e.g. future MapLibre style swap) whenever the system theme changes.
watch(systemDark, (v) => emitter.emit("theme:change", v ? "dark" : "light"));

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
 * Theme follows `prefers-color-scheme`; units follow the region of the
 * user's most-preferred language. Both update live at runtime.
 */
export const useSettings = () => {
  const resolvedTheme = computed(() => (systemDark.value ? "dark" : "light"));

  const isDark = computed(() => resolvedTheme.value === "dark");

  const resolvedUnits = computed(() =>
    localeDefaultUnits(
      navigatorLanguages.value[0] ??
        (typeof navigator !== "undefined" ? navigator.language : undefined),
    ),
  );
  const isMetric = computed(() => resolvedUnits.value === "metric");

  return {
    resolvedTheme,
    isDark,
    isMetric,
    resolvedUnits,
  };
};
