import {
  documentPointCount,
  migrateActiveRecording,
  migrateRecording,
  sanitiseTrackDocument,
} from "@/utils/track/index.js";

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Normalise stored recordings into the current schema.
 *
 * The top-level shape must be an object with an array `saved`; anything else
 * throws so the primitive quarantines the value and falls back to defaults.
 * Individual saved documents and the active recording are repaired, dropping
 * unusable points and documents with no usable points.
 *
 * @param {*} data - Raw decoded state, at any stored version.
 * @returns {{ saved: Object[], active: Object|null }}
 */
export function hydrateRecordings(data) {
  if (!isPlainObject(data)) {
    throw new TypeError("recordings state must be an object");
  }
  if (!Array.isArray(data.saved)) {
    throw new TypeError("recordings saved must be an array");
  }

  const saved = [];
  for (const raw of data.saved) {
    const doc = sanitiseTrackDocument(migrateRecording(raw), {
      kind: "recording",
    });
    if (doc) saved.push(doc);
  }

  let active = null;
  if (data.active !== null && data.active !== undefined) {
    const doc = sanitiseTrackDocument(migrateActiveRecording(data.active), {
      kind: "recording",
    });
    if (doc && documentPointCount(doc) >= 2) active = doc;
  }

  return { saved, active };
}
