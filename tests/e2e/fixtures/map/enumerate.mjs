/**
 * Pure demo-area tile enumeration shared by the fixture generator (`refresh.mjs`)
 * and its unit test.
 *
 * Keeping this logic in one place means the manifest-completeness test derives
 * exactly the same expected tile set the generator fetched — no drift between
 * production code and test oracle. No DOM, network or map dependencies.
 */

import { enumerateTiles } from "../../../../src/features/offline/tiles.js";

/** Default padding: one tile margin at each zoom. */
export const DEFAULT_TILE_MARGIN = 1;

/**
 * Enumerate the demo-area tiles for a set of zooms, padded by `margin` tiles in
 * every direction and deduplicated. The padded box guarantees a 1280×720
 * viewport at the screenshot zoom never hits a gap.
 *
 * @param {{ west:number, south:number, east:number, north:number }} bounds
 * @param {number[]} zooms
 * @param {number} [margin]
 * @returns {Array<{ z:number, x:number, y:number }>}
 */
export function paddedTiles(bounds, zooms, margin = DEFAULT_TILE_MARGIN) {
  const tiles = [];
  const seen = new Set();
  for (const z of zooms) {
    const max = 2 ** z - 1;
    const clamp = (v) => Math.max(0, Math.min(max, v));
    for (const tile of enumerateTiles(bounds, z, z)) {
      for (let x = clamp(tile.x - margin); x <= clamp(tile.x + margin); x++) {
        for (let y = clamp(tile.y - margin); y <= clamp(tile.y + margin); y++) {
          const key = `${z}/${x}/${y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          tiles.push({ z, x, y });
        }
      }
    }
  }
  return tiles;
}
