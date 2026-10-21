import { ref, computed, inject } from "vue";
import maplibregl from "maplibre-gl";
import { magvar } from "magvar";
import { useStorage } from "@/composables/useStorage";
import { getMapInstance } from "@/composables/useMap";
import { useOrientView } from "@/composables/useOrientView";
import { useFollowCamera } from "@/composables/useFollowCamera";
import { deriveCourse, deriveSpeed } from "@/utils/follow";
import { emitter } from "@/emitter.js";
import { Position } from "@/classes/Position";

// Per-instance cache: instanceId -> instance state
const locateCache = new Map();

// Smoothing factor for compass heading (0 = no update, 1 = no smoothing).
// 0.15 is a gentle low-pass that removes jitter while still tracking rotation.
const HEADING_SMOOTH = 0.15;

// Ground speed above which the fix counts as moving, in metres per second
// (~1.8 km/h). Below it the reported heading is untrustworthy and the derived
// course (or the last held course) is used instead.
const MOVING_SPEED_MPS = 0.5;

// Far navigations can take ~20 s for tiles and terrain to settle, and MapLibre
// may never emit the `idle` event that normally re-syncs the markers. Retry on
// a bounded loop after each `moveend` until the map reports itself settled.
// Far camera jumps can leave the map unloaded for far longer on slow tile
// networks (~50-60 s observed), so the window is deliberately generous.
const MARKER_RETRY_INTERVAL_MS = 750;
const MARKER_RETRY_TIMEOUT_MS = 120000;

/** Interpolate between two angles (degrees) handling the 0°/360° wrap. */
function smoothAngle(current, next, factor) {
  let diff = next - current;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (current + diff * factor + 360) % 360;
}

/**
 * Composable for the Locate feature.
 *
 * Manages GPS tracking state, map markers, and the permission flow.
 * State is cached per app instance and shared across all callers.
 *
 * @returns {{ mode: import('vue').ComputedRef<'active'|'following'|'error'|null>, position: import('vue').ComputedRef<Position|null>, compassHeading: import('vue').ComputedRef<number|null>, headingLost: import('vue').ComputedRef<boolean>, permissionGranted: import('vue').ComputedRef<boolean>, showConfirmModal: import('vue').Ref<boolean>, showErrorModal: import('vue').Ref<boolean>, cycle: Function, startFollowing: Function, confirmLocate: Function, requestPermission: Function, stop: Function, retryOrientation: Function, retryPosition: Function }}
 */
