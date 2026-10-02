import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const postMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();
const ensureCsrfCookieMock = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    get: getMock,
    post: postMock,
    put: putMock,
    delete: deleteMock,
  },
  ensureCsrfCookie: ensureCsrfCookieMock,
}));

describe("resource API composables", () => {
  beforeEach(() => {
    vi.resetModules();
    getMock.mockReset();
    postMock.mockReset();
    putMock.mockReset();
    deleteMock.mockReset();
    ensureCsrfCookieMock.mockReset();
  });

  it("useMapsApi stringifies geojson payload on create/update", async () => {
    const { useMapsApi } = await import("@/composables/resources/useMapsApi");
    const maps = useMapsApi();

    ensureCsrfCookieMock.mockResolvedValue(undefined);
    postMock.mockResolvedValue({});
    putMock.mockResolvedValue({});

    const geojson = { type: "FeatureCollection", features: [] };
    await maps.create({
      title: "My map",
      slug: "my-map",
      visibility: "private",
      geojson,
    });
    await maps.update("map-1", {
      title: "My map",
      slug: "my-map",
      visibility: "private",
      geojson,
    });

    expect(postMock).toHaveBeenCalledWith(
      "/api/user/maps",
      expect.objectContaining({
        geojson: JSON.stringify(geojson),
      }),
    );
    expect(putMock).toHaveBeenCalledWith(
      "/api/user/maps/map-1",
      expect.objectContaining({
        geojson: JSON.stringify(geojson),
      }),
    );
  });

  it("useMapsApi routes list/show/destroy to expected endpoints", async () => {
    const { useMapsApi } = await import("@/composables/resources/useMapsApi");
    const maps = useMapsApi();
    getMock.mockResolvedValue({});
    deleteMock.mockResolvedValue({});
    ensureCsrfCookieMock.mockResolvedValue(undefined);

    await maps.list();
    await maps.show("map-42");
    await maps.destroy("map-42");

    expect(getMock).toHaveBeenCalledWith("/api/user/maps");
    expect(getMock).toHaveBeenCalledWith("/api/user/maps/map-42");
    expect(deleteMock).toHaveBeenCalledWith("/api/user/maps/map-42");
  });

  it("useCollectionsApi normalizes parent_id to null when missing", async () => {
    const { useCollectionsApi } =
      await import("@/composables/resources/useCollectionsApi");
    const collections = useCollectionsApi();
    ensureCsrfCookieMock.mockResolvedValue(undefined);
    postMock.mockResolvedValue({});

    await collections.create({
      title: "Root collection",
      slug: "root-collection",
    });

    expect(postMock).toHaveBeenCalledWith(
      "/api/user/collections",
      expect.objectContaining({
        parent_id: null,
      }),
    );
  });

  it("useCollectionsApi routes list/show/update/destroy to expected endpoints", async () => {
    const { useCollectionsApi } =
      await import("@/composables/resources/useCollectionsApi");
    const collections = useCollectionsApi();
    getMock.mockResolvedValue({});
    putMock.mockResolvedValue({});
    deleteMock.mockResolvedValue({});
    ensureCsrfCookieMock.mockResolvedValue(undefined);

    await collections.list();
    await collections.show("col-1");
    await collections.update("col-1", {
      title: "Renamed",
      slug: "renamed",
      parent_id: "root",
    });
    await collections.destroy("col-1");

    expect(getMock).toHaveBeenCalledWith("/api/user/collections");
    expect(getMock).toHaveBeenCalledWith("/api/user/collections/col-1");
    expect(putMock).toHaveBeenCalledWith(
      "/api/user/collections/col-1",
      expect.objectContaining({
        parent_id: "root",
      }),
    );
    expect(deleteMock).toHaveBeenCalledWith("/api/user/collections/col-1");
  });
});
