import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const originalBroadcastChannel = globalThis.BroadcastChannel;

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
});

describe("isSessionOwnerAlive", () => {
  it("returns false without the BroadcastChannel API", async () => {
    delete globalThis.BroadcastChannel;

    await expect(
      isSessionOwnerAlive("owner-1", { instanceId: "no-api" }),
    ).resolves.toBe(false);
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
