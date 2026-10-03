/**
 * Vendored map-asset refresh script.
 *
 * Downloads the style, sprites and glyph ranges that the E2E suite needs and
 * mirrors them under this directory (`www.ogis.org/...`) so Playwright can
 * serve them from route stubs. This keeps tests independent of the live
 * origin (which intermittently returns HTTP 429 without CORS headers).
 *
 * The style is the single source of truth: every other URL is derived from
 * what the style itself declares. Dependency-free — uses the global `fetch`.
 *
 * Usage: npm run fixtures:refresh
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mapDefaults } from "../../../../src/defaults/maplibre.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLE_FILE = join(HERE, "style.json");
const GLYPH_RANGE = "0-255";
const REQUEST_TIMEOUT_MS = 10_000;

/** Collected `<relative path> — <bytes>` summary rows. */
const written = [];
/** Stack names that could not be downloaded. */
const skipped = [];
/** Hard failures (non-ok, non-404 requests or network errors). */
const failures = [];

/** Fetch with a 10s timeout, returning the Response (may be non-ok). */
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
async function ensureDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

/** Write a file and record its path/size in the summary. */
async function save(relativePath, body) {
  const absolutePath = join(HERE, relativePath);
  await ensureDir(absolutePath);
  await writeFile(absolutePath, body);
  written.push({ path: relativePath, bytes: body.byteLength });
}

/**
 * Map an absolute remote URL to a path mirrored under this directory, e.g.
 * `https://www.ogis.org/basemap/sprite` → `www.ogis.org/basemap/sprite`.
 */
function mirrorPath(url, suffix) {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname}${suffix}`;
}

/**
 * Collect the distinct font stacks declared by symbol layers, joined with a
 * literal comma as MapLibre does. Reads the style's flat `layers` array.
 */
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

/** Normalise `style.sprite` (string or `[{ id, url }]`) to a list of URLs. */
function collectSpriteUrls(style) {
  const sprite = style.sprite;
  if (typeof sprite === "string") return [sprite];
  if (Array.isArray(sprite)) {
    return sprite
      .map((entry) => entry?.url)
      .filter((url) => typeof url === "string");
  }
  return [];
}

/** Encode a glyph stack for a URL: spaces as %20, commas left literal. */
function encodeStack(stack) {
  return encodeURIComponent(stack).replace(/%2C/g, ",");
}

async function main() {
  // 1. Style — the source of truth. A failure here aborts immediately.
  let style;
  try {
    const response = await fetchWithTimeout(mapDefaults.style);
    if (!response.ok) {
      console.error(`FAILED ${mapDefaults.style} — HTTP ${response.status}`);
      process.exit(1);
    }
    const text = await response.text();
    await save("style.json", Buffer.from(text));
    style = JSON.parse(text);
  } catch (error) {
    console.error(`FAILED ${mapDefaults.style} — ${error.message}`);
    process.exit(1);
  }

  // 2. Sprites (1x only — the suite runs at devicePixelRatio 1).
  for (const spriteUrl of collectSpriteUrls(style)) {
    for (const suffix of [".json", ".png"]) {
      const requestUrl = `${spriteUrl}${suffix}`;
      try {
        const response = await fetchWithTimeout(requestUrl);
        if (!response.ok) {
          console.error(`FAILED ${requestUrl} — HTTP ${response.status}`);
          failures.push(requestUrl);
          continue;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        await save(mirrorPath(requestUrl, ""), bytes);
      } catch (error) {
        console.error(`FAILED ${requestUrl} — ${error.message}`);
        failures.push(requestUrl);
      }
    }
  }

  // 3. Glyphs — exactly the range the suite requests, per distinct stack.
  const glyphTemplate = style.glyphs;
  const stacks = glyphTemplate ? collectFontStacks(style) : [];
  for (const stack of stacks) {
    const encoded = encodeStack(stack);
    const requestUrl = glyphTemplate
      .replace("{fontstack}", encoded)
      .replace("{range}", GLYPH_RANGE);
    try {
      const response = await fetchWithTimeout(requestUrl);
      if (response.status === 404) {
        console.warn(
          `WARNING ${requestUrl} — HTTP 404, skipping stack "${stack}"`,
        );
        skipped.push(stack);
        continue;
      }
      if (!response.ok) {
        console.error(`FAILED ${requestUrl} — HTTP ${response.status}`);
        failures.push(requestUrl);
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      await save(mirrorPath(requestUrl, ""), bytes);
    } catch (error) {
      console.error(`FAILED ${requestUrl} — ${error.message}`);
      failures.push(requestUrl);
    }
  }

  // 4. Summary.
  console.log("\nWritten files:");
  for (const entry of written) {
    console.log(`  ${entry.path} — ${entry.bytes} bytes`);
  }
  console.log(`\nStacks found: ${stacks.length}`);
  console.log(`Stacks skipped: ${skipped.length}`);
  if (skipped.length) console.log(`  ${skipped.join(", ")}`);
  console.log(`Failures: ${failures.length}`);

  if (failures.length) process.exit(1);
}

await main();
