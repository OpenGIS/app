/**
 * Vendored map-asset refresh — the fixture generator.
 *
 * Fetches the LIVE production style, rewrites every committable-host URL
 * (sources, glyphs, sprites) into the `__E2E_MAP_BASE__/<host>/<path>`
 * placeholder form, leaves excluded hosts live (`esri-satellite`) and the
 * `attribution` stub untouched, and writes the canonical
 * [`style.json`](./style.json) fixture.
 *
 * It then derives the fetch list from that generated style — not from a
 * duplicated source table — and downloads, for the demo area padded by one
 * tile margin at each zoom:
 *
 *   - for each source: TileJSON when `url` is set (the rewritten descriptor is
 *     also stored so MapLibre resolves real tile URLs), otherwise its `tiles[]`
 *     templates;
 *   - every rendered glyph `0-255` for each font stack the style declares;
 *   - the 1× sprite metadata and atlas.
 *
 * Files land under `tests/fixtures/map/assets/<host>/<path>` — the same
 * scheme the `/__e2e_map__/**` middleware serves from `assets/**`. A manifest
 * (`assets.manifest.json`) records every stored path with bytes, source and zoom.
 *
 * Once the manifest is written, stale entries left over from previous runs are
 * pruned: every file under `assets/**` that is not listed in the new manifest is
 * unlinked, then any directories emptied by that are removed. Only paths under
 * `assets/**` are touched — `style.json`, `assets.manifest.json` and everything
 * else are left alone.
 *
 * Dependency-free — uses the global `fetch`.
 *
 * Usage: npm run fixtures:refresh
 */

import {
  mkdir,
  readdir,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mapDefaults } from "../../../src/defaults/maplibre.js";
import { tileUrlTemplateToUrl } from "../../../src/features/offline/tiles.js";
import { DEMO_AREA } from "./demoArea.mjs";
import { paddedTiles } from "./enumerate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS_ROOT = join(HERE, "assets");
const STYLE_FILE = join(HERE, "style.json");
const MANIFEST_FILE = join(HERE, "assets.manifest.json");

const REQUEST_TIMEOUT_MS = 30_000;
const CONCURRENCY = 12;
const TILE_MARGIN = 1;

/** `__E2E_MAP_BASE__` token the fixture style uses in place of the serving origin. */
const PLACEHOLDER = "__E2E_MAP_BASE__";

/** Stored records, keyed by relative asset path (deduplicated). */
const files = new Map();
/** Expected-but-absent tiles (upstream 204/404), recorded for the manifest. */
const absent = [];
/** Hard failures that abort the run. */
const failures = [];
/** Per-source tally for the report. */
const sourceStats = new Map();

const excludedById = Object.fromEntries(
  DEMO_AREA.excludedSources.map((entry) => [entry.id, entry]),
);
const committableHosts = new Set(DEMO_AREA.committableHosts);

/** Fetch with a timeout, returning the Response (may be non-ok). */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Recursively create the directory for a file path. */
const ensureDir = (filePath) => mkdir(dirname(filePath), { recursive: true });

/** The host of an absolute URL, or null when it is not http(s). */
function hostOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return parsed.host;
  } catch {
    return null;
  }
}

/**
 * Rewrite an absolute URL into placeholder form:
 * `https://h/p` → `__E2E_MAP_BASE__/h/p`. The host must be committable.
 *
 * Uses string splicing rather than `new URL` so tile/glyph template braces
 * (`{z}`, `{x}`, `{y}`, `{fontstack}`, `{range}`) are preserved verbatim.
 */
function toPlaceholder(url) {
  const parsed = new URL(url);
  const path = url.slice(
    url.indexOf(`${parsed.protocol}//`) +
      parsed.protocol.length +
      2 +
      parsed.host.length,
  );
  return `${PLACEHOLDER}/${parsed.host}${path}`;
}

