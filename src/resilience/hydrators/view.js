const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Normalise a stored view into the current schema.
 *
 * Field-level problems are repaired rather than rejected: an unusable centre or
 * zoom becomes `null`, and missing pitch/bearing default to 0 so legacy views
 * keep working. Only an uninterpretable top-level shape throws.
 *
 * @param {*} data - Raw decoded state, at any stored version.
 * @param {{ version?: number }} [context] - Stored schema context.
 * @returns {{ mapView: { center: { lat: number, lng: number } | null, zoom: number | null, pitch: number, bearing: number } }}
 */
export function hydrateView(data, { version } = {}) {
  if (!isPlainObject(data)) {
    throw new TypeError("view state must be an object");
  }

  if (Object.hasOwn(data, "mapView") && !isPlainObject(data.mapView)) {
    throw new TypeError("view state mapView must be an object");
  }

  const mapView = data.mapView ?? {};
  const rawCenter = mapView.center;

  const center =
    isPlainObject(rawCenter) &&
    isFiniteNumber(rawCenter.lat) &&
    isFiniteNumber(rawCenter.lng) &&
    rawCenter.lat >= -90 &&
    rawCenter.lat <= 90 &&
    rawCenter.lng >= -180 &&
    rawCenter.lng <= 180
      ? { lat: rawCenter.lat, lng: rawCenter.lng }
      : null;

  return {
    mapView: {
      center,
      zoom: isFiniteNumber(mapView.zoom) ? mapView.zoom : null,
      pitch: isFiniteNumber(mapView.pitch) ? mapView.pitch : 0,
      bearing: isFiniteNumber(mapView.bearing) ? mapView.bearing : 0,
    },
  };
}
