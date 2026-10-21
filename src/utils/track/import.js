// track/import.js — GPX/GeoJSON import into canonical track documents

import { gpx as gpxToGeoJSON } from "@tmcw/togeojson";
import { createTrackId, normalisePoint, normaliseTime } from "./model.js";

export const MAX_TRACK_FILE_BYTES = 10 * 1024 * 1024;

/** Import failure carrying a stable `code` for callers to map. */
export class TrackImportError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "TrackImportError";
    this.code = code;
  }
}

const invalidGPX = () =>
  new TrackImportError("invalid-gpx", "Invalid GPX file");
const invalidGeoJSON = () =>
  new TrackImportError("invalid-geojson", "Invalid GeoJSON file");
const unsupportedFormat = () =>
  new TrackImportError("unsupported-format", "Unsupported track format");
const noImportableFeatures = () =>
  new TrackImportError("no-importable-features", "No importable features");

const cleanName = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const fileBaseName = (filename) => {
  const name = cleanName(
    String(filename ?? "")
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, ""),
  );
  return name;
};

const descendants = (element, name) => {
  if (!element?.getElementsByTagName) return [];
  return Array.from(element.getElementsByTagName("*")).filter(
    (node) => node.localName === name,
  );
};

const nodeText = (element, name) => {
  const node = descendants(element, name)[0];
  return node ? cleanName(node.textContent) : null;
};

const isParserError = (doc) =>
  Boolean(doc?.getElementsByTagName("parsererror").length) ||
  doc?.documentElement?.localName === "parsererror";

/** Detect a track format from its content, not its extension. */
export function detectTrackFormat(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("<")) return "gpx";
  if (trimmed.startsWith("{")) return "geojson";
  return null;
}

const pointFromCoordinate = (coordinate) => {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
  return normalisePoint({
    lat: coordinate[1],
    lng: coordinate[0],
    ele: coordinate.length > 2 ? coordinate[2] : undefined,
  });
};

const segmentFromCoordinates = (coordinates) => {
  if (!Array.isArray(coordinates)) return [];
  return coordinates.map(pointFromCoordinate).filter(Boolean);
};

const geometryToSegments = (geometry) => {
  if (!geometry || typeof geometry !== "object") return null;
  if (geometry.type === "LineString") {
    if (!Array.isArray(geometry.coordinates)) return null;
    return [segmentFromCoordinates(geometry.coordinates)];
  }
  if (geometry.type === "MultiLineString") {
    if (!Array.isArray(geometry.coordinates)) return null;
    return geometry.coordinates.map(segmentFromCoordinates);
  }
  return null;
};

const isLineGeometry = (geometry) =>
  geometry?.type === "LineString" || geometry?.type === "MultiLineString";

const isSupportedGeometry = (geometry) =>
  isLineGeometry(geometry) ||
  geometry?.type === "Point" ||
  geometry?.type === "MultiPoint";

const gpxTypeFromProperties = (properties) =>
  properties?._gpxType === "rte" || properties?.gpxType === "rte"
    ? "rte"
    : "trk";

const normaliseTimeList = (values) =>
  values.map((value) => normaliseTime(value));

/** Assign times only when the list length matches the point count. */
const extractTimes = (rawTimes, segments) => {
  if (!Array.isArray(rawTimes)) return null;
  const counts = segments.map((segment) => segment.length);
  const total = counts.reduce((sum, count) => sum + count, 0);

  if (segments.length === 1) {
    if (rawTimes.length === 1 && Array.isArray(rawTimes[0])) {
      return rawTimes[0].length === counts[0]
        ? [normaliseTimeList(rawTimes[0])]
        : null;
    }
    return rawTimes.length === counts[0] ? [normaliseTimeList(rawTimes)] : null;
  }

  if (rawTimes.length === segments.length && rawTimes.every(Array.isArray)) {
    return rawTimes.every((values, index) => values.length === counts[index])
      ? rawTimes.map(normaliseTimeList)
      : null;
  }

  if (rawTimes.length === total && !rawTimes.some(Array.isArray)) {
    let offset = 0;
    return counts.map((count) => {
      const values = rawTimes.slice(offset, offset + count);
      offset += count;
      return normaliseTimeList(values);
    });
  }

  return null;
};