/** Map an absolute remote URL to its path under `assets/`, e.g. `h/p`. */
function assetPath(url) {
  const parsed = new URL(url);
  const path = url.slice(
    url.indexOf(`${parsed.protocol}//`) +
      parsed.protocol.length +
      2 +
      parsed.host.length,
  );
  return `${parsed.host}${path}`;
}

/**
 * The path portion of a placeholder URL, without the host:
 * `__E2E_MAP_BASE__/<host>/<path>` → `/<path>`.
 */
function placeholderAssetPath(placeholderUrl) {
  const withoutMount = placeholderUrl
    .slice(`${PLACEHOLDER}/`.length)
    .split("?")[0];
  const slash = withoutMount.indexOf("/");
  return slash === -1 ? "/" : withoutMount.slice(slash);
}

/** The `assets/` path a TileJSON descriptor's placeholder URL is served from. */
function descriptorAssetPathFor(placeholderUrl) {
  const withoutMount = placeholderUrl
    .slice(`${PLACEHOLDER}/`.length)
    .split("?")[0];
  return withoutMount;
}

/** Record a fetched tile with its source id and zoom (dedupe by path). */
function recordFile(path, bytes, source, zoom) {
  if (!files.has(path)) {
    files.set(path, { path, bytes: bytes.byteLength, source, zoom });
  }
}

/** Record an absent (204/404) tile so the manifest accounts for the gap. */
function recordAbsent(path, source, zoom, status) {
  absent.push({ path, source, zoom, status });
}

/** Fetch bytes from `url`, returning a Buffer or null on 204/404. */
async function fetchBytes(url) {
  const response = await fetchWithTimeout(url);
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Persist a Buffer under `assets/<host>/<path>` and return the record. An
 * explicit `path` override stores under `assets/<path>` instead (used by TileJSON
 * descriptors, whose serving path differs from their upstream URL).
 */
async function store(url, bytes, source, zoom, pathOverride = null) {
  const path = pathOverride ?? assetPath(url);
  const absolutePath = join(ASSETS_ROOT, path);
  await ensureDir(absolutePath);
  await writeFile(absolutePath, bytes);
  recordFile(path, bytes, source, zoom);
  return absolutePath;
}

/** Fetch, score and store one URL; returns true when a file was written. */
async function fetchAndStore(url, source, zoom) {
  let bytes;
  try {
    bytes = await fetchBytes(url);
  } catch (error) {
    failures.push(`${url} — ${error.message}`);
    return false;
  }
  if (bytes === null) {
    recordAbsent(assetPath(url), source, zoom, "204/404");
    return false;
  }
  try {
    await store(url, bytes, source, zoom);
  } catch (error) {
    failures.push(`${url} — ${error.message}`);
    return false;
  }
  return true;
}

/** Run `worker` over `items` with a bounded concurrency. */
async function runPool(items, worker) {
  const queue = [...items];
  const runners = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (queue.length) {
        await worker(queue.shift());
      }
    },
  );
  await Promise.all(runners);
}

/**
 * Assert a URL's host is committable, aborting the run on a policy violation.
 * Returns the host for convenience.
 */
function assertCommittable(url, context) {
  const host = hostOf(url);
  if (!host || !committableHosts.has(host)) {
    failures.push(
      `Policy violation in ${context}: host "${host}" is neither committable nor excluded (${url})`,
    );
    return null;
  }
  return host;
}

/** Collect the distinct font stacks declared by symbol layers (MapLibre order). */
function collectFontStacks(style) {
  const stacks = new Set();
  for (const layer of style.layers ?? []) {
    if (layer?.type !== "symbol") continue;
    const font = layer?.layout?.["text-font"];
    if (Array.isArray(font) && font.every((f) => typeof f === "string")) {
      stacks.add(font.join(","));
    }
  }
  return [...stacks].sort();
}

/** Encode a glyph stack for a URL: spaces as %20, commas left literal. */
const encodeStack = (stack) => encodeURIComponent(stack).replace(/%2C/g, ",");

