/**
 * Map recovery helpers.
 *
 * Kept in a small, dependency-free module so the failure-classification logic
 * can be unit tested without a DOM, a map instance or the network.
 */

/** How long the style may take to load before the map is considered failed. */
export const MAP_STYLE_TIMEOUT_MS = 20000;

/** Status codes that have a dedicated user-facing message. */
const STATUS_CODES = new Set([
  "unavailable",
  "unsupported",
  "init",
  "style",
  "contextLost",
]);

/**
 * Resolve a style watchdog timeout. Anything other than a positive finite
 * number — including a missing, zero, negative or non-numeric override — falls
 * back to the default.
 *
 * @param {*} value - Candidate override, typically `window.__ogisMapStyleTimeoutMs`.
 * @returns {number} A positive finite timeout in milliseconds.
 */
export const resolveStyleTimeout = (value) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MAP_STYLE_TIMEOUT_MS;
};

/**
 * Whether a MapLibre error event describes the style document itself.
 *
 * Source, tile, glyph and sprite failures are routine and must never raise the
 * map-unavailable overlay. Only a failure carrying the configured style URL
 * and no `sourceId` qualifies.
 *
 * @param {*} event - MapLibre `error` event payload.
 * @param {string} styleUrl - The style URL the map was constructed with.
 * @returns {boolean}
 */
export const isStyleRequestError = (event, styleUrl) => {
  if (!event || typeof event !== "object") return false;
  if (!styleUrl || typeof styleUrl !== "string") return false;

  try {
    if (event.sourceId) return false;
    const error = event.error;
    if (!error || typeof error !== "object") return false;
    return error.url === styleUrl;
  } catch {
    return false;
  }
};

/**
 * Locale key for a map failure code, with `map.status.unavailable` as the
 * fallback for unknown or missing codes.
 *
 * @param {string} [code]
 * @returns {string}
 */
export const mapStatusMessageKey = (code) => {
  if (typeof code !== "string" || !STATUS_CODES.has(code)) {
    return "map.status.unavailable";
  }
  return `map.status.${code}`;
};
