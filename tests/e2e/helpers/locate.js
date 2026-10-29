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
 * Simulate iOS orientation permission gating before the document boots.
 *
 * Defines `DeviceOrientationEvent.requestPermission` as a stub that counts its
 * calls on `window.__orientationPermissionCalls` and resolves `result`. It also
 * removes `ondeviceorientationabsolute` so the app falls back to the generic
 * `deviceorientation` event, matching iOS Safari. Must be installed before the
 * document boots.
 *
 * @param {import('@playwright/test').Page} page
 * @param {"granted"|"denied"} [result]
 */
export const withIOSOrientationPermission = (page, result = "granted") =>
  page.addInitScript((permissionResult) => {
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
 * Dispatch a `pointerdown` on the map container (never on a control or panel),
 * which is where the restored-session compass retry is armed.
 */
export const tapMap = (page) =>
  page.locator(".ogis-map").dispatchEvent("pointerdown");

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
