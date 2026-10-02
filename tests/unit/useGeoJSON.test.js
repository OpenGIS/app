import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

let injectReturn = "navigator";

vi.mock("vue", () => ({
  inject: vi.fn(() => injectReturn),
  ref: (v) => ({ value: v }),
  shallowRef: (v) => ({ value: v }),
  computed: (fn) => ({
    get value() {
      return fn();
    },
  }),
  watch: vi.fn(),
  onUnmounted: vi.fn(),
}));

let mockMapInstance = null;
let emitterCallbacks = {};

const mockMap = {
  addSource: vi.fn(),
  addLayer: vi.fn(),
  getSource: vi.fn(),
  getLayer: vi.fn(),
  removeLayer: vi.fn(),
  removeSource: vi.fn(),
};

const mockSetData = vi.fn();
mockMap.getSource.mockImplementation(() => ({ setData: mockSetData }));

const mockEmitter = {
  once: vi.fn((event, cb) => {
    emitterCallbacks[event] = cb;
  }),
};

vi.mock("@/composables/useMap.js", () => ({
  getMapInstance: vi.fn(() => mockMapInstance),
}));

vi.mock("@/emitter.js", () => ({
  emitter: mockEmitter,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function freshUseGeoJSON(instanceId = "nav") {
  injectReturn = instanceId;
  mockMapInstance = null;
  emitterCallbacks = {};
  vi.clearAllMocks();
  mockMap.getSource.mockImplementation(() => ({ setData: mockSetData }));
  vi.resetModules();
  const { useGeoJSON } = await import("../../src/composables/useGeoJSON.js");
  return useGeoJSON();
}

function simulateMapReady(geoJSON) {
  // Trigger the map:ready callback registered on the emitter
  if (emitterCallbacks["map:ready"]) {
    emitterCallbacks["map:ready"]({ map: mockMap });
  }
}

const lineFeature = (id = "line-1", color = null) => ({
  type: "Feature",
  id,
  geometry: {
    type: "LineString",
    coordinates: [
      [-128, 50],
      [-127, 51],
    ],
  },
  properties: color ? { "ogis.color": color } : {},
});

const pointFeature = (id = "point-1") => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates: [-128, 50] },
  properties: {},
});

const polygonFeature = (id = "poly-1") => ({
  type: "Feature",
  id,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-128, 50],
        [-127, 50],
        [-127, 51],
        [-128, 51],
        [-128, 50],
      ],
    ],
  },
  properties: {},
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useGeoJSON / map lifecycle", () => {
  it("creates source and four layers on map:ready", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    expect(mockMap.addSource).toHaveBeenCalledWith(
      "ogis-geojson",
      expect.objectContaining({ type: "geojson" }),
    );
    expect(mockMap.addLayer).toHaveBeenCalledTimes(4);
    const layerIds = mockMap.addLayer.mock.calls.map((c) => c[0].id);
    expect(layerIds).toContain("ogis-geojson-polygon-fill");
    expect(layerIds).toContain("ogis-geojson-polygon-outline");
    expect(layerIds).toContain("ogis-geojson-line");
    expect(layerIds).toContain("ogis-geojson-point");
  });

  it("queues features set before map:ready and flushes on setup", async () => {
    const geoJSON = await freshUseGeoJSON();
    geoJSON.setFeature(lineFeature());

    // Not yet rendered — no map available
    expect(mockSetData).not.toHaveBeenCalled();

    simulateMapReady(geoJSON);

    // Source initialised with empty FC, then setData called with the queued feature
    expect(mockSetData).toHaveBeenCalledTimes(1);
    const fc = mockSetData.mock.calls[0][0];
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
  });

  it("sets up immediately when map is already ready", async () => {
    injectReturn = "already-ready";
    emitterCallbacks = {};
    vi.clearAllMocks();
    mockMap.getSource.mockImplementation(() => ({ setData: mockSetData }));
    mockMapInstance = mockMap; // map already available
    vi.resetModules();
    const { useGeoJSON } = await import("../../src/composables/useGeoJSON.js");
    useGeoJSON();

    expect(mockMap.addSource).toHaveBeenCalled();
    expect(mockMap.addLayer).toHaveBeenCalledTimes(4);
  });

  it("cleans up layers and source on destroy", async () => {
    mockMap.getLayer.mockReturnValue(true); // all layers exist
    mockMap.getSource.mockImplementation((id) => {
      if (id === "ogis-geojson") return { setData: mockSetData };
      return null;
    });

    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    emitterCallbacks["destroy"]?.();

    expect(mockMap.removeLayer).toHaveBeenCalledTimes(4);
    expect(mockMap.removeSource).toHaveBeenCalledWith("ogis-geojson");
  });
});

