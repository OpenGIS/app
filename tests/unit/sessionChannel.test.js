import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSessionTabId,
  isSessionOwnerAlive,
  listenForSessionProbes,
} from "@/resilience/sessionChannel";

class FakeBroadcastChannel {
  static groups = new Map();

  static group(name) {
    if (!FakeBroadcastChannel.groups.has(name)) {
      FakeBroadcastChannel.groups.set(name, new Set());
    }
    return FakeBroadcastChannel.groups.get(name);
  }

  static reset() {
    FakeBroadcastChannel.groups.clear();
  }

  constructor(name) {
    this.name = name;
    this.listeners = new Set();
    this.closed = false;
    FakeBroadcastChannel.group(name).add(this);
  }

  addEventListener(type, listener) {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "message") this.listeners.delete(listener);
  }

  postMessage(data) {
    for (const channel of FakeBroadcastChannel.group(this.name)) {
      if (channel === this || channel.closed) continue;
      for (const listener of [...channel.listeners]) {
        listener({ data });
      }
    }
  }

  close() {
    this.closed = true;
    FakeBroadcastChannel.group(this.name).delete(this);
  }
}

class FakeLocks {
  constructor() {
    this.held = new Set();
    this.granted = [];
    this.requests = [];
  }

  hold(name) {
    this.held.add(name);
  }

  request(name, optionsOrCallback, maybeCallback) {
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : maybeCallback;
    const options =
      typeof optionsOrCallback === "function" ? {} : optionsOrCallback || {};

    this.requests.push({ name, options });

    if (options.ifAvailable) {
      if (this.held.has(name)) {
        return Promise.resolve().then(() => callback(null));
      }

      // A shared probe never enters `held`: concurrent shared probes both
      // acquire the lock, so they cannot exclude each other.
      if (options.mode === "shared") {
        return Promise.resolve().then(() => callback({ name, mode: "shared" }));
      }

      this.held.add(name);
      return Promise.resolve()
        .then(() => callback({ name }))
        .finally(() => this.held.delete(name));
    }

    this.held.add(name);
    this.granted.push(name);
    return Promise.resolve(callback({ name })).then(
      () => undefined,
      () => undefined,
    );
  }
}

const originalBroadcastChannel = globalThis.BroadcastChannel;
const originalLocksDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  "locks",
);

const installLocks = (locks) => {
  Object.defineProperty(globalThis.navigator, "locks", {
    configurable: true,
    value: locks,
  });
};

const restoreLocks = () => {
  if (originalLocksDescriptor) {
    Object.defineProperty(
      globalThis.navigator,
      "locks",
      originalLocksDescriptor,
    );
  } else {
    delete globalThis.navigator.locks;
  }
};

beforeEach(() => {
  FakeBroadcastChannel.reset();
  globalThis.BroadcastChannel = FakeBroadcastChannel;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  if (originalBroadcastChannel) {
    globalThis.BroadcastChannel = originalBroadcastChannel;
  } else {
    delete globalThis.BroadcastChannel;
  }
  restoreLocks();
  FakeBroadcastChannel.reset();
});

describe("getSessionTabId", () => {
  it("generates an id once and reuses it for the tab", () => {
    const first = getSessionTabId();
    const second = getSessionTabId();

    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
    expect(sessionStorage.getItem("ogis_session-tab")).toBe(first);
  });

  it("generates a new id after the session storage is cleared", () => {
    const first = getSessionTabId();
    sessionStorage.clear();

    expect(getSessionTabId()).not.toBe(first);
  });

  it("holds a lifetime tab lock and requests it only once", () => {
    const locks = new FakeLocks();
    installLocks(locks);

    const id = getSessionTabId();
    const lockName = `ogis-session-tab-${id}`;

    expect(locks.granted).toContain(lockName);

    getSessionTabId();

    expect(locks.granted.filter((name) => name === lockName)).toHaveLength(1);
    expect(locks.held.has(lockName)).toBe(true);
  });
});

