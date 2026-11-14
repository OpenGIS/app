import { expect } from "@playwright/test";
import { DEMO } from "../../fixtures/demo.mjs";

/**
 * Shared Locate E2E helpers.
 *
 * Covers the pieces the locate and follow specs both need: permission storage
 * seeding, the new `?id=`-safe geolocation stub that can emit crafted fixes
 * (with speed/heading, which `context.setGeolocation` cannot), a compass-event
 * dispatcher, and the light camera-settle waits.
 */

/** The mocked geolocation fix shared by the camera specs: the demo centre. */
export const LOCATE_FIX = {
  latitude: DEMO.center.lat,
  longitude: DEMO.center.lng,
};

/** Clear locate (and view) storage before the document boots. */
export const withNoLocateStorage = (page) =>
  page.addInitScript(() => {
    localStorage.removeItem("ogis_locate_app");
    sessionStorage.removeItem("ogis_locate_app");
    localStorage.removeItem("ogis_view_app");
  });

/** Seed a stored locate grant so the confirmation modal is skipped. */
export const withGrantedLocateStorage = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      "ogis_locate_app",
      JSON.stringify({ permissionGranted: true }),
    );
  });

/** Seed an arbitrary locate value into localStorage before boot. */
export const withLocateSession = (page, value) =>
  page.addInitScript((stored) => {
    localStorage.setItem("ogis_locate_app", JSON.stringify(stored));
  }, value);

/**
 * Simulate Apple WebKit's inaccurate geolocation permission reporting.
 *
 * Safari can report `prompt` after the user has already granted access, so this
 * stubs an Apple vendor string and a permission query that always resolves
 * `prompt`. Must be installed before the document boots.
 */
export const withAppleWebKitPromptPermission = (page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      get: () => "Apple Computer, Inc.",
    });
    if (!navigator.permissions) {
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {},
      });
    }
    Object.defineProperty(navigator.permissions, "query", {
      configurable: true,
      value: async () => ({ state: "prompt" }),
    });
  });

/**
 * Simulate a stalled geolocation permission query.
 *
 * `navigator.permissions.query` returns a promise that never resolves, so the
 * app's bounded permission query is the only thing that can settle a restore.
 * The timeout override is exposed as
 * `window.__ogisLocatePermissionTimeoutMs`. Must be installed before the
 * document boots.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeoutMs]
 */
export const withHangingPermissionQuery = (page, timeoutMs = 50) =>
  page.addInitScript((timeout) => {
    window.__ogisLocatePermissionTimeoutMs = timeout;
    if (!navigator.permissions) {
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {},
      });
    }
    Object.defineProperty(navigator.permissions, "query", {
      configurable: true,
      value: () => new Promise(() => {}),
    });
  }, timeoutMs);

/**
 * Simulate a slow but successful geolocation permission query.
 *
 * `navigator.permissions.query` resolves `state` after `delayMs`, and the app's
 * own permission bound is widened to `timeoutMs` so the delayed query can still
 * settle. The call count is exposed as `window.__permissionQueryCalls`, and the
 * resolved count as `window.__permissionQueryResolved`, so a test can wait for
 * the restore to leave the permission query and park on the compass probe. Must
 * be installed before the document boots.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ delayMs?: number, state?: "granted"|"denied"|"prompt", timeoutMs?: number }} [options]
 */
export const withDelayedPermissionQuery = (
  page,
  { delayMs = 2500, state = "granted", timeoutMs = 6000 } = {},
) =>
  page.addInitScript(
    ({ delay, permissionState, timeout }) => {
      window.__permissionQueryCalls = 0;
      window.__permissionQueryResolved = 0;
      window.__ogisLocatePermissionTimeoutMs = timeout;
      if (!navigator.permissions) {
        Object.defineProperty(navigator, "permissions", {
          configurable: true,
          value: {},
        });
      }
      Object.defineProperty(navigator.permissions, "query", {
        configurable: true,
        value: () => {
          window.__permissionQueryCalls += 1;
          return new Promise((resolve) => {
            setTimeout(() => {
              window.__permissionQueryResolved += 1;
              resolve({ state: permissionState });
            }, delay);
          });
        },
      });
    },
    { delay: delayMs, permissionState: state, timeout: timeoutMs },
  );

/** Escape a literal string so it can be matched exactly inside a RegExp. */
export const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pattern matching one exact settled hash string (no accidental wildcards). */
export const expectedHashRegExp = (hash) => new RegExp(escapeRegExp(hash));

