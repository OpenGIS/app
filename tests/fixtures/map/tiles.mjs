/**
 * Pure tile-math helpers for the map fixture generator and its unit tests.
 *
 * No DOM, network or map dependencies, so the generator and the test oracle
 * share exactly the same geometry without drifting apart.
 */

/**
 * Clamp a tile coordinate into the valid Web Mercator range for a zoom.
 *
 * @param {number} value
 * @param {number} max - Highest valid tile index (`2^z - 1`).
 * @returns {number}
 */
function clampTile(value, max) {
  return Math.max(0, Math.min(max, value));
}

/**
 * Convert a longitude/latitude pair to a Web Mercator slippy-map tile
 * coordinate at zoom z.
 *
 * @param {number} lng - Longitude in degrees (-180..180).
 * @param {number} lat - Latitude in degrees (-85.05..85.05).
 * @param {number} z - Zoom level.
 * @returns {{ x: number, y: number }} Integer tile coordinates.
 */
export function lonLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

/**
 * Convert a geographic bounds object to an inclusive range of tile
 * coordinates at zoom z.
 *
 * Coordinates are clamped to the valid Web Mercator tile space [0, 2^z-1].
 * Antimeridian-crossing bounds (east < west) are handled by sweeping the
 * whole longitude range, which is safe and simple.
 *
 * @param {{ west: number, south: number, east: number, north: number }} bounds
 * @param {number} z - Zoom level.
 * @returns {{ xMin: number, xMax: number, yMin: number, yMax: number }}
 */
export function tileBoundsToRange(bounds, z) {
  const max = 2 ** z - 1;

  let west = bounds.west;
  let east = bounds.east;

  // Antimeridian: east < west means the box spans the ±180 line, so include
  // the entire longitude range rather than trying to split it.
  const crossesAntimeridian = east < west;

  const topLeft = lonLatToTile(west, bounds.north, z);
  const bottomRight = lonLatToTile(east, bounds.south, z);

  let xMin;
  let xMax;
  if (crossesAntimeridian) {
    xMin = 0;
    xMax = max;
  } else {
    xMin = topLeft.x;
    xMax = bottomRight.x;
  }

  const yMin = topLeft.y;
  const yMax = bottomRight.y;

  return {
    xMin: clampTile(xMin, max),
    xMax: clampTile(xMax, max),
    yMin: clampTile(yMin, max),
    yMax: clampTile(yMax, max),
  };
}

/**
 * Enumerate every tile across the inclusive zoom range [minZoom, maxZoom]
 * that falls within the given bounds.
 *
 * @param {{ west: number, south: number, east: number, north: number }} bounds
 * @param {number} minZoom
 * @param {number} maxZoom
 * @returns {Array<{ z: number, x: number, y: number }>}
 */
export function enumerateTiles(bounds, minZoom, maxZoom) {
  const tiles = [];
  const lo = Math.max(0, Math.floor(minZoom));
  const hi = Math.min(22, Math.floor(maxZoom));
  if (lo > hi) return tiles;
  for (let z = lo; z <= hi; z++) {
    const { xMin, xMax, yMin, yMax } = tileBoundsToRange(bounds, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/**
 * Substitute {z}, {x} and {y} placeholders in a tile URL template. The
 * optional {-y} placeholder is also supported.
 *
 * @param {string} template - e.g. 'https://tiles.example.com/{z}/{x}/{y}.pbf'
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function tileUrlTemplateToUrl(template, z, x, y) {
  return template
    .replace("{z}", z)
    .replace("{x}", x)
    .replace(/\{-y\}/g, -y)
    .replace("{y}", y);
}
