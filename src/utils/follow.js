// utils/follow.js — pure maths for the follow camera
//
// Everything here is map- and DOM-free so it can be unit-tested in Node. The
// composable owns all MapLibre interaction; this module only decides numbers.

import { horizonFitZoom, metresPerPixel } from "@/utils/orient";
import { haversine } from "@/utils/geo";

/** Mean Earth radius in metres (matches utils/geo.js and utils/orient.js). */
const EARTH_RADIUS_METRES = 6_371_000;

const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

/**
 * Agreed non-linear pitch curve, as speed/pitch keyframes. Piecewise linear
 * interpolation between these points keeps the curve monotone; the camera
 * damping smooths the corners in practice.
 *
 * @type {ReadonlyArray<{ speedKmh: number, pitchDeg: number }>}
 */
export const PITCH_KEYFRAMES = Object.freeze([
  { speedKmh: 0, pitchDeg: 0 },
  { speedKmh: 5, pitchDeg: 32 },
  { speedKmh: 15, pitchDeg: 42 },
  { speedKmh: 30, pitchDeg: 50 },
  { speedKmh: 60, pitchDeg: 56 },
  { speedKmh: 100, pitchDeg: 60 },
]);

/** Speed at or below which zoom pull-back is zero (walking pace), in km/h. */
export const ZOOM_PULLBACK_START_KMH = 5;

/** Speed at which zoom pull-back reaches its maximum, in km/h. */
export const ZOOM_PULLBACK_END_KMH = 100;

/** Maximum zoom levels pulled back at high speed. */
export const ZOOM_PULLBACK_MAX = 1;

/** Lower-third offset fraction at full tilt. */
export const OFFSET_FRACTION_MAX = 0.2;

/** Pitch at which the lower-third offset reaches its maximum, in degrees. */
export const OFFSET_RAMP_PITCH_DEG = 60;

/** Floor on `cos(pitch)` so the look-ahead division stays finite near 90°. */
export const MIN_COS_PITCH = 0.1;

/** Speed at which the bearing blend starts favouring course over ground. */
export const BEARING_BLEND_START_KMH = 5;

/** Speed at which course over ground fully replaces compass bearing. */
export const BEARING_BLEND_END_KMH = 25;

/** Minimum displacement before a derived course or speed is trusted, in m. */
export const MIN_DISPLACEMENT_METRES = 1;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Normalise an angle to [0, 360). */
const normaliseDegrees = (degrees) => ((degrees % 360) + 360) % 360;

/** Normalise a longitude to [-180, 180). */
const normaliseLongitude = (longitude) =>
  ((((longitude + 180) % 360) + 360) % 360) - 180;

/** Whether a value is a usable finite number. */
const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

/** Hermite smoothstep from edge0 to edge1. */
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Whether a `{ lat, lng }` fix has finite coordinates. */
const isFix = (fix) =>
  fix != null && isFiniteNumber(fix.lat) && isFiniteNumber(fix.lng);

/**
 * The configured minimum displacement, falling back to the module default for
 * missing or invalid options.
 *
 * @param {Object} [options]
 * @param {number} [options.minDistanceMetres]
 * @returns {number} Minimum displacement in metres.
 */
const minDistance = (options = {}) =>
  isFiniteNumber(options.minDistanceMetres)
    ? options.minDistanceMetres
    : MIN_DISPLACEMENT_METRES;

/**
 * Speed-driven camera pitch, interpolated piecewise-linearly between the
 * agreed keyframes and clamped outside 0–100 km/h.
 *
 * @param {number|null} speedKmh - Speed in km/h; non-finite or null → 0°.
 * @returns {number} Pitch in degrees, in [0, 60].
 */
export function pitchForSpeedKmh(speedKmh) {
  if (!isFiniteNumber(speedKmh)) return 0;

  const speed = clamp(speedKmh, 0, 100);
  const first = PITCH_KEYFRAMES[0];
  const last = PITCH_KEYFRAMES[PITCH_KEYFRAMES.length - 1];
  if (speed <= first.speedKmh) return first.pitchDeg;
  if (speed >= last.speedKmh) return last.pitchDeg;

  for (let i = 1; i < PITCH_KEYFRAMES.length; i++) {
    const next = PITCH_KEYFRAMES[i];
    if (speed <= next.speedKmh) {
      const previous = PITCH_KEYFRAMES[i - 1];
      const t =
        (speed - previous.speedKmh) / (next.speedKmh - previous.speedKmh);
      return previous.pitchDeg + (next.pitchDeg - previous.pitchDeg) * t;
    }
  }

  return last.pitchDeg;
}