describe("isSessionOwnerAlive", () => {
  it("returns false without the BroadcastChannel API", async () => {
    delete globalThis.BroadcastChannel;

    await expect(
      isSessionOwnerAlive("owner-1", { instanceId: "no-api" }),
    ).resolves.toBe(false);
  });

  it("resolves true from a held owner lock without BroadcastChannel", async () => {
    const locks = new FakeLocks();
    locks.hold("ogis-session-tab-owner-1");
    installLocks(locks);
    delete globalThis.BroadcastChannel;

    await expect(
      isSessionOwnerAlive("owner-1", { instanceId: "lock-alive" }),
    ).resolves.toBe(true);
  });

  it("falls through a free lock to the BroadcastChannel fallback", async () => {
    const locks = new FakeLocks();
    installLocks(locks);

    await expect(
      isSessionOwnerAlive("owner-1", {
        instanceId: "lock-free",
        timeoutMs: 20,
      }),
    ).resolves.toBe(false);

    expect(locks.requests).toContainEqual({
      name: "ogis-session-tab-owner-1",
      options: { ifAvailable: true, mode: "shared" },
    });
    expect(locks.held.has("ogis-session-tab-owner-1")).toBe(false);
  });

  it("does not let concurrent probes mistake each other for a live owner", async () => {
    const locks = new FakeLocks();
    installLocks(locks);
    delete globalThis.BroadcastChannel;

    const [first, second] = await Promise.all([
      isSessionOwnerAlive("owner-1", { instanceId: "dead-owner" }),
      isSessionOwnerAlive("owner-1", { instanceId: "dead-owner" }),
    ]);

    expect(first).toBe(false);
    expect(second).toBe(false);

    const probes = locks.requests.filter(
      (request) => request.name === "ogis-session-tab-owner-1",
    );
    expect(probes).toHaveLength(2);
    for (const probe of probes) {
      expect(probe.options).toEqual({ ifAvailable: true, mode: "shared" });
    }
    expect(locks.held.has("ogis-session-tab-owner-1")).toBe(false);
  });

  it("falls back to BroadcastChannel when the lock probe never settles", async () => {
    const locks = {
      requests: [],
      request(name) {
        this.requests.push(name);
        return new Promise(() => {});
      },
    };
    installLocks(locks);

    const stop = listenForSessionProbes("lock-hang", () => "owner-1");

    vi.useFakeTimers();
    try {
      const result = isSessionOwnerAlive("owner-1", {
        instanceId: "lock-hang",
        timeoutMs: 20,
      });

      await vi.advanceTimersByTimeAsync(1000);

      await expect(result).resolves.toBe(true);
      expect(locks.requests).toContain("ogis-session-tab-owner-1");
    } finally {
      vi.useRealTimers();
      stop();
    }
  });

  it("resolves true when the matching owner responds", async () => {
    const stop = listenForSessionProbes("alive", () => "owner-1");

    try {
      await expect(
        isSessionOwnerAlive("owner-1", {
          instanceId: "alive",
          timeoutMs: 100,
        }),
      ).resolves.toBe(true);
    } finally {
      stop();
    }
  });

  it("resolves false on timeout when nobody responds", async () => {
    await expect(
      isSessionOwnerAlive("owner-1", {
        instanceId: "timeout",
        timeoutMs: 20,
      }),
    ).resolves.toBe(false);
  });

  it("ignores a response from a mismatched owner", async () => {
    const stop = listenForSessionProbes("mismatch", () => "owner-2");

    try {
      await expect(
        isSessionOwnerAlive("owner-1", {
          instanceId: "mismatch",
          timeoutMs: 20,
        }),
      ).resolves.toBe(false);
    } finally {
      stop();
    }
  });

  it("ignores a listener whose owner has been cleared", async () => {
    let owner = "owner-1";
    const stop = listenForSessionProbes("cleared", () => owner);
    owner = null;

    try {
      await expect(
        isSessionOwnerAlive("owner-1", {
          instanceId: "cleared",
          timeoutMs: 20,
        }),
      ).resolves.toBe(false);
    } finally {
      stop();
    }
  });
});

describe("listenForSessionProbes", () => {
  it("stops responding after the returned stop runs", async () => {
    const stop = listenForSessionProbes("stopped", () => "owner-1");
    stop();

    await expect(
      isSessionOwnerAlive("owner-1", {
        instanceId: "stopped",
        timeoutMs: 20,
      }),
    ).resolves.toBe(false);
  });

  it("returns an idempotent stop and is safe without the API", async () => {
    const stop = listenForSessionProbes("idempotent", () => "owner-1");
    expect(() => {
      stop();
      stop();
    }).not.toThrow();

    delete globalThis.BroadcastChannel;
    const noApiStop = listenForSessionProbes("no-api", () => "owner-1");
    expect(() => noApiStop()).not.toThrow();
  });
});