const assignTimes = (points, times) => {
  for (let i = 0; i < points.length; i++) {
    if (times[i] !== undefined) points[i].t = times[i];
  }
};

const rawPointElements = (element) => {
  if (element.localName === "rte") {
    return [descendants(element, "rtept")];
  }
  return descendants(element, "trkseg").map((segment) =>
    descendants(segment, "trkpt"),
  );
};

/** Read <time> nodes from the parsed document when the library time list is short. */
const timesFromElement = (element, segments) => {
  if (!element) return null;

  const prepared = rawPointElements(element)
    .map((points) => {
      const times = [];
      for (const point of points) {
        const normalised = normalisePoint({
          lat: point.getAttribute("lat"),
          lng: point.getAttribute("lon"),
        });
        if (!normalised) continue;
        times.push(normaliseTime(nodeText(point, "time")));
      }
      return times;
    })
    .filter((times) => times.length >= 2);

  if (prepared.length !== segments.length) return null;
  if (
    prepared.some((times, index) => times.length !== segments[index].length)
  ) {
    return null;
  }
  return prepared;
};

/** Document-order trk/rte elements, with per-type indexes. */
const lineElementOrder = (root) => {
  const entries = [];
  const counters = { trk: 0, rte: 0 };
  for (const element of root.getElementsByTagName("*")) {
    if (element.localName !== "trk" && element.localName !== "rte") continue;
    const type = element.localName;
    entries.push({ type, index: counters[type]++, element });
  }
  return entries;
};

/** Reorder library features into document order when counts line up. */
const orderLineFeatures = (features, elements) => {
  const lineFeatures = features.filter((feature) =>
    isLineGeometry(feature?.geometry),
  );
  const byType = { trk: [], rte: [] };
  for (const feature of lineFeatures) {
    byType[gpxTypeFromProperties(feature.properties)].push(feature);
  }

  const elementsByType = { trk: [], rte: [] };
  for (const entry of elements) elementsByType[entry.type].push(entry.element);

  const aligned =
    byType.trk.length === elementsByType.trk.length &&
    byType.rte.length === elementsByType.rte.length;

  if (!aligned) {
    return lineFeatures.map((feature) => ({ feature, element: null }));
  }

  const counters = { trk: 0, rte: 0 };
  const ordered = [];
  for (const entry of elements) {
    const feature = byType[entry.type][counters[entry.type]++];
    if (feature) ordered.push({ feature, element: entry.element });
  }
  return ordered;
};

const validFeatureId = (id) => {
  if (typeof id === "string") return id.trim() || null;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  return null;
};

const lineEntry = (feature, element) => {
  const segments = geometryToSegments(feature.geometry);
  if (!segments) return null;

  const usable = segments.filter((segment) => segment.length > 0);
  if (!usable.some((segment) => segment.length >= 2)) return null;

  const properties =
    feature.properties && typeof feature.properties === "object"
      ? feature.properties
      : {};

  let times = extractTimes(
    properties.coordinateProperties?.times ?? properties.times,
    usable,
  );
  if (!times) times = timesFromElement(element, usable);
  if (times) {
    times.forEach((values, index) => assignTimes(usable[index], values));
  }

  return {
    segments: usable,
    name: cleanName(properties.name),
    desc: cleanName(properties.desc),
    cmt: cleanName(properties.cmt),
    type: cleanName(properties.type),
    gpxType: gpxTypeFromProperties(properties),
    id: validFeatureId(feature.id),
    createdAt: normaliseTime(properties.time) ?? null,
  };
};

const decorateWaypoint = (point, properties = {}) => {
  if (!point) return null;
  const waypoint = { ...point };
  for (const key of ["name", "desc", "cmt", "sym", "type"]) {
    const value = cleanName(properties[key]);
    if (value) waypoint[key] = value;
  }
  if (Array.isArray(properties.links) && properties.links.length) {
    waypoint.links = properties.links.map((link) => ({ ...link }));
  }
  return waypoint;
};

