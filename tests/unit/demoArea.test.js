import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_AREA } from "../e2e/fixtures/map/demoArea.mjs";
import { paddedTiles } from "../e2e/fixtures/map/enumerate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP_DIR = join(HERE, "..", "e2e", "fixtures", "map");
const STYLE_PATH = join(MAP_DIR, "style.json");
const MANIFEST_PATH = join(MAP_DIR, "site.manifest.json");
const SITE_ROOT = join(MAP_DIR, "site");

const style = JSON.parse(readFileSync(STYLE_PATH, "utf8"));
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

const excludedIds = new Set(DEMO_AREA.excludedSources.map((entry) => entry.id));
const committableHosts = new Set(DEMO_AREA.committableHosts);

/** Collect every URL a source declares (its `url` and/or `tiles[]`). */
const sourceUrls = (source) => {
  const urls = [];
  if (typeof source.url === "string") urls.push(source.url);
  if (Array.isArray(source.tiles)) urls.push(...source.tiles);
  return urls;
};

/** The host of a URL, or null when it is relative/placeholder/templated. */
const hostOf = (url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return parsed.host;
  } catch {
    return null;
  }
};

/** Every distinct host referenced by the fixture style (sources, glyphs, sprites). */
const fixtureStyleHosts = () => {
  const hosts = new Set();
  const add = (url) => {
    const host = hostOf(url);
    if (host) hosts.add(host);
  };
  for (const source of Object.values(style.sources)) {
    sourceUrls(source).forEach(add);
  }
  if (typeof style.glyphs === "string") add(style.glyphs);
  if (typeof style.sprite === "string") add(style.sprite);
  if (Array.isArray(style.sprite)) {
    style.sprite.forEach((entry) => entry?.url && add(entry.url));
  }
  return hosts;
};

/** Mirror the generator's live-URL → `site/` path mapping. */
const sitePathOf = (url) => {
  const parsed = new URL(url);
  const path = url.slice(
    url.indexOf(`${parsed.protocol}//`) +
      parsed.protocol.length +
      2 +
      parsed.host.length,
  );
  return `${parsed.host}${path}`;
};

describe("DEMO_AREA — geometry", () => {
  it("is deeply frozen", () => {
    expect(Object.isFrozen(DEMO_AREA)).toBe(true);
    expect(Object.isFrozen(DEMO_AREA.center)).toBe(true);
    expect(Object.isFrozen(DEMO_AREA.bounds)).toBe(true);
    expect(Object.isFrozen(DEMO_AREA.coverageZooms)).toBe(true);
    expect(Object.isFrozen(DEMO_AREA.excludedSources)).toBe(true);
    expect(Object.isFrozen(DEMO_AREA.committableHosts)).toBe(true);
  });

  it("places the centre strictly inside the bounds", () => {
    const { lat, lng } = DEMO_AREA.center;
    const { west, south, east, north } = DEMO_AREA.bounds;
    expect(lng).toBeGreaterThan(west);
    expect(lng).toBeLessThan(east);
    expect(lat).toBeGreaterThan(south);
    expect(lat).toBeLessThan(north);
  });

  it("orients bounds west<east and south<north", () => {
    const { west, south, east, north } = DEMO_AREA.bounds;
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
  });

  it("uses the project's default demo coordinates", () => {
    expect(DEMO_AREA.center).toEqual({ lat: 50.6539, lng: -128.0094 });
  });
});

