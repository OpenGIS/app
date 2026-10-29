const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const RESTORABLE_MODES = new Set(["active", "following"]);

/**
 * Validate and normalise a persisted last fix.
 *
 * A fix is only usable when its coordinates, accuracy and timestamp are
 * finite and in range. Heading is optional: a non-finite value is coerced to
 * `null` rather than discarding the whole fix.
 *
 * @param {*} value
 * @returns {{ lat: number, lng: number, accuracy: number, heading: number|null, at: number } | null}
 */
function hydrateFix(value) {
  if (!isPlainObject(value)) return null;

  const { lat, lng, accuracy, heading, at } = value;
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) return null;
  if (!isFiniteNumber(lng) || lng < -180 || lng > 180) return null;
  if (!isFiniteNumber(accuracy) || accuracy < 0) return null;
  if (!isFiniteNumber(at) || at <= 0) return null;

  return {
    lat,
    lng,
    accuracy,
    heading: isFiniteNumber(heading) ? heading : null,
    at,
  };
}

/**
 * Normalise stored locate state.
 *
 * A session can only be restored when both a restorable mode and a valid last
 * fix are present; otherwise both are dropped. This keeps legacy values and
 * transient states (`error`) from resuming a dead session. Version 2 values
 * carry no owner id and gain a `null` one. A non-object top level throws so the
 * primitive quarantines the value and falls back to defaults.
 *
 * @param {*} data - Raw decoded state, at any stored version.
 * @returns {{ permissionGranted: boolean, mode: 'active'|'following'|null, lastFix: Object|null, ownerId: string|null }}
 */
export function hydrateLocate(data) {
  if (!isPlainObject(data)) {
    throw new TypeError("locate state must be an object");
  }

  const permissionGranted =
    data.permissionGranted === true ||
    data.permissionGranted === "true" ||
    data.permissionGranted === 1;

  const mode = RESTORABLE_MODES.has(data.mode) ? data.mode : null;
  const lastFix = mode === null ? null : hydrateFix(data.lastFix);
  const ownerId =
    lastFix !== null &&
    typeof data.ownerId === "string" &&
    data.ownerId.trim() !== ""
      ? data.ownerId
      : null;

  return {
    permissionGranted,
    mode: lastFix === null ? null : mode,
    lastFix,
    ownerId: lastFix === null ? null : ownerId,
  };
}
