import { migrateRoute, sanitiseTrackDocument } from "@/utils/track/index.js";

/**
 * Normalise stored routes into the current schema.
 *
 * The top-level shape must be an array; anything else throws so the primitive
 * quarantines the value and falls back to defaults. Invalid documents are
 * dropped. When two documents share an id the first one wins, so the earlier
 * stored entry keeps its stable colour and ordering.
 *
 * @param {*} data - Raw decoded state, at any stored version.
 * @returns {Object[]}
 */
export function hydrateRoutes(data) {
  if (!Array.isArray(data)) {
    throw new TypeError("routes state must be an array");
  }

  const byId = new Map();
  for (const raw of data) {
    const doc = sanitiseTrackDocument(migrateRoute(raw), { kind: "route" });
    if (!doc || byId.has(doc.id)) continue;
    byId.set(doc.id, doc);
  }

  return [...byId.values()];
}