const waypointFromCoordinate = (coordinate, time, properties) => {
  const point = pointFromCoordinate(coordinate);
  if (!point) return null;
  return decorateWaypoint(normalisePoint({ ...point, t: time }), properties);
};

const waypointsFromGeoJSONFeature = (feature) => {
  const properties =
    feature.properties && typeof feature.properties === "object"
      ? feature.properties
      : {};
  const times = properties.coordinateProperties?.times ?? properties.times;
  const geometry = feature.geometry;

  if (geometry?.type === "Point") {
    const time =
      properties.time ??
      (Array.isArray(times)
        ? Array.isArray(times[0])
          ? times[0][0]
          : times[0]
        : undefined);
    const waypoint = waypointFromCoordinate(
      geometry.coordinates,
      time,
      properties,
    );
    return waypoint ? [waypoint] : [];
  }

  if (geometry?.type === "MultiPoint") {
    if (!Array.isArray(geometry.coordinates)) return [];
    const waypoints = [];
    geometry.coordinates.forEach((coordinate, index) => {
      const time =
        properties.time ??
        (Array.isArray(times)
          ? Array.isArray(times[index])
            ? times[index][0]
            : times[index]
          : undefined);
      const waypoint = waypointFromCoordinate(coordinate, time, properties);
      if (waypoint) waypoints.push(waypoint);
    });
    return waypoints;
  }

  return [];
};

const pointFromElement = (element) =>
  normalisePoint({
    lat: element.getAttribute("lat"),
    lng: element.getAttribute("lon"),
    ele: nodeText(element, "ele"),
    t: nodeText(element, "time"),
  });

const lineEntryFromElement = (element) => {
  const segments = rawPointElements(element)
    .map((points) => points.map(pointFromElement).filter(Boolean))
    .filter((segment) => segment.length > 0);

  if (!segments.some((segment) => segment.length >= 2)) return null;

  return {
    segments,
    name: nodeText(element, "name"),
    desc: nodeText(element, "desc"),
    cmt: nodeText(element, "cmt"),
    type: nodeText(element, "type"),
    gpxType: element.localName === "rte" ? "rte" : "trk",
    id: null,
    createdAt: null,
  };
};

/** Small localName-based parser for prefixed GPX documents. */
const parseByLocalName = (doc) => {
  const lines = [];
  const waypoints = [];

  for (const element of doc.getElementsByTagName("*")) {
    if (element.localName === "trk" || element.localName === "rte") {
      const line = lineEntryFromElement(element);
      if (line) lines.push(line);
    } else if (element.localName === "wpt") {
      const point = pointFromElement(element);
      const waypoint = decorateWaypoint(point, {
        name: nodeText(element, "name"),
        desc: nodeText(element, "desc"),
        cmt: nodeText(element, "cmt"),
        sym: nodeText(element, "sym"),
        type: nodeText(element, "type"),
      });
      if (waypoint) waypoints.push(waypoint);
    }
  }

  return { lines, waypoints };
};

