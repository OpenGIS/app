/**
 * Decode a raw persisted-state string into its stored value.
 *
 * The state store writes a versioned envelope; older values were stored bare.
 * Empty or unparseable input returns `null`.
 *
 * @param {string|null|undefined} raw
 * @returns {*}
 */
export const readStoredState = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.__ogisState === 1 ? parsed.data : parsed;
  } catch {
    return null;
  }
};
