// Silent boot-time compass-hardware detection.
//
// DeviceOrientationEvent existing is not evidence of compass hardware: desktop
// Chrome exposes the constructor but only emits a relative (non-compass)
// reading, never a usable heading. Nor is the requestPermission API hardware
// evidence: desktop Chrome 151+ ships it without a compass. The reliable test
// is therefore to wait briefly for a valid absolute heading event, with a
// bounded timeout. An absolute event carrying null sensor data is treated as
// negative evidence after a short grace, so a compass-less desktop settles
// quickly instead of waiting out the full timeout.

/** How long the probe waits for a valid heading event before giving up. */
export const COMPASS_PROBE_TIMEOUT_MS = 2500;

/**
 * How long an absolute event with null sensor data waits for a valid heading
 * before it counts as negative evidence.
 */
export const COMPASS_NULL_EVENT_GRACE_MS = 250;

/**
 * Whether the navigator describes an iOS or iPadOS device.
 *
 * iPadOS 13+ reports a desktop macOS user agent, so the `MacIntel` platform
 * with multi-touch is treated as iPadOS. Desktop macOS reports `MacIntel` with
 * no touch points and is not iOS.
 *
 * @param {Navigator} [navigatorLike]
 * @returns {boolean}
 */
export const isIOSDevice = (navigatorLike) => {
  if (!navigatorLike) return false;

  const userAgent =
    typeof navigatorLike.userAgent === "string" ? navigatorLike.userAgent : "";
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;

  if (
    navigatorLike.platform === "MacIntel" &&
    Number(navigatorLike.maxTouchPoints) > 1
  )
    return true;

  return navigatorLike.userAgentData?.platform === "iOS";
};

/**
 * Whether a DeviceOrientation event carries a usable compass heading.
 *
 * Requires a finite numeric alpha, or a finite numeric iOS
 * `webkitCompassHeading`. A relative generic reading is rejected unless it
 * carries a numeric `webkitCompassHeading`. Null or undefined sensor data
 * cannot authorise capability.
 *
 * @param {DeviceOrientationEvent} event
 * @returns {boolean}
 */
export const isValidHeadingEvent = (event) => {
  if (!event) return false;

  const hasAlpha =
    typeof event.alpha === "number" && Number.isFinite(event.alpha);
  const hasWebkitHeading =
    typeof event.webkitCompassHeading === "number" &&
    Number.isFinite(event.webkitCompassHeading);

  if (!hasAlpha && !hasWebkitHeading) return false;

  // Skip relative (non-compass) readings from the generic event, unless the
  // event carries a webkitCompassHeading (iOS Safari).
  if ("absolute" in event && !event.absolute && !hasWebkitHeading) return false;

  return true;
};

/**
 * Whether an event is the desktop-Chrome null-reading signature: an absolute
 * orientation event with a null alpha and no numeric webkit heading.
 *
 * @param {DeviceOrientationEvent} event
 * @returns {boolean}
 */
const isNullOrientationEvent = (event) => {
  if (!event || event.alpha !== null) return false;

  const absolute =
    event.absolute === true || event.type === "deviceorientationabsolute";
  if (!absolute) return false;

  return !(
    typeof event.webkitCompassHeading === "number" &&
    Number.isFinite(event.webkitCompassHeading)
  );
};

/**
 * Probe silently for usable compass hardware.
 *
 * Resolves `'capable'` on the first valid heading event, or `'incapable'` when
 * an absolute null-reading event has stood unrefuted for a short grace period,
 * or when no valid event arrives within `timeoutMs`. The
 * `__ogisCompassCapable` boot override always wins. An iOS-style permission API
 * short-circuits the probe only on iOS/iPadOS, where the sensor is gated behind
 * that permission; on every other platform the API is not hardware evidence and
 * the probe listens normally. Interpreters must treat a positive result as
 * sticky: a positive finding is never downgraded.
 *
 * @param {Object} [options]
 * @param {EventTarget|null} [options.target] - Defaults to `window`.
 * @param {boolean} [options.hasPermissionRequest] - Defaults to the presence of
 *   `DeviceOrientationEvent.requestPermission`.
 * @param {boolean} [options.isIOS] - Defaults to detecting iOS from the probe
 *   target's navigator.
 * @param {number} [options.timeoutMs]
 * @param {number} [options.nullGraceMs]
 * @returns {{ ready: Promise<'capable'|'incapable'>, dispose: () => void }}
 */
export const createCompassCapabilityProbe = ({
  target,
  hasPermissionRequest,
  isIOS,
  timeoutMs = COMPASS_PROBE_TIMEOUT_MS,
  nullGraceMs = COMPASS_NULL_EVENT_GRACE_MS,
} = {}) => {
  const probeTarget =
    target === undefined && typeof window !== "undefined" ? window : target;
  const navigatorLike =
    probeTarget?.navigator ??
    (typeof navigator !== "undefined" ? navigator : undefined);
  const iosDevice = isIOS ?? isIOSDevice(navigatorLike);
  const requiresPermission =
    hasPermissionRequest ??
    (typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function");

  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  let settled = false;
  let disposed = false;
  let timeoutId = null;
  let nullGraceId = null;

  const removeListeners = () => {
    if (!probeTarget) return;
    probeTarget.removeEventListener("deviceorientationabsolute", onOrientation);
    probeTarget.removeEventListener("deviceorientation", onOrientation);
  };

  const clearTimer = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const clearNullGrace = () => {
    if (nullGraceId !== null) {
      clearTimeout(nullGraceId);
      nullGraceId = null;
    }
  };

  const cleanup = () => {
    removeListeners();
    clearTimer();
    clearNullGrace();
  };

  const settle = (result) => {
    if (settled || disposed) return;
    settled = true;
    cleanup();
    resolveReady(result);
  };

  const scheduleNullSettle = () => {
    if (settled || disposed || nullGraceId !== null) return;
    nullGraceId = setTimeout(() => {
      nullGraceId = null;
      settle("incapable");
    }, nullGraceMs);
  };

  const onOrientation = (event) => {
    if (isValidHeadingEvent(event)) {
      settle("capable");
      return;
    }
    if (isNullOrientationEvent(event)) scheduleNullSettle();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cleanup();
  };

  if (!probeTarget) {
    settle("incapable");
    return { ready, dispose };
  }

  // E2E fixture override: pin the result without attaching listeners.
  if (typeof probeTarget.__ogisCompassCapable === "boolean") {
    settle(probeTarget.__ogisCompassCapable ? "capable" : "incapable");
    return { ready, dispose };
  }

  // On iOS/iPadOS a permission API implies a sensor-capable device, because
  // the platform gates the sensor behind that request; no prompt is made here
  // and permission is requested later inside a user gesture. Elsewhere the API
  // is not hardware proof — desktop Chrome 151+ exposes it without a compass —
  // so fall through and listen for a valid heading.
  if (iosDevice && requiresPermission) {
    settle("capable");
    return { ready, dispose };
  }

  probeTarget.addEventListener("deviceorientationabsolute", onOrientation, {
    passive: true,
  });
  probeTarget.addEventListener("deviceorientation", onOrientation, {
    passive: true,
  });
  timeoutId = setTimeout(() => settle("incapable"), timeoutMs);

  return { ready, dispose };
};
