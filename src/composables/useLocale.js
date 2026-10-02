import { computed, inject, ref, watch } from "vue";

// Locale message tables are auto-registered from the files in `src/locales/`.
// Dropping a new `{code}.json` file in is all that is needed to add a language.
const modules = import.meta.glob("../locales/*.json", {
  eager: true,
  import: "default",
});

const LOCALES = Object.fromEntries(
  Object.entries(modules).map(([path, messages]) => [
    path
      .split("/")
      .pop()
      .replace(/\.json$/, ""),
    messages,
  ]),
);

/**
 * Read the browser's preferred languages as an ordered list.
 * Falls back to `[navigator.language]`, then English, outside a browser.
 */
function readNavigatorLanguages() {
  if (typeof navigator === "undefined") return ["en"];
  if (Array.isArray(navigator.languages) && navigator.languages.length) {
    return [...navigator.languages];
  }
  return navigator.language ? [navigator.language] : ["en"];
}

/**
 * Module-level reactive list of the user's preferred languages — the single
 * source of truth for locale resolution, kept live by the `languagechange`
 * event (mirrors `systemDark` in useSettings).
 */
export const navigatorLanguages = ref(readNavigatorLanguages());

if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    navigatorLanguages.value = readNavigatorLanguages();
  });
}

/**
 * Overrides for cases where the UI locale code does not directly match the
 * preferred OSM `name:xx` tag suffix. For most languages this is empty —
 * the locale code IS the OSM tag. Add entries here only when they diverge
 * (e.g. if a UI locale ever uses a non-standard code for display purposes).
 *
 * Note: CJK languages should be added as full BCP 47 subtags (`zh-Hans`,
 * `zh-Hant`) rather than bare `zh`, so no override is needed for those either.
 */
const MAP_LANGUAGE_TAG_OVERRIDES = {};

const cache = new Map();

/**
 * Pre-seed the locale cache for use outside Vue setup context (e.g., feature install).
 * Called by main.js before features are installed.
 */
export function initLocaleCache(instanceId, locale, messages) {
  if (!cache.has(instanceId)) {
    cache.set(instanceId, {
      defaultLocale: locale,
      customMessages: messages ?? {},
    });
  }
}

const LOCALE_CODES = Object.keys(LOCALES);

/**
 * Resolve a language tag against the registered locale codes using script-prefix
 * matching: try progressively shorter `-`-separated prefixes, longest first
 * (e.g. "zh-Hans-CN" → "zh-hans-cn" → "zh-hans" → "zh"), comparing
 * case-insensitively. Returns the registered code (original casing, e.g.
 * "zh-Hans") or null when nothing matches. Exported for unit testing.
 */
export function matchLocale(tag, codes) {
  if (!tag || !Array.isArray(codes) || !codes.length) return null;
  const parts = String(tag).toLowerCase().split("-");
  for (let length = parts.length; length > 0; length--) {
    const prefix = parts.slice(0, length).join("-");
    const found = codes.find((code) => code.toLowerCase() === prefix);
    if (found) return found;
  }
  return null;
}

/**
 * @param {string} [instanceId] - App instance ID. If omitted, resolved via inject('ogisAppId').
 *   Pass explicitly when calling from outside Vue setup context (e.g. a feature install()).
 */
export const useLocale = (instanceId) => {
  const id = instanceId ?? inject("ogisAppId", "app");

  if (!cache.has(id)) {
    const defaultLocale = inject("navigatorLocale", null);
    const customMessages = inject("navigatorMessages", {});
    cache.set(id, { defaultLocale, customMessages });
  }

  const { defaultLocale, customMessages } = cache.get(id);

  const locale = computed(() => {
    // 1. ?locale= URL param — exact match, then shorter prefixes
    const fromParam = matchLocale(defaultLocale, LOCALE_CODES);
    if (fromParam) return fromParam;

    // 2. Walk the browser's preferred languages in order.
    for (const code of navigatorLanguages.value) {
      const match = matchLocale(code, LOCALE_CODES);
      if (match) return match;
    }

    // 3. English fallback
    return "en";
  });

  // Keep <html lang> in sync with the active locale.
  watch(
    locale,
    (value) => {
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.lang = value;
      }
    },
    { immediate: true },
  );

  /**
   * Translate a key. Resolution order:
   *   custom messages for active locale → active locale → English → key itself
   */
  const t = (key) => {
    const lang = locale.value;
    const custom = customMessages[lang] ?? {};
    const msgs = LOCALES[lang] ?? LOCALES.en;
    return custom[key] ?? msgs[key] ?? LOCALES.en[key] ?? key;
  };

  /**
   * The locale code formatted as an OSM `name:xx` tag suffix.
   * For most locales this equals `locale.value` directly.
   * Use this value when building MapLibre coalesce expressions for
   * multilingual map labels (see docs/6.locale.md — OSM Multilingual Names).
   */
  const mapLanguageTag = computed(
    () => MAP_LANGUAGE_TAG_OVERRIDES[locale.value] ?? locale.value,
  );

  return {
    locale,
    mapLanguageTag,
    t,
  };
};
