import { describe, it, expect, vi } from "vitest";
import {
  lonLatToTile,
  tileBoundsToRange,
  enumerateTiles,
  tileUrlTemplateToUrl,
  resolveSourceTiles,
} from "@/features/offline/tiles.js";

describe("lonLatToTile", () => {
  it("returns integer Web Mercator tile coordinates", () => {
    // Greenwich at z0 is tile 0,0
    expect(lonLatToTile(0, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("computes a known tile", () => {
    // An illustrative location at z6
    const { x, y } = lonLatToTile(56.78, 12.34, 6);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(x)).toBe(true);
    expect(Number.isInteger(y)).toBe(true);
  });

  it("respects the 2^z world width", () => {
    const { x, y } = lonLatToTile(56.78, 12.34, 6);
    expect(x).toBeLessThan(2 ** 6);
    expect(y).toBeLessThan(2 ** 6);
  });
});

describe("tileBoundsToRange", () => {
  it("returns an inclusive range", () => {
    const bounds = { west: -130, south: 49, east: -126, north: 52 };
    const range = tileBoundsToRange(bounds, 6);
    expect(range.xMin).toBeLessThanOrEqual(range.xMax);
    expect(range.yMin).toBeLessThanOrEqual(range.yMax);
  });

  it("clamps coordinates to [0, 2^z-1]", () => {
    const bounds = { west: -200, south: -90, east: 200, north: 90 };
    const z = 2;
    const range = tileBoundsToRange(bounds, z);
    expect(range.xMin).toBe(0);
    expect(range.xMax).toBe(2 ** z - 1);
    expect(range.yMin).toBe(0);
    expect(range.yMax).toBe(2 ** z - 1);
  });

  it("handles antimeridian-crossing bounds by covering the full longitude range", () => {
    // east < west implies the box spans ±180
    const bounds = { west: 170, south: -10, east: -170, north: 10 };
    const z = 2;
    const range = tileBoundsToRange(bounds, z);
    expect(range.xMin).toBe(0);
    expect(range.xMax).toBe(2 ** z - 1);
  });

  it("y range is correct order (north < south in tile space)", () => {
    const bounds = { west: -130, south: 49, east: -126, north: 52 };
    const { yMin, yMax } = tileBoundsToRange(bounds, 6);
    expect(yMin).toBeLessThanOrEqual(yMax);
  });
});

describe("enumerateTiles", () => {
  it("produces the expected count across an inclusive zoom range", () => {
    // A single world-wide tile at z0 → 1 tile
    const world = { west: -180, south: -85, east: 180, north: 85 };
    expect(enumerateTiles(world, 0, 0)).toHaveLength(1);
  });

  it("counts 4 tiles for the whole world at z1", () => {
    const world = { west: -180, south: -85, east: 180, north: 85 };
    expect(enumerateTiles(world, 1, 1)).toHaveLength(4);
  });

  it("counts across multiple zoom levels cumulatively", () => {
    const world = { west: -180, south: -85, east: 180, north: 85 };
    // z0 (1) + z1 (4) + z2 (16) = 21
    expect(enumerateTiles(world, 0, 2)).toHaveLength(21);
  });

  it("returns empty for an out-of-range zoom band", () => {
    const world = { west: -180, south: -85, east: 180, north: 85 };
    expect(enumerateTiles(world, 5, 4)).toHaveLength(0);
  });

  it("returns tiles within bounds at a given zoom", () => {
    const bounds = { west: -130, south: 49, east: -126, north: 52 };
    const tiles = enumerateTiles(bounds, 6, 6);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.z).toBe(6);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("tileUrlTemplateToUrl", () => {
  it("substitutes z, x and y placeholders", () => {
    const url = tileUrlTemplateToUrl(
      "https://tiles.example.com/{z}/{x}/{y}.pbf",
      3,
      4,
      5,
    );
    expect(url).toBe("https://tiles.example.com/3/4/5.pbf");
  });

  it("substitutes the {-y} placeholder", () => {
    const url = tileUrlTemplateToUrl(
      "https://tiles.example.com/{z}/{x}/{-y}.pbf",
      2,
      1,
      3,
    );
    expect(url).toBe("https://tiles.example.com/2/1/-3.pbf");
  });
});

describe("resolveSourceTiles", () => {
  it("uses the first tiles template for array-based sources", async () => {
    const source = {
      type: "vector",
      tiles: ["https://tiles.example.com/{z}/{x}/{y}.pbf"],
      minzoom: 0,
      maxzoom: 14,
    };
    const resolved = await resolveSourceTiles(source);
    expect(resolved).toEqual({
      template: "https://tiles.example.com/{z}/{x}/{y}.pbf",
      minzoom: 0,
      maxzoom: 14,
    });
  });

  it("fetches and uses TileJSON tiles for url-based sources", async () => {
    const source = {
      type: "vector",
      url: "https://tiles.example.com/planet",
      minzoom: 0,
      maxzoom: 14,
    };
    const fakeTiles = ["https://tiles.example.com/planet/slug/{z}/{x}/{y}.pbf"];
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tiles: fakeTiles }),
      }),
    );
    const resolved = await resolveSourceTiles(source);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://tiles.example.com/planet",
    );
    expect(resolved.template).toBe(fakeTiles[0]);
    expect(resolved.minzoom).toBe(0);
    expect(resolved.maxzoom).toBe(14);
  });

  it("applies TileJSON zoom ranges when source omits them", async () => {
    const source = { type: "vector", url: "https://tiles.example.com/planet" };
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            tiles: ["https://tiles.example.com/{z}/{x}/{y}.pbf"],
            minzoom: 3,
            maxzoom: 11,
          }),
      }),
    );
    const resolved = await resolveSourceTiles(source);
    expect(resolved.minzoom).toBe(3);
    expect(resolved.maxzoom).toBe(11);
  });
});
