import { computed, inject, ref } from "vue";
import { useCollectionsApi } from "@/composables/resources/useCollectionsApi";
import { useMapsApi } from "@/composables/resources/useMapsApi";

const cache = new Map();

function createState() {
  return {
    maps: ref([]),
    collections: ref([]),
    loading: ref(false),
    error: ref(null),
  };
}

function extractCollectionData(response) {
  if (Array.isArray(response?.data?.data)) {
    return response.data.data;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  if (Array.isArray(response)) {
    return response;
  }

  return [];
}

function normalizeMap(map) {
  return {
    id: map?.id ?? null,
    title: map?.title ?? null,
    slug: map?.slug ?? null,
    description: map?.description ?? null,
    visibility: map?.visibility ?? "private",
    created_at: map?.created_at ?? null,
    updated_at: map?.updated_at ?? null,
  };
}

function normalizeCollection(collection) {
  return {
    id: collection?.id ?? null,
    title: collection?.title ?? null,
    slug: collection?.slug ?? null,
    description: collection?.description ?? null,
    visibility: collection?.visibility ?? "private",
    created_at: collection?.created_at ?? null,
  };
}

export function useResourceOverview(instanceId) {
  const id = instanceId ?? inject("ogisAppId", "app");

  if (!cache.has(id)) {
    cache.set(id, createState());
  }

  const state = cache.get(id);
  const mapsApi = useMapsApi();
  const collectionsApi = useCollectionsApi();

  const mapCount = computed(() => state.maps.value.length);
  const collectionCount = computed(() => state.collections.value.length);

  const clear = () => {
    state.maps.value = [];
    state.collections.value = [];
    state.error.value = null;
  };

  const refresh = async () => {
    state.loading.value = true;
    state.error.value = null;

    try {
      const [mapsResponse, collectionsResponse] = await Promise.all([
        mapsApi.list(),
        collectionsApi.list(),
      ]);

      state.maps.value = extractCollectionData(mapsResponse).map(normalizeMap);
      state.collections.value =
        extractCollectionData(collectionsResponse).map(normalizeCollection);

      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;
      state.maps.value = [];
      state.collections.value = [];
      state.error.value = status === 401 ? "unauthorized" : "load-failed";

      return { ok: false, status };
    } finally {
      state.loading.value = false;
    }
  };

  return {
    maps: state.maps,
    collections: state.collections,
    loading: state.loading,
    error: state.error,
    mapCount,
    collectionCount,
    refresh,
    clear,
  };
}
