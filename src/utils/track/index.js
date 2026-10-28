// track/index.js — public track document helpers

export {
  createTrackId,
  documentBounds,
  documentDistance,
  documentPointCount,
  documentPoints,
  fileSafeName,
  lineGeometry,
  migrateActiveRecording,
  migrateRecording,
  migrateRoute,
  normaliseElevation,
  normalisePoint,
  normaliseTime,
  normaliseWaypoint,
  sanitiseTrackDocument,
  waypointCount,
} from "./model.js";

export {
  geodesicLine,
  ON_ROUTE_METRES,
  nearestPointOnTrack,
} from "./navigation.js";

export {
  MAX_TRACK_FILE_BYTES,
  TrackImportError,
  detectTrackFormat,
  parseGPX,
  parseGeoJSON,
  parseTrackFile,
} from "./import.js";

export { toGPX, toGeoJSON, trackFilename, trackMime } from "./export.js";

export { BRIGHT_COLORS, assignTrackColors, colorForId } from "./colors.js";
