import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const listMapsMock = vi.fn();
const showMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const destroyMock = vi.fn();

vi.mock("@/composables/resources/useCollectionsApi", () => ({
  useCollectionsApi: () => ({
    list: listMock,
    show: showMock,
    create: createMock,
    update: updateMock,
    destroy: destroyMock,
  }),
}));

vi.mock("@/composables/resources/useMapsApi", () => ({
  useMapsApi: () => ({
    list: listMapsMock,
  }),
}));

describe("useCollectionsBrowser", () => {
  beforeEach(() => {
    vi.resetModules();
    listMock.mockReset();
    listMapsMock.mockReset();
    showMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
    destroyMock.mockReset();
  });

  it("loads authenticated collection summaries from /api/user/collections", async () => {
    const { useCollectionsBrowser } =
      await import("@/composables/resources/useCollectionsBrowser");
    const browser = useCollectionsBrowser("collections-browser-list");

    listMock.mockResolvedValue({
      data: {
        data: [
          {
            id: "col-1",
            title: "Trips",
            slug: "trips",
            visibility: "private",
            maps_count: 2,
            children_count: 1,
          },
        ],
      },
    });

    const result = await browser.loadCollections();

    expect(result).toEqual({ ok: true, status: 200 });
    expect(browser.collections.value).toHaveLength(1);
    expect(browser.collections.value[0]).toEqual(
      expect.objectContaining({
        id: "col-1",
        title: "Trips",
        slug: "trips",
        maps_count: 2,
        children_count: 1,
      }),
    );
  });

  it("loads available map summaries for collection assignment", async () => {
    const { useCollectionsBrowser } =
      await import("@/composables/resources/useCollectionsBrowser");
    const browser = useCollectionsBrowser("collections-browser-map-options");

    listMapsMock.mockResolvedValue({
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

    const result = await browser.loadAvailableMaps();

    expect(result).toEqual({ ok: true, status: 200 });
    expect(browser.availableMaps.value).toEqual([
      expect.objectContaining({
        id: "map-1",
        title: "Morning Route",
        slug: "morning-route",
      }),
    ]);
  });

  it("selects a collection and keeps parent/map detail data", async () => {
    const { useCollectionsBrowser } =
      await import("@/composables/resources/useCollectionsBrowser");
    const browser = useCollectionsBrowser("collections-browser-select");

    showMock.mockResolvedValue({
      data: {
        data: {
          id: "col-1",
          title: "Trips",
          slug: "trips",
          visibility: "private",
          parent_id: "col-root",
          parent: {
            id: "col-root",
            title: "Root",
            slug: "root",
            visibility: "private",
          },
          maps_count: 1,
          children_count: 0,
          maps: [
            {
              id: "map-1",
              title: "Morning Route",
              slug: "morning-route",
              visibility: "private",
            },
          ],
        },
      },
    });

    const result = await browser.selectCollection("col-1");

    expect(result).toEqual({ ok: true, status: 200 });
    expect(browser.selectedCollection.value).toEqual(
      expect.objectContaining({
        id: "col-1",
        parent_id: "col-root",
        maps_count: 1,
      }),
    );
    expect(browser.selectedCollection.value.parent).toEqual(
      expect.objectContaining({
        id: "col-root",
        title: "Root",
      }),
    );
    expect(browser.selectedCollection.value.maps[0]).toEqual(
      expect.objectContaining({
        id: "map-1",
        title: "Morning Route",
      }),
    );
  });

  it("saves selected collection metadata and refreshes selected details", async () => {
    const { useCollectionsBrowser } =
      await import("@/composables/resources/useCollectionsBrowser");
    const browser = useCollectionsBrowser("collections-browser-save-meta");

    showMock
      .mockResolvedValueOnce({
        data: {
          data: {
            id: "col-1",
            title: "Old Title",
            slug: "old-title",
            description: "Old Description",
            visibility: "private",
            parent_id: null,
            maps_count: 0,
            children_count: 0,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            id: "col-1",
            title: "New Title",
            slug: "new-title",
            description: "New Description",
            visibility: "public",
            parent_id: null,
            maps_count: 0,
            children_count: 0,
          },
        },
      });

    await browser.selectCollection("col-1");

    const result = await browser.saveSelectedCollectionMeta({
      title: "New Title",
      slug: "new-title",
      description: "New Description",
      visibility: "public",
      parent_id: null,
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(updateMock).toHaveBeenCalledWith(
      "col-1",
      expect.objectContaining({
        title: "New Title",
        slug: "new-title",
        description: "New Description",
        visibility: "public",
        parent_id: null,
      }),
    );
    expect(browser.selectedCollection.value.title).toBe("New Title");
    expect(browser.selectedCollectionMetaSaved.value).toBe(true);
  });

  it("creates a collection and selects it", async () => {
    const { useCollectionsBrowser } =
      await import("@/composables/resources/useCollectionsBrowser");
    const browser = useCollectionsBrowser("collections-browser-create");

    createMock.mockResolvedValue({
      data: {
        data: {
          id: "col-2",
          title: "Hikes",
          slug: "hikes",
          description: "Hiking routes",
          visibility: "private",
          parent_id: null,
          maps_count: 0,
          children_count: 0,
        },
      },
    });

    const result = await browser.createCollection({
      title: "Hikes",
      slug: "hikes",
      description: "Hiking routes",
      visibility: "private",
      parent_id: null,
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(browser.collections.value[0]).toEqual(
      expect.objectContaining({
        id: "col-2",
        title: "Hikes",
      }),
    );
    expect(browser.selectedCollection.value.id).toBe("col-2");
    expect(browser.createCollectionSaved.value).toBe(true);
  });

  it("removes selected collection after successful delete", async () => {
    const { useCollectionsBrowser } =
      await import("@/composables/resources/useCollectionsBrowser");
    const browser = useCollectionsBrowser("collections-browser-delete");

    showMock.mockResolvedValueOnce({
      data: {
        data: {
          id: "col-1",
          title: "Trips",
          slug: "trips",
          visibility: "private",
          parent_id: null,
          maps_count: 0,
          children_count: 0,
        },
      },
    });

    await browser.selectCollection("col-1");

    destroyMock.mockResolvedValue({
      status: 204,
    });
    listMock.mockResolvedValue({
      data: {
        data: [],
      },
    });

    const result = await browser.deleteSelectedCollection();

    expect(result).toEqual({ ok: true, status: 204 });
    expect(destroyMock).toHaveBeenCalledWith("col-1");
    expect(listMock).toHaveBeenCalled();
    expect(browser.selectedCollection.value).toBeNull();
    expect(browser.deleteSelectedCollectionSaved.value).toBe(true);
  });

  it("captures unauthorized errors when collection delete fails with 401", async () => {
    const { useCollectionsBrowser } =
      await import("@/composables/resources/useCollectionsBrowser");
    const browser = useCollectionsBrowser("collections-browser-delete-401");

    showMock.mockResolvedValueOnce({
      data: {
        data: {
          id: "col-1",
          title: "Trips",
          slug: "trips",
          visibility: "private",
          parent_id: null,
          maps_count: 0,
          children_count: 0,
        },
      },
    });

    await browser.selectCollection("col-1");

    destroyMock.mockRejectedValue({
      response: {
        status: 401,
      },
    });

    const result = await browser.deleteSelectedCollection();

    expect(result).toEqual({ ok: false, status: 401 });
    expect(browser.deleteSelectedCollectionError.value).toBe("unauthorized");
  });

  it("captures not-found errors when collection delete fails with 404", async () => {
    const { useCollectionsBrowser } =
      await import("@/composables/resources/useCollectionsBrowser");
    const browser = useCollectionsBrowser("collections-browser-delete-404");

    showMock.mockResolvedValueOnce({
      data: {
        data: {
          id: "col-1",
          title: "Trips",
          slug: "trips",
          visibility: "private",
          parent_id: null,
          maps_count: 0,
          children_count: 0,
        },
      },
    });

    await browser.selectCollection("col-1");

    destroyMock.mockRejectedValue({
      response: {
        status: 404,
      },
    });

    const result = await browser.deleteSelectedCollection();

    expect(result).toEqual({ ok: false, status: 404 });
    expect(browser.deleteSelectedCollectionError.value).toBe("not-found");
  });
});
