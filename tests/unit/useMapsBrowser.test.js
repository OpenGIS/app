import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const listCollectionsMock = vi.fn();
const showMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const destroyMock = vi.fn();
const setFeatureMock = vi.fn();
const removeFeatureMock = vi.fn();
const fitBoundsMock = vi.fn();
const flyToMock = vi.fn();
const getZoomMock = vi.fn(() => 9);

vi.mock("@/composables/resources/useMapsApi", () => ({
  useMapsApi: () => ({
    list: listMock,
    show: showMock,
    create: createMock,
    update: updateMock,
    destroy: destroyMock,
  }),
}));

vi.mock("@/composables/resources/useCollectionsApi", () => ({
  useCollectionsApi: () => ({
    list: listCollectionsMock,
  }),
}));

vi.mock("@/composables/useGeoJSON", () => ({
  useGeoJSON: () => ({
    setFeature: setFeatureMock,
    removeFeature: removeFeatureMock,
  }),
}));

vi.mock("@/composables/useMap", () => ({
  getMapInstance: () => ({
    fitBounds: fitBoundsMock,
    flyTo: flyToMock,
    getZoom: getZoomMock,
  }),
}));

describe("useMapsBrowser", () => {
  beforeEach(() => {
    vi.resetModules();
    listMock.mockReset();
    listCollectionsMock.mockReset();
    showMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
    destroyMock.mockReset();
    setFeatureMock.mockReset();
    removeFeatureMock.mockReset();
    fitBoundsMock.mockReset();
    flyToMock.mockReset();
    getZoomMock.mockReset();
    getZoomMock.mockReturnValue(9);
  });

  it("loads authenticated map summaries from /api/user/maps", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-list");

    listMock.mockResolvedValue({
      data: {
        data: [
          {
            id: "map-1",
            title: "Morning Route",
            slug: "morning-route",
            visibility: "private",
          },
        ],
      },
    });

    const result = await browser.loadMaps();

    expect(result).toEqual({ ok: true, status: 200 });
    expect(browser.maps.value).toHaveLength(1);
    expect(browser.maps.value[0]).toEqual(
      expect.objectContaining({
        id: "map-1",
        title: "Morning Route",
        slug: "morning-route",
        visibility: "private",
      }),
    );
  });

  it("creates a blank map, selects it, and refreshes map summaries", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-create");

    createMock.mockResolvedValue({
      status: 201,
      data: {
        data: {
          id: "map-2",
          title: "New Map",
          slug: "new-map",
          description: "Created from panel",
          visibility: "private",
          center: { lat: 0, lng: 0 },
          zoom: 10,
          collections: [{ id: "col-1" }],
          geojson: {
            type: "FeatureCollection",
            features: [],
          },
        },
      },
    });
    listMock.mockResolvedValue({
      data: {
        data: [
          {
            id: "map-2",
            title: "New Map",
            slug: "new-map",
            visibility: "private",
          },
        ],
      },
    });

    const result = await browser.createMap({
      title: "New Map",
      slug: "new-map",
      description: "Created from panel",
      visibility: "private",
      collections: ["col-1"],
    });

    expect(result).toEqual({ ok: true, status: 201 });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Map",
        slug: "new-map",
        description: "Created from panel",
        visibility: "private",
        collections: ["col-1"],
        geojson: {
          type: "FeatureCollection",
          features: [],
        },
      }),
    );
    expect(browser.selectedMap.value?.id).toBe("map-2");
    expect(browser.createMapSaved.value).toBe(true);
    expect(browser.maps.value[0]?.id).toBe("map-2");
  });

  it("selects a map and renders GeoJSON features", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-select");

    showMock.mockResolvedValue({
      data: {
        data: {
          id: "map-1",
          title: "Selected Route",
          center: { lat: 12.34, lng: 56.78 },
          zoom: 12,
          geojson: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                id: "line-a",
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [56.78, 12.34],
                    [56.79, 12.35],
                  ],
                },
                properties: {},
              },
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [56.78, 12.34] },
                properties: {},
              },
            ],
          },
        },
      },
    });

    const result = await browser.selectMap("map-1");

    expect(result).toEqual({ ok: true, status: 200 });
    expect(browser.selectedMap.value?.id).toBe("map-1");
    expect(browser.renderedFeatureCount.value).toBe(2);
    expect(setFeatureMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "line-a" }),
    );
    expect(setFeatureMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "map-1-feature-1" }),
    );
    expect(fitBoundsMock).toHaveBeenCalledWith(
      [
        [56.78, 12.34],
        [56.79, 12.35],
      ],
      {
        padding: 60,
        duration: 900,
        maxZoom: 12,
      },
    );
  });

  it("loads available collection summaries for map relationship editing", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-collections");

    listCollectionsMock.mockResolvedValue({
      data: {
        data: [
          {
            id: "col-1",
            title: "Trips",
            slug: "trips",
            visibility: "private",
          },
        ],
      },
    });

    const result = await browser.loadAvailableCollections();

    expect(result).toEqual({ ok: true, status: 200 });
    expect(browser.availableCollections.value).toEqual([
      expect.objectContaining({
        id: "col-1",
        title: "Trips",
        slug: "trips",
      }),
    ]);
  });

  it("removes previously rendered map features when selecting another map", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-reselect");

    showMock
      .mockResolvedValueOnce({
        data: {
          data: {
            id: "map-1",
            geojson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [0, 0] },
                  properties: {},
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            id: "map-2",
            geojson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [1, 1] },
                  properties: {},
                },
              ],
            },
          },
        },
      });

    await browser.selectMap("map-1");
    await browser.selectMap("map-2");

    expect(removeFeatureMock).toHaveBeenCalledWith("map-1-feature-0");
    expect(setFeatureMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "map-2-feature-0" }),
    );
  });

  it("falls back to flyTo center when map has no renderable geometry bounds", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-fallback");

    showMock.mockResolvedValue({
      data: {
        data: {
          id: "map-3",
          center: { lat: 12.34, lng: 56.78 },
          zoom: 11,
          geojson: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: null,
                properties: {},
              },
            ],
          },
        },
      },
    });

    const result = await browser.selectMap("map-3");

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fitBoundsMock).not.toHaveBeenCalled();
    expect(flyToMock).toHaveBeenCalledWith({
      center: [56.78, 12.34],
      zoom: 11,
    });
  });

  it("saves selected map metadata and refreshes selected map details", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-save-meta");

    showMock
      .mockResolvedValueOnce({
        data: {
          data: {
            id: "map-1",
            title: "Old title",
            slug: "old-title",
            description: "Old description",
            visibility: "private",
            center: { lat: 12.34, lng: 56.78 },
            zoom: 12,
            collections: [{ id: "col-1" }, { id: "col-2" }],
            geojson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [56.78, 12.34] },
                  properties: {},
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            id: "map-1",
            title: "New title",
            slug: "new-title",
            description: "New description",
            visibility: "public",
            center: { lat: 12.34, lng: 56.78 },
            zoom: 12,
            collections: [{ id: "col-1" }, { id: "col-2" }],
            geojson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [56.78, 12.34] },
                  properties: {},
                },
              ],
            },
          },
        },
      });

    await browser.selectMap("map-1");

    const result = await browser.saveSelectedMapMeta({
      title: "New title",
      slug: "new-title",
      description: "New description",
      visibility: "public",
      collections: ["col-2"],
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(updateMock).toHaveBeenCalledWith(
      "map-1",
      expect.objectContaining({
        title: "New title",
        slug: "new-title",
        description: "New description",
        visibility: "public",
        collections: ["col-2"],
      }),
    );
    expect(browser.selectedMap.value.title).toBe("New title");
    expect(browser.selectedMapMetaSaved.value).toBe(true);
  });

  it("captures validation errors when metadata update fails with 422", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-save-meta-422");

    showMock.mockResolvedValueOnce({
      data: {
        data: {
          id: "map-1",
          title: "Old title",
          slug: "old-title",
          description: "Old description",
          visibility: "private",
          collections: [],
          geojson: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [56.78, 12.34] },
                properties: {},
              },
            ],
          },
        },
      },
    });

    updateMock.mockRejectedValue({
      response: {
        status: 422,
        data: {
          errors: {
            slug: ["The slug has already been taken."],
          },
        },
      },
    });

    await browser.selectMap("map-1");
    const result = await browser.saveSelectedMapMeta({
      title: "Title",
      slug: "taken-slug",
      description: "",
      visibility: "private",
    });

    expect(result).toEqual({ ok: false, status: 422 });
    expect(browser.selectedMapMetaError.value).toBe("validation");
    expect(browser.selectedMapMetaValidationErrors.value.slug[0]).toBe(
      "The slug has already been taken.",
    );
  });

  it("captures validation errors when map creation fails with 422", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-create-422");

    createMock.mockRejectedValue({
      response: {
        status: 422,
        data: {
          errors: {
            title: ["The title field is required."],
          },
        },
      },
    });

    const result = await browser.createMap({
      title: "",
      slug: "new-map",
      visibility: "private",
    });

    expect(result).toEqual({ ok: false, status: 422 });
    expect(browser.createMapError.value).toBe("validation");
    expect(browser.createMapValidationErrors.value.title[0]).toBe(
      "The title field is required.",
    );
  });

  it("deletes selected map, clears rendered features, and refreshes summaries", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-delete");

    showMock.mockResolvedValue({
      data: {
        data: {
          id: "map-1",
          title: "Delete Me",
          slug: "delete-me",
          visibility: "private",
          center: { lat: 12.34, lng: 56.78 },
          zoom: 12,
          geojson: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [56.78, 12.34] },
                properties: {},
              },
            ],
          },
        },
      },
    });
    destroyMock.mockResolvedValue({ status: 204 });
    listMock.mockResolvedValue({
      data: {
        data: [],
      },
    });

    await browser.selectMap("map-1");
    const result = await browser.deleteSelectedMap();

    expect(result).toEqual({ ok: true, status: 204 });
    expect(destroyMock).toHaveBeenCalledWith("map-1");
    expect(removeFeatureMock).toHaveBeenCalledWith("map-1-feature-0");
    expect(browser.selectedMap.value).toBeNull();
    expect(browser.deleteSelectedMapSaved.value).toBe(true);
    expect(browser.maps.value).toEqual([]);
  });

  it("captures unauthorized errors when map delete fails with 401", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-delete-401");

    showMock.mockResolvedValue({
      data: {
        data: {
          id: "map-1",
          title: "Delete Me",
          slug: "delete-me",
          visibility: "private",
          geojson: {
            type: "FeatureCollection",
            features: [],
          },
        },
      },
    });
    destroyMock.mockRejectedValue({
      response: {
        status: 401,
      },
    });

    await browser.selectMap("map-1");
    const result = await browser.deleteSelectedMap();

    expect(result).toEqual({ ok: false, status: 401 });
    expect(browser.deleteSelectedMapError.value).toBe("unauthorized");
  });

  it("captures not-found errors when map delete fails with 404", async () => {
    const { useMapsBrowser } =
      await import("@/composables/resources/useMapsBrowser");
    const browser = useMapsBrowser("maps-browser-delete-404");

    showMock.mockResolvedValue({
      data: {
        data: {
          id: "map-1",
          title: "Delete Me",
          slug: "delete-me",
          visibility: "private",
          geojson: {
            type: "FeatureCollection",
            features: [],
          },
        },
      },
    });
    destroyMock.mockRejectedValue({
      response: {
        status: 404,
      },
    });

    await browser.selectMap("map-1");
    const result = await browser.deleteSelectedMap();

    expect(result).toEqual({ ok: false, status: 404 });
    expect(browser.deleteSelectedMapError.value).toBe("not-found");
  });
});
