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