/**
 * Hash the one-shot orientation flight must settle to, derived live.
 *
 * The fitted zoom is computed at call time from the real map canvas (the same
 * `clientWidth`/`clientHeight` source the flight uses) and the mocked fix
 * latitude, calling the production helpers through the dev server's own module
 * graph — so the expectation follows the actual viewport and formula instead of
 * hardcoding a zoom. The trailing `/0/0` is the north-up reset the flight
 * applies. The helpers cannot be imported from Node here: `src/utils/orient.js`
 * resolves its defaults through the Vite `@` alias, which Playwright does not
 * map.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ latitude: number, longitude: number }} [fix]
 * @returns {Promise<string>} e.g. `#map=12/48.953134/-55.643057/0/0`
 */
export const orientHash = (page, fix = LOCATE_FIX) =>
  page.evaluate(async ({ latitude, longitude }) => {
    const { fitZoomForDisc, horizonDistanceMetres } =
      await import("/src/utils/orient.js");
    const { orientCameraDefaults } = await import("/src/defaults/maplibre.js");
    const { getMapInstance } = await import("/src/composables/useMap.js");
    const canvas = getMapInstance("app").getCanvas();
    const { clientWidth: widthPx, clientHeight: heightPx } = canvas;
    const zoom = fitZoomForDisc({
      widthPx,
      heightPx,
      latitude,
      radiusMetres: horizonDistanceMetres(orientCameraDefaults.eyeHeightMetres),
      paddingPx: Math.round(
        Math.min(widthPx, heightPx) * orientCameraDefaults.fitPaddingFraction,
      ),
    });
    return `#map=${Math.round(zoom)}/${latitude.toFixed(6)}/${longitude.toFixed(6)}/0/0`;
  }, fix);

/**
 * Light wait: the camera has ARRIVED, without waiting for every tile to render.
 *
 * `useMap.js` writes the URL hash on MapLibre `moveend`, so matching the
 * EXPECTED hash proves the camera has settled. Anchoring on the expected value
 * (rather than generic hash stability) is what makes this race-safe: while a
 * fly/pan is pending the pre-move hash differs from `expectedHash`, so the wait
 * cannot resolve early even when it is called immediately after the click that
 * triggers the move; if the hash already matches, the move has already
 * completed and resolving at once is correct.
 *
 * `expect.poll` is used rather than `page.waitForURL` because the app updates
 * the hash with `history.replaceState` (a same-document update).
 *
 * @param {import('@playwright/test').Page} page
 * @param {RegExp} expectedHash - hash pattern the camera must reach.
 * @param {number} [timeout]
 */
export const waitForCameraSettle = async (
  page,
  expectedHash,
  timeout = 30000,
) => {
  await expect
    .poll(() => page.url(), {
      timeout,
      message: `camera did not settle to ${expectedHash}`,
    })
    .toMatch(expectedHash);
};

/**
 * Install a geolocation stub whose fixes are emitted from the test.
 *
 * `context.setGeolocation` reports a position but always with a null
 * `speed`/`heading`; this stub keeps the watcher callbacks on the page so a
 * test can publish crafted fixes carrying a real speed and heading — the
 * inputs the follow camera's speed-driven pose depends on. Watch ids are
 * tracked so `clearWatch` on stop is exercised for real.
 *
 * @param {import('@playwright/test').Page} page
 */
export const installGeolocationMock = (page) =>
  page.addInitScript(() => {
    const watchers = new Map();
    let nextId = 1;
    window.__geo = {
      emit(coords) {
        const position = { coords, timestamp: performance.now() };
        for (const watcher of watchers.values()) watcher.success(position);
      },
      fail(code) {
        for (const watcher of watchers.values()) watcher.error({ code });
      },
      count: () => watchers.size,
      lastOptions() {
        const latest = [...watchers.values()].pop();
        return latest ? (latest.options ?? null) : null;
      },
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition(success, error, options) {
          const id = nextId++;
          watchers.set(id, { success, error, options });
          return id;
        },
        clearWatch(id) {
          watchers.delete(id);
        },
        getCurrentPosition(success) {
          success?.(null);
        },
      },
    });
  });

/** Emit a crafted fix to every active watcher. */
export const emitFix = (
  page,
  { lat, lng, speed = null, heading = null, accuracy = 10 },
) =>
  page.evaluate((coords) => window.__geo.emit(coords), {
    latitude: lat,
    longitude: lng,
    speed,
    heading,
    accuracy,
  });