/**
 * Zoom levels to pull back as speed rises, from 0 at walking pace to
 * {@link ZOOM_PULLBACK_MAX} at {@link ZOOM_PULLBACK_END_KMH}. A smoothstep
 * shape avoids a hard knee in the zoom curve.
 *
 * @param {number|null} speedKmh - Speed in km/h.
 * @returns {number} Pull-back in zoom levels, in [0, 1].
 */
export function zoomPullBackForSpeed(speedKmh) {
  if (!isFiniteNumber(speedKmh)) return 0;
  if (speedKmh <= ZOOM_PULLBACK_START_KMH) return 0;
  if (speedKmh >= ZOOM_PULLBACK_END_KMH) return ZOOM_PULLBACK_MAX;

  const t = smoothstep(
    ZOOM_PULLBACK_START_KMH,
    ZOOM_PULLBACK_END_KMH,
    speedKmh,
  );
  return ZOOM_PULLBACK_MAX * t;
}

/**
 * Fraction of the viewport height used as the lower-third lever. Zero at a
 * flat camera and rising linearly to `maxFraction` at `rampPitchDeg`.
 *
 * @param {number} pitchDeg - Camera pitch in degrees.
 * @param {Object} [options]
 * @param {number} [options.maxFraction=OFFSET_FRACTION_MAX]
 * @param {number} [options.rampPitchDeg=OFFSET_RAMP_PITCH_DEG]
 * @returns {number} Offset fraction, in [0, maxFraction].
 */
export function offsetFractionForPitch(
  pitchDeg,
  {
    maxFraction = OFFSET_FRACTION_MAX,
    rampPitchDeg = OFFSET_RAMP_PITCH_DEG,
  } = {},
) {
  if (!isFiniteNumber(pitchDeg)) return 0;
  const relevant = isFiniteNumber(maxFraction)
    ? maxFraction
    : OFFSET_FRACTION_MAX;
  const ramp =
    isFiniteNumber(rampPitchDeg) && rampPitchDeg > 0
      ? rampPitchDeg
      : OFFSET_RAMP_PITCH_DEG;
  return relevant * clamp(pitchDeg / ramp, 0, 1);
}

/**
 * Approximate ground distance ahead of the followed point so it sits in the
 * lower third of a tilted view.
 *
 * This is a composition approximation, not a geodesic measurement: a vertical
 * pixel offset of `offsetFraction · viewportHeight` corresponds to
 * `offsetFraction · viewportHeight · mpp / cos(pitch)` ground metres, because
 * tilt foreshortens the ground plane. It will be tuned against real captures.
 *
 * @param {Object} params
 * @param {number} params.pitchDeg - Camera pitch in degrees.
 * @param {number} params.zoom - MapLibre zoom level.
 * @param {number} params.latitude - Latitude in degrees.
 * @param {number} params.viewportHeightPx - Canvas height in CSS pixels.
 * @param {number} [params.maxOffsetFraction=OFFSET_FRACTION_MAX]
 * @param {number} [params.offsetRampPitchDeg=OFFSET_RAMP_PITCH_DEG]
 * @returns {number} Look-ahead distance in metres; 0 for a flat or invalid pose.
 */
export function lookAheadMetres({
  pitchDeg,
  zoom,
  latitude,
  viewportHeightPx,
  maxOffsetFraction = OFFSET_FRACTION_MAX,
  offsetRampPitchDeg = OFFSET_RAMP_PITCH_DEG,
} = {}) {
  if (!isFiniteNumber(pitchDeg) || pitchDeg <= 0) return 0;
  if (
    !isFiniteNumber(zoom) ||
    !isFiniteNumber(latitude) ||
    !isFiniteNumber(viewportHeightPx) ||
    viewportHeightPx <= 0
  ) {
    return 0;
  }

  const offsetFraction = offsetFractionForPitch(pitchDeg, {
    maxFraction: maxOffsetFraction,
    rampPitchDeg: offsetRampPitchDeg,
  });
  const mpp = metresPerPixel({ zoom, latitude });
  if (!isFiniteNumber(mpp)) return 0;

  const pitchRad = Math.min(pitchDeg, 90) * DEGREES_TO_RADIANS;
  return (
    (offsetFraction * viewportHeightPx * mpp) /
    Math.max(Math.cos(pitchRad), MIN_COS_PITCH)
  );
}

