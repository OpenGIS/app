import { ref, computed, inject } from "vue";
import maplibregl from "maplibre-gl";
import { magvar } from "magvar";
import { useStorage } from "@/composables/useStorage";
import { getMapInstance } from "@/composables/useMap";
import { emitter } from "@/emitter.js";
import { locateZoom } from "@/defaults/maplibre";
import { Position } from "@/classes/Position";

// Per-instance cache: instanceId -> instance state
const locateCache = new Map();

// Smoothing factor for compass heading (0 = no update, 1 = no smoothing).
// 0.15 is a gentle low-pass that removes jitter while still tracking rotation.
const HEADING_SMOOTH = 0.15;

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
 * @returns {{ mode: import('vue').ComputedRef<'active'|'following'|'error'|null>, position: import('vue').ComputedRef<Position|null>, compassHeading: import('vue').ComputedRef<number|null>, headingLost: import('vue').ComputedRef<boolean>, permissionGranted: import('vue').ComputedRef<boolean>, showConfirmModal: import('vue').Ref<boolean>, showErrorModal: import('vue').Ref<boolean>, cycle: Function, confirmLocate: Function, stop: Function, retryOrientation: Function, retryPosition: Function }}
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
      needsInitialZoom: false, // true until the first fix after activation
      generation: 0, // incremented on start/stop; discards stale callbacks
      mapReadyListener: null, // pending map:ready retry for the initial zoom
      headingTimeoutId: null, // timeout handle for heading-loss detection
      showConfirmModal: ref(false),
      showErrorModal: ref(false),
      pendingCallback: null, // called when user confirms the permission modal
      watcherId: null,
      orientationListener: null, // { eventName, handler }
      positionMarker: null,
      headingMarker: null,
    });
  }

  const c = locateCache.get(instanceId);

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
  };

  const removeMarkers = () => {
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

  // ─── Initial zoom ─────────────────────────────────────────────────────────

  /** Drop any pending map:ready retry for the one-shot initial zoom. */
  const clearInitialZoomRetry = () => {
    if (c.mapReadyListener) {
      emitter.off("map:ready", c.mapReadyListener);
      c.mapReadyListener = null;
    }
  };

  /**
   * Apply the one-shot initial zoom, exactly once per activation.
   *
   * The flag is only consumed when the map is ready and a position exists, so
   * a first fix that lands before map init is retained for a later fix rather
   * than being lost. On success the flag is cleared, preventing a double zoom.
   */
  const applyInitialZoom = () => {
    if (!c.needsInitialZoom) return;
    const map = getMapInstance(instanceId);
    if (!map || !c.position.value) return;
    c.needsInitialZoom = false;
    clearInitialZoomRetry();
    map.flyTo({
      center: [c.position.value.lng, c.position.value.lat],
      zoom: locateZoom,
    });
  };

  /**
   * If the map is not ready yet, retry the initial zoom once `map:ready`
   * fires. Guards against a first fix arriving before MapLibre has
   * initialised (see applyInitialZoom). The listener is registered once.
   */
  const armInitialZoomRetry = () => {
    if (getMapInstance(instanceId) || c.mapReadyListener) return;
    c.mapReadyListener = () => applyInitialZoom();
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

    applyInitialZoom();
    syncMarkers();

    if (c.mode.value === "following") {
      const map = getMapInstance(instanceId);
      if (map)
        map.easeTo({
          center: [c.position.value.lng, c.position.value.lat],
        });
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
    clearInitialZoomRetry();
    c.needsInitialZoom = false;
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
    c.needsInitialZoom = true;
    armInitialZoomRetry();

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
      c.mode.value = "following";
      if (c.position.value) {
        const map = getMapInstance(instanceId);
        if (map)
          map.easeTo({
            center: [c.position.value.lng, c.position.value.lat],
          });
      }
    } else if (c.mode.value === "following") {
      stop();
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
    clearInitialZoomRetry();
    c.needsInitialZoom = false;
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
    confirmLocate,
    requestPermission,
    stop,
    retryOrientation,
    retryPosition,
  };
};