/** Live upstream URLs and templates per source id, captured before rewriting. */
const liveById = new Map();

/**
 * Bump a placeholder path to a distinct `.json` descriptor path so a TileJSON
 * descriptor never collides with a same-prefixed tile directory (e.g.
 * OpenFreeMap's `/planet` descriptor vs `/planet/<slug>/…` tiles).
 */
function descriptorPlaceholder(url) {
  const placeholder = toPlaceholder(url);
  const parsed = new URL(url);
  const segment = parsed.pathname.split("/").pop() ?? "";
  return segment.includes(".") ? placeholder : `${placeholder}.json`;
}

/**
 * Step 1 — fetch the live style and rewrite committable-host URLs to the
 * placeholder form. Excluded hosts and the attribution stub stay as-is.
 */
async function buildFixtureStyle() {
  const response = await fetchWithTimeout(mapDefaults.style);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${mapDefaults.style}`);
  }
  const style = await response.json();

  // Sources: rewrite each source whose host is committable; leave excluded
  // sources live; reject unknown hosts.
  for (const [id, source] of Object.entries(style.sources)) {
    if (excludedById[id]) continue;
    const live = { url: null, tiles: null };
    if (typeof source.url === "string") {
      if (assertCommittable(source.url, `source "${id}" url`)) {
        live.url = source.url;
        source.url = descriptorPlaceholder(source.url);
      }
    }
    if (Array.isArray(source.tiles)) {
      live.tiles = [...source.tiles];
      source.tiles = source.tiles.map((template) => {
        if (!assertCommittable(template, `source "${id}" tiles`))
          return template;
        return toPlaceholder(template);
      });
    }
    liveById.set(id, live);
    if (typeof source.url !== "string" && !Array.isArray(source.tiles)) {
      failures.push(
        `Policy violation: source "${id}" is neither excluded nor declares a url/tiles`,
      );
    }
  }

  // Glyphs.
  if (typeof style.glyphs === "string") {
    if (assertCommittable(style.glyphs, "glyphs")) {
      style.glyphs = toPlaceholder(style.glyphs);
    }
  }

  // Sprites (string or [{ id, url }]).
  if (typeof style.sprite === "string") {
    if (assertCommittable(style.sprite, "sprite")) {
      style.sprite = toPlaceholder(style.sprite);
    }
  } else if (Array.isArray(style.sprite)) {
    for (const sprite of style.sprite) {
      if (
        typeof sprite?.url === "string" &&
        assertCommittable(sprite.url, "sprite")
      ) {
        sprite.url = toPlaceholder(sprite.url);
      }
    }
  }

  return style;
}

/**
 * Step 2 — derive and fetch the tile list for one source from the *generated*
 * style. Returns nothing; records files/absences/failures.
 */
async function fetchSourceTiles(id, source, style) {
  const excluded = excludedById[id];
  if (excluded) return;

  const stats = {
    id,
    type: source.type,
    tiles: 0,
    absent: 0,
    descriptor: false,
  };
  sourceStats.set(id, stats);
  // Resolve the live upstream template + zoom range from the URLs captured
  // before rewriting (the generated style only holds placeholder forms).
  const live = liveById.get(id) ?? {};
  let templateLive;
  let minzoom = source.minzoom ?? 0;
  let maxzoom = source.maxzoom ?? 22;

  if (Array.isArray(live.tiles) && live.tiles.length) {
    templateLive = live.tiles[0];
  } else if (typeof live.url === "string") {
    // TileJSON descriptor: fetch live, resolve its tiles, and store the
    // rewritten descriptor under assets/ so MapLibre resolves real tile URLs.
    const descriptorLive = live.url;
    let tileJSON;
    try {
      const response = await fetchWithTimeout(descriptorLive);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      tileJSON = await response.json();
    } catch (error) {
      failures.push(`${descriptorLive} — ${error.message}`);
      return;
    }
    const tiles = tileJSON.tiles ?? [];
    if (!tiles.length) {
      failures.push(`${descriptorLive} — TileJSON declared no tiles`);
      return;
    }
    templateLive = tiles[0];
    if (source.minzoom == null && tileJSON.minzoom != null)
      minzoom = tileJSON.minzoom;
    if (source.maxzoom == null && tileJSON.maxzoom != null)
      maxzoom = tileJSON.maxzoom;

    // Store the descriptor with its tiles rewritten to the placeholder form,
    // under the same `.json` path the rewritten style points at.
    const descriptorFixture = structuredClone(tileJSON);
    if (Array.isArray(descriptorFixture.tiles)) {
      descriptorFixture.tiles = descriptorFixture.tiles.map(toPlaceholder);
    }
    try {
      await store(
        descriptorLive,
        Buffer.from(JSON.stringify(descriptorFixture, null, 2)),
        id,
        null,
        descriptorAssetPathFor(source.url),
      );
      stats.descriptor = true;
    } catch (error) {
      failures.push(`${descriptorLive} (descriptor) — ${error.message}`);
    }
  } else {
    failures.push(`Source "${id}" has neither a tiles array nor a url`);
    return;
  }

  // Clamp the source's zoom range to the demo coverage and enumerate tiles,
  // padded by one tile margin at each zoom.
  const zooms = DEMO_AREA.coverageZooms.filter(
    (z) => z >= minzoom && z <= maxzoom,
  );
  stats.zooms = zooms;
  stats.minzoom = minzoom;
  stats.maxzoom = maxzoom;
  stats.template = templateLive;

  const tiles = paddedTiles(DEMO_AREA.bounds, zooms, TILE_MARGIN);

  await runPool(tiles, async ({ z, x, y }) => {
    const url = tileUrlTemplateToUrl(templateLive, z, x, y);
    const stored = await fetchAndStore(url, id, z);
    if (stored) stats.tiles += 1;
    else stats.absent += 1;
  });
}

/**
 * Recover the live origin for a placeholder URL, given the host is committable.
 * Placeholder form is `__E2E_MAP_BASE__/<host>/<path>`, and every committable
 * host is https, so the live origin is simply `https://<host>`.
 */
function liveOriginFromPlaceholder(placeholderUrl) {
  const host = placeholderUrl.split("?")[0].split("/")[1];
  return `https://${host}`;
}

/** Step 3 — sprites (1× metadata + atlas) from the generated style. */
async function fetchSprites(style) {
  const spriteUrls = [];
  if (typeof style.sprite === "string") {
    spriteUrls.push(style.sprite);
  } else if (Array.isArray(style.sprite)) {
    for (const sprite of style.sprite) {
      if (typeof sprite?.url === "string") spriteUrls.push(sprite.url);
    }
  }

  const requests = [];
  for (const placeholderUrl of spriteUrls) {
    const base = `${liveOriginFromPlaceholder(placeholderUrl)}${placeholderAssetPath(placeholderUrl)}`;
    for (const suffix of [".json", ".png"]) {
      requests.push({ url: `${base}${suffix}`, source: "sprite", zoom: null });
    }
  }

  await runPool(requests, async ({ url, source, zoom }) => {
    await fetchAndStore(url, source, zoom);
  });
}

/** Step 4 — glyphs for every font stack, for each committed range. */
async function fetchGlyphs(style) {
  if (typeof style.glyphs !== "string") return;
  const stacks = collectFontStacks(style);
  const requests = [];
  for (const stack of stacks) {
    for (const range of DEMO_AREA.glyphRanges) {
      const live = `${liveOriginFromPlaceholder(style.glyphs)}${placeholderAssetPath(style.glyphs)}`;
      const url = live
        .replace("{fontstack}", encodeStack(stack))
        .replace("{range}", range);
      requests.push({ url, source: "glyph", zoom: null });
    }
  }
  await runPool(requests, async ({ url, source, zoom }) => {
    await fetchAndStore(url, source, zoom);
  });
}

/**
 * Prune stale files under `assets/**`: any file not listed in the freshly written
 * manifest is unlinked, then directories left empty are removed. Idempotent, and
 * scoped strictly to `assets/**` — the manifest and style fixtures are outside it.
 */
async function pruneStaleFiles(allFiles) {
  const keep = new Set(allFiles.map((file) => file.path));
  let count = 0;
  let bytes = 0;

  async function walk(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, relative);
        if ((await readdir(absolute)).length === 0) await rmdir(absolute);
      } else if (entry.isFile() && !keep.has(relative)) {
        bytes += (await stat(absolute)).size;
        await unlink(absolute);
        count += 1;
      }
    }
  }

  await walk(ASSETS_ROOT, "");
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  console.log(`Pruned ${count} stale files (${mb} MB)`);
}

