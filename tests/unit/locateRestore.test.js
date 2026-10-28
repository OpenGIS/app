import { describe, expect, it } from "vitest";
import {
  LOCATE_RESTORE_MAX_AGE_MS,
  canRestoreLocate,
  isAppleWebKit,
} from "@/resilience/locateRestore";

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
