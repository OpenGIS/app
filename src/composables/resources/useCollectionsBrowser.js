import { inject, ref } from "vue";
import { useCollectionsApi } from "@/composables/resources/useCollectionsApi";
import { useMapsApi } from "@/composables/resources/useMapsApi";

const cache = new Map();

function createState() {
  return {
    collections: ref([]),
    loadingCollections: ref(false),
    collectionsError: ref(null),
    availableMaps: ref([]),
    loadingAvailableMaps: ref(false),
    availableMapsError: ref(null),
    selectedCollection: ref(null),
    loadingSelectedCollection: ref(false),
    selectedCollectionError: ref(null),
    savingSelectedCollectionMeta: ref(false),
    selectedCollectionMetaError: ref(null),
    selectedCollectionMetaValidationErrors: ref({}),
    selectedCollectionMetaSaved: ref(false),
    creatingCollection: ref(false),
    createCollectionError: ref(null),
    createCollectionValidationErrors: ref({}),
    createCollectionSaved: ref(false),
    deletingSelectedCollection: ref(false),
    deleteSelectedCollectionError: ref(null),
    deleteSelectedCollectionSaved: ref(false),
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

function extractResourceData(response) {
  if (response?.data?.data && typeof response.data.data === "object") {
    return response.data.data;
  }

  if (response?.data && typeof response.data === "object") {
    return response.data;
  }

  if (response && typeof response === "object") {
    return response;
  }

  return null;
}

function normalizeMapSummary(map) {
  return {
    id: map?.id ?? null,
    title: map?.title ?? null,
    slug: map?.slug ?? null,
    visibility: map?.visibility ?? "private",
  };
}

function normalizeMapCollection(mapCollection) {
  if (typeof mapCollection === "string") {
    return mapCollection;
  }

  if (mapCollection && typeof mapCollection === "object") {
    return mapCollection.id ?? null;
  }

  return null;
}

function normalizeCollectionSummary(collection) {
  return {
    id: collection?.id ?? null,
    title: collection?.title ?? null,
    slug: collection?.slug ?? null,
    description: collection?.description ?? null,
    visibility: collection?.visibility ?? "private",
    parent_id: collection?.parent_id ?? null,
    maps_count: Number.isFinite(collection?.maps_count)
      ? collection.maps_count
      : 0,
    children_count: Number.isFinite(collection?.children_count)
      ? collection.children_count
      : 0,
    created_at: collection?.created_at ?? null,
    updated_at: collection?.updated_at ?? null,
  };
}

function normalizeCollectionDetails(collection) {
  return {
    ...normalizeCollectionSummary(collection),
    parent: collection?.parent
      ? normalizeCollectionSummary(collection.parent)
      : null,
    children: Array.isArray(collection?.children)
      ? collection.children.map(normalizeCollectionSummary)
      : [],
    maps: Array.isArray(collection?.maps)
      ? collection.maps.map(normalizeMapSummary)
      : [],
  };
}

function normalizeMetaPayload(meta) {
  return {
    title: meta?.title ?? "",
    slug: meta?.slug ?? "",
    description: (meta?.description ?? "").trim() || null,
    visibility: meta?.visibility ?? "private",
    parent_id: meta?.parent_id ?? null,
    maps: Array.isArray(meta?.maps)
      ? meta.maps.map(normalizeMapCollection).filter((id) => !!id)
      : [],
  };
}

export function useCollectionsBrowser(instanceId) {
  const id = instanceId ?? inject("onrteAppId", "app");

  if (!cache.has(id)) {
    cache.set(id, createState());
  }

  const state = cache.get(id);
  const collectionsApi = useCollectionsApi();
  const mapsApi = useMapsApi();

  const clearSelectedMetaFeedback = () => {
    state.selectedCollectionMetaError.value = null;
    state.selectedCollectionMetaValidationErrors.value = {};
    state.selectedCollectionMetaSaved.value = false;
  };

  const clearCreateFeedback = () => {
    state.createCollectionError.value = null;
    state.createCollectionValidationErrors.value = {};
    state.createCollectionSaved.value = false;
  };

  const clearDeleteFeedback = () => {
    state.deleteSelectedCollectionError.value = null;
    state.deleteSelectedCollectionSaved.value = false;
  };

  const upsertCollectionSummary = (collection) => {
    const summary = normalizeCollectionSummary(collection);
    const remaining = state.collections.value.filter(
      (item) => item.id !== summary.id,
    );

    state.collections.value = [summary, ...remaining];
  };

  const loadCollections = async () => {
    state.loadingCollections.value = true;
    state.collectionsError.value = null;

    try {
      const response = await collectionsApi.list();
      state.collections.value = extractCollectionData(response).map(
        normalizeCollectionSummary,
      );

      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;
      state.collections.value = [];
      state.collectionsError.value =
        status === 401 ? "unauthorized" : "load-failed";

      return { ok: false, status };
    } finally {
      state.loadingCollections.value = false;
    }
  };

  const loadAvailableMaps = async () => {
    state.loadingAvailableMaps.value = true;
    state.availableMapsError.value = null;

    try {
      const response = await mapsApi.list();
      state.availableMaps.value =
        extractCollectionData(response).map(normalizeMapSummary);

      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;
      state.availableMaps.value = [];
      state.availableMapsError.value =
        status === 401 ? "unauthorized" : "load-failed";

      return { ok: false, status };
    } finally {
      state.loadingAvailableMaps.value = false;
    }
  };

  const selectCollection = async (collectionId) => {
    state.loadingSelectedCollection.value = true;
    state.selectedCollectionError.value = null;
    clearSelectedMetaFeedback();
    clearDeleteFeedback();

    try {
      const response = await collectionsApi.show(collectionId);
      const details = normalizeCollectionDetails(extractResourceData(response));
      state.selectedCollection.value = details;
      upsertCollectionSummary(details);

      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;
      state.selectedCollection.value = null;

      if (status === 401) {
        state.selectedCollectionError.value = "unauthorized";
      } else if (status === 404) {
        state.selectedCollectionError.value = "not-found";
      } else {
        state.selectedCollectionError.value = "load-failed";
      }

      return { ok: false, status };
    } finally {
      state.loadingSelectedCollection.value = false;
    }
  };

  const saveSelectedCollectionMeta = async (meta) => {
    if (!state.selectedCollection.value?.id) {
      return { ok: false, status: 0 };
    }

    state.savingSelectedCollectionMeta.value = true;
    clearSelectedMetaFeedback();

    try {
      const currentCollection = state.selectedCollection.value;
      await collectionsApi.update(
        currentCollection.id,
        normalizeMetaPayload(meta),
      );

      const refreshedResponse = await collectionsApi.show(currentCollection.id);
      const refreshedCollection = normalizeCollectionDetails(
        extractResourceData(refreshedResponse),
      );

      state.selectedCollection.value = refreshedCollection;
      upsertCollectionSummary(refreshedCollection);
      state.selectedCollectionMetaSaved.value = true;

      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;

      if (status === 422) {
        state.selectedCollectionMetaError.value = "validation";
        state.selectedCollectionMetaValidationErrors.value =
          error?.response?.data?.errors ?? {};
      } else if (status === 401) {
        state.selectedCollectionMetaError.value = "unauthorized";
      } else if (status === 404) {
        state.selectedCollectionMetaError.value = "not-found";
      } else {
        state.selectedCollectionMetaError.value = "save-failed";
      }

      return { ok: false, status };
    } finally {
      state.savingSelectedCollectionMeta.value = false;
    }
  };

  const createCollection = async (meta) => {
    state.creatingCollection.value = true;
    clearCreateFeedback();

    try {
      const response = await collectionsApi.create(normalizeMetaPayload(meta));
      const createdCollection = normalizeCollectionDetails(
        extractResourceData(response),
      );

      upsertCollectionSummary(createdCollection);
      state.createCollectionSaved.value = true;

      if (createdCollection?.id) {
        state.selectedCollection.value = createdCollection;
      }

      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;

      if (status === 422) {
        state.createCollectionError.value = "validation";
        state.createCollectionValidationErrors.value =
          error?.response?.data?.errors ?? {};
      } else if (status === 401) {
        state.createCollectionError.value = "unauthorized";
      } else {
        state.createCollectionError.value = "save-failed";
      }

      return { ok: false, status };
    } finally {
      state.creatingCollection.value = false;
    }
  };

  const deleteSelectedCollection = async () => {
    if (!state.selectedCollection.value?.id) {
      return { ok: false, status: 0 };
    }

    state.deletingSelectedCollection.value = true;
    clearDeleteFeedback();

    try {
      const collectionId = state.selectedCollection.value.id;
      const response = await collectionsApi.destroy(collectionId);

      state.selectedCollection.value = null;
      state.selectedCollectionError.value = null;
      clearSelectedMetaFeedback();
      state.deleteSelectedCollectionSaved.value = true;

      await loadCollections();

      return { ok: true, status: response?.status ?? 204 };
    } catch (error) {
      const status = error?.response?.status ?? 0;

      if (status === 401) {
        state.deleteSelectedCollectionError.value = "unauthorized";
      } else if (status === 404) {
        state.deleteSelectedCollectionError.value = "not-found";
      } else {
        state.deleteSelectedCollectionError.value = "delete-failed";
      }

      return { ok: false, status };
    } finally {
      state.deletingSelectedCollection.value = false;
    }
  };

  const clearSelection = () => {
    state.selectedCollection.value = null;
    state.selectedCollectionError.value = null;
    clearSelectedMetaFeedback();
    clearDeleteFeedback();
  };

  const clear = () => {
    state.collections.value = [];
    state.collectionsError.value = null;
    state.availableMaps.value = [];
    state.availableMapsError.value = null;
    clearSelection();
    clearCreateFeedback();
  };

  return {
    collections: state.collections,
    loadingCollections: state.loadingCollections,
    collectionsError: state.collectionsError,
    availableMaps: state.availableMaps,
    loadingAvailableMaps: state.loadingAvailableMaps,
    availableMapsError: state.availableMapsError,
    selectedCollection: state.selectedCollection,
    loadingSelectedCollection: state.loadingSelectedCollection,
    selectedCollectionError: state.selectedCollectionError,
    savingSelectedCollectionMeta: state.savingSelectedCollectionMeta,
    selectedCollectionMetaError: state.selectedCollectionMetaError,
    selectedCollectionMetaValidationErrors:
      state.selectedCollectionMetaValidationErrors,
    selectedCollectionMetaSaved: state.selectedCollectionMetaSaved,
    creatingCollection: state.creatingCollection,
    createCollectionError: state.createCollectionError,
    createCollectionValidationErrors: state.createCollectionValidationErrors,
    createCollectionSaved: state.createCollectionSaved,
    deletingSelectedCollection: state.deletingSelectedCollection,
    deleteSelectedCollectionError: state.deleteSelectedCollectionError,
    deleteSelectedCollectionSaved: state.deleteSelectedCollectionSaved,
    loadCollections,
    loadAvailableMaps,
    selectCollection,
    saveSelectedCollectionMeta,
    createCollection,
    deleteSelectedCollection,
    clearSelection,
    clear,
  };
}