export const useLocate = (explicitInstanceId) => {
  const instanceId = explicitInstanceId ?? inject("ogisAppId", "app");

  if (!locateCache.has(instanceId)) {
    locateCache.set(instanceId, {
      storage: useStorage("locate", { permissionGranted: false }, instanceId),
      mode: ref(null), // null | 'active' | 'following' | 'error'
      position: ref(null), // Position | null
      compassHeading: ref(null), // smoothed DeviceOrientation compass bearing
      headingLost: ref(false), // true when orientation events have stopped arriving
      smoothedHeading: null, // internal: raw float used for smoothing
      magneticDeclination: 0, // degrees East; corrects webkitCompassHeading to true north
      lastFix: null, // { lat, lng, atMs } of the previous accepted fix
      lastCourseDeg: null, // last valid course over ground, held across nulls
      lastSpeedMps: 0, // last ground speed, in metres per second
      needsInitialOrient: false, // true until the first fix after activation
      generation: 0, // incremented on start/stop; discards stale callbacks
      mapReadyListener: null, // pending map:ready retry for the orient flight
      headingTimeoutId: null, // timeout handle for heading-loss detection
      showConfirmModal: ref(false),
      showErrorModal: ref(false),
      pendingCallback: null, // called when user confirms the permission modal
      watcherId: null,
      orientationListener: null, // { eventName, handler }
      positionMarker: null,
      headingMarker: null,
      idleMap: null, // map instance with the bound idle listener
      idleHandler: null, // bound idle handler, used to detach it
      moveendMap: null, // map instance with the bound moveend listener
      moveendHandler: null, // bound moveend handler, used to detach it
      retryTimerId: null, // interval handle for the post-move marker re-sync
      retryDeadline: 0, // epoch ms when the retry loop gives up (0 = inactive)
    });
  }

  const c = locateCache.get(instanceId);

  const { orientView } = useOrientView(instanceId);
  const followCamera = useFollowCamera(instanceId);

  // ─── Following ───────────────────────────────────────────────────────────

  /** The current unrounded compass heading, or null when unavailable/lost. */
  const currentCompassHeading = () =>
    !c.headingLost.value && c.smoothedHeading !== null
      ? c.smoothedHeading
      : null;

  /** Clear the per-fix derivation state (baseline fix, course and speed). */
  const resetDerivation = () => {
    c.lastFix = null;
    c.lastCourseDeg = null;
    c.lastSpeedMps = 0;
  };

  /**
   * Feed the follow camera a position with its motion.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {number} speedMps - Reported or derived ground speed, m/s.
   * @param {number|null} courseDeg - Current course over ground, or null.
   * @param {number} timestampMs - Fix time, from `performance.now()`.
   */
  const feedFollowCamera = (lat, lng, speedMps, courseDeg, timestampMs) => {
    followCamera.setTarget({
      lat,
      lng,
      compassHeading: currentCompassHeading(),
      courseDeg,
      speedKmh: speedMps * 3.6,
      timestampMs,
    });
  };

  // ─── Map markers ─────────────────────────────────────────────────────────

  const createPositionElement = () => {
    const el = document.createElement("div");
    el.className = "ogis-locate-position";
    el.innerHTML = `<svg width="48" height="48" fill="currentColor"><use href="#position"/></svg>`;
    return el;
  };

  const createHeadingElement = () => {
    const el = document.createElement("div");
    el.className = "ogis-locate-heading";
    el.innerHTML = `<svg width="48" height="48" fill="currentColor"><use href="#position-heading"/></svg>`;
    return el;
  };

  /** Detach the map idle listener bound for marker recovery, if any. */
  const clearIdleListener = () => {
    if (c.idleMap && c.idleHandler) {
      c.idleMap.off("idle", c.idleHandler);
    }
    c.idleMap = null;
    c.idleHandler = null;
  };

  /** Stop the bounded marker re-sync loop, if one is running. */
  const clearMarkerRetry = () => {
    if (c.retryTimerId !== null) {
      clearInterval(c.retryTimerId);
      c.retryTimerId = null;
    }
    c.retryDeadline = 0;
  };

  /** Detach the map moveend listener bound for marker recovery, if any. */
  const clearMoveendListener = () => {
    if (c.moveendMap && c.moveendHandler) {
      c.moveendMap.off("moveend", c.moveendHandler);
    }
    c.moveendMap = null;
    c.moveendHandler = null;
    clearMarkerRetry();
  };

  /** Detach every marker sync listener and stop its retry loop. */
  const detachMarkerSync = () => {
    clearIdleListener();
    clearMoveendListener();
    clearMarkerRetry();
  };

  /**
   * Re-sync the markers after each move, then poll until the map settles.
   *
   * A far navigation may never emit `idle`, and a single sync at `moveend` can
   * land before tiles and terrain finish loading. The interval is cleared by a
   * new `moveend` (which restarts the window), on teardown, or at the deadline.
   */
  const startMarkerRetry = (map) => {
    clearMarkerRetry();
    c.retryDeadline = Date.now() + MARKER_RETRY_TIMEOUT_MS;
    c.retryTimerId = setInterval(() => {
      syncMarkers();
      if (map.loaded() && !map.isMoving()) {
        clearMarkerRetry();
      } else if (Date.now() >= c.retryDeadline) {
        clearMarkerRetry();
      }
    }, MARKER_RETRY_INTERVAL_MS);
  };

  /**
   * Bind a single moveend listener per map instance to re-sync the markers.
   *
   * Unlike the idle listener this fires even when a far navigation never
   * reaches idle, so it both syncs once immediately and arms startMarkerRetry.
   */
  const ensureMoveendListener = (map = getMapInstance(instanceId)) => {
    if (!map || c.moveendMap === map) return;
    clearMoveendListener();
    c.moveendMap = map;
    c.moveendHandler = () => {
      // Arm the retry first: an immediate sync can throw (MapLibre's terrain
      // DEM RangeError), and the retry must still recover the markers.
      startMarkerRetry(map);
      try {
        syncMarkers();
      } catch {
        // The retry loop will try again.
      }
    };
    map.on("moveend", c.moveendHandler);
  };

  /**
   * Bind a single idle listener per map instance to re-sync the markers.
   *
   * At far-away positions MapLibre's ScaleControl move handler can throw a
   * terrain DEM RangeError ("Out of range source coordinates for DEM data").
   * That aborts the map's move dispatch before Marker._update runs, leaving a
   * static fix's HTML marker stuck at a stale, off-screen projection with no
   * further move event to correct it. Re-syncing once tiles settle recovers it.
   */
  const ensureIdleListener = (map = getMapInstance(instanceId)) => {
    if (!map || c.idleMap === map) return;
    clearIdleListener();
    c.idleMap = map;
    c.idleHandler = () => syncMarkers();
    map.on("idle", c.idleHandler);
  };

  /**
   * Sync both markers to the current position and compass heading.
   * Called after every position or orientation update.
   */
  const syncMarkers = () => {
    // Never create or refresh markers once tracking has stopped or errored.
    // A late orientation/position callback must not resurrect a marker.
    if (c.mode.value === null || c.mode.value === "error") return;
    if (!c.position.value) return;
    const map = getMapInstance(instanceId);
    if (!map) return;

    const { lng, lat } = c.position.value;
    const lngLat = [lng, lat];

    if (c.compassHeading.value !== null) {
      // Heading available — show heading marker only
      if (c.positionMarker) {
        c.positionMarker.remove();
        c.positionMarker = null;
      }
      if (!c.headingMarker) {
        c.headingMarker = new maplibregl.Marker({
          element: createHeadingElement(),
          anchor: "center",
          rotationAlignment: "map",
        })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        c.headingMarker.setLngLat(lngLat);
      }
      c.headingMarker.setRotation(c.compassHeading.value);
    } else {
      // No heading — show position marker only
      if (c.headingMarker) {
        c.headingMarker.remove();
        c.headingMarker = null;
      }
      if (!c.positionMarker) {
        c.positionMarker = new maplibregl.Marker({
          element: createPositionElement(),
          anchor: "center",
        })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        c.positionMarker.setLngLat(lngLat);
      }
    }

    // A marker now exists, so arm the recovery re-sync for missed move events.
    ensureIdleListener(map);
    ensureMoveendListener(map);
  };

  const removeMarkers = () => {
    detachMarkerSync();
    c.positionMarker?.remove();
    c.positionMarker = null;
    c.headingMarker?.remove();
    c.headingMarker = null;
  };

  // ─── DeviceOrientation ────────────────────────────────────────────────────

  /**
   * Request DeviceOrientationEvent permission on iOS (Safari ≥ 13).
   * On other platforms the API is available without an explicit grant.
   */
  const requestOrientationPermission = async () => {
    if (typeof DeviceOrientationEvent?.requestPermission === "function") {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        return result === "granted";
      } catch {
        return false;
      }
    }
    return true;
  };

  const startOrientationWatching = () => {
    if (c.orientationListener) return; // already listening

    // Schedule a timeout that fires if no valid heading event arrives.
    // Resets on every valid event; used to detect iOS permission expiry or
    // hardware becoming unavailable.
    const scheduleHeadingTimeout = () => {
      clearTimeout(c.headingTimeoutId);
      c.headingTimeoutId = setTimeout(() => {
        c.headingLost.value = true;
        c.compassHeading.value = null;
        syncMarkers();
      }, 8000);
    };

    const handler = (event) => {
      if (event.alpha === null) return;
      // Skip relative (non-compass) readings from the generic event,
      // unless the event carries a webkitCompassHeading (iOS Safari).
      if (
        "absolute" in event &&
        !event.absolute &&
        typeof event.webkitCompassHeading !== "number"
      )
        return;

      // Valid reading received — clear any loss state and reset the watchdog.
      c.headingLost.value = false;
      scheduleHeadingTimeout();

      // iOS Safari provides a true compass heading via webkitCompassHeading
      // (0-360° clockwise from magnetic north). We correct it to true north by
      // adding the magnetic declination for the user's current position.
      // For absolute events (Android), alpha is already relative to true north,
      // so we just convert counter-clockwise to clockwise.
      const bearing =
        typeof event.webkitCompassHeading === "number"
          ? (event.webkitCompassHeading + c.magneticDeclination + 360) % 360
          : (360 - event.alpha) % 360;

      if (c.smoothedHeading === null) {
        c.smoothedHeading = bearing;
      } else {
        c.smoothedHeading = smoothAngle(
          c.smoothedHeading,
          bearing,
          HEADING_SMOOTH,
        );
      }
      c.compassHeading.value = Math.round(c.smoothedHeading);
      syncMarkers();
    };

    // deviceorientationabsolute always provides an absolute compass bearing.
    // Fall back to deviceorientation on devices that don't fire the absolute event.
    const eventName =
      "ondeviceorientationabsolute" in window
        ? "deviceorientationabsolute"
        : "deviceorientation";

    window.addEventListener(eventName, handler);
    c.orientationListener = { eventName, handler };
    // Note: the watchdog is NOT started here. It only starts after the first
    // valid heading event fires, so devices without compass hardware (desktops,
    // some tablets) never produce a false "Compass unavailable" alert.
  };

  const stopOrientationWatching = () => {
    if (!c.orientationListener) return;
    window.removeEventListener(
      c.orientationListener.eventName,
      c.orientationListener.handler,
    );
    c.orientationListener = null;
    c.smoothedHeading = null;
    c.compassHeading.value = null;
    clearTimeout(c.headingTimeoutId);
    c.headingTimeoutId = null;
    c.headingLost.value = false;
  };

  // ─── Orientation flight ───────────────────────────────────────────────────

  /** Drop any pending map:ready retry for the orient flight. */
  const clearOrientRetry = () => {
    if (c.mapReadyListener) {
      emitter.off("map:ready", c.mapReadyListener);
      c.mapReadyListener = null;
    }
  };

  /**
   * Apply the one-shot orientation flight, exactly once per activation.
   *
   * Delegates the flight — the reset to a north-up, viewport-fitted
   * line-of-sight disc — to the orient facility, while retaining the one-shot
   * lifecycle here: the flag is only consumed when the map is ready and a
   * position exists, so a first fix that lands before map init is retained for
   * a later fix rather than being lost.
   */
  const applyOrientFlight = () => {
    if (!c.needsInitialOrient) return;
    if (!c.position.value) return;

    const { lng, lat } = c.position.value;
    if (!orientView({ target: { lat, lng } })) return;

    c.needsInitialOrient = false;
    clearOrientRetry();
  };

  /**
   * If the map is not ready yet, retry the orientation flight once `map:ready`
   * fires. Guards against a first fix arriving before MapLibre has
   * initialised (see applyOrientFlight). The listener is registered once.
   */
  const armOrientRetry = () => {
    if (getMapInstance(instanceId) || c.mapReadyListener) return;
    c.mapReadyListener = () => applyOrientFlight();
    emitter.once("map:ready", c.mapReadyListener);
  };

  // ─── Geolocation callbacks ────────────────────────────────────────────────

  /**
   * @param {GeolocationPosition} geoPos
   * @param {number} gen - generation captured by startWatching; stale
   *   callbacks from a stopped/superseded session are ignored.
   */
  const onPosition = (geoPos, gen) => {
    if (gen !== c.generation) return;
    // Ignore fixes that arrive after the user has stopped tracking.
    if (c.mode.value === null || c.mode.value === "error") return;

    if (!c.storage.permissionGranted) {
      c.storage.permissionGranted = true;
    }

    const { latitude, longitude, heading, accuracy, speed } = geoPos.coords;
    c.magneticDeclination = magvar(latitude, longitude);

    c.position.value = new Position({
      lat: latitude,
      lng: longitude,
      heading, // direction of travel (may be null at rest)
      accuracy,
      speed,
    });

    applyOrientFlight();
    syncMarkers();

    // Derive motion from the previous fix so the camera can chase between ~1 Hz
    // updates. The reported speed/heading are preferred while moving; the
    // derived values fill in otherwise, with the last valid course held across
    // a null derivation (GPS jitter at rest).
    const now = performance.now();
    const fix = { lat: latitude, lng: longitude };
    const previous = c.lastFix;
    const dtSec = previous ? (now - previous.atMs) / 1000 : 0;
    const derivedCourse = previous ? deriveCourse(previous, fix) : null;
    const derivedSpeedMps = previous ? deriveSpeed(previous, fix, dtSec) : null;
    c.lastFix = { lat: latitude, lng: longitude, atMs: now };

    const reportedSpeed =
      typeof speed === "number" && Number.isFinite(speed) ? speed : null;
    const reportedHeading =
      typeof heading === "number" && Number.isFinite(heading) ? heading : null;

    const speedMps =
      reportedSpeed !== null
        ? reportedSpeed
        : derivedSpeedMps !== null
          ? derivedSpeedMps
          : 0;
    c.lastSpeedMps = speedMps;

    const moving = speedMps > MOVING_SPEED_MPS;
    let courseDeg = null;
    if (moving && reportedHeading !== null) {
      courseDeg = reportedHeading;
    } else if (derivedCourse !== null) {
      courseDeg = derivedCourse;
    }
    courseDeg = courseDeg ?? c.lastCourseDeg;
    c.lastCourseDeg = courseDeg;

    if (c.mode.value === "following") {
      feedFollowCamera(latitude, longitude, speedMps, courseDeg, now);
    }
  };

  /**
   * @param {GeolocationPositionError} err
   * @param {number} gen - see onPosition; stale errors must not tear down a
   *   newer session (e.g. an old error clearing a freshly created watcher).
   */
  const onError = (err, gen) => {
    if (gen !== c.generation) return;
    c.generation++; // bump so any other in-flight callback is discarded
    clearOrientRetry();
    c.needsInitialOrient = false;
    followCamera.stop();
    resetDerivation();
    stopWatcher();
    stopOrientationWatching();
    removeMarkers();
    c.mode.value = "error";
    if (err.code === 1 /* PERMISSION_DENIED */) {
      c.showErrorModal.value = true;
    }
  };

  // ─── Internal helpers ─────────────────────────────────────────────────────

  const startWatching = async () => {
    if (!("geolocation" in navigator)) {
      c.mode.value = "error";
      return;
    }
    const gen = ++c.generation;
    c.mode.value = "active";
    c.needsInitialOrient = true;
    resetDerivation();
    armOrientRetry();

    // Request orientation permission (no-op on non-iOS) then start listening.
    // Both happen inside the same user-gesture call stack so iOS treats them
    // as a single permission prompt.
    await requestOrientationPermission();

    // A stop() (or a fresh startWatching) may have run during that await.
    // Abandon this generation so we neither orphan a watcher nor clobber
    // the newer session's state.
    if (gen !== c.generation) return;

    startOrientationWatching();

    c.watcherId = navigator.geolocation.watchPosition(
      (pos) => onPosition(pos, gen),
      (err) => onError(err, gen),
      { enableHighAccuracy: true },
    );
  };

  const stopWatcher = () => {
    if (c.watcherId !== null) {
      navigator.geolocation.clearWatch(c.watcherId);
      c.watcherId = null;
    }
  };

  // ─── Public actions ───────────────────────────────────────────────────────

  /**
   * Switch from active to following, taking the camera over immediately.
   *
   * Drops the one-shot orientation flight so a late fix cannot restart it
   * mid-follow, starts the follow camera and feeds it the last known fix.
   */
  const enterFollowing = () => {
    c.mode.value = "following";
    c.needsInitialOrient = false;
    clearOrientRetry();
    followCamera.start();
    const position = c.position.value;
    if (position) {
      feedFollowCamera(
        position.lat,
        position.lng,
        c.lastSpeedMps,
        c.lastCourseDeg,
        performance.now(),
      );
    }
  };

  /**
   * Cycle through states: inactive → active → following → inactive.
   * In the error state, re-opens the error modal instead.
   * On first use (no stored grant), shows the confirmation modal.
   */
  const cycle = () => {
    if (c.mode.value === "error") {
      c.showErrorModal.value = true;
      return;
    }

    if (c.mode.value === null) {
      requestPermission(startWatching);
    } else if (c.mode.value === "active") {
      enterFollowing();
    } else if (c.mode.value === "following") {
      stop();
    }
  };

  /**
   * Start following from any state, for programmatic callers.
   *
   * Already following: reported as started. Error: re-opens the error modal
   * without starting. Active: follows straight away. Inactive: requests
   * permission first, then starts watching and follows once a fix is tracked.
   * `onStarted` runs only when following actually began, so a cancelled
   * permission prompt, an unavailable geolocation API or a geolocation error
   * leaves the caller's state untouched.
   *
   * @param {Object} [options]
   * @param {Function} [options.onStarted] - Called once following has started.
   */
  const startFollowing = ({ onStarted } = {}) => {
    if (c.mode.value === "following") {
      onStarted?.();
      return;
    }

    if (c.mode.value === "error") {
      c.showErrorModal.value = true;
      return;
    }

    if (c.mode.value === "active") {
      enterFollowing();
      onStarted?.();
      return;
    }

    if (c.mode.value === null) {
      requestPermission(() => {
        // startWatching() sets the mode synchronously (active, or error when
        // geolocation is unavailable), before it awaits orientation permission.
        startWatching();
        if (c.mode.value === "active") enterFollowing();
        if (c.mode.value === "active" || c.mode.value === "following") {
          onStarted?.();
        }
      });
    }
  };

  /**
   * Request geolocation permission before running a callback.
   * If the user has already granted permission, the callback runs immediately.
   * Otherwise, the confirm modal is shown and the callback runs when the user confirms.
   */
  const requestPermission = (onConfirmed) => {
    if (c.storage.permissionGranted) {
      onConfirmed();
    } else {
      c.pendingCallback = onConfirmed;
      c.showConfirmModal.value = true;
    }
  };

  /** Called when the user confirms they understand the permission request. */
  const confirmLocate = () => {
    c.storage.permissionGranted = true;
    c.showConfirmModal.value = false;
    const cb = c.pendingCallback;
    c.pendingCallback = null;
    if (cb) cb();
  };

  /** Stop tracking and return to the inactive state. */
  const stop = () => {
    // Bump the generation first so any in-flight watcher callback (or a
    // startWatching still awaiting orientation permission) is superseded
    // and can no longer create a watcher or markers.
    c.generation++;
    clearOrientRetry();
    c.needsInitialOrient = false;
    followCamera.stop();
    resetDerivation();
    stopWatcher();
    stopOrientationWatching();
    removeMarkers();
    c.mode.value = null;
    c.position.value = null;
  };

  /**
   * Re-request orientation (compass) permission and restart watching.
   * Must be called within a user-gesture handler so iOS Safari grants the
   * DeviceOrientationEvent permission.
   */
  const retryOrientation = async () => {
    stopOrientationWatching();
    const granted = await requestOrientationPermission();
    if (granted) {
      c.headingLost.value = false;
      startOrientationWatching();
    } else {
      c.headingLost.value = true;
    }
  };

  /**
   * Re-request geolocation after a permission error.
   * Bypasses the confirmation modal since the user is explicitly retrying.
   */
  const retryPosition = async () => {
    c.mode.value = null;
    c.showErrorModal.value = false;
    await startWatching();
  };

  return {
    mode: computed(() => c.mode.value),
    position: computed(() => c.position.value),
    compassHeading: computed(() => c.compassHeading.value),
    headingLost: computed(() => c.headingLost.value),
    permissionGranted: computed(() => c.storage.permissionGranted),
    showConfirmModal: c.showConfirmModal,
    showErrorModal: c.showErrorModal,
    cycle,
    startFollowing,
    confirmLocate,
    requestPermission,
    stop,
    retryOrientation,
    retryPosition,
  };
};