/**
 * Blend a compass bearing (where the device faces) with course over ground.
 *
 * Compass dominates at rest and walking pace; course takes over smoothly as
 * speed rises, using a smoothstep from {@link BEARING_BLEND_START_KMH} to
 * {@link BEARING_BLEND_END_KMH}. One missing source is returned directly;
 * both missing returns null. The result is the shortest-path blend and is
 * normalised to [0, 360).
 *
 * @param {Object} params
 * @param {number|null} [params.compassDeg] - Compass/facing bearing in degrees.
 * @param {number|null} [params.courseDeg] - Course over ground in degrees.
 * @param {number|null} [params.speedKmh] - Speed in km/h; non-finite → 0.
 * @returns {number|null} Blended bearing in [0, 360), or null.
 */
export function blendBearing({ compassDeg, courseDeg, speedKmh } = {}) {
  const hasCompass = isFiniteNumber(compassDeg);
  const hasCourse = isFiniteNumber(courseDeg);

  if (!hasCompass && !hasCourse) return null;
  if (!hasCompass) return normaliseDegrees(courseDeg);
  if (!hasCourse) return normaliseDegrees(compassDeg);

  const speed = isFiniteNumber(speedKmh) ? Math.max(speedKmh, 0) : 0;
  const courseWeight = smoothstep(
    BEARING_BLEND_START_KMH,
    BEARING_BLEND_END_KMH,
    speed,
  );
  const delta = ((courseDeg - compassDeg + 540) % 360) - 180;
  return normaliseDegrees(compassDeg + delta * courseWeight);
}

/**
 * Derive course over ground from two consecutive fixes.
 *
 * Uses the haversine distance from `utils/geo.js` for the minimum-displacement
 * gate and the standard initial-bearing formula (with Δlongitude normalised to
 * ±180°), so the antimeridian and high latitudes are handled.
 *
 * @param {{ lat: number, lng: number }} prev - Earlier fix.
 * @param {{ lat: number, lng: number }} next - Later fix.
 * @param {Object} [options]
 * @param {number} [options.minDistanceMetres=MIN_DISPLACEMENT_METRES] - Below
 *   this displacement the course is untrustworthy.
 * @returns {number|null} Bearing in [0, 360), or null when untrustworthy.
 */
export function deriveCourse(prev, next, options = {}) {
  if (!isFix(prev) || !isFix(next)) return null;

  const distance = haversine(prev, next);
  if (distance < minDistance(options)) return null;

  const lat1 = prev.lat * DEGREES_TO_RADIANS;
  const lat2 = next.lat * DEGREES_TO_RADIANS;
  const deltaLng =
    (((next.lng - prev.lng + 540) % 360) - 180) * DEGREES_TO_RADIANS;

  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

  return normaliseDegrees(Math.atan2(y, x) * RADIANS_TO_DEGREES);
}

/**
 * Fallback speed from two fixes, in metres per second to match
 * `Position.speed`.
 *
 * Below the minimum displacement the result is 0 rather than null, which
 * suppresses GPS jitter while the device is effectively stationary.
 *
 * @param {{ lat: number, lng: number }} prev - Earlier fix.
 * @param {{ lat: number, lng: number }} next - Later fix.
 * @param {number} dtSec - Time between fixes in seconds.
 * @param {Object} [options]
 * @param {number} [options.minDistanceMetres=MIN_DISPLACEMENT_METRES]
 * @returns {number|null} Speed in m/s, or null for invalid inputs.
 */
export function deriveSpeed(prev, next, dtSec, options = {}) {
  if (!isFix(prev) || !isFix(next)) return null;
  if (!isFiniteNumber(dtSec) || dtSec <= 0) return null;

  const distance = haversine(prev, next);
  if (distance < minDistance(options)) return 0;

  return distance / dtSec;
}