describe("useGeoJSON / setFeature", () => {
  it("adds a line feature to the source", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(lineFeature());

    expect(mockSetData).toHaveBeenCalledTimes(1);
    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("LineString");
  });

  it("adds a point feature to the source", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(pointFeature());

    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features[0].geometry.type).toBe("Point");
  });

  it("adds a polygon feature to the source", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(polygonFeature());

    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features[0].geometry.type).toBe("Polygon");
  });

  it("updates an existing feature (same id) — no duplicates", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(lineFeature("track", null));
    geoJSON.setFeature({
      ...lineFeature("track", "#ff0000"),
      geometry: {
        type: "LineString",
        coordinates: [
          [-128, 50],
          [-126, 52],
        ],
      },
    });

    const fc = mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0];
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties["ogis.color"]).toBe("#ff0000");
  });

  it("stores multiple features independently", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(lineFeature("a"));
    geoJSON.setFeature(pointFeature("b"));

    const fc = mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0];
    expect(fc.features).toHaveLength(2);
  });

  it("warns and does nothing when feature.type is not 'Feature'", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature({ type: "FeatureCollection", features: [] });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("GeoJSON Feature"),
    );
    expect(mockSetData).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warns and does nothing when feature has no id", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
    });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("id"));
    expect(mockSetData).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warns and does nothing for unsupported geometry types", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature({
      type: "Feature",
      id: "gc",
      geometry: { type: "GeometryCollection", geometries: [] },
    });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("geometry type"),
      "GeometryCollection",
    );
    expect(mockSetData).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warns and does nothing when feature is null", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(null);

    expect(spy).toHaveBeenCalled();
    expect(mockSetData).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("useGeoJSON / removeFeature", () => {
  it("removes a feature by id", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    geoJSON.setFeature(lineFeature("a"));
    geoJSON.setFeature(pointFeature("b"));
    mockSetData.mockClear();

    geoJSON.removeFeature("a");

    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].id).toBe("b");
  });

  it("is a no-op for an unknown id", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    geoJSON.setFeature(lineFeature("a"));
    mockSetData.mockClear();

    geoJSON.removeFeature("does-not-exist");

    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features).toHaveLength(1);
  });

  it("converts numeric ids to strings", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    geoJSON.setFeature({ ...lineFeature(), id: 42 });
    mockSetData.mockClear();

    geoJSON.removeFeature(42);

    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features).toHaveLength(0);
  });
});

describe("useGeoJSON / clearFeatures", () => {
  it("removes all features", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    geoJSON.setFeature(lineFeature("a"));
    geoJSON.setFeature(pointFeature("b"));
    geoJSON.setFeature(polygonFeature("c"));
    mockSetData.mockClear();

    geoJSON.clearFeatures();

    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features).toHaveLength(0);
  });

  it("re-adds features can use new random colours after clear", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    geoJSON.setFeature(lineFeature("x"));
    const first =
      mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0].features[0]
        .properties["ogis.color"];

    geoJSON.clearFeatures();
    geoJSON.setFeature(lineFeature("x")); // same id, fresh colour

    const second =
      mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0].features[0]
        .properties["ogis.color"];

    // Both should be valid colour strings (exact values may differ)
    expect(first).toMatch(/^#/);
    expect(second).toMatch(/^#/);
  });
});

