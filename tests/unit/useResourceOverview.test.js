import { beforeEach, describe, expect, it, vi } from "vitest";

const listMapsMock = vi.fn();
const listCollectionsMock = vi.fn();

vi.mock("@/composables/resources/useMapsApi", () => ({
  useMapsApi: () => ({
    list: listMapsMock,
  }),
}));

vi.mock("@/composables/resources/useCollectionsApi", () => ({
  useCollectionsApi: () => ({
    list: listCollectionsMock,
  }),
}));

describe("useResourceOverview", () => {
  beforeEach(() => {
    vi.resetModules();
    listMapsMock.mockReset();
    listCollectionsMock.mockReset();
  });

  it("loads map and collection summaries for authenticated account panel", async () => {
    const { useResourceOverview } =
      await import("@/composables/resources/useResourceOverview");
    const overview = useResourceOverview("resource-overview-success");

    listMapsMock.mockResolvedValue({
      data: {
        data: [{ id: "map-1", title: "Morning Route", visibility: "public" }],
      },
    });
    listCollectionsMock.mockResolvedValue({
      data: {
        data: [{ id: "col-1", title: "Weekend Trails", visibility: "private" }],
      },
    });

    const result = await overview.refresh();

    expect(result).toEqual({ ok: true, status: 200 });
    expect(overview.mapCount.value).toBe(1);
    expect(overview.collectionCount.value).toBe(1);
    expect(overview.maps.value[0]).toEqual(
      expect.objectContaining({
        id: "map-1",
        title: "Morning Route",
        visibility: "public",
      }),
    );
    expect(overview.collections.value[0]).toEqual(
      expect.objectContaining({
        id: "col-1",
        title: "Weekend Trails",
        visibility: "private",
      }),
    );
    expect(overview.error.value).toBeNull();
  });

  it("maps unauthorized API failures to an auth-specific error state", async () => {
    const { useResourceOverview } =
      await import("@/composables/resources/useResourceOverview");
    const overview = useResourceOverview("resource-overview-401");

    listMapsMock.mockRejectedValue({
      response: { status: 401 },
    });
    listCollectionsMock.mockResolvedValue({ data: { data: [] } });

    const result = await overview.refresh();

    expect(result).toEqual({ ok: false, status: 401 });
    expect(overview.error.value).toBe("unauthorized");
    expect(overview.mapCount.value).toBe(0);
    expect(overview.collectionCount.value).toBe(0);
  });

  it("clears overview state explicitly when account session is reset", async () => {
    const { useResourceOverview } =
      await import("@/composables/resources/useResourceOverview");
    const overview = useResourceOverview("resource-overview-clear");

    listMapsMock.mockResolvedValue({
      data: { data: [{ id: "map-1", title: "Map" }] },
    });
    listCollectionsMock.mockResolvedValue({
      data: { data: [{ id: "col-1", title: "Collection" }] },
    });

    await overview.refresh();
    overview.clear();

    expect(overview.mapCount.value).toBe(0);
    expect(overview.collectionCount.value).toBe(0);
    expect(overview.error.value).toBeNull();
  });
});