/**
 * Exponential damping factor for a frame, matching the Slice 1 driver:
 * `1 - exp(-dt / tau)`.
 *
 * A non-positive (or non-finite) frame interval leaves the value untouched;
 * an invalid or non-positive time constant snaps straight to the target.
 *
 * @param {number} dtSec - Frame interval in seconds.
 * @param {number} tauSec - Time constant in seconds.
 * @returns {number} Damping factor, in [0, 1].
 */
export function dampingFactor(dtSec, tauSec) {
  if (!isFiniteNumber(dtSec) || !isFiniteNumber(tauSec) || tauSec <= 0) {
    return 1;
  }
  if (dtSec <= 0) return 0;
  return clamp(1 - Math.exp(-dtSec / tauSec), 0, 1);
}

/**
 * Linear interpolation towards a target with a clamped damping factor.
 *
 * @param {number} current - Current value.
 * @param {number} target - Target value.
 * @param {number} factor - Damping factor; clamped to [0, 1].
 * @returns {number} Interpolated value; `current` for invalid inputs.
 */
export function damp(current, target, factor) {
  if (!isFiniteNumber(current)) return current;
  if (!isFiniteNumber(target) || !isFiniteNumber(factor)) return current;
  return current + (target - current) * clamp(factor, 0, 1);
}

/**
 * Angular damping along the shortest path around a circle.
 *
 * @param {number} currentDeg - Current angle in degrees.
 * @param {number} targetDeg - Target angle in degrees.
 * @param {number} factor - Damping factor; clamped to [0, 1].
 * @returns {number} Interpolated angle normalised to [0, 360); `current` for
 *   invalid inputs.
 */
export function dampAngle(currentDeg, targetDeg, factor) {
  if (!isFiniteNumber(currentDeg)) return currentDeg;
  if (!isFiniteNumber(targetDeg) || !isFiniteNumber(factor)) {
    return currentDeg;
  }

  const delta = ((targetDeg - currentDeg + 540) % 360) - 180;
  return normaliseDegrees(currentDeg + delta * clamp(factor, 0, 1));
}

/**
 * Destination point on a spherical Earth.
 *
 * Handles zero distance, the antimeridian (the returned longitude is
 * normalised to [-180, 180)) and high latitudes. Used to interpolate between
 * 1 Hz fixes.
 *
 * @param {{ lat: number, lng: number }} origin - Start point in degrees.
 * @param {number} bearingDeg - Bearing clockwise from north, in degrees.
 * @param {number} distanceMetres - Distance to travel in metres.
 * @returns {{ lat: number, lng: number }} Destination in degrees.
 */
export function deadReckon({ lat, lng } = {}, bearingDeg, distanceMetres) {
  const origin = { lat, lng };
  if (
    !isFix(origin) ||
    !isFiniteNumber(bearingDeg) ||
    !isFiniteNumber(distanceMetres)
  ) {
    return origin;
  }

  if (distanceMetres === 0) return origin;

  const angular = distanceMetres / EARTH_RADIUS_METRES;
  const bearing = bearingDeg * DEGREES_TO_RADIANS;
  const lat1 = lat * DEGREES_TO_RADIANS;
  const lng1 = lng * DEGREES_TO_RADIANS;

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angular) +
    Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing);
  const lat2 = Math.asin(sinLat2);
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * sinLat2,
    );

  return {
    lat: lat2 * RADIANS_TO_DEGREES,
    lng: normaliseLongitude(lng2 * RADIANS_TO_DEGREES),
  };
}

/**
 * Locate's horizon-fit baseline, reused by the follow camera so its rest pose
 * and the orientation flight cannot drift apart.
 *
 * @param {Object} params
 * @param {number} params.widthPx - Viewport width in pixels.
 * @param {number} params.heightPx - Viewport height in pixels.
 * @param {number} params.latitude - Latitude in degrees.
 * @param {Object} [options]
 * @param {number} [options.eyeHeightMetres] - Observer eye height in metres.
 * @param {number} [options.paddingFraction] - Padding per side, as a fraction
 *   of the smaller viewport axis.
 * @returns {number} Fitted zoom, clamped to [0, 22].
 */
export function followFitZoom(
  { widthPx, heightPx, latitude } = {},
  { eyeHeightMetres, paddingFraction } = {},
) {
  return horizonFitZoom({
    widthPx,
    heightPx,
    latitude,
    eyeHeightMetres,
    paddingFraction,
  });
}
