/**
 * Demo geometry — the single source of truth for the E2E demo area.
 *
 * Parsed once at module scope from the committed GPS fixture
 * (`recording.geojson`). Node-only: uses `node:fs` and `node:url`, with no
 * browser, map or third-party dependency. Consumers derive every demo
 * coordinate from here, so nothing hardcodes the demo location.
 *
 * The demo area opens on the "Day 13" track, which starts at
 * Grand Falls-Windsor, Newfoundland (2018-09-13). Raw points are
 * `[lng, lat, elevation, unixTimestamp]`; distances are cumulative haversine
 * metres, never point indices.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Exact feature title of the demo track. */
const DAY = "Day 13";

/** Absolute path of the committed GeoJSON fixture. */
const fixtureName = "./recording.geojson";
const sourceFile = fileURLToPath(new URL(fixtureName, import.meta.url));

/** Length of the demo slice along the track, in metres. */
const SLICE_METRES = 2_000;

/** Number of opening slice points exported as the GPX route excerpt. */
const ROUTE_POINTS = 10;

/** Minimum half-extents the bounds must reach (covers a z16 viewport). */
const MIN_HALF = { lng: 0.02, lat: 0.012 };

/** Half-extents the bounds target overall (≈0.10° × 0.05°). */
const TARGET_HALF = { lng: 0.05, lat: 0.025 };

/** Half-extents of the seeded offline region, well inside the bounds. */
const OFFLINE_HALF = { lng: 0.01, lat: 0.006 };

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres between two `[lng, lat, ...]` points. */
function haversine(a, b) {
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[1])) *
      Math.cos(toRadians(b[1])) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** The longest MultiLineString segment of a feature, by point count. */
function longestSegment(segments) {
  return segments.reduce((longest, segment) =>
    segment.length > longest.length ? segment : longest,
  );
}

/** Raw points covering the first `metres` of a segment, cut by distance. */
function sliceByDistance(segment, metres) {
  const points = [segment[0]];
  let travelled = 0;
  for (let i = 1; i < segment.length; i += 1) {
    travelled += haversine(segment[i - 1], segment[i]);
    points.push(segment[i]);
    if (travelled >= metres) break;
  }
  return points;
}

/** Bounding box `{west, south, east, north}` of raw `[lng, lat, ...]` points. */
function bboxOf(points) {
  return {
    west: Math.min(...points.map((point) => point[0])),
    south: Math.min(...points.map((point) => point[1])),
    east: Math.max(...points.map((point) => point[0])),
    north: Math.max(...points.map((point) => point[1])),
  };
}

/** The raw point nearest halfway along a segment's cumulative distance. */
function midpoint(points) {
  let total = 0;
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    total += haversine(points[i - 1], points[i]);
    cumulative.push(total);
  }
  const half = total / 2;
  const index = cumulative.findIndex((value) => value >= half);
  return points[index === -1 ? points.length - 1 : index];
}

/** Convert a raw `[lng, lat, elevation, t]` point to `{lat, lng, t}`. */
const toPoint = ([lng, lat, , t]) => ({ lat, lng, t });

const collection = JSON.parse(readFileSync(sourceFile, "utf8"));
const feature = collection.features.find(
  (entry) => entry.properties?.title === DAY,
);
if (!feature) {
  throw new Error(`Demo fixture is missing the "${DAY}" feature`);
}

const segments = feature.geometry.coordinates;
const rawSlice = sliceByDistance(longestSegment(segments), SLICE_METRES);

const sliceBBox = bboxOf(rawSlice);
const [centerLng, centerLat] = midpoint(rawSlice);

/** Total haversine distance along the slice, in metres. */
const sliceDistance = rawSlice.reduce(
  (total, point, index) =>
    index === 0 ? total : total + haversine(rawSlice[index - 1], point),
  0,
);

/** Elapsed time along the slice, in seconds (`rawSlice` timestamps). */
const sliceDuration = rawSlice.at(-1)[3] - rawSlice[0][3];

const halfLng = Math.max(
  (sliceBBox.east - sliceBBox.west) / 2,
  MIN_HALF.lng,
  TARGET_HALF.lng,
);
const halfLat = Math.max(
  (sliceBBox.north - sliceBBox.south) / 2,
  MIN_HALF.lat,
  TARGET_HALF.lat,
);

/** The single derived demo object every consumer reads from. */
export const DEMO = {
  sourceFile,
  day: DAY,
  /** First point of the whole Day 13 feature. */
  start: toPoint(segments[0][0]),
  /** Opening ~2 km of the longest segment, as `{lat, lng, t}` points. */
  slice: rawSlice.map(toPoint),
  /** Bounding box of the `slice`. */
  sliceBBox,
  /** Total haversine distance along the `slice`, in metres. */
  sliceDistance,
  /** Elapsed time along the `slice`, in seconds. */
  sliceDuration,
  /** Midpoint of the `slice`. */
  center: { lat: centerLat, lng: centerLng },
  /** Box the fixture set covers: the slice expanded to the target extents. */
  bounds: {
    west: centerLng - halfLng,
    south: centerLat - halfLat,
    east: centerLng + halfLng,
    north: centerLat + halfLat,
  },
  /** Zoom the committed screenshot matrix uses. */
  screenshotZoom: 16,
  /** Small seeded offline region inside `bounds`. */
  offlineRegion: {
    west: centerLng - OFFLINE_HALF.lng,
    south: centerLat - OFFLINE_HALF.lat,
    east: centerLng + OFFLINE_HALF.lng,
    north: centerLat + OFFLINE_HALF.lat,
  },
  /** Opening slice points, exported as the GPX route excerpt. */
  route: rawSlice.slice(0, ROUTE_POINTS).map(toPoint),
};

export default DEMO;
