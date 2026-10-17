import { ref, inject } from "vue";
import {
  getMapInstance,
  setMapViewSuppressed,
  persistMapView,
} from "@/composables/useMap";
import { followCameraDefaults } from "@/defaults/maplibre";
import {
  blendBearing,
  damp,
  dampAngle,
  dampingFactor,
  deadReckon,
  followFitZoom,
  lookAheadMetres,
  pitchForSpeedKmh,
  zoomPullBackForSpeed,
} from "@/utils/follow";
import { emitter } from "@/emitter.js";

// Per-instance cache: instanceId -> instance state.
const followCache = new Map();

// Elapsed time since the last fix is capped before dead reckoning, so a stalled
// fix stream cannot fling the goal arbitrarily far ahead.
const DEAD_RECKON_MAX_SECONDS = 3;

// Settle thresholds: once the pose is within these of the last applied pose,
// the driver stops issuing `jumpTo` so a settled camera emits no move events.
const SETTLE_EPSILON = {
  degrees: 1e-6,
  bearing: 1e-3,
  pitch: 1e-3,
  zoom: 1e-4,
};

/** Whether the user has asked the OS to reduce motion. */
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** A monotonic clock reading, in milliseconds. */
const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/**
 * Map movement events that prove the user drove the camera when they carry an
 * `originalEvent`. The controller's own `jumpTo` calls pass no event data, so
 * their events have no `originalEvent` and are ignored — the same discriminator
 * `useMap` uses for view persistence. The start events catch the beginning of a
 * gesture; `move` and `moveend` are included so a continuous exploration keeps
 * deferring the idle resume until the gesture actually ends. `boxzoomstart`
 * covers box zoom, whose own camera animation does not carry the originating
 * event.
 */
const USER_GESTURE_EVENTS = Object.freeze([
  "movestart",
  "dragstart",
  "zoomstart",
  "rotatestart",
  "pitchstart",
  "boxzoomstart",
  "move",
  "moveend",
]);

/** Clamp a value to [0, 1]. */
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Quadratic ease-out, matching MapLibre's own camera easing. */
const easeOut = (t) => t * (2 - t);

/** Whether any pose component moved beyond its settle threshold. */
const exceedsEpsilon = (pose, applied) =>
  Math.abs(pose.lng - applied.lng) > SETTLE_EPSILON.degrees ||
  Math.abs(pose.lat - applied.lat) > SETTLE_EPSILON.degrees ||
  Math.abs(pose.bearing - applied.bearing) > SETTLE_EPSILON.bearing ||
  Math.abs(pose.pitch - applied.pitch) > SETTLE_EPSILON.pitch ||
  Math.abs(pose.zoom - applied.zoom) > SETTLE_EPSILON.zoom;

/**
 * Composable for a follow camera that owns the map each animation frame.
 *
 * It damps centre, bearing, pitch and zoom towards a target derived from speed
 * and heading, dead-reckoning the fix forward between ~1 Hz updates and
 * displacing the centre ahead of the target so the user sits in the lower third
 * once tilted. Gesture suspension and an idle timer are later slices.
 *
 * State is cached per app instance and shared across all callers. While active
 * it suppresses controller-driven view persistence (see `useMap`), then
 * persists the final camera exactly once on `stop()`.
 *
 * @param {string} [explicitInstanceId] - App instance ID; resolved via
 *   `inject('ogisAppId')` when omitted.
 * @returns {{
 *   isActive: import('vue').Ref<boolean>,
 *   start: Function,
 *   setTarget: Function,
 *   stop: Function,
 * }}
 */