/** Emit a geolocation error (`{ code }`) to every active watcher. */
export const emitGeoError = (page, code) =>
  page.evaluate((c) => window.__geo.fail(c), code);

/**
 * Dispatch an absolute deviceorientation event that yields a true-north
 * compass bearing of `bearingDeg`. Absolute `alpha` runs counter-clockwise
 * from north, so the app reverses it (`(360 - alpha) % 360`).
 */
export const dispatchCompass = (page, bearingDeg) =>
  page.evaluate((bearing) => {
    const event = new DeviceOrientationEvent("deviceorientationabsolute", {
      alpha: (360 - bearing) % 360,
      beta: 0,
      gamma: 0,
      absolute: true,
    });
    window.dispatchEvent(event);
  }, bearingDeg);

/**
 * Start a live compass stream: dispatch the bearing immediately and then every
 * `intervalMs`. Real devices stream orientation continuously; a single event is
 * insufficient while following because `useLocate` clears the heading after ~8 s
 * without an event, and any slow actionability wait can exceed that. The
 * interval handle is stored on the page so {@link stopCompassStream} can clear
 * it.
 */
export const startCompassStream = (page, bearingDeg, intervalMs = 1000) =>
  page.evaluate(
    ({ bearing, interval }) => {
      const dispatch = () => {
        const event = new DeviceOrientationEvent("deviceorientationabsolute", {
          alpha: (360 - bearing) % 360,
          beta: 0,
          gamma: 0,
          absolute: true,
        });
        window.dispatchEvent(event);
      };
      if (window.__compassStream) clearInterval(window.__compassStream);
      dispatch();
      window.__compassStream = setInterval(dispatch, interval);
    },
    { bearing: bearingDeg, interval: intervalMs },
  );

/**
 * Declare compass-hardware capability before the document boots.
 *
 * Sets the `__ogisCompassCapable` boot override read by the capability probe,
 * so a spec can pin Follow availability without waiting out the real probe.
 * Must be installed before the document boots.
 *
 * @param {import('@playwright/test').Page} page
 * @param {boolean} [capable]
 */
export const withCompassCapability = (page, capable = true) =>
  page.addInitScript((value) => {
    window.__ogisCompassCapable = value;
  }, capable);

/**
 * Stretch (or shrink) the boot compass-capability probe window.
 *
 * Sets the `__ogisCompassProbeTimeoutMs` override read when the boot probe is
 * created. A long window keeps capability `unknown` while a spec enters
 * Following, so a later timeout can exercise the late-downgrade path.
 *
 * Desktop Chrome itself emits a null-reading orientation event, which now
 * settles the probe incapable after a short grace. Those events are suppressed
 * by default so the stretched window really stays open. A spec that needs to
 * drive the probe itself dispatches through {@link dispatchNullCompassReading},
 * which releases the suppression in the same synchronous step as the controlled
 * event — native/background events still cannot settle the probe first. Passing
 * `allowOrientationEvents: true` releases them from boot instead. Must be
 * installed before the document boots.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} ms - Finite positive timeout in milliseconds.
 * @param {{ allowOrientationEvents?: boolean }} [options]
 */
export const withCompassProbeTimeout = (
  page,
  ms,
  { allowOrientationEvents = false } = {},
) =>
  page.addInitScript(
    ({ timeout, allowEvents }) => {
      window.__ogisCompassProbeTimeoutMs = timeout;
      if (allowEvents) {
        window.__ogisCompassAllowOrientationEvents = true;
        return;
      }

      // Registered before the app's probe listener: stop native null readings
      // from settling a probe the spec deliberately holds open. The flag is the
      // deterministic release an explicit dispatch sets just before firing.
      const suppress = (event) => {
        if (window.__ogisCompassAllowOrientationEvents === true) return;
        event.stopImmediatePropagation();
      };
      window.addEventListener("deviceorientation", suppress, true);
      window.addEventListener("deviceorientationabsolute", suppress, true);
    },
    { timeout: ms, allowEvents: allowOrientationEvents },
  );

