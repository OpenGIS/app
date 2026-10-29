/**
 * Restore gating for a persisted Locate session.
 *
 * Chromium and Firefox report the geolocation permission accurately, so a
 * restore may only proceed on an explicit `granted`. Apple WebKit (bug 275479)
 * can report `prompt` after the user has already granted access, so it gets a
 * narrow exception: a recent stored fix is treated as potentially granted and
 * the normal silent restore path is attempted.
 */

/** Oldest stored fix that Apple WebKit may restore from: 24 hours. */
export const LOCATE_RESTORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Default bound for the geolocation permission query: 2 seconds. */
export const LOCATE_PERMISSION_QUERY_TIMEOUT_MS = 2000;

const PERMISSION_STATES = new Set(["granted", "denied", "prompt"]);

const resolvePermissionTimeout = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : LOCATE_PERMISSION_QUERY_TIMEOUT_MS;

/**
 * Read the OS geolocation permission state, bounded by a timeout.
 *
 * A missing Permissions API, a rejected query, a malformed result and a query
 * that never settles all resolve to `null` (unknown). The helper never throws,
 * and a late rejection from the original query cannot surface as an unhandled
 * rejection.
 *
 * @param {Object} [options]
 * @param {number} [options.timeoutMs] - Bound in milliseconds. Defaults to
 *   `globalThis.__ogisLocatePermissionTimeoutMs` when it is a finite positive
 *   number, otherwise 2000 ms.
 * @returns {Promise<'granted'|'denied'|'prompt'|null>}
 */
export const queryGeolocationPermission = async ({ timeoutMs } = {}) => {
  const override =
    typeof globalThis === "undefined"
      ? undefined
      : globalThis.__ogisLocatePermissionTimeoutMs;
  const timeout = resolvePermissionTimeout(
    typeof timeoutMs === "number" ? timeoutMs : override,
  );

  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeout);
  });

  const queryPromise = (async () => {
    try {
      if (typeof navigator === "undefined") return null;
      const query = navigator.permissions?.query;
      if (typeof query !== "function") return null;
      const status = await query.call(navigator.permissions, {
        name: "geolocation",
      });
      const state = status?.state;
      return PERMISSION_STATES.has(state) ? state : null;
    } catch {
      return null;
    }
  })();

  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
    // A query that settles after the timeout must not reject unhandled.
    queryPromise.catch(() => {});
  }
};

/**
 * Whether the current engine is Apple WebKit.
 *
 * @param {Navigator} [navigatorLike]
 * @returns {boolean}
 */
export const isAppleWebKit = (navigatorLike = navigator) => {
  const vendor = navigatorLike?.vendor;
  return typeof vendor === "string" && vendor.includes("Apple");
};

/**
 * Whether a persisted Locate session may be restored.
 *
 * `granted` restores everywhere and `denied` never restores. A prompting or
 * unavailable permission state restores only on Apple WebKit, and only for a
 * stored fix inside the recency window.
 *
 * @param {Object} options
 * @param {string|null} options.permissionState - OS geolocation permission.
 * @param {number|null} options.fixAt - Epoch milliseconds of the stored fix.
 * @param {number} [options.now] - Current epoch milliseconds.
 * @param {boolean} [options.appleWebKit] - Whether the engine is Apple WebKit.
 * @returns {boolean}
 */
export const canRestoreLocate = ({
  permissionState,
  fixAt,
  now = Date.now(),
  appleWebKit = isAppleWebKit(),
}) => {
  if (permissionState === "granted") return true;
  if (permissionState === "denied") return false;
  if (!appleWebKit) return false;
  if (typeof fixAt !== "number" || !Number.isFinite(fixAt) || fixAt <= 0) {
    return false;
  }
  const age = now - fixAt;
  return age >= 0 && age <= LOCATE_RESTORE_MAX_AGE_MS;
};
