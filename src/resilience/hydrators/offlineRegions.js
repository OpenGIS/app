const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const validBounds = (bounds) => {
  if (!isPlainObject(bounds)) return false;

  const { west, south, east, north } = bounds;
  if (![west, south, east, north].every(isFiniteNumber)) return false;
  if (west < -180 || west > 180 || east < -180 || east > 180) return false;
  if (south < -90 || south > 90 || north < -90 || north > 90) return false;
  if (west > east || south > north) return false;

  return true;
};

/**
 * Normalise stored offline regions into the current schema.
 *
 * The top-level shape must be an array; anything else throws so the primitive
 * quarantines the value and falls back to defaults. Malformed entries are
 * dropped. Every retained region has safe numbers and a finite `createdAt`, so
 * panel formatting (`toLocaleString`, `new Date(...)`) cannot throw.
 *
 * @param {*} data - Raw decoded state, at any stored version.
 * @returns {Object[]}
 */
export function hydrateOfflineRegions(data) {
  if (!Array.isArray(data)) {
    throw new TypeError("offline regions state must be an array");
  }

  const regions = [];
  const ids = new Set();

  for (const raw of data) {
    if (!isPlainObject(raw)) continue;
    if (typeof raw.id !== "string" || !raw.id.trim()) continue;
    if (ids.has(raw.id.trim())) continue;
    if (typeof raw.name !== "string" || !raw.name.trim()) continue;
    if (!validBounds(raw.bounds)) continue;
    if (!isFiniteNumber(raw.minZoom) || !isFiniteNumber(raw.maxZoom)) continue;
    if (raw.minZoom > raw.maxZoom) continue;
    if (!isFiniteNumber(raw.tileCount) || raw.tileCount < 0) continue;
    if (!isFiniteNumber(raw.estimatedBytes) || raw.estimatedBytes < 0) continue;
    if (!isFiniteNumber(raw.createdAt)) continue;

    const id = raw.id.trim();
    ids.add(id);
    regions.push({
      ...raw,
      id,
      name: raw.name,
      bounds: {
        west: raw.bounds.west,
        south: raw.bounds.south,
        east: raw.bounds.east,
        north: raw.bounds.north,
      },
      minZoom: raw.minZoom,
      maxZoom: raw.maxZoom,
      tileCount: raw.tileCount,
      estimatedBytes: raw.estimatedBytes,
      createdAt: raw.createdAt,
    });
  }

  return regions;
}
