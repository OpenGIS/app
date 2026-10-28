import { inject, nextTick, reactive, watch } from "vue";
import { createDebug } from "@/debug.js";
import { emitter } from "@/emitter.js";

const debug = createDebug("state");

const ENVELOPE_MARKER = "__ogisState";
const ENVELOPE_MARKER_VERSION = 1;
const DEFAULT_DEBOUNCE_MS = 250;

/** @type {Map<string, Object>} */
const registry = new Map();

let storageListenerAttached = false;

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const deepClone = (value) => {
  if (Array.isArray(value)) return value.map(deepClone);
  if (isPlainObject(value)) {
    const clone = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = deepClone(item);
    }
    return clone;
  }
  return value;
};

const registryKey = (instanceId, namespace) =>
  `${instanceId}\u0000${namespace}`;

const storeKey = (namespace, instanceId) => `ogis_${namespace}_${instanceId}`;

const quarantineKey = (namespace, instanceId) =>
  `ogis_quarantine_${namespace}_${instanceId}`;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const storageFor = (kind) => {
  try {
    if (typeof window === "undefined") return null;
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

const safeGetItem = (kind, key) => {
  const storage = storageFor(kind);
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch (error) {
    debug.warn(`could not read [${key}]`, error);
    return null;
  }
};

const safeSetItem = (kind, key, value) => {
  const storage = storageFor(kind);
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch (error) {
    debug.warn(`could not write [${key}]`, error);
    return false;
  }
};

const safeRemoveItem = (kind, key) => {
  const storage = storageFor(kind);
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (error) {
    debug.warn(`could not remove [${key}]`, error);
  }
};

const sameContainer = (value, defaults) =>
  Array.isArray(defaults) ? Array.isArray(value) : isPlainObject(value);

const serialiseEnvelope = (state, version) => {
  try {
    return JSON.stringify({
      [ENVELOPE_MARKER]: ENVELOPE_MARKER_VERSION,
      version,
      data: state,
    });
  } catch (error) {
    debug.warn("could not serialise state", error);
    return null;
  }
};

/**
 * Decode a raw stored string into cleaned data.
 *
 * A bare value is treated as version 0 legacy data. An envelope newer than the
 * definition is rejected so a downgrade can never discard data. Hydrators run
 * synchronously and may throw to reject the value.
 *
 * @param {string} raw
 * @param {Object} definition - Normalised definition.
 * @returns {{ ok: true, data: *, version: number } | { ok: false, reason: string }}
 */
const decode = (raw, definition) => {
  if (typeof raw !== "string") {
    return { ok: false, reason: "storage value is not a string" };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "stored value is not valid JSON" };
  }

  let version;
  let data;

  if (
    isPlainObject(parsed) &&
    parsed[ENVELOPE_MARKER] === ENVELOPE_MARKER_VERSION
  ) {
    version = parsed.version;
    if (!Number.isFinite(version)) {
      return { ok: false, reason: "envelope version is not a number" };
    }
    if (version > definition.version) {
      return { ok: false, reason: "stored version is newer than supported" };
    }
    data = parsed.data;
  } else {
    version = 0;
    data = parsed;
  }

  if (definition.hydrate) {
    let cleaned;
    try {
      cleaned = definition.hydrate(data, {
        version,
        namespace: definition.namespace,
        instanceId: definition.instanceId,
      });
    } catch {
      return { ok: false, reason: "hydration rejected the stored value" };
    }
    if (cleaned === undefined || cleaned === null) {
      return { ok: false, reason: "hydration returned no data" };
    }
    if (!sameContainer(cleaned, definition.defaults)) {
      return { ok: false, reason: "hydrated data has an unexpected shape" };
    }
    return { ok: true, data: cleaned, version };
  }

  if (!sameContainer(data, definition.defaults)) {
    return { ok: false, reason: "stored value has an unexpected shape" };
  }

  return { ok: true, data, version };
};

/**
 * Replace reactive state in place, preserving its identity.
 *
 * Arrays are spliced; plain objects have keys absent from the new data removed
 * before assigning. This keeps every existing `state.*` reference valid.
 *
 * @param {Object|Array} state
 * @param {Object|Array} data
 */
const replaceState = (state, data) => {
  const clone = deepClone(data);

  if (Array.isArray(state)) {
    state.splice(0, state.length, ...clone);
    return;
  }

  for (const key of Object.keys(state)) {
    if (!Object.hasOwn(clone, key)) delete state[key];
  }
  for (const key of Object.keys(clone)) {
    state[key] = clone[key];
  }
};

/**
 * Remove every localStorage key belonging to one app instance, including
 * quarantine copies. Other instances are untouched.
 *
 * @param {string} instanceId
 */
export const resetInstanceState = (instanceId) => {
  const storage = storageFor("local");
  if (!storage) return;

  const suffix = new RegExp(`^ogis_.*_${escapeRegExp(instanceId)}$`);

  let keys;
  try {
    keys = Object.keys(storage);
  } catch (error) {
    debug.warn("could not enumerate storage keys", error);
    return;
  }

  for (const key of keys) {
    if (!suffix.test(key)) continue;
    try {
      storage.removeItem(key);
    } catch (error) {
      debug.warn(`could not remove [${key}]`, error);
    }
  }
};

const handleStorage = (event) => {
  if (event.key === null) return;

  for (const entry of registry.values()) {
    if (!entry.crossTab || entry.key !== event.key) continue;
    if (event.newValue === null || event.newValue === undefined) continue;

    const decoded = decode(event.newValue, entry.definition);
    if (!decoded.ok) {
      debug.warn(`ignored external update for [${entry.key}]`, decoded.reason);
      continue;
    }

    entry.clearPendingWrite();
    entry.suppressWrite = true;
    replaceState(entry.state, decoded.data);
    entry.serialised = serialiseEnvelope(entry.state, entry.definition.version);

    nextTick(() => {
      entry.suppressWrite = false;
    });

    try {
      entry.definition.onSync?.(entry.state, {
        namespace: entry.definition.namespace,
        instanceId: entry.definition.instanceId,
        source: "external",
      });
    } catch (error) {
      debug.warn(`onSync failed for [${entry.key}]`, error);
    }

    emitter.emit("state:sync", {
      namespace: entry.definition.namespace,
      instanceId: entry.definition.instanceId,
      source: "external",
      key: entry.key,
    });
  }
};

const ensureStorageListener = () => {
  if (storageListenerAttached) return;
  if (typeof window === "undefined") return;
  if (typeof window.addEventListener !== "function") return;
  window.addEventListener("storage", handleStorage);
  storageListenerAttached = true;
};

/**
 * Reactive persisted state with versioned envelopes, quarantine and optional
 * cross-tab sync.
 *
 * The returned `state` is reactive and is mutated in place by external syncs.
 * A definition's `hydrate` and `onSync` callbacks run synchronously.
 *
 * @param {string} namespace - Storage namespace, e.g. `"view"`.
 * @param {Object} definition - Store definition.
 * @param {number} [definition.version=1] - Current schema version.
 * @param {Object|Array} [definition.defaults={}] - Deep-cloned default state.
 * @param {"local"|"session"} [definition.storage="local"] - Storage area.
 * @param {boolean} [definition.crossTab=false] - Sync external writes. Always
 *   false for session storage, which is per-tab.
 * @param {number} [definition.debounce=250] - Coalescing window in milliseconds.
 * @param {(data: *, context: {version: number, namespace: string, instanceId: string}) => *} [definition.hydrate] - Returns cleaned data; throw to reject.
 * @param {(state: Object|Array, context: {namespace: string, instanceId: string, source: "external"}) => void} [definition.onSync] - Runs after an external write is applied.
 * @param {string} [instanceId] - App instance ID. Resolved via
 *   `inject("ogisAppId", "app")` when omitted.
 * @returns {{ state: Object|Array, flush: Function, reset: Function }}
 */
export const usePersistedState = (namespace, definition = {}, instanceId) => {
  const id = instanceId ?? inject("ogisAppId", "app");
  const key = storeKey(namespace, id);
  const cacheKey = registryKey(id, namespace);

  if (registry.has(cacheKey)) return registry.get(cacheKey).api;

  const requestedStorage =
    definition.storage === "session" ? "session" : "local";
  const crossTab = requestedStorage === "local" && definition.crossTab === true;
  const version = Number.isFinite(definition.version) ? definition.version : 1;
  const defaults = definition.defaults ?? {};
  const debounce = Number.isFinite(definition.debounce)
    ? Math.max(0, definition.debounce)
    : DEFAULT_DEBOUNCE_MS;

  const normalised = {
    ...definition,
    version,
    defaults,
    storage: requestedStorage,
    crossTab,
    debounce,
    namespace,
    instanceId: id,
  };

  const state = reactive(deepClone(defaults));

  const entry = {
    api: null,
    key,
    state,
    definition: normalised,
    crossTab,
    suppressWrite: false,
    timer: null,
    serialised: null,
    stopWatch: null,
    dispose: null,
    clearPendingWrite: () => {},
  };

  const write = () => {
    const serialised = serialiseEnvelope(state, version);
    if (serialised === null) return;
    if (serialised === entry.serialised) return;
    if (safeSetItem(normalised.storage, key, serialised)) {
      entry.serialised = serialised;
    }
  };

  const clearPendingWrite = () => {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  };

  entry.clearPendingWrite = clearPendingWrite;

  const flush = () => {
    try {
      clearPendingWrite();
      write();
    } catch (error) {
      debug.warn(`flush failed for [${key}]`, error);
    }
  };

  const reset = () => {
    clearPendingWrite();
    safeRemoveItem(normalised.storage, key);
    entry.suppressWrite = true;
    replaceState(state, defaults);
    entry.serialised = serialiseEnvelope(state, version);
    nextTick(() => {
      entry.suppressWrite = false;
    });
  };

  const bootRaw = safeGetItem(normalised.storage, key);

  if (bootRaw !== null) {
    const decoded = decode(bootRaw, normalised);
    if (decoded.ok) {
      replaceState(state, decoded.data);
    } else {
      debug.warn(`discarded invalid state for [${key}]`, decoded.reason);
      safeSetItem("local", quarantineKey(namespace, id), bootRaw);
    }
  }

  entry.serialised = serialiseEnvelope(state, version);

  entry.stopWatch = watch(
    state,
    () => {
      if (entry.suppressWrite) return;
      clearPendingWrite();
      entry.timer = setTimeout(() => {
        entry.timer = null;
        write();
      }, debounce);
    },
    { deep: true },
  );

  const onPageHide = () => flush();
  const onVisibilityChange = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") flush();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  entry.dispose = () => {
    clearPendingWrite();
    entry.stopWatch?.();
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", onPageHide);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };

  const api = { state, flush, reset };
  entry.api = api;
  registry.set(cacheKey, entry);

  if (crossTab) ensureStorageListener();

  return api;
};

/**
 * Test-only helper: discard every registered store, stop their watchers and
 * remove the module-level storage listener. Safe to call repeatedly.
 */
export const __resetPersistedStateForTests = () => {
  for (const entry of registry.values()) {
    entry.dispose?.();
  }
  registry.clear();

  if (storageListenerAttached && typeof window !== "undefined") {
    window.removeEventListener("storage", handleStorage);
    storageListenerAttached = false;
  }
};
