import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mapDefaults } from "../../../src/defaults/maplibre.js";
import {
  E2E_MAP_MOUNT,
  E2E_MAP_PLACEHOLDER,
} from "../../fixtures/map/vitePlugin.mjs";

/**
 * Map-asset stubs for the E2E suite.
 *
 * The committed fixture style ([`fixtures/map/style.json`](../../fixtures/map/style.json))
 * now points every committable source at the `__E2E_MAP_BASE__` placeholder, so
 * tiles, glyphs and sprites load same-origin from the E2E Vite middleware with
 * **zero Playwright interception** (`tests/fixtures/map/vitePlugin.mjs`).
 *
 * This module therefore only does three things:
 *
 *   1. serves the app's style URL from the pinned fixture, substituting the
 *      placeholder with the page origin + fixture mount (never a hardcoded port);
 *   2. serves the Esri satellite raster a fast 404 — Esri imagery is excluded
 *      for licensing and the app's graceful-degradation path stays exercised;
 *   3. blocks every other non-localhost request, so a live dependency cannot
 *      creep back into the suite unnoticed.
 *
 * Missing fixture tiles/glyphs degrade to an instant empty 200 in the Vite
 * middleware; a missing sprite or style still fails loudly.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLE_FIXTURE = join(HERE, "..", "..", "fixtures", "map", "style.json");

const CORS_HEADERS = { "access-control-allow-origin": "*" };

/** True for http(s) requests to anything other than the local dev server. */
const isExternalRequest = (url) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
};

/**
 * Resolve the app origin for a style request. The fixture's placeholder must be
 * substituted with the page's own origin, not the (cross-origin) style URL's.
 */
const requestOrigin = (request, context) => {
  try {
    const frameUrl = request.frame()?.url();
    if (frameUrl) return new URL(frameUrl).origin;
  } catch {
    // Service-worker-initiated or detached request; fall through.
  }
  const pageUrl = context
    .pages()
    .map((page) => page.url())
    .find(Boolean);
  if (pageUrl) return new URL(pageUrl).origin;
  return new URL(request.url()).origin;
};

/** Serve the pinned fixture style with the origin placeholder substituted. */
const serveStyle = async (route, context) => {
  let template;
  try {
    template = await readFile(STYLE_FIXTURE, "utf8");
  } catch (error) {
    throw new Error(
      `Missing map style fixture at ${STYLE_FIXTURE} — run \`npm run fixtures:refresh\` (see docs/9.testing.md): ${error.message}`,
    );
  }
  const base = `${requestOrigin(route.request(), context)}${E2E_MAP_MOUNT}`;
  const body = template.split(E2E_MAP_PLACEHOLDER).join(base);
  await route.fulfill({
    status: 200,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
    body,
  });
};

/**
 * Install the map-asset stubs on a Playwright context. Installed at context
 * level so stubs also cover service-worker requests and are in place before any
 * page is created.
 */
export const installMapAssetStubs = async (context) => {
  await context.route(isExternalRequest, async (route) => {
    const request = route.request();
    if (request.url() === mapDefaults.style) {
      await serveStyle(route, context);
      return;
    }
    if (request.url().includes("server.arcgisonline.com")) {
      // Esri imagery is excluded for licensing; fail fast and predictably.
      await route.fulfill({ status: 404, headers: CORS_HEADERS, body: "" });
      return;
    }
    await route.abort("blockedbyclient");
    throw new Error(
      `E2E map-asset guard blocked an unexpected external request: ${request.url()}`,
    );
  });
};
