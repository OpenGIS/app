import { createDebug } from "@/debug.js";
import {
  documentPointCount,
  migrateActiveRecording,
  migrateRecording,
  sanitiseTrackDocument,
} from "@/utils/track/index.js";

const debug = createDebug("state");

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Normalise stored saved recordings into the current schema.
 *
 * The top-level shape must be an object with an array `saved`; anything else
 * throws so the primitive quarantines the value and falls back to defaults.
 * Individual saved documents are repaired, dropping unusable points and
 * documents with no usable points. Legacy `{ saved, active }` values are
 * accepted, but any `active` property is ignored: the active recording lives
 * in its own tab-owned store.
 *
 * @param {*} data - Raw decoded state, at any stored version.
 * @returns {{ saved: Object[] }}
 */
export function hydrateRecordings(data) {
  if (!isPlainObject(data)) {
    throw new TypeError("recordings state must be an object");
  }
  if (!Array.isArray(data.saved)) {
    throw new TypeError("recordings saved must be an array");
  }

  const byId = new Map();
  for (const raw of data.saved) {
    const doc = sanitiseTrackDocument(migrateRecording(raw), {
      kind: "recording",
    });
    if (!doc || byId.has(doc.id)) continue;
    byId.set(doc.id, doc);
  }

  return { saved: [...byId.values()] };
}

/**
 * Normalise a stored active recording.
 *
 * The top-level shape must be an object; anything else throws so the primitive
 * quarantines the value and falls back to defaults. A `null` or missing
 * `active` yields `null`. Otherwise the document is migrated and sanitised,
 * and kept only when it has at least two usable points.
 *
 * @param {*} data - Raw decoded state.
 * @returns {{ active: Object|null }}
 */
export function hydrateRecordingActive(data) {
  if (!isPlainObject(data)) {
    throw new TypeError("recording active state must be an object");
  }

  let active = null;
  if (data.active !== null && data.active !== undefined) {
    const doc = sanitiseTrackDocument(migrateActiveRecording(data.active), {
      kind: "recording",
    });
    if (doc && documentPointCount(doc) >= 2) active = doc;
  }

  return { active };
}

const storageFor = (kind) => {
  try {
    if (typeof window === "undefined") return null;
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

const readRaw = (kind, key) => {
  const storage = storageFor(kind);
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const writeRaw = (kind, key, value) => {
  const storage = storageFor(kind);
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

/**
 * One-time boot migration from the shared recordings store to the tab-owned
 * active-recording store.
 *
 * Reads the legacy local `ogis_recordings_{instanceId}` value and, when it
 * carries an `active` property, moves a non-null active recording into
 * sessionStorage under `ogis_recording-active_{instanceId}` (unless that key
 * already exists) and rewrites the local value as saved-only. If the session
 * write fails, the local value is left untouched so a later boot can retry. A
 * value with no `active` property, malformed input or a non-object top level is
 * left untouched. Best-effort only; never throws.
 *
 * @param {string} instanceId
 * @returns {boolean} true when the local value was rewritten.
 */
export function migrateRecordingsSession(instanceId) {
  const localKey = `ogis_recordings_${instanceId}`;
  const sessionKey = `ogis_recording-active_${instanceId}`;

  try {
    const raw = readRaw("local", localKey);
    if (raw === null) return false;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }

    const data =
      isPlainObject(parsed) && parsed.__ogisState === 1 ? parsed.data : parsed;

    if (!isPlainObject(data)) return false;
    if (!Object.hasOwn(data, "active")) return false;

    const needsMove = data.active !== null && data.active !== undefined;
    if (needsMove && readRaw("session", sessionKey) === null) {
      const written = writeRaw(
        "session",
        sessionKey,
        JSON.stringify({ active: data.active }),
      );
      // Keep the local value intact when the move fails; a later boot retries.
      if (!written) return false;
    }

    writeRaw(
      "local",
      localKey,
      JSON.stringify({
        saved: Array.isArray(data.saved) ? data.saved : [],
      }),
    );

    return true;
  } catch (error) {
    debug.warn("could not migrate recordings to session storage", error);
    return false;
  }
}
