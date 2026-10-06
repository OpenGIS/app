import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  e2eMapFixtures,
  E2E_MAP_MOUNT,
  E2E_MAP_PLACEHOLDER,
  substitutePlaceholder,
} from "../fixtures/map/vitePlugin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS_ROOT = join(HERE, "..", "fixtures", "map", "assets");

const TEST_ORIGIN = "http://example.test:5174";
const TEST_BASE = `${TEST_ORIGIN}${E2E_MAP_MOUNT}`;

/** Every file under `assets/` whose bytes contain the origin placeholder. */
const placeholderFiles = () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (readFileSync(full).includes(E2E_MAP_PLACEHOLDER))
        found.push(full);
    }
  };
  walk(ASSETS_ROOT);
  return found;
};

/**
 * Drive the real middleware for one request and collect what it would send.
 * Network-free: `readFile`/`res.end` only, with a fake req/res pair.
 */
const serve = (url, host = "example.test:5174") => {
  const plugin = e2eMapFixtures();
  let handler;
  plugin.configureServer({
    middlewares: {
      use: (fn) => {
        handler = fn;
      },
    },
  });

  const chunks = [];
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(body) {
      if (body) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
      finish();
    },
  };
  const req = { method: "GET", url, headers: { host } };
  handler(req, res, finish);

  return done.then(() => ({
    status: res.statusCode,
    headers: res.headers,
    body: Buffer.concat(chunks).toString("utf8"),
  }));
};

describe("e2e map fixture placeholder substitution", () => {
  it("rewrites the placeholder in JSON bodies against the serving origin", () => {
    const raw = JSON.stringify({
      tiles: [`${E2E_MAP_PLACEHOLDER}/h/{z}/{x}/{y}.pbf`],
    });
    const out = substitutePlaceholder(raw, ".json", TEST_BASE);
    expect(out).not.toContain(E2E_MAP_PLACEHOLDER);
    expect(out).toContain(`${TEST_BASE}/h/{z}/{x}/{y}.pbf`);
  });

  it("leaves binary tile, glyph and sprite assets untouched", () => {
    const body = Buffer.from(`${E2E_MAP_PLACEHOLDER}-bytes`);
    expect(substitutePlaceholder(body, ".pbf", TEST_BASE)).toBe(body);
    expect(substitutePlaceholder(body, ".png", TEST_BASE)).toBe(body);
    expect(substitutePlaceholder(body, ".webp", TEST_BASE)).toBe(body);
  });
});

describe("e2e map fixture middleware serves no raw placeholder", () => {
  it("resolves the OpenFreeMap TileJSON descriptor at request time", async () => {
    const { status, headers, body } = await serve(
      `${E2E_MAP_MOUNT}/tiles.openfreemap.org/planet.json`,
    );
    expect(status).toBe(200);
    expect(headers["content-type"]).toBe("application/json");

    const descriptor = JSON.parse(body);
    expect(body).not.toContain(E2E_MAP_PLACEHOLDER);
    expect(descriptor.tiles[0]).toContain(
      `${TEST_ORIGIN}${E2E_MAP_MOUNT}/tiles.openfreemap.org/`,
    );
  });

  it("substitutes every placeholder-bearing fixture, and they are all JSON", () => {
    const files = placeholderFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const extension = extname(file).toLowerCase();
      expect(
        extension,
        `${relative(ASSETS_ROOT, file)} embeds the placeholder but is not JSON`,
      ).toBe(".json");

      const rewritten = substitutePlaceholder(
        readFileSync(file, "utf8"),
        extension,
        TEST_BASE,
      );
      expect(
        rewritten,
        `${relative(ASSETS_ROOT, file)} survives the substitution path`,
      ).not.toContain(E2E_MAP_PLACEHOLDER);
    }
  });
});
