/**
 * URL hash utilities for map view sharing in OpenStreetMap format:
 * #map={zoom}/{lat}/{lng}/{pitch}/{bearing}
 *
 * The pitch and bearing segments are optional on read: a three-segment
 * #map={zoom}/{lat}/{lng} hash (as written by other map apps) parses with
 * both defaulting to 0. All five segments are always written.
 *
 * Example: #map=16/12.340000/56.780000/45/120
 */

/**
 * Formats a map view as a URL hash. Single source of truth for the format,
 * shared by `updateUrlHash` and the Info panel's share URL.
 * @param {number} zoom
 * @param {number} lat
 * @param {number} lng
 * @param {number} [pitch=0] - Camera tilt in degrees
 * @param {number} [bearing=0] - Compass bearing in degrees (0–360)
 * @returns {string}
 */
export function formatUrlHash(zoom, lat, lng, pitch = 0, bearing = 0) {
  return `#map=${Math.round(zoom)}/${lat.toFixed(6)}/${lng.toFixed(6)}/${Math.round(pitch)}/${Math.round(bearing)}`;
}

/**
 * Parses the current URL hash for a map view.
 * Accepts three-segment (pitch/bearing default to 0) and five-segment hashes;
 * any extra trailing segments are ignored.
 * @returns {{ zoom: number, center: [number, number], pitch: number, bearing: number } | null}
 */
export function parseUrlHash() {
  const match = window.location.hash.match(
    /^#map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)(?:\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?))?/,
  );
  if (!match) return null;
  return {
    zoom: parseFloat(match[1]),
    center: [parseFloat(match[3]), parseFloat(match[2])], // MapLibre uses [lng, lat]
    pitch: match[4] !== undefined ? parseFloat(match[4]) : 0,
    bearing: match[5] !== undefined ? parseFloat(match[5]) : 0,
  };
}

/**
 * Updates the URL hash with the current map view without adding a browser history entry.
 * @param {number} zoom
 * @param {number} lat
 * @param {number} lng
 * @param {number} [pitch=0]
 * @param {number} [bearing=0]
 */
export function updateUrlHash(zoom, lat, lng, pitch = 0, bearing = 0) {
  history.replaceState(null, "", formatUrlHash(zoom, lat, lng, pitch, bearing));
}
