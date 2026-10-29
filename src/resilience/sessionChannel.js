const SESSION_TAB_KEY = "ogis_session-tab";

let fallbackTabId = null;

const createId = () => {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-crypto identifier.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const sessionStorageSafe = () => {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const channelName = (instanceId) => `ogis-session-${instanceId}`;

/**
 * Return this tab's session owner id.
 *
 * The id is generated once per tab and stored in `sessionStorage`, so it
 * survives a reload but is new after an app quit. When storage is unavailable
 * a module-level fallback keeps the id stable for the lifetime of the document.
 *
 * @returns {string}
 */
export const getSessionTabId = () => {
  const storage = sessionStorageSafe();

  if (storage) {
    try {
      const existing = storage.getItem(SESSION_TAB_KEY);
      if (typeof existing === "string" && existing) return existing;

      const id = createId();
      storage.setItem(SESSION_TAB_KEY, id);
      return id;
    } catch {
      // Fall through to the in-memory id.
    }
  }

  if (fallbackTabId === null) fallbackTabId = createId();
  return fallbackTabId;
};

/**
 * Probe whether another tab still owns a stored session.
 *
 * Opens the instance's probe channel, posts a request and resolves `true` only
 * when a matching owner answers before the timeout. Every failure path —
 * unsupported API, construction failure, malformed response, timeout — resolves
 * `false`, so a dead owner is never mistaken for a live one.
 *
 * @param {string} ownerId
 * @param {{ timeoutMs?: number, instanceId?: string }} [options]
 * @returns {Promise<boolean>}
 */
export const isSessionOwnerAlive = (
  ownerId,
  { timeoutMs = 250, instanceId = "app" } = {},
) => {
  if (typeof ownerId !== "string" || !ownerId) return Promise.resolve(false);
  if (typeof BroadcastChannel !== "function") return Promise.resolve(false);

  const requestId = createId();
  let channel;

  try {
    channel = new BroadcastChannel(channelName(instanceId));
  } catch {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (alive) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        channel.removeEventListener("message", onMessage);
      } catch {
        // Ignore teardown failures.
      }
      try {
        channel.close();
      } catch {
        // Ignore teardown failures.
      }
      resolve(alive);
    };

    const onMessage = (event) => {
      const data = event?.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "session-owned") return;
      if (data.requestId !== requestId) return;
      if (data.ownerId !== ownerId) return;
      finish(true);
    };

    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));

    try {
      channel.addEventListener("message", onMessage);
      channel.postMessage({ type: "session-probe", requestId, ownerId });
    } catch {
      finish(false);
    }
  });
};

/**
 * Answer liveness probes for one instance while this tab owns its session.
 *
 * The listener responds only when `getOwnerId()` returns a non-empty string
 * equal to the probed owner. The returned stop function is idempotent and safe
 * when BroadcastChannel is unsupported.
 *
 * @param {string} instanceId
 * @param {() => string|null} getOwnerId
 * @returns {() => void}
 */
export const listenForSessionProbes = (instanceId, getOwnerId) => {
  if (typeof BroadcastChannel !== "function") return () => {};

  let channel;
  try {
    channel = new BroadcastChannel(channelName(instanceId));
  } catch {
    return () => {};
  }

  const onMessage = (event) => {
    const data = event?.data;
    if (!data || typeof data !== "object") return;
    if (data.type !== "session-probe") return;
    if (typeof data.requestId !== "string" || !data.requestId) return;
    if (typeof data.ownerId !== "string" || !data.ownerId) return;

    let current;
    try {
      current = getOwnerId();
    } catch {
      return;
    }

    if (typeof current !== "string" || !current) return;
    if (current !== data.ownerId) return;

    try {
      channel.postMessage({
        type: "session-owned",
        requestId: data.requestId,
        ownerId: current,
      });
    } catch {
      // A failed response is indistinguishable from a dead owner.
    }
  };

  channel.addEventListener("message", onMessage);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      channel.removeEventListener("message", onMessage);
    } catch {
      // Ignore teardown failures.
    }
    try {
      channel.close();
    } catch {
      // Ignore teardown failures.
    }
  };
};
