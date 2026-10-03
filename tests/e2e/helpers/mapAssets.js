import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { mapDefaults } from "../../../src/defaults/maplibre.js";

/**
 * Vendored map-asset stubs for the E2E suite (BUGS.md #4).
 *
 * The MapLibre style, sprites and glyphs otherwise come from
 * `https://www.ogis.org`, which intermittently returns HTTP 429 without CORS
 * headers — surfacing as console errors that fail `expectNoConsoleErrors`.
 * Slice 1 vendored the assets under `tests/e2e/fixtures/map/`; this module
 * serves them from there so a test never reaches the live origin.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP_FIXTURES = resolve(HERE, "..", "fixtures", "map");
const STYLE_FIXTURE = join(MAP_FIXTURES, "style.json");
const OG_ORIGIN_FIXTURES = join(MAP_FIXTURES, "www.ogis.org");

/** 5 s ceiling on the server-side glyph relay so a slow origin cannot hang a test. */
const RELAY_TIMEOUT_MS = 5000;

const CONTENT_TYPES = {
  ".json": "application/json",
  ".png": "image/png",
  ".pbf": "application/x-protobuf",
};

const CORS_HEADERS = { "access-control-allow-origin": "*" };

/** Fulfil with bytes and an explicit content type, always CORS-permissive. */
const fulfilBody = (route, body, contentType) =>
  route.fulfill({
    status: 200,
    headers: { ...CORS_HEADERS, "content-type": contentType },
    body,
  });

/**
 * Relay an unvendored glyph range from the live origin, server-side.
 *
 * Only glyph `.pbf` files reach here (e.g. a CJK range on a `?country=random`
 * README capture). The response is always HTTP 200 — on any failure it is an
 * empty body — so MapLibre never raises a console error over a missing range.
 */
const relayGlyphs = async (route, originalUrl) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
  try {
    const response = await fetch(originalUrl, { signal: controller.signal });
    if (response.ok) {
      const body = Buffer.from(await response.arrayBuffer());
      await fulfilBody(route, body, CONTENT_TYPES[".pbf"]);
      return;
    }
  } catch {
    // Non-ok, timeout or network error: fall through to graceful degradation.
  } finally {
    clearTimeout(timer);
  }
  await fulfilBody(route, Buffer.alloc(0), CONTENT_TYPES[".pbf"]);
};

/**
 * Install the style and ogis.org route stubs on a Playwright context (or page).
 * Installed at context level so stubs also cover service-worker requests and
 * are in place before any page is created.
 */
export const installMapAssetStubs = async (context) => {
  // a) Style — the app's exact style URL, served from the pinned fixture.
  await context.route(mapDefaults.style, async (route) => {
    let body;
    try {
      body = await readFile(STYLE_FIXTURE);
    } catch (error) {
      throw new Error(
        `Missing map style fixture at ${STYLE_FIXTURE} — run \`npm run fixtures:refresh\` (BUGS.md #4): ${error.message}`,
      );
    }
    await fulfilBody(route, body, CONTENT_TYPES[".json"]);
  });

  // b) Everything else the style points at, mirrored under the fixture root.
  await context.route("https://www.ogis.org/**", async (route) => {
    const requestUrl = route.request().url();
    // Keep the path percent-encoded: the fixture directories use encoded names.
    const pathname = new URL(requestUrl).pathname.replace(/^\/+/, "");

    const filePath = resolve(OG_ORIGIN_FIXTURES, pathname);
    // Guard against traversal: never serve outside the fixture root.
    if (
      filePath !== OG_ORIGIN_FIXTURES &&
      !filePath.startsWith(OG_ORIGIN_FIXTURES + sep)
    ) {
      await route.fulfill({ status: 404 });
      return;
    }

    const extension = extname(filePath).toLowerCase();
    try {
      const body = await readFile(filePath);
      await fulfilBody(
        route,
        body,
        CONTENT_TYPES[extension] ?? "application/octet-stream",
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        await route.fulfill({ status: 404 });
        return;
      }
      if (extension === ".pbf") {
        // A missing glyph range degrades gracefully via the relay.
        await relayGlyphs(route, requestUrl);
        return;
      }
      // A missing sprite/style companion is drift worth failing loudly on.
      await route.fulfill({ status: 404 });
    }
  });
};
