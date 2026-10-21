// track/export.js — GPX writer and GeoJSON projection

import { fileSafeName, lineGeometry, normalisePoint } from "./model.js";

const XML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => XML_ESCAPES[character]);

const text = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const isoTime = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const normalisedSegments = (doc) =>
  (doc?.segments ?? []).map((segment) =>
    (segment?.points ?? []).map(normalisePoint).filter(Boolean),
  );

const coordinateTimes = (doc) => {
  const segments = normalisedSegments(doc).filter(
    (segment) => segment.length >= 2,
  );
  if (segments.length === 0) return null;

  const times = [];
  for (const segment of segments) {
    const values = segment.map((point) =>
      point.t === undefined ? null : isoTime(point.t),
    );
    if (values.some((value) => value === null)) return null;
    times.push(values);
  }

  return times.length === 1 ? times[0] : times;
};

const child = (tag, value, indent) =>
  `${indent}<${tag}>${escapeXml(value)}</${tag}>`;

const pointElement = (point, tag, indent) => {
  const attributes = `lat="${escapeXml(point.lat)}" lon="${escapeXml(point.lng)}"`;
  const children = [];
  if (point.ele !== undefined)
    children.push(child("ele", point.ele, `${indent}  `));
  if (point.t !== undefined) {
    const time = isoTime(point.t);
    if (time) children.push(child("time", time, `${indent}  `));
  }

  if (children.length === 0) return `${indent}<${tag} ${attributes}/>`;
  return [
    `${indent}<${tag} ${attributes}>`,
    ...children,
    `${indent}</${tag}>`,
  ].join("\n");
};

const waypointElement = (waypoint, indent) => {
  const attributes = `lat="${escapeXml(waypoint.lat)}" lon="${escapeXml(waypoint.lng)}"`;
  const children = [];

  if (waypoint.ele !== undefined) {
    children.push(child("ele", waypoint.ele, `${indent}  `));
  }
  if (waypoint.t !== undefined) {
    const time = isoTime(waypoint.t);
    if (time) children.push(child("time", time, `${indent}  `));
  }
  for (const key of ["name", "cmt", "desc", "sym", "type"]) {
    const value = text(waypoint[key]);
    if (value) children.push(child(key, value, `${indent}  `));
  }

  if (children.length === 0) return `${indent}<wpt ${attributes}/>`;
  return [`${indent}<wpt ${attributes}>`, ...children, `${indent}</wpt>`].join(
    "\n",
  );
};

const lineHeader = (doc, name, indent) => {
  const lines = [];
  if (name) lines.push(child("name", name, `${indent}  `));
  for (const key of ["cmt", "desc", "type"]) {
    const value = text(doc[key]);
    if (value) lines.push(child(key, value, `${indent}  `));
  }
  return lines;
};

/** Serialise a document as GPX 1.1. */
export function toGPX(doc, { name } = {}) {
  const docName = text(name) ?? text(doc?.name);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="ogis.app" xmlns="http://www.topografix.com/GPX/1/1">',
  ];

  for (const waypoint of doc?.waypoints ?? []) {
    lines.push(waypointElement(waypoint, "  "));
  }

  if (doc?.kind !== "waypoints") {
    const route = doc?.gpxType === "rte" && (doc.segments?.length ?? 0) <= 1;
    if (route) {
      lines.push("  <rte>");
      lines.push(...lineHeader(doc, docName, "  "));
      for (const point of doc.segments?.[0]?.points ?? []) {
        lines.push(pointElement(point, "rtept", "    "));
      }
      lines.push("  </rte>");
    } else {
      lines.push("  <trk>");
      lines.push(...lineHeader(doc, docName, "  "));
      for (const segment of doc?.segments ?? []) {
        lines.push("    <trkseg>");
        for (const point of segment?.points ?? []) {
          lines.push(pointElement(point, "trkpt", "      "));
        }
        lines.push("    </trkseg>");
      }
      lines.push("  </trk>");
    }
  }

  lines.push("</gpx>");
  return lines.join("\n");
}

const waypointProperties = (waypoint) => {
  const properties = {};
  for (const key of ["name", "desc", "cmt", "sym", "type"]) {
    const value = text(waypoint[key]);
    if (value) properties[key] = value;
  }
  if (waypoint.t !== undefined) {
    const time = isoTime(waypoint.t);
    // Waypoint time is projected as an ISO string in properties.time.
    if (time) properties.time = time;
  }
  if (Array.isArray(waypoint.links) && waypoint.links.length) {
    properties.links = waypoint.links.map((link) => ({ ...link }));
  }
  return properties;
};

const waypointGeometry = (waypoint) => {
  const point = normalisePoint(waypoint);
  if (!point) return null;
  const coordinates = [point.lng, point.lat];
  if (point.ele !== undefined) coordinates.push(point.ele);
  return coordinates;
};

/** Project a document to a GeoJSON FeatureCollection. */
export function toGeoJSON(doc, { name } = {}) {
  const features = [];
  const geometry = lineGeometry(doc);

  if (geometry) {
    const properties = {};
    const docName = text(name) ?? text(doc?.name);
    if (docName) properties.name = docName;
    for (const key of ["desc", "cmt", "type"]) {
      const value = text(doc[key]);
      if (value) properties[key] = value;
    }
    if (doc?.gpxType === "rte" || doc?.gpxType === "trk") {
      properties._gpxType = doc.gpxType;
    }

    const times = coordinateTimes(doc);
    if (times) properties.coordinateProperties = { times };

    features.push({ type: "Feature", geometry, properties });
  }

  for (const waypoint of doc?.waypoints ?? []) {
    const coordinates = waypointGeometry(waypoint);
    if (!coordinates) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates },
      properties: waypointProperties(waypoint),
    });
  }

  return { type: "FeatureCollection", features };
}

const kindFallback = (doc) => {
  if (doc?.kind === "recording") return "recording";
  if (doc?.kind === "waypoints") return "waypoints";
  return "route";
};

/** Safe download filename for a document. */
export function trackFilename(doc, format, { name } = {}) {
  const extension = format === "gpx" ? "gpx" : "geojson";
  const fallback = `${kindFallback(doc)}-${doc?.id ?? "unknown"}`;
  const base = fileSafeName(text(name) ?? text(doc?.name), fallback).replace(
    /\.(gpx|geojson)$/i,
    "",
  );
  return `${base}.${extension}`;
}

/** MIME type for a track format. */
export function trackMime(format) {
  return format === "gpx" ? "application/gpx+xml" : "application/geo+json";
}
