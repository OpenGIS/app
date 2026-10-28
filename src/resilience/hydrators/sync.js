const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasUsableId = (item) => {
  if (!isPlainObject(item)) return false;
  if (typeof item.id === "string" && item.id.trim()) return true;
  return Number.isFinite(item.id);
};

/**
 * Normalise stored sync state.
 *
 * The top-level shape must be an object; anything else throws so the primitive
 * quarantines the value and falls back to defaults. Non-array queues and
 * non-array failed lists are repaired to arrays, and items without a usable id
 * are dropped.
 *
 * @param {*} data - Raw decoded state, at any stored version.
 * @returns {{ queue: Object[], failed: Object[] }}
 */
export function hydrateSync(data) {
  if (!isPlainObject(data)) {
    throw new TypeError("sync state must be an object");
  }

  const repair = (value) =>
    Array.isArray(value) ? value.filter(hasUsableId) : [];

  return {
    queue: repair(data.queue),
    failed: repair(data.failed),
  };
}
