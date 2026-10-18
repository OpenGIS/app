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
 * Substitute `{token}` placeholders in a message with `String()`-coerced
 * values from `params`. Tokens without a matching parameter key are left as-is.
 */
const interpolate = (message, params) => {
  if (!params) return message;
  return message.replace(/\{([^{}]+)\}/g, (match, token) =>
    Object.prototype.hasOwnProperty.call(params, token)
      ? String(params[token])
      : match,
  );
};

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

  /** Resolve a key across the chain: custom → active locale → English → undefined. */
  const resolveMessage = (lang, key) => {
    const custom = customMessages[lang] ?? {};
    const msgs = LOCALES[lang] ?? LOCALES.en;
    return custom[key] ?? msgs[key] ?? LOCALES.en[key];
  };

  /**
   * Translate a key, optionally interpolating and pluralising.
   *
   * Resolution order for a plain key:
   *   custom messages for active locale → active locale → English → key itself
   *
   * When `params.count` is a number, the CLDR plural category for the active
   * locale is selected and resolved as `key_<category>` first, then
   * `key_other`, then the base `key`, and finally the key itself. The chosen
   * message is then interpolated: `{token}` occurrences are replaced with
   * `String(params[token])`; tokens without a matching parameter stay as-is.
   */
  const t = (key, params) => {
    const lang = locale.value;

    if (params && typeof params.count === "number") {
      const category = new Intl.PluralRules(lang).select(params.count);
      const message =
        resolveMessage(lang, `${key}_${category}`) ??
        resolveMessage(lang, `${key}_other`) ??
        resolveMessage(lang, key) ??
        key;
      return interpolate(message, params);
    }

    return interpolate(resolveMessage(lang, key) ?? key, params);
  };

  /**
   * The locale code formatted as an OSM `name:xx` tag suffix.
   * For most locales this equals `locale.value` directly.
   * Use this value when building MapLibre coalesce expressions for
   * multilingual map labels (see docs/7.locale.md — OSM Multilingual Names).
   */
  const mapLanguageTag = computed(
    () => MAP_LANGUAGE_TAG_OVERRIDES[locale.value] ?? locale.value,
  );

  /**
   * The BCP 47 tag used to format dates and numbers.
   *
   * Formatting follows the user's regional tag — the explicit `?locale=` value
   * when it is one, otherwise their first preferred browser language — while
   * staying aligned with the active UI language. A tag that resolves to a
   * different language than the active locale is ignored, so `en-CA` yields
   * Canadian English formatting for English but French formatting (not Canadian
   * English) once `?locale=fr` switches the UI to French.
   */
  const formatLocale = computed(() => {
    const paramMatch = matchLocale(defaultLocale, LOCALE_CODES);
    if (paramMatch && paramMatch === locale.value) return defaultLocale;

    const preferred = navigatorLanguages.value[0];
    const preferredMatch = matchLocale(preferred, LOCALE_CODES);
    if (preferredMatch && preferredMatch === locale.value) return preferred;

    return locale.value;
  });

  return {
    locale,
    mapLanguageTag,
    formatLocale,
    t,
  };
};
