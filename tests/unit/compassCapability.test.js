import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPASS_NULL_EVENT_GRACE_MS,
  COMPASS_PROBE_TIMEOUT_MS,
  createCompassCapabilityProbe,
  isIOSDevice,
  isValidHeadingEvent,
} from "@/utils/compassCapability";

const createFakeTarget = (overrides = {}) => {
  const listeners = new Map();

  const add = (type, handler) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
  };
  const remove = (type, handler) => {
    listeners.get(type)?.delete(handler);
  };

  return {
    addEventListener: vi.fn(add),
    removeEventListener: vi.fn(remove),
    emit(type, event) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    totalListeners() {
      return [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
    },
    ...overrides,
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("isIOSDevice", () => {
  it("recognises iPhone, iPad and iPod user agents", () => {
    expect(
      isIOSDevice({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      }),
    ).toBe(true);
    expect(
      isIOSDevice({
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      }),
    ).toBe(true);
    expect(
      isIOSDevice({
        userAgent:
          "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15",
      }),
    ).toBe(true);
  });

  it("recognises iPadOS desktop-mode MacIntel with multi-touch", () => {
    expect(
      isIOSDevice({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("recognises a userAgentData iOS platform", () => {
    expect(
      isIOSDevice({ userAgentData: { platform: "iOS" }, maxTouchPoints: 5 }),
    ).toBe(true);
  });

  it("rejects desktop macOS, Android and missing navigators", () => {
    expect(
      isIOSDevice({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/157.0.0.0 Safari/537.36",
        platform: "MacIntel",
        maxTouchPoints: 0,
        userAgentData: { platform: "macOS" },
      }),
    ).toBe(false);
    expect(
      isIOSDevice({
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/157.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
        userAgentData: { platform: "Android" },
      }),
    ).toBe(false);
    expect(isIOSDevice(undefined)).toBe(false);
    expect(isIOSDevice(null)).toBe(false);
  });
});

describe("isValidHeadingEvent", () => {
  it("accepts absolute readings, including an alpha of zero", () => {
    expect(isValidHeadingEvent({ alpha: 90, absolute: true })).toBe(true);
    expect(isValidHeadingEvent({ alpha: 0, absolute: true })).toBe(true);
  });

  it("rejects missing, undefined and null alpha without a webkit heading", () => {
    expect(isValidHeadingEvent({})).toBe(false);
    expect(isValidHeadingEvent({ alpha: undefined, absolute: true })).toBe(
      false,
    );
    expect(isValidHeadingEvent({ alpha: null, absolute: true })).toBe(false);
    expect(isValidHeadingEvent({ alpha: NaN, absolute: true })).toBe(false);
  });

  it("rejects a relative generic reading without a webkit heading", () => {
    expect(isValidHeadingEvent({ alpha: 90, absolute: false })).toBe(false);
    expect(isValidHeadingEvent({ alpha: undefined, absolute: false })).toBe(
      false,
    );
  });

  it("accepts a numeric webkitCompassHeading even without a finite alpha", () => {
    expect(
      isValidHeadingEvent({
        alpha: 90,
        absolute: false,
        webkitCompassHeading: 45,
      }),
    ).toBe(true);
    expect(isValidHeadingEvent({ alpha: 90, webkitCompassHeading: 45 })).toBe(
      true,
    );
    expect(
      isValidHeadingEvent({
        alpha: null,
        absolute: false,
        webkitCompassHeading: 45,
      }),
    ).toBe(true);
    expect(
      isValidHeadingEvent({
        alpha: null,
        absolute: true,
        webkitCompassHeading: 0,
      }),
    ).toBe(true);
  });

  it("requires a finite alpha or a finite webkit heading", () => {
    // A finite alpha alone is valid on an absolute reading, even when the
    // webkit heading is non-finite.
    expect(
      isValidHeadingEvent({
        alpha: 90,
        absolute: true,
        webkitCompassHeading: NaN,
      }),
    ).toBe(true);
    expect(
      isValidHeadingEvent({ alpha: 90, webkitCompassHeading: Infinity }),
    ).toBe(true);

    // A non-finite webkit heading without a finite alpha cannot authorise
    // capability.
    expect(
      isValidHeadingEvent({
        alpha: null,
        absolute: true,
        webkitCompassHeading: NaN,
      }),
    ).toBe(false);
    expect(
      isValidHeadingEvent({
        alpha: null,
        absolute: false,
        webkitCompassHeading: Infinity,
      }),
    ).toBe(false);
  });
});

describe("createCompassCapabilityProbe", () => {
  it("exposes the documented default timeout", () => {
    expect(COMPASS_PROBE_TIMEOUT_MS).toBe(2500);
  });

  it("resolves incapable when there is no target", async () => {
    const probe = createCompassCapabilityProbe({
      target: null,
      hasPermissionRequest: false,
    });

    await expect(probe.ready).resolves.toBe("incapable");
  });

  it("resolves capable immediately on an iOS permission API", async () => {
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: true,
      isIOS: true,
    });

    await expect(probe.ready).resolves.toBe("capable");
    expect(target.totalListeners()).toBe(0);
  });

  it("does not treat a non-iOS permission API as hardware evidence", async () => {
    vi.useFakeTimers();
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: true,
      isIOS: false,
    });

    let result = null;
    probe.ready.then((value) => {
      result = value;
    });

    // The probe listens normally instead of trusting the permission API.
    expect(target.listenerCount("deviceorientationabsolute")).toBe(1);
    expect(target.listenerCount("deviceorientation")).toBe(1);

    await vi.advanceTimersByTimeAsync(COMPASS_PROBE_TIMEOUT_MS - 1);
    expect(result).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe("incapable");
    await expect(probe.ready).resolves.toBe("incapable");
    expect(target.totalListeners()).toBe(0);
  });

  it("derives iOS from the probe target's navigator", async () => {
    const target = createFakeTarget({
      navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" },
    });
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: true,
    });

    await expect(probe.ready).resolves.toBe("capable");
    expect(target.totalListeners()).toBe(0);
  });

  it("resolves capable on a valid absolute orientation event", async () => {
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: false,
    });

    expect(target.listenerCount("deviceorientationabsolute")).toBe(1);
    expect(target.listenerCount("deviceorientation")).toBe(1);

    target.emit("deviceorientationabsolute", { alpha: 90, absolute: true });

    await expect(probe.ready).resolves.toBe("capable");
    expect(target.totalListeners()).toBe(0);
  });

  it("resolves capable on an iOS generic event with a webkit heading", async () => {
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: false,
    });

    target.emit("deviceorientation", {
      alpha: 0,
      absolute: false,
      webkitCompassHeading: 270,
    });

    await expect(probe.ready).resolves.toBe("capable");
    expect(target.totalListeners()).toBe(0);
  });

  it("ignores invalid events and resolves incapable after the timeout", async () => {
    vi.useFakeTimers();
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: false,
    });

    let result = null;
    probe.ready.then((value) => {
      result = value;
    });

    target.emit("deviceorientation", {});
    target.emit("deviceorientation", { alpha: 90, absolute: false });

    await vi.advanceTimersByTimeAsync(COMPASS_PROBE_TIMEOUT_MS - 1);
    expect(result).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe("incapable");
    await expect(probe.ready).resolves.toBe("incapable");
    expect(target.totalListeners()).toBe(0);
  });

  it("settles incapable after the null-reading grace timer", async () => {
    vi.useFakeTimers();
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: false,
      isIOS: false,
    });

    let result = null;
    probe.ready.then((value) => {
      result = value;
    });

    // The desktop-Chrome signature: absolute orientation with null sensor data.
    target.emit("deviceorientationabsolute", {
      alpha: null,
      beta: null,
      gamma: null,
      absolute: true,
    });

    await vi.advanceTimersByTimeAsync(COMPASS_NULL_EVENT_GRACE_MS - 1);
    expect(result).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe("incapable");
    await expect(probe.ready).resolves.toBe("incapable");
    expect(target.totalListeners()).toBe(0);
  });

  it("lets a valid heading win before the null-reading grace fires", async () => {
    vi.useFakeTimers();
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: false,
      isIOS: false,
    });

    let result = null;
    probe.ready.then((value) => {
      result = value;
    });

    target.emit("deviceorientationabsolute", { alpha: null, absolute: true });
    await vi.advanceTimersByTimeAsync(COMPASS_NULL_EVENT_GRACE_MS - 1);

    target.emit("deviceorientationabsolute", { alpha: 90, absolute: true });
    await expect(probe.ready).resolves.toBe("capable");

    // The null-reading timer was cleared by the settle.
    await vi.advanceTimersByTimeAsync(COMPASS_NULL_EVENT_GRACE_MS * 2);
    expect(result).toBe("capable");
    expect(target.totalListeners()).toBe(0);
  });

  it("does not stack null-reading grace timers on repeated null events", async () => {
    vi.useFakeTimers();
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: false,
      isIOS: false,
    });

    let result = null;
    probe.ready.then((value) => {
      result = value;
    });

    target.emit("deviceorientationabsolute", { alpha: null, absolute: true });
    await vi.advanceTimersByTimeAsync(100);
    target.emit("deviceorientationabsolute", { alpha: null, absolute: true });
    await vi.advanceTimersByTimeAsync(100);

    // 200 ms since the first null event and 100 ms since the second: still in
    // grace. A stacked second timer would delay settlement to 350 ms.
    expect(result).toBeNull();

    await vi.advanceTimersByTimeAsync(COMPASS_NULL_EVENT_GRACE_MS - 200);
    expect(result).toBe("incapable");
    await expect(probe.ready).resolves.toBe("incapable");
  });

  it("honours the __ogisCompassCapable override both ways without listeners", async () => {
    const capableTarget = createFakeTarget({ __ogisCompassCapable: true });
    const capableProbe = createCompassCapabilityProbe({
      target: capableTarget,
    });

    expect(capableTarget.totalListeners()).toBe(0);
    await expect(capableProbe.ready).resolves.toBe("capable");

    const incapableTarget = createFakeTarget({ __ogisCompassCapable: false });
    const incapableProbe = createCompassCapabilityProbe({
      target: incapableTarget,
    });

    expect(incapableTarget.totalListeners()).toBe(0);
    await expect(incapableProbe.ready).resolves.toBe("incapable");
  });

  it("removes listeners and never resolves after dispose", async () => {
    vi.useFakeTimers();
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: false,
    });

    let result = null;
    probe.ready.then((value) => {
      result = value;
    });

    expect(target.totalListeners()).toBe(2);
    probe.dispose();
    expect(target.totalListeners()).toBe(0);

    target.emit("deviceorientation", { alpha: 90, absolute: true });
    await vi.advanceTimersByTimeAsync(COMPASS_PROBE_TIMEOUT_MS * 2);
    expect(result).toBeNull();
  });

  it("lets a false override win over an iOS permission API", async () => {
    const target = createFakeTarget({ __ogisCompassCapable: false });
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: true,
      isIOS: true,
    });

    await expect(probe.ready).resolves.toBe("incapable");
    expect(target.totalListeners()).toBe(0);
  });

  it("does not start the null-reading grace for a relative orientation event", async () => {
    vi.useFakeTimers();
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: false,
      isIOS: false,
    });

    let result = null;
    probe.ready.then((value) => {
      result = value;
    });

    // A relative reading with null alpha is not the desktop-Chrome absolute
    // signature, so it is not negative evidence.
    target.emit("deviceorientation", { alpha: null, absolute: false });
    await vi.advanceTimersByTimeAsync(COMPASS_NULL_EVENT_GRACE_MS * 2);
    expect(result).toBeNull();

    // Only the full probe timeout settles it.
    await vi.advanceTimersByTimeAsync(
      COMPASS_PROBE_TIMEOUT_MS - COMPASS_NULL_EVENT_GRACE_MS * 2,
    );
    expect(result).toBe("incapable");
    await expect(probe.ready).resolves.toBe("incapable");
  });

  it("clears a pending null-reading grace timer on dispose", async () => {
    vi.useFakeTimers();
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: false,
      isIOS: false,
    });

    let result = null;
    probe.ready.then((value) => {
      result = value;
    });

    target.emit("deviceorientationabsolute", { alpha: null, absolute: true });
    expect(target.totalListeners()).toBe(2);

    probe.dispose();
    expect(target.totalListeners()).toBe(0);

    // The grace timer must not fire after disposal; `ready` stays pending by
    // design.
    await vi.advanceTimersByTimeAsync(COMPASS_PROBE_TIMEOUT_MS * 2);
    expect(result).toBeNull();
  });

  it("treats dispose after settling as a no-op", async () => {
    const target = createFakeTarget();
    const probe = createCompassCapabilityProbe({
      target,
      hasPermissionRequest: false,
    });

    target.emit("deviceorientationabsolute", { alpha: 10, absolute: true });
    await expect(probe.ready).resolves.toBe("capable");

    expect(() => probe.dispose()).not.toThrow();
    await expect(probe.ready).resolves.toBe("capable");
  });
});