describe("useGeoJSON / style defaults", () => {
  it("auto-assigns a colour when ogis.color is absent", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(lineFeature("l"));

    const fc = mockSetData.mock.calls[0][0];
    const color = fc.features[0].properties["ogis.color"];
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("uses explicit ogis.color when provided", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(lineFeature("l", "#aabbcc"));

    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features[0].properties["ogis.color"]).toBe("#aabbcc");
  });

  it("preserves the same auto-colour across updates of the same id", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(lineFeature("track"));
    const first =
      mockSetData.mock.calls[0][0].features[0].properties["ogis.color"];

    geoJSON.setFeature(lineFeature("track")); // no explicit colour
    const second =
      mockSetData.mock.calls[1][0].features[0].properties["ogis.color"];

    expect(first).toBe(second);
  });

  it("applies default line width and opacity when not specified", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(lineFeature("l"));

    const props = mockSetData.mock.calls[0][0].features[0].properties;
    expect(props["ogis.width"]).toBe(3);
    expect(props["ogis.opacity"]).toBe(0.85);
  });

  it("applies default point radius and opacity when not specified", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(pointFeature("p"));

    const props = mockSetData.mock.calls[0][0].features[0].properties;
    expect(props["ogis.radius"]).toBe(6);
    expect(props["ogis.opacity"]).toBe(1);
  });

  it("applies default polygon fillOpacity and opacity when not specified", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature(polygonFeature("p"));

    const props = mockSetData.mock.calls[0][0].features[0].properties;
    expect(props["ogis.fillOpacity"]).toBe(0.4);
    expect(props["ogis.opacity"]).toBe(0.85);
  });

  it("does not override explicitly provided navigator.* style values", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature({
      ...lineFeature("l"),
      properties: { "ogis.width": 8, "ogis.opacity": 0.5 },
    });

    const props = mockSetData.mock.calls[0][0].features[0].properties;
    expect(props["ogis.width"]).toBe(8);
    expect(props["ogis.opacity"]).toBe(0.5);
  });
});

describe("useGeoJSON / setDefaults", () => {
  it("setDefaults colour is used for new features with no ogis.color", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    geoJSON.setDefaults({ line: { color: "#123456" } });
    geoJSON.setFeature(lineFeature("l"));

    const fc = mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0];
    expect(fc.features[0].properties["ogis.color"]).toBe("#123456");
  });

  it("setDefaults re-processes existing features", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    geoJSON.setFeature(lineFeature("l")); // gets auto colour

    geoJSON.setDefaults({ line: { color: "#abcdef" } });

    const fc = mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0];
    expect(fc.features[0].properties["ogis.color"]).toBe("#abcdef");
  });

  it("setDefaults does not override explicit ogis.color on existing feature", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    geoJSON.setFeature(lineFeature("l", "#explicit"));
    geoJSON.setDefaults({ line: { color: "#default" } });

    const fc = mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0];
    expect(fc.features[0].properties["ogis.color"]).toBe("#explicit");
  });

  it("setDefaults updates width and opacity for existing features", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    geoJSON.setFeature(lineFeature("l")); // default width=3
    geoJSON.setDefaults({ line: { width: 10, opacity: 0.5 } });

    const fc = mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0];
    const props = fc.features[0].properties;
    expect(props["ogis.width"]).toBe(10);
    expect(props["ogis.opacity"]).toBe(0.5);
  });

  it("ignores unknown geometry type keys in setDefaults", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    // Should not throw
    expect(() =>
      geoJSON.setDefaults({ unknown: { color: "red" } }),
    ).not.toThrow();
  });
});

