// utils/orient.js — pure helpers for the locate orientation flight

import { orientCameraDefaults } from "@/defaults/maplibre";

/** Mean Earth radius in metres (matches utils/geo.js). */
const EARTH_RADIUS_METRES = 6_371_000;

/**
 * MapLibre's 512-px-tile scale convention: the equatorial circumference in
 * metres. Ground resolution is `C · cos(lat) / (512 · 2^zoom)`.
 */
const EQUATORIAL_CIRCUMFERENCE_METRES = 40_075_016.686;

/** MapLibre's tile size in CSS pixels. */
const TILE_SIZE_PX = 512;

/** Clamp bounds for a MapLibre zoom level. */
const MIN_ZOOM = 0;
const MAX_ZOOM = 22;

/**
 * Distance to the geometric horizon for an observer, in metres.
 *
 * @param {number} eyeHeightMetres - Observer eye height above ground.
 * @returns {number} Horizon distance in metres.
 */
export function horizonDistanceMetres(eyeHeightMetres) {
  return Math.sqrt(2 * EARTH_RADIUS_METRES * eyeHeightMetres);
}

/**
 * Ground resolution (metres per CSS pixel) at a zoom and latitude.
 *
 * Derived from MapLibre's 512-px-tile scale convention:
 * `C · cos(lat) / (512 · 2^zoom)`.
 *
 * @param {Object} params
 * @param {number} params.zoom - MapLibre zoom level.
 * @param {number} params.latitude - Latitude in degrees.
 * @returns {number} Metres per pixel.
 */
export function metresPerPixel({ zoom, latitude }) {
  const metresPerPixelAtZoomZero =
    (EQUATORIAL_CIRCUMFERENCE_METRES / TILE_SIZE_PX) *
    Math.cos((latitude * Math.PI) / 180);
  return metresPerPixelAtZoomZero / 2 ** zoom;
}

/**
 * Zoom at which a ground disc of `radiusMetres` fills the viewport.
 *
 * Latitude-aware and derived from MapLibre's real scale (512-px tiles), so the
 * circle fits the smaller viewport axis exactly (minus optional padding).
 *
 * @param {Object} params
 * @param {number} params.widthPx - Viewport width in pixels.
 * @param {number} params.heightPx - Viewport height in pixels.
 * @param {number} params.latitude - Latitude of the disc centre, in degrees.
 * @param {number} params.radiusMetres - Disc radius in metres.
 * @param {number} [params.paddingPx=0] - Padding in pixels, applied per side.
 * @returns {number} Fitted zoom, clamped to [0, 22].
 */
export function fitZoomForDisc({
  widthPx,
  heightPx,
  latitude,
  radiusMetres,
  paddingPx = 0,
}) {
  const minDim = Math.min(widthPx, heightPx) - 2 * paddingPx;
  const metresPerPixelAtZoomZero = metresPerPixel({ zoom: 0, latitude });
  const zoom = Math.log2(
    (minDim * metresPerPixelAtZoomZero) / (2 * radiusMetres),
  );
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Zoom at which the line-of-sight horizon disc fits the viewport.
 *
 * Shared by the locate orientation flight and the follow camera's rest pose so
 * the two cannot drift. Padding is a fraction of the smaller viewport axis,
 * applied per side.
 *
 * @param {Object} params
 * @param {number} params.widthPx - Viewport width in pixels.
 * @param {number} params.heightPx - Viewport height in pixels.
 * @param {number} params.latitude - Latitude in degrees.
 * @param {number} [params.eyeHeightMetres] - Observer eye height in metres.
 * @param {number} [params.paddingFraction] - Padding per side, as a fraction
 *   of the smaller viewport axis.
 * @returns {number} Fitted zoom, clamped to [0, 22].
 */
export function horizonFitZoom({
  widthPx,
  heightPx,
  latitude,
  eyeHeightMetres = orientCameraDefaults.eyeHeightMetres,
  paddingFraction = orientCameraDefaults.fitPaddingFraction,
}) {
  const minDim = Math.min(widthPx, heightPx);
  return fitZoomForDisc({
    widthPx,
    heightPx,
    latitude,
    radiusMetres: horizonDistanceMetres(eyeHeightMetres),
    paddingPx: Math.round(minDim * paddingFraction),
  });
}

/**
 * Shortest angular distance between a bearing and due north (0°).
 *
 * @param {number} bearingDeg - Bearing in degrees; any value wraps.
 * @returns {number} Absolute shortest angle to 0°, in [0, 180].
 */
export function shortestBearingDelta(bearingDeg) {
  const d = Math.abs(bearingDeg) % 360;
  return Math.min(d, 360 - d);
}

/**
 * Duration of the orientation flight, in milliseconds.
 *
 * Blends a logarithmic distance curve (gentle, long-distance flights) with a
 * rotation-speed floor, so the bearing never sweeps faster than the configured
 * cap. The result is clamped to the configured min/max.
 *
 * @param {Object} params
 * @param {number} params.distanceMetres - Camera-to-user ground distance.
 * @param {number} params.bearingDeg - Current map bearing to reset from.
 * @returns {number} Flight duration in milliseconds.
 */
export function orientFlightDurationMs({ distanceMetres, bearingDeg }) {
  const {
    durationMinMs,
    durationMaxMs,
    durationPivotMs,
    durationMsPerDecade,
    durationPivotMetres,
    maxRotationDegPerSecond,
  } = orientCameraDefaults;

  const distanceCurve =
    durationPivotMs +
    durationMsPerDecade *
      Math.log10(Math.max(distanceMetres, 1) / durationPivotMetres);
  const rotationFloor =
    (shortestBearingDelta(bearingDeg) / maxRotationDegPerSecond) * 1000;

  return Math.min(
    durationMaxMs,
    Math.max(durationMinMs, Math.max(distanceCurve, rotationFloor)),
  );
}
