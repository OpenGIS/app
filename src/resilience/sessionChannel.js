const SESSION_TAB_KEY = "ogis_session-tab";

const STARVATION_GRACE_MS = 1000;
const REQUIRED_MISSES = 2;
const MAX_PROBE_ROUNDS = 8;
const PROBE_LOCK_TIMEOUT_MS = 1000;

let fallbackTabId = null;

const heldTabLocks = new Set();

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

const now = () => {
  try {
    if (
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
    ) {
      return performance.now();
    }
  } catch {
    // Fall back to the wall clock.
  }
  return Date.now();
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

const tabLockName = (tabId) => `ogis-session-tab-${tabId}`;

const locksApi = () => {
  try {
    if (typeof navigator === "undefined") return null;
    const locks = navigator.locks;
    if (!locks || typeof locks.request !== "function") return null;
    return locks;
  } catch {
    return null;
  }
};

const holdTabLock = (tabId) => {
  if (typeof tabId !== "string" || !tabId) return;
  if (heldTabLocks.has(tabId)) return;

  const locks = locksApi();
  if (!locks) return;

  heldTabLocks.add(tabId);

  try {
    const request = locks.request(
      tabLockName(tabId),
      () => new Promise(() => {}),
    );
    if (request && typeof request.catch === "function") {
      request.catch(() => heldTabLocks.delete(tabId));
    }
  } catch {
    // The id remains usable even when the lock cannot be requested.
  }
};

const ownerLockHeld = (ownerId) => {
  const locks = locksApi();
  if (!locks) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const settle = (held) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(held);
    };

    // A request that never invokes its callback would otherwise hang the probe
    // forever; fall through to the BroadcastChannel fallback instead.
    timer = setTimeout(() => settle(false), PROBE_LOCK_TIMEOUT_MS);

    try {
      const request = locks.request(
        tabLockName(ownerId),
        { ifAvailable: true, mode: "shared" },
        (lock) => {
          // A null lock means the owner still holds it; an acquired probe lock
          // is released as soon as this callback returns. Probing in shared
          // mode means two concurrent probes for a dead owner both acquire the
          // lock, so neither probe mistakes the other's probe lock for a live
          // owner.
          settle(lock === null || lock === undefined);
        },
      );

      if (request && typeof request.catch === "function") {
        request.catch(() => settle(false));
      }
    } catch {
      settle(false);
    }
  });
};

/**
 * Return this tab's session owner id.
 *
 * The id is generated once per tab and stored in `sessionStorage`, so it
 * survives a reload but is new after an app quit. When storage is unavailable
 * a module-level fallback keeps the id stable for the lifetime of the document.
 *
 * The id also holds a Web Lock for the document lifetime, which lets other tabs
 * detect a live owner even when the main thread is too busy to answer a probe.
 *
 * @returns {string}
 */
export const getSessionTabId = () => {
  const storage = sessionStorageSafe();
  let id = null;

  if (storage) {
    try {
      const existing = storage.getItem(SESSION_TAB_KEY);
      if (typeof existing === "string" && existing) {
        id = existing;
      } else {
        id = createId();
        storage.setItem(SESSION_TAB_KEY, id);
      }
    } catch {
      // Fall through to the in-memory id.
    }
  }

  if (!id) {
    if (fallbackTabId === null) fallbackTabId = createId();
    id = fallbackTabId;
  }

  holdTabLock(id);
  return id;
};

const probeOwner = (ownerId, timeoutMs, instanceId) => {
  let channel;

  try {
    channel = new BroadcastChannel(channelName(instanceId));
  } catch {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let deadline = 0;
    let misses = 0;
    let starvationRounds = 0;

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
      if (data.ownerId !== ownerId) return;
      finish(true);
    };

    const onTimeout = () => {
      if (settled) return;

      // A timer that fires well past its due time means the main thread was
      // blocked, not that the owner failed to answer. Re-arm instead of
      // counting the round as a miss; the interrupted streak no longer counts
      // as consecutive on-time misses.
      const lateBy = now() - deadline;
      if (lateBy > STARVATION_GRACE_MS) {
        misses = 0;
        starvationRounds += 1;
        // Under sustained starvation the owner cannot answer, so assume it is
        // alive rather than stealing its session. The bound also guarantees
        // the probe settles instead of re-arming forever.
        if (starvationRounds >= MAX_PROBE_ROUNDS) {
          finish(true);
          return;
        }
        scheduleRound();
        return;
      }

      starvationRounds = 0;
      misses += 1;
      if (misses >= REQUIRED_MISSES) {
        finish(false);
        return;
      }

      scheduleRound();
    };

    const scheduleRound = () => {
      if (settled) return;

      const delay = Math.max(0, timeoutMs);
      deadline = now() + delay;
      timer = setTimeout(onTimeout, delay);

      try {
        channel.postMessage({
          type: "session-probe",
          requestId: createId(),
          ownerId,
        });
      } catch {
        finish(false);
      }
    };

    try {
      channel.addEventListener("message", onMessage);
    } catch {
      finish(false);
      return;
    }

    scheduleRound();
  });
};

/**
 * Probe whether another tab still owns a stored session.
 *
 * The owner's Web Lock is checked first with a shared-mode `ifAvailable` probe:
 * a live owner holds the lock exclusively, so the probe gets `null` and resolves
 * `true` immediately, even when `BroadcastChannel` is unavailable. Probing in
 * shared mode keeps concurrent probes from excluding each other — otherwise a
 * probe for a dead owner could briefly hold the lock and make a sibling probe
 * report a dead owner as alive. When the lock is free — an older app version, or
 * an owner whose lock request has not yet been granted — the instance's probe
 * channel is used instead. Every failure path —
 * unsupported API, construction failure, malformed response, starvation-safe
 * timeout — resolves `false`, so a dead owner is never mistaken for a live one.
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

  return ownerLockHeld(ownerId).then((held) => {
    if (held) return true;
    if (typeof BroadcastChannel !== "function") return false;
    return probeOwner(ownerId, timeoutMs, instanceId);
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

  try {
    channel.addEventListener("message", onMessage);
  } catch {
    try {
      channel.close();
    } catch {
      // Ignore teardown failures.
    }
    return () => {};
  }

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