describe("useGeoJSON / layer configuration", () => {
  it("line layer has round cap and join", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    const lineLayerCall = mockMap.addLayer.mock.calls.find(
      (c) => c[0].id === "ogis-geojson-line",
    );
    expect(lineLayerCall[0].layout["line-cap"]).toBe("round");
    expect(lineLayerCall[0].layout["line-join"]).toBe("round");
  });

  it("layers use data-driven expressions for colour", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    const lineLayer = mockMap.addLayer.mock.calls.find(
      (c) => c[0].id === "ogis-geojson-line",
    )[0];
    expect(lineLayer.paint["line-color"]).toEqual(["get", "ogis.color"]);
  });

  it("all geometry-type layers have correct filters", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    const getFilter = (id) =>
      mockMap.addLayer.mock.calls.find((c) => c[0].id === id)?.[0].filter;

    expect(getFilter("ogis-geojson-line")).toEqual([
      "match",
      ["geometry-type"],
      ["LineString", "MultiLineString"],
      true,
      false,
    ]);
    expect(getFilter("ogis-geojson-point")).toEqual([
      "match",
      ["geometry-type"],
      ["Point", "MultiPoint"],
      true,
      false,
    ]);
    expect(getFilter("ogis-geojson-polygon-fill")).toEqual([
      "match",
      ["geometry-type"],
      ["Polygon", "MultiPolygon"],
      true,
      false,
    ]);
  });

  it("point layer has white stroke", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);

    const pointLayer = mockMap.addLayer.mock.calls.find(
      (c) => c[0].id === "ogis-geojson-point",
    )[0];
    expect(pointLayer.paint["circle-stroke-color"]).toBe("white");
  });
});

describe("useGeoJSON / instance isolation", () => {
  it("separate instanceIds maintain independent feature sets", async () => {
    // Instance A
    injectReturn = "instance-a";
    emitterCallbacks = {};
    vi.clearAllMocks();
    mockMap.getSource.mockImplementation(() => ({ setData: mockSetData }));
    vi.resetModules();
    const { useGeoJSON: useGeoJSONA } =
      await import("../../src/composables/useGeoJSON.js");
    const geoJSONA = useGeoJSONA();
    const callbacksA = { ...emitterCallbacks };
    callbacksA["map:ready"]?.({ map: mockMap });
    geoJSONA.setFeature(lineFeature("shared-id"));
    const countA =
      mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0].features
        .length;

    // Instance B (same module, different id via second call)
    injectReturn = "instance-b";
    emitterCallbacks = {};
    const geoJSONB = useGeoJSONA("instance-b");
    emitterCallbacks["map:ready"]?.({ map: mockMap });
    // B has no features
    const lastFC = mockSetData.mock.calls[mockSetData.mock.calls.length - 1][0];

    expect(countA).toBe(1);
    expect(lastFC.features).toHaveLength(0);
  });
});

describe("useGeoJSON / MultiLineString and MultiPolygon", () => {
  it("categorises MultiLineString as a line", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature({
      type: "Feature",
      id: "ml",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [-128, 50],
            [-127, 51],
          ],
        ],
      },
      properties: {},
    });

    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties["ogis.width"]).toBe(3);
  });

  it("categorises MultiPolygon as a polygon", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature({
      type: "Feature",
      id: "mp",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [-128, 50],
              [-127, 50],
              [-127, 51],
              [-128, 51],
              [-128, 50],
            ],
          ],
        ],
      },
      properties: {},
    });

    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features[0].properties["ogis.fillOpacity"]).toBe(0.4);
  });

  it("categorises MultiPoint as a point", async () => {
    const geoJSON = await freshUseGeoJSON();
    simulateMapReady(geoJSON);
    mockSetData.mockClear();

    geoJSON.setFeature({
      type: "Feature",
      id: "mpt",
      geometry: {
        type: "MultiPoint",
        coordinates: [
          [-128, 50],
          [-127, 51],
        ],
      },
      properties: {},
    });

    const fc = mockSetData.mock.calls[0][0];
    expect(fc.features[0].properties["ogis.radius"]).toBe(6);
  });
});