/**
 * Dispatch desktop Chrome's null absolute orientation signature.
 *
 * Releases the native-event suppression installed by
 * {@link withCompassProbeTimeout} in the same synchronous step as the dispatch,
 * so no native/background event can settle the probe between the release and the
 * controlled event. Returns the capability read immediately before the dispatch,
 * letting a spec assert the probe was still `unknown` and therefore that the
 * null-event grace — not the probe timeout — settled it.
 *
 * The signature is an absolute event whose alpha, beta and gamma are all null,
 * with no `webkitCompassHeading`. The fields are redefined as own properties so
 * the WebIDL constructor cannot coerce or omit them on another platform; the
 * final reading is recorded on `window.__ogisLastNullReading` for diagnostics
 * and the helper throws if it is not null/null/null/true.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<'unknown'|'capable'|'incapable'>} Capability before dispatch.
 */
export const dispatchNullCompassReading = (page) =>
  page.evaluate(async () => {
    const { useLocate } = await import("/src/composables/useLocate.js");
    const capabilityBefore = useLocate("app").compassCapability.value;
    window.__ogisCompassAllowOrientationEvents = true;
    const event = new DeviceOrientationEvent("deviceorientationabsolute", {
      alpha: null,
      beta: null,
      gamma: null,
      absolute: true,
    });

    // The WebIDL constructor is allowed to coerce or omit these fields, and
    // has been observed to leave the reading unsettled on Linux headless
    // Chrome. Pin the signature as own properties so every platform delivers
    // the identical null reading regardless of constructor behaviour.
    for (const [key, value] of [
      ["alpha", null],
      ["beta", null],
      ["gamma", null],
      ["absolute", true],
    ]) {
      Object.defineProperty(event, key, {
        configurable: true,
        enumerable: true,
        value,
      });
    }

    const reading = {
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      absolute: event.absolute,
    };
    window.__ogisLastNullReading = reading;
    if (
      reading.alpha !== null ||
      reading.beta !== null ||
      reading.gamma !== null ||
      reading.absolute !== true
    ) {
      throw new Error(
        `dispatchNullCompassReading built the wrong signature: ${JSON.stringify(reading)}`,
      );
    }

    window.dispatchEvent(event);
    return capabilityBefore;
  });

/**
 * Simulate an iOS device with gesture-gated orientation permission.
 *
 * Emulates an iPhone/iPadOS navigator in the same init script so the production
 * iOS platform gate (`isIOSDevice`) is genuinely satisfied — the fixture does
 * not pin the boot probe result. The `requestPermission` stub counts its calls
 * on `window.__orientationPermissionCalls` and resolves `result`. It also
 * removes `ondeviceorientationabsolute` so the app falls back to the generic
 * `deviceorientation` event, matching iOS Safari. `navigator.vendor` is left
 * untouched so the fixture never triggers the Apple WebKit restore paths. A
 * later `withCompassCapability(false)` init script still overrides the probe.
 * Must be installed before the document boots.
 *
 * @param {import('@playwright/test').Page} page
 * @param {"granted"|"denied"} [result]
 */
export const withIOSOrientationPermission = (page, result = "granted") =>
  page.addInitScript((permissionResult) => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () =>
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "iPhone",
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5,
    });
    window.__orientationPermissionCalls = 0;
    Object.defineProperty(window.DeviceOrientationEvent, "requestPermission", {
      configurable: true,
      value: () => {
        window.__orientationPermissionCalls += 1;
        return Promise.resolve(permissionResult);
      },
    });
    delete window.ondeviceorientationabsolute;
  }, result);

/**
 * Simulate an iOS orientation permission prompt that never settles on its own.
 *
 * Like {@link withIOSOrientationPermission}, but `requestPermission` returns a
 * promise held until the test calls {@link resolveIOSOrientationPermission}.
 * It emulates the iOS navigator in the same init script, so the production
 * platform gate — not a pinned probe result — recognises the device. The
 * pending state is exposed as `window.__orientationPermissionPending`. Must be
 * installed before the document boots.
 *
 * @param {import('@playwright/test').Page} page
 */
export const withHangingIOSOrientationPermission = (page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () =>
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "iPhone",
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5,
    });
    window.__orientationPermissionCalls = 0;
    window.__orientationPermissionPending = false;
    window.__orientationPermissionResolve = null;
    Object.defineProperty(window.DeviceOrientationEvent, "requestPermission", {
      configurable: true,
      value: () => {
        window.__orientationPermissionCalls += 1;
        window.__orientationPermissionPending = true;
        return new Promise((resolve) => {
          window.__orientationPermissionResolve = resolve;
        });
      },
    });
    delete window.ondeviceorientationabsolute;
  });