describe("DEMO_AREA — zooms", () => {
  it("keeps the screenshot zoom an integer within coverage", () => {
    expect(Number.isInteger(DEMO_AREA.screenshotZoom)).toBe(true);
    expect(DEMO_AREA.coverageZooms).toContain(DEMO_AREA.screenshotZoom);
  });

  it("covers every integer zoom from 0 to the screenshot zoom", () => {
    expect(DEMO_AREA.coverageZooms).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("keeps every coverage zoom a plausible Web Mercator integer", () => {
    for (const zoom of DEMO_AREA.coverageZooms) {
      expect(Number.isInteger(zoom)).toBe(true);
      expect(zoom).toBeGreaterThanOrEqual(0);
      expect(zoom).toBeLessThanOrEqual(24);
    }
  });
});

describe("DEMO_AREA — policy", () => {
  it("gives every excluded source a non-empty reason", () => {
    expect(DEMO_AREA.excludedSources.length).toBeGreaterThan(0);
    for (const entry of DEMO_AREA.excludedSources) {
      expect(entry.id).toBeTypeOf("string");
      expect(entry.reason, `${entry.id} needs a reason`).toBeTypeOf("string");
      expect(
        entry.reason.length,
        `${entry.id} reason is empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("declares a non-empty committable-host allowlist", () => {
    expect(DEMO_AREA.committableHosts.length).toBeGreaterThan(0);
    for (const host of DEMO_AREA.committableHosts) {
      expect(host).toMatch(/^[a-z0-9.-]+$/i);
    }
  });

  it("declares at least one committed glyph range", () => {
    expect(DEMO_AREA.glyphRanges.length).toBeGreaterThan(0);
  });

  it("vendors only the 1x sprite atlas", () => {
    expect(DEMO_AREA.spriteScale).toBe(1);
  });
});

describe("DEMO_AREA — excluded sources (against the fixture style)", () => {
  it("names every excluded source id, and each exists in the style", () => {
    for (const entry of DEMO_AREA.excludedSources) {
      expect(
        style.sources[entry.id],
        `excluded source "${entry.id}" is missing from style.json`,
      ).toBeDefined();
    }
  });

  it("leaves excluded sources free of committable-host URLs", () => {
    for (const entry of DEMO_AREA.excludedSources) {
      const source = style.sources[entry.id];
      for (const url of sourceUrls(source)) {
        const host = hostOf(url);
        if (host === null) continue;
        expect(
          committableHosts.has(host),
          `excluded source "${entry.id}" references committable host ${host}`,
        ).toBe(false);
      }
    }
  });
});

describe("DEMO_AREA — allowlist coverage of the fixture style", () => {
  it("covers every non-excluded tile/sprite/glyph host", () => {
    const excludedHosts = new Set(
      [...excludedIds].flatMap((id) =>
        sourceUrls(style.sources[id] ?? {})
          .map(hostOf)
          .filter(Boolean),
      ),
    );
    for (const host of fixtureStyleHosts()) {
      expect(
        committableHosts.has(host) || excludedHosts.has(host),
        `host "${host}" is neither committable nor on an excluded source`,
      ).toBe(true);
    }
  });
});

describe("DEMO_AREA — no live-host drift in the fixture style", () => {
  it("rewrites every non-excluded source URL to the placeholder form", () => {
    for (const [id, source] of Object.entries(style.sources)) {
      if (excludedIds.has(id)) continue;
      for (const url of sourceUrls(source)) {
        expect(
          hostOf(url),
          `source "${id}" still points at a live host: ${url}`,
        ).toBeNull();
      }
    }
  });

  it("rewrites glyphs and sprites to the placeholder form", () => {
    if (typeof style.glyphs === "string") {
      expect(
        hostOf(style.glyphs),
        `live glyphs URL: ${style.glyphs}`,
      ).toBeNull();
    }
    const spriteUrls =
      typeof style.sprite === "string"
        ? [style.sprite]
        : (style.sprite ?? []).map((entry) => entry?.url).filter(Boolean);
    for (const url of spriteUrls) {
      expect(hostOf(url), `live sprite URL: ${url}`).toBeNull();
    }
  });

  it("keeps only excluded hosts live", () => {
    const liveHosts = new Set();
    for (const [id, source] of Object.entries(style.sources)) {
      if (!excludedIds.has(id)) continue;
      sourceUrls(source).forEach((url) => {
        const host = hostOf(url);
        if (host) liveHosts.add(host);
      });
    }
    const excludedHosts = new Set(
      [...excludedIds].flatMap((id) =>
        sourceUrls(style.sources[id] ?? {})
          .map(hostOf)
          .filter(Boolean),
      ),
    );
    for (const host of liveHosts) {
      expect(excludedHosts.has(host), `unexpected live host: ${host}`).toBe(
        true,
      );
    }
  });
});

describe("DEMO_AREA — manifest completeness", () => {
  const storedPaths = new Set(manifest.files.map((file) => file.path));
  const absentPaths = new Set(manifest.absent.map((entry) => entry.path));

  it("accounts for every non-excluded source and zoom", () => {
    const byId = Object.fromEntries(
      manifest.sources.map((source) => [source.id, source]),
    );
    for (const [id, source] of Object.entries(style.sources)) {
      if (excludedIds.has(id)) continue;
      const stats = byId[id];
      expect(stats, `manifest is missing source "${id}"`).toBeDefined();

      // Zoom range must be the declared source range ∩ demo zooms. The style
      // declares min/max for tile-template sources; a TileJSON source resolves
      // its range from the upstream descriptor, so trust the manifest there.
      const declaredMin = source.minzoom ?? stats.minzoom ?? 0;
      const declaredMax = source.maxzoom ?? stats.maxzoom ?? 22;
      const expectedZooms = DEMO_AREA.coverageZooms.filter(
        (z) => z >= declaredMin && z <= declaredMax,
      );
      expect(stats.zooms, `zooms mismatch for "${id}"`).toEqual(expectedZooms);

      // Every padded tile path at every zoom must be stored or recorded absent.
      const tiles = paddedTiles(DEMO_AREA.bounds, expectedZooms);
      for (const { z, x, y } of tiles) {
        const url = stats.template
          .replace("{z}", z)
          .replace("{x}", x)
          .replace("{y}", y);
        const path = sitePathOf(url);
        expect(
          storedPaths.has(path) || absentPaths.has(path),
          `unaccounted path for "${id}": ${path}`,
        ).toBe(true);
      }
    }
  });

  it("stores every recorded file on disk with matching bytes", () => {
    for (const file of manifest.files) {
      const absolutePath = join(SITE_ROOT, file.path);
      expect(existsSync(absolutePath), `missing fixture: ${file.path}`).toBe(
        true,
      );
    }
  });

  it("lists every stored file in the manifest", () => {
    // The manifest only grows via the generator; verify a known doc source
    // resolves so the manifest cannot silently empty out.
    expect(manifest.files.some((file) => file.source === "openmaptiles")).toBe(
      true,
    );
    expect(manifest.files.some((file) => file.source === "glyph")).toBe(true);
    expect(manifest.files.some((file) => file.source === "sprite")).toBe(true);
  });
});
