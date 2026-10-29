import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCATE_PERMISSION_QUERY_TIMEOUT_MS,
  LOCATE_RESTORE_MAX_AGE_MS,
  canRestoreLocate,
  isAppleWebKit,
  queryGeolocationPermission,
} from "@/resilience/locateRestore";

const originalPermissions = Object.getOwnPropertyDescriptor(
  navigator,
  "permissions",
);

const setPermissionQuery = (query) => {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query },
  });
};

const removePermissionsApi = () => {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: undefined,
  });
};

afterEach(() => {
  if (originalPermissions) {
    Object.defineProperty(navigator, "permissions", originalPermissions);
  } else {
    delete navigator.permissions;
  }
  delete globalThis.__ogisLocatePermissionTimeoutMs;
  vi.useRealTimers();
});

const NOW = 1_700_000_000_000;
const RECENT_FIX_AT = NOW - 60_000;

const restore = (options) =>
  canRestoreLocate({
    now: NOW,
    appleWebKit: false,
    ...options,
  });

describe("isAppleWebKit", () => {
  it("detects an Apple vendor string", () => {
    expect(isAppleWebKit({ vendor: "Apple Computer, Inc." })).toBe(true);
  });

  it("rejects a non-Apple vendor string", () => {
    expect(isAppleWebKit({ vendor: "Google Inc." })).toBe(false);
  });

  it("rejects an undefined or malformed navigator", () => {
    expect(isAppleWebKit(undefined)).toBe(false);
    expect(isAppleWebKit({})).toBe(false);
    expect(isAppleWebKit({ vendor: 42 })).toBe(false);
  });
});

describe("canRestoreLocate", () => {
  it("restores a granted permission on any browser", () => {
    expect(
      restore({
        permissionState: "granted",
        fixAt: undefined,
        appleWebKit: false,
      }),
    ).toBe(true);
    expect(
      restore({ permissionState: "granted", fixAt: null, appleWebKit: true }),
    ).toBe(true);
  });

  it("never restores a denied permission on any browser", () => {
    expect(
      restore({
        permissionState: "denied",
        fixAt: RECENT_FIX_AT,
        appleWebKit: false,
      }),
    ).toBe(false);
    expect(
      restore({
        permissionState: "denied",
        fixAt: RECENT_FIX_AT,
        appleWebKit: true,
      }),
    ).toBe(false);
  });

  it("restores a prompt on Apple WebKit with a recent valid fix", () => {
    expect(
      restore({
        permissionState: "prompt",
        fixAt: RECENT_FIX_AT,
        appleWebKit: true,
      }),
    ).toBe(true);
  });

  it("does not restore a prompt on non-Apple WebKit", () => {
    expect(
      restore({
        permissionState: "prompt",
        fixAt: RECENT_FIX_AT,
        appleWebKit: false,
      }),
    ).toBe(false);
  });

  it("restores a prompt on Apple WebKit at the recency boundary", () => {
    expect(
      restore({
        permissionState: "prompt",
        fixAt: NOW - LOCATE_RESTORE_MAX_AGE_MS,
        appleWebKit: true,
      }),
    ).toBe(true);
  });

  it("rejects a stale fix on Apple WebKit", () => {
    expect(
      restore({
        permissionState: "prompt",
        fixAt: NOW - LOCATE_RESTORE_MAX_AGE_MS - 1,
        appleWebKit: true,
      }),
    ).toBe(false);
  });

  it("rejects a future fix on Apple WebKit", () => {
    expect(
      restore({
        permissionState: "prompt",
        fixAt: NOW + 1,
        appleWebKit: true,
      }),
    ).toBe(false);
  });

  it("rejects a missing, zero or non-finite fix time on Apple WebKit", () => {
    for (const fixAt of [undefined, null, 0, -1, NaN, Infinity]) {
      expect(
        restore({ permissionState: "prompt", fixAt, appleWebKit: true }),
      ).toBe(false);
    }
  });

  it("treats an unavailable permission state like a prompt", () => {
    expect(
      restore({
        permissionState: null,
        fixAt: RECENT_FIX_AT,
        appleWebKit: true,
      }),
    ).toBe(true);
    expect(
      restore({
        permissionState: null,
        fixAt: RECENT_FIX_AT,
        appleWebKit: false,
      }),
    ).toBe(false);
    expect(
      restore({
        permissionState: null,
        fixAt: NOW - LOCATE_RESTORE_MAX_AGE_MS - 1,
        appleWebKit: true,
      }),
    ).toBe(false);
  });
});

describe("queryGeolocationPermission", () => {
  it("returns granted, denied and prompt states", async () => {
    for (const state of ["granted", "denied", "prompt"]) {
      setPermissionQuery(async () => ({ state }));
      await expect(queryGeolocationPermission()).resolves.toBe(state);
    }
  });

  it("treats a malformed result as unknown", async () => {
    for (const value of [undefined, null, {}, { state: 42 }, { state: "x" }]) {
      setPermissionQuery(async () => value);
      await expect(queryGeolocationPermission()).resolves.toBeNull();
    }
  });

  it("treats a rejected query as unknown", async () => {
    setPermissionQuery(async () => {
      throw new Error("permission query failed");
    });
    await expect(queryGeolocationPermission()).resolves.toBeNull();
  });

  it("treats a missing Permissions API as unknown", async () => {
    removePermissionsApi();
    await expect(queryGeolocationPermission()).resolves.toBeNull();

    setPermissionQuery(undefined);
    await expect(queryGeolocationPermission()).resolves.toBeNull();
  });

  it("resolves null when the query never settles", async () => {
    vi.useFakeTimers();
    setPermissionQuery(() => new Promise(() => {}));

    const result = queryGeolocationPermission();
    await vi.advanceTimersByTimeAsync(LOCATE_PERMISSION_QUERY_TIMEOUT_MS);

    await expect(result).resolves.toBeNull();
  });

  it("honours the global timeout override", async () => {
    vi.useFakeTimers();
    globalThis.__ogisLocatePermissionTimeoutMs = 50;
    setPermissionQuery(() => new Promise(() => {}));

    let settled = false;
    const result = queryGeolocationPermission();
    result.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(49);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeNull();
  });

  it("ignores an invalid timeout override", async () => {
    vi.useFakeTimers();
    globalThis.__ogisLocatePermissionTimeoutMs = 0;
    setPermissionQuery(() => new Promise(() => {}));

    let settled = false;
    const result = queryGeolocationPermission();
    result.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(LOCATE_PERMISSION_QUERY_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeNull();
  });

  it("does not surface a late query rejection after a timeout", async () => {
    const rejections = [];
    const onUnhandled = (reason) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      setPermissionQuery(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("late rejection")), 30);
          }),
      );

      await expect(
        queryGeolocationPermission({ timeoutMs: 10 }),
      ).resolves.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