/**
 * Simulate desktop Chrome's orientation permission API before the document
 * boots.
 *
 * Chrome 151+ exposes `DeviceOrientationEvent.requestPermission` on desktop
 * without compass hardware. The stub counts its calls on
 * `window.__orientationPermissionCalls` and resolves `granted`, but it does not
 * pin capability or hide `deviceorientationabsolute`: the real probe must
 * listen and settle on the sensor events. Must be installed before the document
 * boots.
 *
 * @param {import('@playwright/test').Page} page
 */
export const withDesktopChromeOrientationPermission = (page) =>
  page.addInitScript(() => {
    window.__orientationPermissionCalls = 0;
    Object.defineProperty(window.DeviceOrientationEvent, "requestPermission", {
      configurable: true,
      value: () => {
        window.__orientationPermissionCalls += 1;
        return Promise.resolve("granted");
      },
    });
  });

/**
 * Settle a prompt started by {@link withHangingIOSOrientationPermission}.
 *
 * @param {import('@playwright/test').Page} page
 * @param {"granted"|"denied"} [result]
 * @returns {Promise<boolean>} Whether a pending prompt was resolved.
 */
export const resolveIOSOrientationPermission = (page, result = "granted") =>
  page.evaluate((permissionResult) => {
    const resolve = window.__orientationPermissionResolve;
    if (typeof resolve !== "function") return false;
    window.__orientationPermissionResolve = null;
    window.__orientationPermissionPending = false;
    resolve(permissionResult);
    return true;
  }, result);

/** Dispatch one iOS-style `deviceorientation` event with a compass heading. */
export const dispatchIOSCompass = (page, headingDeg) =>
  page.evaluate((heading) => {
    const event = new DeviceOrientationEvent("deviceorientation", {
      alpha: 0,
      beta: 0,
      gamma: 0,
    });
    Object.defineProperty(event, "webkitCompassHeading", {
      value: heading,
      writable: false,
    });
    window.dispatchEvent(event);
  }, headingDeg);

/**
 * Start a live iOS compass stream: dispatch the heading immediately and then
 * every `intervalMs` through the same `deviceorientation` shape as
 * {@link dispatchIOSCompass}. Real devices stream orientation continuously; a
 * one-shot event is cleared by the ~8 s heading watchdog while a software
 * renderer finishes its first positive bearing/pitch assertions. The interval
 * handle is stored on the page so {@link stopIOSCompassStream} can clear it.
 */
export const startIOSCompassStream = (page, headingDeg, intervalMs = 1000) =>
  page.evaluate(
    ({ heading, interval }) => {
      const dispatch = () => {
        const event = new DeviceOrientationEvent("deviceorientation", {
          alpha: 0,
          beta: 0,
          gamma: 0,
        });
        Object.defineProperty(event, "webkitCompassHeading", {
          value: heading,
          writable: false,
        });
        window.dispatchEvent(event);
      };
      if (window.__iosCompassStream) clearInterval(window.__iosCompassStream);
      dispatch();
      window.__iosCompassStream = setInterval(dispatch, interval);
    },
    { heading: headingDeg, interval: intervalMs },
  );

/** Stop the live iOS compass stream started by {@link startIOSCompassStream}. */
export const stopIOSCompassStream = (page) =>
  page.evaluate(() => {
    if (window.__iosCompassStream) clearInterval(window.__iosCompassStream);
    window.__iosCompassStream = null;
  });

/**
 * Dispatch a `click` on the map container (never on a control or panel), which
 * is where the restored-session compass retry is armed. The retry listens for
 * `click` because WebKit only treats a mouse `pointerdown` as transient
 * activation — a touch tap needs `click` (or an equivalent non-mouse event).
 */
export const tapMap = (page) =>
  page.locator(".ogis-map").dispatchEvent("click");

/**
 * Read the heading marker's current rotation in degrees, or null while the
 * marker is absent or being re-synced.
 */
export const headingRotation = (page) =>
  page
    .locator(".ogis-locate-heading")
    .evaluate((el) => {
      const transform = el.style.transform || "";
      const match = transform.match(/rotateZ\(([^)]+)deg\)/);
      return match ? parseFloat(match[1]) : null;
    })
    .catch(() => null);

/** Stop the live compass stream started by {@link startCompassStream}. */
export const stopCompassStream = (page) =>
  page.evaluate(() => {
    if (window.__compassStream) clearInterval(window.__compassStream);
    window.__compassStream = null;
  });