const claimId = (usedIds) => (candidate) => {
  const valid =
    (typeof candidate === "string" && candidate.trim()) ||
    (typeof candidate === "number" && Number.isFinite(candidate));
  if (valid) {
    const id = String(candidate).trim();
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
  let id = createTrackId();
  while (usedIds.has(id)) id = createTrackId();
  usedIds.add(id);
  return id;
};

const buildDocuments = (
  lines,
  waypoints,
  { format, filename, fallbackName },
) => {
  if (lines.length === 0 && waypoints.length === 0)
    throw noImportableFeatures();

  const groupId = createTrackId();
  const usedIds = new Set();
  const claim = claimId(usedIds);
  const base = cleanName(fallbackName) ?? fileBaseName(filename);
  const docs = [];
  const source = () => ({
    format,
    ...(filename ? { filename } : {}),
    groupId,
    index: docs.length,
  });

  lines.forEach((entry, index) => {
    const stem = base ?? "Route";
    const name =
      entry.name ?? (lines.length > 1 ? `${stem} ${index + 1}` : stem);
    const doc = {
      v: 2,
      id: claim(entry.id),
      kind: "route",
      name,
      gpxType: entry.gpxType,
      createdAt: entry.createdAt,
      source: source(),
      segments: entry.segments.map((points) => ({ points })),
      waypoints: [],
    };
    for (const key of ["desc", "cmt", "type"]) {
      if (entry[key]) doc[key] = entry[key];
    }
    docs.push(doc);
  });

  if (waypoints.length) {
    if (docs.length === 1) {
      docs[0].waypoints = waypoints;
    } else {
      docs.push({
        v: 2,
        id: claim(null),
        kind: "waypoints",
        name: base ?? "Waypoints",
        gpxType: null,
        createdAt: null,
        source: source(),
        segments: [],
        waypoints,
      });
    }
  }

  return docs;
};

/** Parse a GPX string into canonical track documents. */
export function parseGPX(text, options = {}) {
  const doc = new DOMParser().parseFromString(
    String(text ?? ""),
    "application/xml",
  );
  if (isParserError(doc)) throw invalidGPX();
  if (!doc.documentElement || doc.documentElement.localName !== "gpx") {
    throw invalidGPX();
  }

  let collection;
  try {
    collection = gpxToGeoJSON(doc);
  } catch {
    throw invalidGPX();
  }

  const features = Array.isArray(collection?.features)
    ? collection.features
    : [];

  if (features.length === 0) {
    const fallback = parseByLocalName(doc);
    if (fallback.lines.length === 0 && fallback.waypoints.length === 0) {
      throw noImportableFeatures();
    }
    return buildDocuments(fallback.lines, fallback.waypoints, {
      format: "gpx",
      ...options,
    });
  }

  const lines = [];
  for (const { feature, element } of orderLineFeatures(
    features,
    lineElementOrder(doc.documentElement),
  )) {
    const entry = lineEntry(feature, element);
    if (entry) lines.push(entry);
  }

  const waypoints = [];
  for (const feature of features) {
    if (feature.geometry?.type !== "Point") continue;
    waypoints.push(...waypointsFromGeoJSONFeature(feature));
  }

  if (lines.length === 0 && waypoints.length === 0)
    throw noImportableFeatures();

  return buildDocuments(lines, waypoints, { format: "gpx", ...options });
}

/** Parse a GeoJSON string into canonical track documents. */
export function parseGeoJSON(text, options = {}) {
  let data;
  try {
    data = JSON.parse(String(text ?? ""));
  } catch {
    throw invalidGeoJSON();
  }

  if (Array.isArray(data)) throw invalidGeoJSON();

  let features;
  let single = false;

  if (data?.type === "FeatureCollection") {
    if (!Array.isArray(data.features)) throw invalidGeoJSON();
    features = data.features;
  } else if (data?.type === "Feature") {
    single = true;
    features = [data];
  } else if (isSupportedGeometry(data)) {
    single = true;
    features = [{ type: "Feature", geometry: data, properties: {} }];
  } else {
    throw invalidGeoJSON();
  }

  const lines = [];
  const waypoints = [];

  for (const feature of features) {
    if (!feature || feature.type !== "Feature") {
      if (single) throw invalidGeoJSON();
      continue;
    }

    const geometry = feature.geometry;
    if (isLineGeometry(geometry)) {
      const entry = lineEntry(feature, null);
      if (entry) lines.push(entry);
    } else if (geometry?.type === "Point" || geometry?.type === "MultiPoint") {
      waypoints.push(...waypointsFromGeoJSONFeature(feature));
    } else if (geometry) {
      throw invalidGeoJSON();
    }
  }

  if (lines.length === 0 && waypoints.length === 0)
    throw noImportableFeatures();

  return buildDocuments(lines, waypoints, { format: "geojson", ...options });
}

/** Read, detect and parse a File/Blob-like object. */
export async function parseTrackFile(file) {
  if (Number(file?.size) > MAX_TRACK_FILE_BYTES) {
    throw new TrackImportError("file-too-large", "Track file is too large");
  }

  const text = await file.text();
  const format = detectTrackFormat(text);
  if (!format) throw unsupportedFormat();

  return format === "gpx"
    ? parseGPX(text, { filename: file.name })
    : parseGeoJSON(text, { filename: file.name });
}
