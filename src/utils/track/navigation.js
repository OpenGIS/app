// track/navigation.js — nearest point on a track

import { haversine } from "../geo.js";
import { deriveCourse } from "../follow.js";
import { normalisePoint } from "./model.js";

/** Distance within which a position counts as on route, in metres. */
export const ON_ROUTE_METRES = 5;

const EARTH_RADIUS_METRES = 6_371_000;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const MAX_GEODESIC_POINTS = 64;

/** Normalise a longitude to [-180, 180). */
const normaliseLongitude = (longitude) =>
  ((((longitude + 180) % 360) + 360) % 360) - 180;

/** Convert a point in degrees to a unit vector on the sphere. */
const toUnitVector = ({ lat, lng }) => {
  const latitude = lat * DEGREES_TO_RADIANS;
  const longitude = lng * DEGREES_TO_RADIANS;
  const cosLatitude = Math.cos(latitude);
  return {
    x: cosLatitude * Math.cos(longitude),
    y: cosLatitude * Math.sin(longitude),
    z: Math.sin(latitude),
  };
};

/** Convert a unit vector back to a point in degrees. */
const fromUnitVector = ({ x, y, z }) => ({
  lat: Math.atan2(z, Math.hypot(x, y)) * RADIANS_TO_DEGREES,
  lng: normaliseLongitude(Math.atan2(y, x) * RADIANS_TO_DEGREES),
});

/**
 * Build a great-circle line between two points.
 *
 * The line is spherical linear interpolation (slerp) between the endpoints'
 * unit vectors, so it bows correctly along the Earth's surface rather than
 * being drawn as a straight segment in the projection. The number of points
 * scales with the great-circle distance, one roughly every `maxStepMetres`,
 * clamped to between 2 and 64 points so short hops stay simple and long
 * connectors remain visibly curved.
 *
 * Invalid inputs return an empty array. Identical (or near-identical) points
 * return two coincident coordinates, which keeps a valid GeoJSON LineString.
 *
 * @param {{ lat: number, lng: number }} start - Start point in degrees.
 * @param {{ lat: number, lng: number }} end - End point in degrees.
 * @param {{ maxStepMetres?: number }} [options] - Point spacing in metres.
 * @returns {Array<[number, number]>} `[lng, lat]` coordinates including both
 *   endpoints.
 */
export function geodesicLine(start, end, { maxStepMetres = 25_000 } = {}) {
  const from = normalisePoint(start);
  const to = normalisePoint(end);
  if (!from || !to) return [];

  const startCoordinate = [from.lng, from.lat];
  const endCoordinate = [to.lng, to.lat];

  const distance = haversine(from, to);
  if (!Number.isFinite(distance) || distance < 1e-6) {
    return [startCoordinate, endCoordinate];
  }

  const step =
    Number.isFinite(maxStepMetres) && maxStepMetres > 0
      ? maxStepMetres
      : 25_000;
  const pointCount = Math.min(
    MAX_GEODESIC_POINTS,
    Math.max(2, Math.ceil(distance / step)),
  );

  const a = toUnitVector(from);
  const b = toUnitVector(to);
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);

  // Near-antipodal endpoints make the slerp denominator collapse; fall back
  // to the two endpoints rather than emitting NaN coordinates.
  if (Math.abs(sinOmega) < 1e-9) {
    return [startCoordinate, endCoordinate];
  }

  const coordinates = [];
  for (let i = 0; i < pointCount; i++) {
    if (i === 0) {
      coordinates.push(startCoordinate);
      continue;
    }
    if (i === pointCount - 1) {
      coordinates.push(endCoordinate);
      continue;
    }

    const t = i / (pointCount - 1);
    const weightA = Math.sin((1 - t) * omega) / sinOmega;
    const weightB = Math.sin(t * omega) / sinOmega;
    const point = fromUnitVector({
      x: a.x * weightA + b.x * weightB,
      y: a.y * weightA + b.y * weightB,
      z: a.z * weightA + b.z * weightB,
    });
    coordinates.push([point.lng, point.lat]);
  }

  return coordinates;
}

/**
 * Find the closest point on a track to a position.
 *
 * Each segment is projected into a local equirectangular plane centred on the
 * user, so the closest point can be found with plain 2D segment maths. The
 * projection is only local: distance and bearing are recalculated on the sphere
 * from the resulting point. Segments are never joined across gaps, and invalid
 * points are skipped.
 *
 * @param {Object} doc - v2 track document.
 * @param {{ lat: number, lng: number }} position - User position in degrees.
 * @returns {{
 *   point: { lat: number, lng: number },
 *   distance: number,
 *   bearing: number|null,
 *   segmentIndex: number,
 *   pointIndex: number
 * }|null} Closest point and its sphere-corrected distance/bearing, or null.
 */
export function nearestPointOnTrack(doc, position) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.segments)) {
    return null;
  }

  const user = normalisePoint(position);
  if (!user) return null;

  const userLatRad = user.lat * DEGREES_TO_RADIANS;
  const cosUserLat = Math.cos(userLatRad);

  let best = null;

  doc.segments.forEach((segment, segmentIndex) => {
    const rawPoints = Array.isArray(segment?.points) ? segment.points : [];
    const points = [];
    rawPoints.forEach((raw, index) => {
      const point = normalisePoint(raw);
      if (point) points.push({ ...point, index });
    });

    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];

      const ax =
        EARTH_RADIUS_METRES *
        cosUserLat *
        (normaliseLongitude(start.lng - user.lng) * DEGREES_TO_RADIANS);
      const ay =
        EARTH_RADIUS_METRES * ((start.lat - user.lat) * DEGREES_TO_RADIANS);
      const bx =
        EARTH_RADIUS_METRES *
        cosUserLat *
        (normaliseLongitude(end.lng - user.lng) * DEGREES_TO_RADIANS);
      const by =
        EARTH_RADIUS_METRES * ((end.lat - user.lat) * DEGREES_TO_RADIANS);

      const dx = bx - ax;
      const dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;

      let x = ax;
      let y = ay;
      if (lengthSquared > 0) {
        const t = Math.min(
          1,
          Math.max(0, -(ax * dx + ay * dy) / lengthSquared),
        );
        x = ax + dx * t;
        y = ay + dy * t;
      }

      const point = {
        lat: user.lat + (y / EARTH_RADIUS_METRES) * RADIANS_TO_DEGREES,
        lng: normaliseLongitude(
          user.lng +
            (x / (EARTH_RADIUS_METRES * cosUserLat)) * RADIANS_TO_DEGREES,
        ),
      };
      const distance = haversine(user, point);

      if (!best || distance < best.distance) {
        best = {
          point,
          distance,
          bearing: deriveCourse(user, point, { minDistanceMetres: 0.1 }),
          segmentIndex,
          pointIndex: start.index,
        };
      }
    }
  });

  return best;
}
