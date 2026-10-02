// offline/download.js — the offline region download manager.
// Pre-warms the service worker's map cache by fetching every tile and glyph
// URL for a chosen region; the SW (see public/sw.js) caches successful GETs
// automatically, so no direct Cache API access is required here.
import {
  enumerateTiles,
  resolveSourceTiles,
  tileUrlTemplateToUrl,
} from "./tiles.js";

// Average size of a single tile, per source type, used for estimates.
const AVERAGE_BYTES = {
  vector: 60 * 1024, // ~60KB
  raster: 25 * 1024, // ~25KB
  "raster-dem": 30 * 1024, // ~30KB
  geojson: 60 * 1024,
  image: 25 * 1024,
  video: 25 * 1024,
};

const GLYPH_RANGE_STEP = 256;
const GLYPH_FIRST_RANGE = 0;
const GLYPH_LAST_RANGE = 65280;

/** Estimate bytes for a single tile of the given source type. */
export function averageBytesForType(type) {
  return AVERAGE_BYTES[type] ?? 60 * 1024;
}

/**
 * Estimate how many tiles and how many bytes downloading a region would
 * require, across all sources. The chosen zoom range is clamped to each
 * source's own min/max zoom.
 *
 * @param {Array<Object>} sourceList - Source objects from map.getStyle().sources
 * @param {{ west: number, south: number, east: number, north: number }} bounds
 * @param {number} minZoom
 * @param {number} maxZoom
 * @returns {{ tileCount: number, estimatedBytes: number }}
 */
export async function estimateRegion(sourceList, bounds, minZoom, maxZoom) {
  let tileCount = 0;
  let estimatedBytes = 0;

  for (const source of sourceList) {
    const min = Math.max(minZoom, source.minzoom ?? 0);
    const max = Math.min(maxZoom, source.maxzoom ?? 22);
    if (min > max) continue;

    const tiles = enumerateTiles(bounds, min, max);
    tileCount += tiles.length;
    estimatedBytes += tiles.length * averageBytesForType(source.type);
  }

  return { tileCount, estimatedBytes };
}

/**
 * Collect the distinct text-font fontstacks from all symbol layers, used to
 * pre-fetch glyph ranges so labels render offline.
 *
 * @param {Array<Object>} layers - Style layers
 * @returns {Array<Array<string>>} Distinct fontstack arrays
 */
export function collectFontstacks(layers) {
  const seen = new Set();
  const stacks = [];
  for (const layer of layers) {
    const fonts = layer.layout?.["text-font"];
    if (!Array.isArray(fonts) || fonts.length === 0) continue;
    const key = JSON.stringify(fonts);
    if (!seen.has(key)) {
      seen.add(key);
      stacks.push(fonts);
    }
  }
  return stacks;
}

/**
 * Build the list of glyph URLs for every fontstack and glyph range.
 *
 * @param {string} glyphTemplate - Style glyphs template, e.g. '.../{fontstack}/{range}.pbf'
 * @param {Array<Array<string>>} fontstacks
 * @returns {Array<string>}
 */
export function glyphUrlsForTemplate(glyphTemplate, fontstacks) {
  const urls = [];
  for (const stack of fontstacks) {
    const fontstack = stack.join(",");
    for (
      let range = GLYPH_FIRST_RANGE;
      range <= GLYPH_LAST_RANGE;
      range += GLYPH_RANGE_STEP
    ) {
      urls.push(
        glyphTemplate
          .replace("{fontstack}", fontstack)
          .replace("{range}", range),
      );
    }
  }
  return urls;
}

/**
 * Fetch a list of URLs with a bounded concurrency, reporting progress as each
 * resolves. Only successful (ok) responses are counted.
 *
 * @param {Array<string>} urls
 * @param {(done: number, total: number) => void} onProgress
 * @param {AbortSignal} [signal]
 * @returns {Promise<number>} Count of successful fetches
 */
export async function fetchAll(urls, onProgress = () => {}, signal) {
  let done = 0;
  let succeeded = 0;
  const total = urls.length;

  const worker = async (url) => {
    try {
      const response = await fetch(url, { signal });
      if (response.ok) succeeded++;
      // Drain the body so the response can be cached fully and connections reused.
      await response.arrayBuffer();
    } catch (err) {
      if (err.name === "AbortError") throw err;
      // Ignore per-URL failures — do not abort the whole download.
    } finally {
      done++;
      onProgress(done, total);
    }
  };

  const queue = [...urls];
  const limit = 8;
  const workers = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    workers.push(runWorker(queue, worker));
  }
  await Promise.all(workers);

  return succeeded;
}

