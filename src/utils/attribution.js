/**
 * Build the MapLibre-style attribution string from a style JSON object.
 *
 * Mirrors MapLibre's AttributionControl assembly: collect each source's
 * `attribution`, dedupe, drop whitespace-only entries, sort by length, remove
 * any entry that is a substring of another entry, then join with a space.
 *
 * @param {Object|null|undefined} style - A style object exposing `sources`
 * @returns {string} The assembled attribution HTML, or "" when there are none
 */
export const buildAttribution = (style) => {
  const sources = style?.sources ?? {};

  let entries = Object.values(sources)
    .map((source) => source?.attribution)
    .filter((entry) => typeof entry === "string");

  entries = [...new Set(entries)];
  entries = entries.filter((entry) => entry.trim());
  entries.sort((a, b) => a.length - b.length);
  entries = entries.filter((entry, i) => {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].includes(entry)) return false;
    }
    return true;
  });

  return entries.join(" ");
};
