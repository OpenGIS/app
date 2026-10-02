import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildRegionUrls,
  regionUrlsForRegion,
} from "@/features/offline/download.js";

// A mock map whose style has two array-based sources (no TileJSON fetch needed)
// and one symbol layer so glyph URLs are generated too.
const makeMockMap = () => ({
  getStyle: () => ({
    sources: {
      base: {
        type: "vector",
        tiles: ["https://tiles.example.com/base/{z}/{x}/{y}.pbf"],
        minzoom: 0,
        maxzoom: 14,
      },
      hillshade: {
        type: "raster-dem",
        tiles: ["https://tiles.example.com/dem/{z}/{x}/{y}.png"],
        minzoom: 0,
        maxzoom: 10,
      },
    },
    layers: [
      {
        id: "labels",
        layout: { "text-font": ["Open Sans Regular", "Noto Sans Regular"] },
      },
    ],
    glyphs: "https://tiles.example.com/fonts/{fontstack}/{range}.pbf",
  }),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildRegionUrls", () => {
  it("throws when the map is not ready", async () => {
    await expect(
      buildRegionUrls({
        bounds: {},
        minZoom: 0,
        maxZoom: 1,
        getMap: () => null,
      }),
    ).rejects.toThrow("Map is not ready");
  });

  it("builds tile + glyph URLs and allUrls is their concatenation", async () => {
    // A single world-wide tile at z0, clamped to the vector source's maxzoom.
    const world = { west: -180, south: -85, east: 180, north: 85 };
    const result = await buildRegionUrls({
      bounds: world,
      minZoom: 0,
      maxZoom: 0,
      getMap: makeMockMap,
    });

    // Two sources × 1 tile each at z0.
    expect(result.tileUrls).toHaveLength(2);
    expect(result.tileUrls[0]).toBe("https://tiles.example.com/base/0/0/0.pbf");
    expect(result.tileUrls[1]).toBe("https://tiles.example.com/dem/0/0/0.png");

    // One fontstack → 256 ranges (0..65280 step 256).
    expect(result.glyphUrls).toHaveLength(256);
    expect(result.glyphUrls[0]).toBe(
      "https://tiles.example.com/fonts/Open Sans Regular,Noto Sans Regular/0.pbf",
    );

    expect(result.allUrls).toEqual([...result.tileUrls, ...result.glyphUrls]);
    expect(result.allUrls).toHaveLength(2 + 256);
  });

  it("clamps the zoom range per source", async () => {
    const world = { west: -180, south: -85, east: 180, north: 85 };
    const result = await buildRegionUrls({
      bounds: world,
      minZoom: 0,
      maxZoom: 2,
      getMap: makeMockMap,
    });

    // base: z0..2 = 1 + 4 + 16 = 21; dem: min(2, 10) = z0..2 = 21 → 42 tiles.
    expect(result.tileUrls).toHaveLength(42);
  });

  it("skips sources whose zoom band falls outside the request", async () => {
    const map = {
      getStyle: () => ({
        sources: {
          high: {
            type: "vector",
            tiles: ["https://tiles.example.com/hi/{z}/{x}/{y}.pbf"],
            minzoom: 10,
            maxzoom: 14,
          },
        },
        layers: [],
        glyphs: "",
      }),
    };
    const world = { west: -180, south: -85, east: 180, north: 85 };
    const result = await buildRegionUrls({
      bounds: world,
      minZoom: 0,
      maxZoom: 2,
      getMap: () => map,
    });

    // Source minzoom (10) > requested max (2) → no tiles.
    expect(result.tileUrls).toHaveLength(0);
    expect(result.glyphUrls).toHaveLength(0);
    expect(result.allUrls).toHaveLength(0);
  });

  it("produces expected counts given a mock source list and bounds", async () => {
    const map = {
      getStyle: () => ({
        sources: {
          a: {
            type: "vector",
            tiles: ["https://tiles.example.com/a/{z}/{x}/{y}.pbf"],
            minzoom: 0,
            maxzoom: 14,
          },
        },
        layers: [],
        glyphs: "",
      }),
    };
    const world = { west: -180, south: -85, east: 180, north: 85 };
    const result = await buildRegionUrls({
      bounds: world,
      minZoom: 0,
      maxZoom: 1,
      getMap: () => map,
    });

    // z0 (1) + z1 (4) = 5 tiles, no glyphs.
    expect(result.tileUrls).toHaveLength(5);
    expect(result.allUrls).toHaveLength(5);
  });
});

describe("regionUrlsForRegion", () => {
  it("reuses buildRegionUrls to return the URL list for a stored region", async () => {
    const world = { west: -180, south: -85, east: 180, north: 85 };
    const result = await regionUrlsForRegion({
      bounds: world,
      minZoom: 0,
      maxZoom: 0,
      getMap: makeMockMap,
    });

    expect(result.allUrls).toHaveLength(2 + 256);
    expect(result.tileUrls).toHaveLength(2);
    expect(result.allUrls[0]).toBe("https://tiles.example.com/base/0/0/0.pbf");
  });
});
