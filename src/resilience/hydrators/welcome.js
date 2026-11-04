const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Normalise stored welcome state.
 *
 * The top-level shape must be an object; anything else throws so the primitive
 * quarantines the value and falls back to defaults. A non-boolean `seen`
 * repairs to `false`, so a damaged value simply shows the card again.
 *
 * @param {*} data - Raw decoded state, at any stored version.
 * @returns {{ seen: boolean }}
 */
export function hydrateWelcome(data) {
  if (!isPlainObject(data)) {
    throw new TypeError("welcome state must be an object");
  }

  return { seen: data.seen === true };
}
