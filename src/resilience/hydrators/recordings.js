import { createDebug } from "@/debug.js";
import { migrateSessionToLocal } from "@/resilience/persistedState";
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
 * and kept only when it has at least two usable points. The owner id is kept
 * only as a non-empty string alongside an active document.
 *
 * @param {*} data - Raw decoded state.
 * @returns {{ active: Object|null, ownerId: string|null }}
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

  const ownerId =
    active !== null &&
    typeof data.ownerId === "string" &&
    data.ownerId.trim() !== ""
      ? data.ownerId
      : null;

  return { active, ownerId };
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
 * One-time boot migration into the durable active-recording store.
 *
 * Moves a legacy session `ogis_recording-active_{instanceId}` value into
 * localStorage, then moves a legacy local `ogis_recordings_{instanceId}`
 * `active` document into the local active store. The saved store is rewritten
 * as saved-only only after the active document has been written successfully,
 * so a failed write leaves the local recordings value intact for a later boot.
 * A value with no `active` property, malformed input or a non-object top level
 * is left untouched. Best-effort only; never throws.
 *
 * @param {string} instanceId
 * @returns {boolean} true when a value was moved or the saved store rewritten.
 */
export function migrateRecordingsSession(instanceId) {
  const recordingsKey = `ogis_recordings_${instanceId}`;
  const activeKey = `ogis_recording-active_${instanceId}`;

  let migrated = migrateSessionToLocal("recording-active", instanceId);

  try {
    const raw = readRaw("local", recordingsKey);
    if (raw === null) return migrated;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return migrated;
    }

    const data =
      isPlainObject(parsed) && parsed.__ogisState === 1 ? parsed.data : parsed;

    if (!isPlainObject(data)) return migrated;
    if (!Object.hasOwn(data, "active")) return migrated;

    const activeDoc = data.active;
    const needsMove = activeDoc !== null && activeDoc !== undefined;

    if (needsMove && readRaw("local", activeKey) === null) {
      const written = writeRaw(
        "local",
        activeKey,
        JSON.stringify({ active: activeDoc }),
      );
      // Keep the local recordings value intact when the move fails.
      if (!written) return migrated;
      migrated = true;
    }

    writeRaw(
      "local",
      recordingsKey,
      JSON.stringify({
        saved: Array.isArray(data.saved) ? data.saved : [],
      }),
    );

    return true;
  } catch (error) {
    debug.warn("could not migrate recordings to local storage", error);
    return migrated;
  }
}