/** Step 5 — write the manifest, prune stale files and print the report. */
async function writeManifest(style) {
  const allFiles = [...files.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const manifest = {
    generatedFrom: mapDefaults.style,
    bounds: DEMO_AREA.bounds,
    coverageZooms: DEMO_AREA.coverageZooms,
    fonts: collectFontStacks(style),
    sources: [...sourceStats.values()].map((stats) => ({
      id: stats.id,
      type: stats.type,
      template: stats.template ?? null,
      minzoom: stats.minzoom ?? null,
      maxzoom: stats.maxzoom ?? null,
      zooms: stats.zooms ?? [],
      descriptor: stats.descriptor,
      stored: stats.tiles,
      absent: stats.absent,
    })),
    files: allFiles,
    absent: absent.sort((a, b) => a.path.localeCompare(b.path)),
  };
  await ensureDir(join(ASSETS_ROOT, ".keep"));
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  await pruneStaleFiles(allFiles);
  return allFiles;
}

async function main() {
  // 1. Live style → rewritten canonical fixture style.
  let style;
  try {
    style = await buildFixtureStyle();
    if (failures.length) throw new Error(failures.join(" | "));
  } catch (error) {
    console.error(`FAILED to build fixture style — ${error.message}`);
    process.exit(1);
  }
  await writeFile(STYLE_FILE, `${JSON.stringify(style, null, 2)}\n`);

  // 2. Tiles for every non-excluded source, derived from the generated style.
  for (const [id, source] of Object.entries(style.sources)) {
    await fetchSourceTiles(id, source, style);
  }

  // 3. Sprites and glyphs.
  await fetchSprites(style);
  await fetchGlyphs(style);

  // 4. Manifest + report.
  const allFiles = await writeManifest(style);
  const totalBytes = allFiles.reduce((sum, file) => sum + file.bytes, 0);

  console.log(`\nFixture style: ${STYLE_FILE}`);
  console.log(`Manifest:      ${MANIFEST_FILE}`);
  console.log(`\nPer-source breakdown:`);
  for (const stats of sourceStats.values()) {
    console.log(
      `  ${stats.id.padEnd(16)} type=${String(stats.type).padEnd(10)} zooms=${(stats.zooms ?? []).join(",")} stored=${stats.tiles} absent=${stats.absent}`,
    );
  }
  const bySource = new Map();
  for (const file of allFiles) {
    const key = file.source;
    const entry = bySource.get(key) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += file.bytes;
    bySource.set(key, entry);
  }
  console.log(`\nStored files by source:`);
  for (const [source, entry] of bySource) {
    console.log(
      `  ${source.padEnd(16)} ${String(entry.count).padStart(5)} files  ${entry.bytes} bytes`,
    );
  }
  console.log(`\nTotal: ${allFiles.length} files, ${totalBytes} bytes`);
  console.log(`Absent (204/404): ${absent.length}`);
  console.log(`Failures: ${failures.length}`);
  if (failures.length) {
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}

await main();
