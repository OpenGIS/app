/**
 * E2E-only Vite plugin: serve the committed map fixture set same-origin.
 *
 * Registered from `vite.config.js` only when `VITE_E2E_FIXTURES=1` (set by
 * `playwright.config.js`'s webServer env), so production builds are untouched.
 *
 * Files live under `tests/e2e/fixtures/map/site/**` and are mirrored at
 * `/__e2e_map__/**`, keyed by `<host>/<pathname>` (e.g.
 * `https://tile.ogis.app/terrain/9/1/1.pbf` →
 * `site/tile.ogis.app/terrain/9/1/1.pbf`). Glyphs and sprites are vendored the
 * same way under `site/www.ogis.org/**` by the generator.
 *
 * Missing assets degrade by kind, mirroring the pre-existing glyph behaviour:
 * tiles and glyphs return an instant empty 200 (so a missing range never
 * reaches the network or raises a console error), while a missing sprite —
 * genuine drift — returns 404 loudly.
 */

import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = resolve(HERE, "site");

/** URL prefix the plugin answers on. Kept in sync with the style placeholder. */
export const E2E_MAP_MOUNT = "/__e2e_map__";

/** Token the fixture style uses in place of the serving origin. */
export const E2E_MAP_PLACEHOLDER = "__E2E_MAP_BASE__";

const CONTENT_TYPES = {
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pbf": "application/x-protobuf",
};

/** Extensions that represent individual tiles or glyph ranges: degrade softly. */
const TILE_EXTENSIONS = new Set([".pbf", ".webp", ".png", ".jpg", ".jpeg"]);

/** A sprite request (its `.json` metadata or `.png` atlas) must fail loudly. */
const isSprite = (pathname) => /(?:^|\/)sprite\.(?:json|png)$/i.test(pathname);

const setHeaders = (res, contentType) => {
  res.setHeader("content-type", contentType);
  res.setHeader("access-control-allow-origin", "*");
};

const send = (res, status, contentType, body = "") => {
  res.statusCode = status;
  setHeaders(res, contentType);
  res.end(body);
};

/**
 * Rewrite the `__E2E_MAP_BASE__` origin placeholder inside a served JSON body
 * (TileJSON descriptors, sprite metadata) to the request origin + mount. JSON
 * fixtures are the only asset kind that embeds the placeholder; tiles, glyph
 * ranges and sprite atlases are binary and pass through untouched. Resolving the
 * placeholder here — extension-based, independent of the browser `Accept`
 * header — keeps every served JSON path free of the raw placeholder.
 */
export const substitutePlaceholder = (body, extension, base) => {
  if (extension !== ".json") return body;
  return body.toString("utf8").split(E2E_MAP_PLACEHOLDER).join(base);
};

/** Decode a URL path; returns null when the encoding is malformed. */
const safeDecode = (pathname) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
};

/** Candidate absolute paths for a request (raw, then URL-decoded). */
const candidatePaths = (pathname) => {
  const names = [pathname];
  const decoded = safeDecode(pathname);
  if (decoded && decoded !== pathname) names.push(decoded);

  const candidates = [];
  for (const name of names) {
    const filePath = resolve(SITE_ROOT, name);
    if (filePath.startsWith(SITE_ROOT + sep)) {
      candidates.push(filePath);
    }
  }
  return candidates;
};

const serveMissing = (res, pathname, origin) => {
  const extension = extname(pathname).toLowerCase();
  if (isSprite(pathname)) {
    return send(res, 404, "text/plain", "Missing sprite fixture");
  }
  if (TILE_EXTENSIONS.has(extension)) {
    // Empty tile/glyph range: no network hit, no console error.
    return send(
      res,
      200,
      CONTENT_TYPES[extension] ?? "application/octet-stream",
      Buffer.alloc(0),
    );
  }
  if (extension === "" || extension === ".json") {
    // A TileJSON descriptor. It must carry a non-empty `tiles` template:
    // MapLibre expands `urls[...].replace(...)` and throws on an empty list.
    // Point it at a same-origin stub the middleware will answer with empty 200.
    const template = `${origin}${E2E_MAP_MOUNT}/__e2e_missing__/{z}/{x}/{y}.pbf`;
    return send(
      res,
      200,
      "application/json",
      JSON.stringify({ tiles: [template] }),
    );
  }
  return send(res, 404, "text/plain", "Not found");
};

const serveRequest = async (res, pathname, origin) => {
  for (const filePath of candidatePaths(pathname)) {
    try {
      const raw = await readFile(filePath);
      const extension = extname(filePath).toLowerCase();
      const body = substitutePlaceholder(
        raw,
        extension,
        `${origin}${E2E_MAP_MOUNT}`,
      );
      return send(
        res,
        200,
        CONTENT_TYPES[extension] ?? "application/octet-stream",
        body,
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        return send(res, 500, "text/plain", "Fixture read error");
      }
    }
  }
  serveMissing(res, pathname, origin);
};

/** Vite plugin factory. Add to `plugins` only when `VITE_E2E_FIXTURES=1`. */
export const e2eMapFixtures = () => ({
  name: "ogis-e2e-map-fixtures",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();

      const rawUrl = req.url ?? "";
      const pathname = rawUrl.split("?")[0];
      if (pathname !== E2E_MAP_MOUNT && !pathname.startsWith(E2E_MAP_MOUNT + "/")) {
        return next();
      }

      const relative = pathname.slice(E2E_MAP_MOUNT.length).replace(/^\/+/, "");
      const origin = `http://${req.headers.host ?? "localhost"}`;
      serveRequest(res, relative, origin).catch(() =>
        send(res, 500, "text/plain", "Fixture middleware error"),
      );
    });
  },
});