async function runWorker(queue, worker) {
  while (queue.length > 0) {
    const url = queue.shift();
    await worker(url);
  }
}

/**
 * Build the full list of tile and glyph URLs for a region, using the current
 * map style to resolve each source's tile template. Shared by the download and
 * delete flows so they always target the same URLs.
 *
 * TileJSON sources (e.g. the `openmaptiles` planet source with a dated slug)
 * are resolved live against the CURRENT build, so a download always uses the
 * latest slug. On delete the slug may have changed since the region was
 * downloaded, so deletion is best-effort — some URLs may no longer match, and
 * that is acceptable.
 *
 * @param {Object} params
 * @param {{ west: number, south: number, east: number, north: number }} params.bounds
 * @param {number} params.minZoom
 * @param {number} params.maxZoom
 * @param {() => import('maplibre-gl').Map | null} params.getMap
 * @returns {Promise<{ tileUrls: Array<string>, glyphUrls: Array<string>, allUrls: Array<string> }>}
 */
export async function buildRegionUrls({ bounds, minZoom, maxZoom, getMap }) {
  const map = getMap();
  if (!map) throw new Error("Map is not ready");

  const style = map.getStyle();
  const sources = style.sources || {};
  const layers = style.layers || [];

  const tileUrls = [];

  for (const source of Object.values(sources)) {
    let resolved;
    try {
      resolved = await resolveSourceTiles(source);
    } catch (err) {
      // Skip sources that cannot be resolved; continue with the rest.
      continue;
    }
    const min = Math.max(minZoom, resolved.minzoom);
    const max = Math.min(maxZoom, resolved.maxzoom);
    if (min > max) continue;
    const tiles = enumerateTiles(bounds, min, max);
    for (const t of tiles) {
      tileUrls.push(tileUrlTemplateToUrl(resolved.template, t.z, t.x, t.y));
    }
  }

  // Glyphs: pre-fetch every range for every distinct fontstack so labels work offline.
  const fontstacks = collectFontstacks(layers);
  const glyphTemplate = style.glyphs || "";
  const glyphUrls = glyphTemplate
    ? glyphUrlsForTemplate(glyphTemplate, fontstacks)
    : [];

  return {
    tileUrls,
    glyphUrls,
    allUrls: [...tileUrls, ...glyphUrls],
  };
}

/**
 * Re-enumerate the tile + glyph URLs for a previously stored region, so its
 * cached tiles can be purged on delete. Reuses buildRegionUrls.
 *
 * @param {Object} params
 * @param {{ west: number, south: number, east: number, north: number }} params.bounds
 * @param {number} params.minZoom
 * @param {number} params.maxZoom
 * @param {() => import('maplibre-gl').Map | null} params.getMap
 * @returns {Promise<{ tileUrls: Array<string>, glyphUrls: Array<string>, allUrls: Array<string> }>}
 */
export async function regionUrlsForRegion({
  bounds,
  minZoom,
  maxZoom,
  getMap,
}) {
  return buildRegionUrls({ bounds, minZoom, maxZoom, getMap });
}

/**
 * Download a region: fetch all tiles for the chosen zoom range (clamped to
 * each source's range) plus all glyph ranges for labels, pre-warming the SW
 * map cache.
 *
 * @param {Object} params
 * @param {{ west: number, south: number, east: number, north: number }} params.bounds
 * @param {number} params.minZoom
 * @param {number} params.maxZoom
 * @param {(done: number, total: number) => void} [params.onProgress]
 * @param {AbortSignal} [params.signal]
 * @param {() => import('maplibre-gl').Map | null} params.getMap
 * @returns {Promise<{ tileCount: number, glyphCount: number, totalCount: number }>}
 */
export async function downloadRegion({
  bounds,
  minZoom,
  maxZoom,
  onProgress = () => {},
  signal,
  getMap,
}) {
  const { tileUrls, glyphUrls, allUrls } = await buildRegionUrls({
    bounds,
    minZoom,
    maxZoom,
    getMap,
  });

  await fetchAll(allUrls, onProgress, signal);

  return {
    tileCount: tileUrls.length,
    glyphCount: glyphUrls.length,
    totalCount: allUrls.length,
  };
}
