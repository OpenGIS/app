// track/model.js — canonical track document model and value helpers

import { totalDistance } from "../geo.js";

const ELEVATION_SENTINELS = new Set([-9999, -19999, -32768]);

const isV2 = (raw) => raw && typeof raw === "object" && raw.v === 2;

const finiteNumber = (value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "boolean") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const text = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const pointsFrom = (rawPoints) => {
  if (!Array.isArray(rawPoints)) return [];
  const points = [];
  for (const raw of rawPoints) {
    const point = normalisePoint(raw);
    if (point) points.push(point);
  }
  return points;
};

/** Build a v2 route document from the legacy route shape. */
export function migrateRoute(raw) {
  if (isV2(raw)) return raw;
  const gpxType = raw?.gpxType === "rte" || raw?.type === "rte" ? "rte" : "trk";
  return {
    v: 2,
    id: raw?.id ?? createTrackId(),
    kind: "route",
    name: text(raw?.name),
    gpxType,
    createdAt: Number.isFinite(raw?.createdAt) ? raw.createdAt : null,
    source: { format: "legacy" },
    segments: [{ points: pointsFrom(raw?.points) }],
    waypoints: [],
  };
}

/** Build a v2 recording document from the legacy saved-recording shape. */
export function migrateRecording(raw) {
  if (isV2(raw)) return raw;
  const doc = {
    v: 2,
    id: raw?.id ?? createTrackId(),
    kind: "recording",
    name: text(raw?.name),
    gpxType: null,
    createdAt: finiteNumber(raw?.timestamp) ?? null,
    source: { format: "legacy" },
    segments: [{ points: pointsFrom(raw?.points) }],
    waypoints: [],
  };
  if (Number.isFinite(raw?.duration)) doc.duration = raw.duration;
  return doc;
}

/** Migrate the legacy active-recording shape; v2 shapes pass through. */
export function migrateActiveRecording(raw) {
  if (!raw || typeof raw !== "object") return raw;
  if (Array.isArray(raw.segments)) return raw;
  const { points, startTime, ...rest } = raw;
  const createdAt = finiteNumber(startTime) ?? finiteNumber(raw?.createdAt);
  return {
    ...rest,
    ...(createdAt !== undefined ? { createdAt } : {}),
    segments: [{ points: pointsFrom(points) }],
  };
}

/** Flatten segment points, excluding document waypoints. */
export function documentPoints(doc) {
  const points = [];
  for (const segment of doc?.segments ?? []) {
    for (const point of segment?.points ?? []) points.push(point);
  }
  return points;
}

/** Sum distance within each segment, never across segment gaps. */
export function documentDistance(doc) {
  let distance = 0;
  for (const segment of doc?.segments ?? []) {
    distance += totalDistance(segment?.points ?? []);
  }
  return distance;
}

/** Bounds covering segments and waypoints, or null when the document is empty. */
export function documentBounds(doc) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const include = (point) => {
    const p = normalisePoint(point);
    if (!p) return;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat > maxLat) maxLat = p.lat;
  };

  for (const segment of doc?.segments ?? []) {
    for (const point of segment?.points ?? []) include(point);
  }
  for (const waypoint of doc?.waypoints ?? []) include(waypoint);

  if (minLng === Infinity) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** Count of segment points (waypoints excluded). */
export function documentPointCount(doc) {
  return documentPoints(doc).length;
}

/** Count of document waypoints. */
export function waypointCount(doc) {
  return Array.isArray(doc?.waypoints) ? doc.waypoints.length : 0;
}

const coordinateFor = (point) => {
  const p = normalisePoint(point);
  if (!p) return null;
  const coordinate = [p.lng, p.lat];
  if (p.ele !== undefined) coordinate.push(p.ele);
  return coordinate;
};

/** LineString/MultiLineString for usable segments, or null. */
export function lineGeometry(doc) {
  const lines = [];
  for (const segment of doc?.segments ?? []) {
    const coordinates = (segment?.points ?? [])
      .map(coordinateFor)
      .filter(Boolean);
    if (coordinates.length >= 2) lines.push(coordinates);
  }
  if (lines.length === 0) return null;
  if (lines.length === 1) {
    return { type: "LineString", coordinates: lines[0] };
  }
  return { type: "MultiLineString", coordinates: lines };
}

/** Finite elevation in metres, discarding common sentinel values. */
export function normaliseElevation(value) {
  const n = finiteNumber(value);
  if (n === undefined) return undefined;
  if (ELEVATION_SENTINELS.has(n)) return undefined;
  return n;
}

/** Epoch milliseconds from a Date, ISO string or Unix seconds/milliseconds. */
export function normaliseTime(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return Math.round(value < 1e11 ? value * 1000 : value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return normaliseTime(Number(trimmed));
    }
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : undefined;
  }

  return undefined;
}

/** Normalise a point, dropping invalid coordinates and optional values. */
export function normalisePoint(point) {
  if (!point || typeof point !== "object") return null;
  const lat = finiteNumber(point.lat);
  const lng = finiteNumber(point.lng);
  if (lat === undefined || lng === undefined) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const result = { lat, lng };
  const ele = normaliseElevation(point.ele);
  if (ele !== undefined) result.ele = ele;
  const t = normaliseTime(point.t);
  if (t !== undefined) result.t = t;
  return result;
}

/** Strip path separators and reserved characters for a download filename. */
export function fileSafeName(name, fallback) {
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return cleaned || String(fallback ?? "track");
}

/** Collision-resistant document id. */
export function createTrackId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}