export const useFollowCamera = (explicitInstanceId) => {
  const instanceId = explicitInstanceId ?? inject("ogisAppId", "app");

  if (!followCache.has(instanceId)) {
    followCache.set(instanceId, {
      isActive: ref(false),
      raw: null, // latest follow inputs, resolved lazily against the map
      target: null, // resolved { lat, lng, bearing, pitch, zoom, speedKmh, lookAheadMetres, timestampMs }
      pose: null, // current camera pose (damping state)
      applied: null, // last pose pushed to the map (settle guard)
      rafId: null, // active requestAnimationFrame handle
      lastFrame: 0, // timestamp of the previous frame, in ms
      map: null, // map the loop is driving
      mapRemoveHandler: null, // MapLibre 'remove' cleanup
      appDestroyHandler: null, // app-level 'destroy' cleanup
      gestureHandler: null, // user-gesture suspension listener
      resizeHandler: null, // follow-fit recompute listener
      suspended: false, // true while the user owns the camera
      idleTimerId: null, // idle-resume timeout handle
      resume: null, // active resume glide { from, startedAt, finished }
    });
  }

  const c = followCache.get(instanceId);

  const cancelLoop = () => {
    if (c.rafId !== null) cancelAnimationFrame(c.rafId);
    c.rafId = null;
  };

  const clearIdleTimer = () => {
    if (c.idleTimerId !== null) clearTimeout(c.idleTimerId);
    c.idleTimerId = null;
  };

  const disarmCleanup = () => {
    if (c.gestureHandler) {
      for (const type of USER_GESTURE_EVENTS) {
        c.map?.off?.(type, c.gestureHandler);
      }
      c.gestureHandler = null;
    }
    if (c.resizeHandler) {
      c.map?.off?.("resize", c.resizeHandler);
      c.resizeHandler = null;
    }
    if (c.mapRemoveHandler) {
      c.map?.off?.("remove", c.mapRemoveHandler);
      c.mapRemoveHandler = null;
    }
    if (c.appDestroyHandler) {
      emitter.off("destroy", c.appDestroyHandler);
      c.appDestroyHandler = null;
    }
  };

  const armAppDestroyCleanup = () => {
    if (c.appDestroyHandler) return;
    c.appDestroyHandler = () => cleanupOnDestroy();
    emitter.once("destroy", c.appDestroyHandler);
  };

  const armMapRemoveCleanup = (map) => {
    if (c.mapRemoveHandler) return;
    c.mapRemoveHandler = () => cleanupOnDestroy();
    map.once("remove", c.mapRemoveHandler);
  };

  /**
   * Cancel the loop and release suppression when the map goes away, without
   * persisting — the map is already being destroyed. Wired to both MapLibre's
   * `remove` event and the app-level `destroy` emitter, whichever fires first.
   */
  const cleanupOnDestroy = () => {
    cancelLoop();
    clearIdleTimer();
    disarmCleanup();
    c.map = null;
    c.pose = null;
    c.applied = null;
    c.target = null;
    c.raw = null;
    c.suspended = false;
    c.resume = null;
    c.isActive.value = false;
    setMapViewSuppressed(instanceId, false);
  };

  const scheduleFrame = () => {
    if (c.isActive.value && !c.suspended && c.rafId === null) {
      c.rafId = requestAnimationFrame(step);
    }
  };

  /** Clamp a zoom to the map's configured range, when it exposes one. */
  const clampZoom = (zoom, map) => {
    if (!Number.isFinite(zoom)) return zoom;
    let result = zoom;
    const minZoom = map?.getMinZoom?.();
    const maxZoom = map?.getMaxZoom?.();
    if (Number.isFinite(minZoom)) result = Math.max(minZoom, result);
    if (Number.isFinite(maxZoom)) result = Math.min(maxZoom, result);
    return result;
  };

  /**
   * Resolve raw follow inputs into a full camera target.
   *
   * Explicit `bearing`/`pitch`/`zoom` overrides win (the low-level test path).
   * Otherwise the pose is derived from speed and heading: speed-driven pitch, a
   * viewport-fitted horizon zoom pulled back by speed (clamped to the map's
   * range), a compass/course bearing blend, and the composition look-ahead. A
   * missing canvas holds the previous zoom; an undecidable bearing holds the
   * previous target (then the camera) bearing.
   */
  const resolveTarget = (raw) => {
    const map = c.map ?? getMapInstance(instanceId);
    const previous = c.target;
    const pose = c.pose ?? {};
    const canvas = map?.getCanvas?.();
    const widthPx = canvas?.clientWidth;
    const heightPx = canvas?.clientHeight;

    let bearing;
    if (Number.isFinite(raw.bearing)) {
      bearing = raw.bearing;
    } else {
      const blended = blendBearing({
        compassDeg: raw.compassHeading,
        courseDeg: raw.courseDeg,
        speedKmh: raw.speedKmh,
      });
      bearing = blended ?? previous?.bearing ?? pose.bearing ?? 0;
    }

    const pitch = Number.isFinite(raw.pitch)
      ? raw.pitch
      : pitchForSpeedKmh(raw.speedKmh);

    let zoom;
    if (Number.isFinite(raw.zoom)) {
      zoom = raw.zoom;
    } else if (
      Number.isFinite(widthPx) &&
      Number.isFinite(heightPx) &&
      widthPx > 0 &&
      heightPx > 0
    ) {
      const fitZoom = followFitZoom({ widthPx, heightPx, latitude: raw.lat });
      zoom = clampZoom(fitZoom - zoomPullBackForSpeed(raw.speedKmh), map);
    } else {
      zoom = previous?.zoom ?? pose.zoom ?? 0;
    }

    const lookAhead = Number.isFinite(raw.lookAheadMetres)
      ? raw.lookAheadMetres
      : lookAheadMetres({
          pitchDeg: pitch,
          zoom,
          latitude: raw.lat,
          viewportHeightPx: heightPx,
          maxOffsetFraction: followCameraDefaults.maxOffsetFraction,
          offsetRampPitchDeg: followCameraDefaults.offsetRampPitchDeg,
        });

    return {
      lat: raw.lat,
      lng: raw.lng,
      bearing,
      pitch,
      zoom,
      speedKmh: Number.isFinite(raw.speedKmh) ? raw.speedKmh : 0,
      lookAheadMetres: lookAhead,
      timestampMs: raw.timestampMs,
    };
  };

  // ─── Interaction suspension and idle resume ────────────────────────────────

  /**
   * Suspend the driver: leave the camera exactly where the user put it, keep
   * following active, and (re)start the idle timer. Repeated camera-changing
   * interactions simply reset the timer; a bare tap that moves nothing never
   * reaches this because it fires no movement event.
   */
  const suspend = () => {
    if (!c.isActive.value) return;
    if (!c.suspended) {
      c.suspended = true;
      c.resume = null;
      cancelLoop();
    }
    resetIdleTimer();
  };

  /** Arm (or re-arm) the idle timer that starts the resume glide. */
  const resetIdleTimer = () => {
    clearIdleTimer();
    c.idleTimerId = setTimeout(
      beginResume,
      followCameraDefaults.idleResumeDelayMs,
    );
  };

  /**
   * Idle delay elapsed: hand the camera back to the driver. A timed glide
   * blends from the frozen pose to the live follow pose over
   * `resumeGlideMs`; under reduced motion there is no glide and the next frame
   * snaps straight to the pose.
   */
  const beginResume = () => {
    c.idleTimerId = null;
    if (!c.isActive.value || !c.suspended) return;

    c.suspended = false;
    c.lastFrame = 0;
    c.resume =
      prefersReducedMotion() || !c.pose
        ? null
        : { from: { ...c.pose }, startedAt: null, finished: false };
    scheduleFrame();
  };

  /** Mark a user-driven camera change from a MapLibre movement event. */
  const onUserGesture = (event) => {
    if (!event?.originalEvent) return; // controller-driven: no originating event
    suspend();
  };

  /** Viewport resized: recompute the fit baseline so the resume framing holds. */
  const onResize = () => {
    if (c.raw) c.target = resolveTarget(c.raw);
    scheduleFrame();
  };

  /**
   * Take ownership of a resolved map: cancel any in-flight camera animation,
   * capture the current pose as the damping origin, suppress view persistence
   * and (re)resolve any target stored before the map was ready.
   */
  const attachMap = (map) => {
    map.stop();

    const centre = map.getCenter();
    c.pose = {
      lng: centre.lng,
      lat: centre.lat,
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      zoom: map.getZoom(),
    };
    c.applied = { ...c.pose };
    c.map = map;
    c.lastFrame = 0;

    armMapRemoveCleanup(map);
    setMapViewSuppressed(instanceId, true);

    if (!c.gestureHandler) {
      c.gestureHandler = onUserGesture;
      for (const type of USER_GESTURE_EVENTS) map.on(type, c.gestureHandler);
    }
    if (!c.resizeHandler) {
      c.resizeHandler = onResize;
      map.on("resize", c.resizeHandler);
    }

    if (c.raw) c.target = resolveTarget(c.raw);
  };

  const step = (now) => {
    c.rafId = null;
    if (!c.isActive.value || c.suspended) return;

    let map = c.map;
    if (!map) {
      // No map yet (e.g. a target set before the map resolved): keep trying
      // until it appears, then begin driving.
      map = getMapInstance(instanceId);
      if (!map) {
        scheduleFrame();
        return;
      }
      attachMap(map);
    }

    const target = c.target;
    if (!target) {
      scheduleFrame();
      return;
    }

    const dt = c.lastFrame ? Math.min((now - c.lastFrame) / 1000, 0.1) : 0;
    c.lastFrame = now;

    const {
      centreTimeConstantS,
      bearingTimeConstantS,
      pitchTimeConstantS,
      zoomTimeConstantS,
      lookAheadMinMetres,
      lookAheadMaxMetres,
    } = followCameraDefaults;

    const reduced = prefersReducedMotion();
    const pose = c.pose;
    const alpha = (tau) => (reduced ? 1 : dampingFactor(dt, tau));

    // A resume glide runs a deterministic timed blend from the pose the user
    // left to the live follow pose; otherwise the normal damping applies. The
    // glide's progress is carried into the centre blend below so the whole pose
    // moves as one eased step.
    let resumeFrom = null;
    let resumeK = 0;
    if (c.resume) {
      if (c.resume.startedAt === null) c.resume.startedAt = now;
      const duration = followCameraDefaults.resumeGlideMs;
      const t =
        duration > 0 ? clamp01((now - c.resume.startedAt) / duration) : 1;
      resumeFrom = c.resume.from;
      resumeK = easeOut(t);
      pose.bearing = dampAngle(resumeFrom.bearing, target.bearing, resumeK);
      pose.pitch = damp(resumeFrom.pitch, target.pitch, resumeK);
      pose.zoom = damp(resumeFrom.zoom, target.zoom, resumeK);
      if (t >= 1) c.resume.finished = true;
    } else {
      // Rotation and zoom first, so the look-ahead below uses the damped values.
      pose.bearing = dampAngle(
        pose.bearing,
        target.bearing,
        alpha(bearingTimeConstantS),
      );
      pose.pitch = damp(pose.pitch, target.pitch, alpha(pitchTimeConstantS));
      pose.zoom = damp(pose.zoom, target.zoom, alpha(zoomTimeConstantS));
    }

    // Dead-reckon the fix forward along its own bearing for the time since it
    // arrived (capped), so the camera keeps pace between fixes. At rest this is
    // the fix itself. The composition offset is then applied along the current
    // damped bearing so the user sits in the lower third once tilted.
    const elapsed = Number.isFinite(target.timestampMs)
      ? Math.min((now - target.timestampMs) / 1000, DEAD_RECKON_MAX_SECONDS)
      : 0;
    const drift = Math.max(0, (target.speedKmh / 3.6) * elapsed);
    const fixGoal = deadReckon(
      { lat: target.lat, lng: target.lng },
      target.bearing,
      drift,
    );
    const lookAhead = Math.min(
      lookAheadMaxMetres,
      Math.max(lookAheadMinMetres, target.lookAheadMetres ?? 0),
    );
    const goal = deadReckon(fixGoal, pose.bearing, lookAhead);

    if (resumeFrom) {
      pose.lng = resumeFrom.lng + (goal.lng - resumeFrom.lng) * resumeK;
      pose.lat = resumeFrom.lat + (goal.lat - resumeFrom.lat) * resumeK;
      if (c.resume?.finished) c.resume = null;
    } else {
      pose.lng = damp(pose.lng, goal.lng, alpha(centreTimeConstantS));
      pose.lat = damp(pose.lat, goal.lat, alpha(centreTimeConstantS));
    }

    // Settle guard: once the pose stops moving, skip `jumpTo` so a settled
    // driver emits no further move events.
    if (!c.applied || exceedsEpsilon(pose, c.applied)) {
      map.jumpTo({
        center: [pose.lng, pose.lat],
        bearing: pose.bearing,
        pitch: pose.pitch,
        zoom: pose.zoom,
      });
      c.applied = {
        lng: pose.lng,
        lat: pose.lat,
        bearing: pose.bearing,
        pitch: pose.pitch,
        zoom: pose.zoom,
      };
    }

    scheduleFrame();
  };

  /**
   * Take ownership of the camera and start the damping loop.
   *
   * Cancels any in-flight flyTo/easeTo (e.g. the locate orientation flight),
   * captures the current pose as the damping origin, suppresses view
   * persistence and begins the animation-frame loop. Safe to call before the
   * map resolves: the loop waits for it. Idempotent while active.
   */
  const start = () => {
    if (c.isActive.value) return;

    c.isActive.value = true;
    c.suspended = false;
    c.resume = null;
    c.lastFrame = 0;
    armAppDestroyCleanup();

    const map = getMapInstance(instanceId);
    if (map) attachMap(map);

    cancelLoop();
    c.rafId = requestAnimationFrame(step);
  };

  /**
   * Set (or update) the camera target.
   *
   * Accepts a low-level explicit pose (`bearing`/`bearingDeg`, `pitch`, `zoom`,
   * `lookAheadMetres`) for tests and, for production, the raw follow inputs
   * (`compassHeading`, `courseDeg`, `speedKmh`, `timestampMs`) from which the
   * pose is derived. Ignored when the coordinates are not finite.
   *
   * @param {Object} [next]
   * @param {number} next.lat
   * @param {number} next.lng
   * @param {number|null} [next.compassHeading] - Unrounded smoothed compass
   *   bearing in degrees, or null.
   * @param {number|null} [next.courseDeg] - Course over ground in degrees, or
   *   null.
   * @param {number} [next.speedKmh=0] - Ground speed in km/h.
   * @param {number} [next.timestampMs] - Fix time; defaults to `performance.now()`.
   * @param {number} [next.bearing] - Explicit bearing override.
   * @param {number} [next.bearingDeg] - Alias for `bearing`.
   * @param {number} [next.pitch] - Explicit pitch override.
   * @param {number} [next.zoom] - Explicit zoom override.
   * @param {number} [next.lookAheadMetres] - Explicit look-ahead override.
   */
  const setTarget = (next = {}) => {
    if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;

    const explicitBearing = Number.isFinite(next.bearing)
      ? next.bearing
      : Number.isFinite(next.bearingDeg)
        ? next.bearingDeg
        : undefined;

    c.raw = {
      lat: next.lat,
      lng: next.lng,
      bearing: explicitBearing,
      pitch: next.pitch,
      zoom: next.zoom,
      lookAheadMetres: next.lookAheadMetres,
      compassHeading: Number.isFinite(next.compassHeading)
        ? next.compassHeading
        : null,
      courseDeg: Number.isFinite(next.courseDeg) ? next.courseDeg : null,
      speedKmh: Number.isFinite(next.speedKmh) ? next.speedKmh : 0,
      timestampMs: Number.isFinite(next.timestampMs)
        ? next.timestampMs
        : nowMs(),
    };
    c.target = resolveTarget(c.raw);

    scheduleFrame();
  };

  /**
   * Stop the loop, release suppression and persist the final camera exactly
   * once. Cancels any suspended idle timer or resume glide first, so a pending
   * timer can never move the camera after stop. Idempotent.
   */
  const stop = () => {
    if (!c.isActive.value) return;
    cancelLoop();
    clearIdleTimer();
    c.resume = null;
    c.suspended = false;
    disarmCleanup();
    setMapViewSuppressed(instanceId, false);
    persistMapView(instanceId);
    c.isActive.value = false;
    c.raw = null;
    c.target = null;
    c.pose = null;
    c.applied = null;
    c.map = null;
  };

  return {
    isActive: c.isActive,
    start,
    setTarget,
    stop,
  };
};
