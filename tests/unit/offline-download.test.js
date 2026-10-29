import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildRegionUrls,
  downloadRegion,
  fetchAll,
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
  vi.unstubAllGlobals();
});

const okResponse = () => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(0),
});

const notOkResponse = () => ({
  ok: false,
  arrayBuffer: async () => new ArrayBuffer(0),
});

const abortError = () =>
  Object.assign(new Error("The operation was aborted"), {
    name: "AbortError",
  });

describe("buildRegionUrls", () => {
  it("throws a map-not-ready sentinel when the map is not ready", async () => {
    await expect(
      buildRegionUrls({
        bounds: {},
        minZoom: 0,
        maxZoom: 1,
        getMap: () => null,
      }),
    ).rejects.toMatchObject({ code: "map-not-ready" });
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

describe("fetchAll", () => {
  it("records only ok responses and counts failures", async () => {
    const fetchMock = vi.fn(async (url) =>
      url.endsWith("/ok") ? okResponse() : notOkResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAll([
      "https://tiles.example.com/ok",
      "https://tiles.example.com/bad",
    ]);

    expect([...result.succeededUrls]).toEqual(["https://tiles.example.com/ok"]);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(2);
  });

  it("counts a body-read failure as a failed URL", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith("/bad-body")) {
        return {
          ok: true,
          arrayBuffer: async () => {
            throw new Error("body read failed");
          },
        };
      }
      return okResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAll([
      "https://tiles.example.com/good",
      "https://tiles.example.com/bad-body",
    ]);

    expect([...result.succeededUrls]).toEqual([
      "https://tiles.example.com/good",
    ]);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(2);
  });

  it("counts a per-request timeout as failed without rejecting", async () => {
    const fetchMock = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(abortError()));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAll(["slow"], () => {}, undefined, {
      timeoutMs: 10,
    });

    expect(result.succeededUrls.size).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(1);
  });

  it("rejects with an AbortError when the caller aborts", async () => {
    const fetchMock = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(abortError()));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const promise = fetchAll(["slow"], () => {}, controller.signal);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});

// A single array-based source with no glyphs, used by the downloadRegion tests.
const makeTileOnlyMap = () => ({
  getStyle: () => ({
    sources: {
      base: {
        type: "vector",
        tiles: ["https://tiles.example.com/base/{z}/{x}/{y}.pbf"],
        minzoom: 0,
        maxzoom: 14,
      },
    },
    layers: [],
    glyphs: "",
  }),
});

const WORLD = { west: -180, south: -85, east: 180, north: 85 };

describe("downloadRegion", () => {
  it("reports actual counts on full success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse()),
    );

    const result = await downloadRegion({
      bounds: WORLD,
      minZoom: 0,
      maxZoom: 0,
      getMap: makeMockMap,
    });

    // Two sources × one tile, plus 256 glyph ranges.
    expect(result.tileCount).toBe(2);
    expect(result.glyphCount).toBe(256);
    expect(result.totalCount).toBe(258);
    expect(result.requestedCount).toBe(258);
    expect(result.failedCount).toBe(0);
  });

  it("returns actual counts on partial success without throwing", async () => {
    const fetchMock = vi.fn(async (url) =>
      url.includes("/base/0/0/0") || url.includes("/base/1/0/0")
        ? okResponse()
        : notOkResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadRegion({
      bounds: WORLD,
      minZoom: 0,
      maxZoom: 1,
      getMap: makeTileOnlyMap,
    });

    // z0 (1 tile) + z1 (4 tiles) = 5 requested; 2 succeed.
    expect(result.tileCount).toBe(2);
    expect(result.glyphCount).toBe(0);
    expect(result.totalCount).toBe(2);
    expect(result.requestedCount).toBe(5);
    expect(result.failedCount).toBe(3);
  });

  it("rejects with download-empty when no tiles succeed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => notOkResponse()),
    );

    await expect(
      downloadRegion({
        bounds: WORLD,
        minZoom: 0,
        maxZoom: 1,
        getMap: makeTileOnlyMap,
      }),
    ).rejects.toMatchObject({ code: "download-empty" });
  });
});
