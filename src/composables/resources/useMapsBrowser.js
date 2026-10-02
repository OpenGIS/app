import { inject, ref } from "vue";
import { getMapInstance } from "@/composables/useMap";
import { useGeoJSON } from "@/composables/useGeoJSON";
import { useMapsApi } from "@/composables/resources/useMapsApi";
import { useCollectionsApi } from "@/composables/resources/useCollectionsApi";

const cache = new Map();

function createState() {
  return {
    maps: ref([]),
    loadingMaps: ref(false),
    mapsError: ref(null),
    creatingMap: ref(false),
    createMapError: ref(null),
    createMapValidationErrors: ref({}),
    createMapSaved: ref(false),
    deletingSelectedMap: ref(false),
    deleteSelectedMapError: ref(null),
    deleteSelectedMapSaved: ref(false),
    availableCollections: ref([]),
    loadingAvailableCollections: ref(false),
    availableCollectionsError: ref(null),
    selectedMap: ref(null),
    loadingSelectedMap: ref(false),
    selectedMapError: ref(null),
    renderedFeatureIds: ref([]),
    renderedFeatureCount: ref(0),
    savingSelectedMapMeta: ref(false),
    selectedMapMetaError: ref(null),
    selectedMapMetaValidationErrors: ref({}),
    selectedMapMetaSaved: ref(false),
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
    description: map?.description ?? null,
    visibility: map?.visibility ?? "private",
    updated_at: map?.updated_at ?? null,
  };
}

function normalizeMapDetails(map) {
  return {
    ...normalizeMapSummary(map),
    center: map?.center ?? null,
    zoom: map?.zoom ?? null,
    geojson: map?.geojson ?? null,
    collections: Array.isArray(map?.collections) ? map.collections : [],
  };
}

function normalizeCollectionSummary(collection) {
  return {
    id: collection?.id ?? null,
    title: collection?.title ?? null,
    slug: collection?.slug ?? null,
    description: collection?.description ?? null,
    visibility: collection?.visibility ?? "private",
  };
}

function normalizeFeatureCollection(geojson) {
  if (!geojson) {
    return null;
  }

  let parsedGeojson = geojson;

  if (typeof parsedGeojson === "string") {
    try {
      parsedGeojson = JSON.parse(parsedGeojson);
    } catch {
      return null;
    }
  }

  if (
    parsedGeojson?.type !== "FeatureCollection" ||
    !Array.isArray(parsedGeojson?.features)
  ) {
    return null;
  }

  return parsedGeojson;
}

function hasCenterCoordinates(center) {
  return Number.isFinite(center?.lat) && Number.isFinite(center?.lng);
}

function normalizeMetaPayload(meta) {
  return {
    title: meta?.title ?? "",
    slug: meta?.slug ?? "",
    description: (meta?.description ?? "").trim() || null,
    visibility: meta?.visibility ?? "private",
  };
}

function buildBlankFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function normalizeCollectionIds(collections) {
  if (!Array.isArray(collections)) {
    return [];
  }

  return collections.filter((id) => !!id);
}

function collectGeometryCoordinates(geometry) {
  if (!geometry?.type) {
    return [];
  }

  if (geometry.type === "Point") {
    return [geometry.coordinates];
  }

  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    return geometry.coordinates;
  }

  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    return geometry.coordinates.flat(1);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flat(2);
  }

  if (
    geometry.type === "GeometryCollection" &&
    Array.isArray(geometry.geometries)
  ) {
    return geometry.geometries.flatMap((childGeometry) =>
      collectGeometryCoordinates(childGeometry),
    );
  }

  return [];
}

function getFeatureCollectionBounds(featureCollection) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  featureCollection.features.forEach((feature) => {
    const coordinates = collectGeometryCoordinates(feature?.geometry);

    coordinates.forEach((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) {
        return;
      }

      const [lng, lat] = coordinate;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return;
      }

      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    });
  });

  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
    return null;
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export function useMapsBrowser(instanceId) {
  const id = instanceId ?? inject("ogisAppId", "app");

  if (!cache.has(id)) {
    cache.set(id, createState());
  }

  const state = cache.get(id);
  const mapsApi = useMapsApi();
  const collectionsApi = useCollectionsApi();
  const geojson = useGeoJSON(id);

  const clearRenderedFeatures = () => {
    for (const featureId of state.renderedFeatureIds.value) {
      geojson.removeFeature(featureId);
    }

    state.renderedFeatureIds.value = [];
    state.renderedFeatureCount.value = 0;
  };

  const clearMetaFeedback = () => {
    state.selectedMapMetaError.value = null;
    state.selectedMapMetaValidationErrors.value = {};
    state.selectedMapMetaSaved.value = false;
  };

  const clearCreateFeedback = () => {
    state.createMapError.value = null;
    state.createMapValidationErrors.value = {};
    state.createMapSaved.value = false;
  };

  const clearDeleteFeedback = () => {
    state.deleteSelectedMapError.value = null;
    state.deleteSelectedMapSaved.value = false;
  };

  const upsertMapSummary = (map) => {
    const summary = normalizeMapSummary(map);
    const remaining = state.maps.value.filter((item) => item.id !== summary.id);

    state.maps.value = [summary, ...remaining];
  };

  const renderSelectedMap = (map) => {
    clearRenderedFeatures();

    const featureCollection = normalizeFeatureCollection(map?.geojson);

    if (!featureCollection) {
      return false;
    }

    let renderedCount = 0;
    const nextRenderedFeatureIds = [];

    featureCollection.features.forEach((feature, index) => {
      if (feature?.type !== "Feature" || !feature?.geometry?.type) {
        return;
      }

      const featureId = feature.id ?? `${map.id}-feature-${index}`;

      geojson.setFeature({
        ...feature,
        id: featureId,
      });

      nextRenderedFeatureIds.push(featureId);
      renderedCount += 1;
    });

    state.renderedFeatureIds.value = nextRenderedFeatureIds;
    state.renderedFeatureCount.value = renderedCount;

    const mapInstance = getMapInstance(id);
    const bounds = getFeatureCollectionBounds(featureCollection);

    if (mapInstance && bounds) {
      mapInstance.fitBounds(bounds, {
        padding: 60,
        duration: 900,
        maxZoom: Number.isFinite(map?.zoom) ? map.zoom : 15,
      });
    } else if (mapInstance && hasCenterCoordinates(map?.center)) {
      mapInstance.flyTo({
        center: [map.center.lng, map.center.lat],
        zoom: Number.isFinite(map?.zoom) ? map.zoom : mapInstance.getZoom(),
      });
    }

    return true;
  };

  const loadMaps = async () => {
    state.loadingMaps.value = true;
    state.mapsError.value = null;

    try {
      const response = await mapsApi.list();
      state.maps.value =
        extractCollectionData(response).map(normalizeMapSummary);

      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;
      state.maps.value = [];
      state.mapsError.value = status === 401 ? "unauthorized" : "load-failed";

      return { ok: false, status };
    } finally {
      state.loadingMaps.value = false;
    }
  };

  const loadAvailableCollections = async () => {
    state.loadingAvailableCollections.value = true;
    state.availableCollectionsError.value = null;

    try {
      const response = await collectionsApi.list();
      state.availableCollections.value = extractCollectionData(response).map(
        normalizeCollectionSummary,
      );

      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;
      state.availableCollections.value = [];
      state.availableCollectionsError.value =
        status === 401 ? "unauthorized" : "load-failed";

      return { ok: false, status };
    } finally {
      state.loadingAvailableCollections.value = false;
    }
  };

  const createMap = async (meta) => {
    state.creatingMap.value = true;
    clearCreateFeedback();
    clearDeleteFeedback();
    clearMetaFeedback();
    state.selectedMapError.value = null;

    try {
      const nextMeta = normalizeMetaPayload(meta);
      const nextCollectionIds = normalizeCollectionIds(meta?.collections);

      const response = await mapsApi.create({
        ...nextMeta,
        geojson: buildBlankFeatureCollection(),
        collections: nextCollectionIds,
      });

      const createdMap = normalizeMapDetails(extractResourceData(response));
      state.selectedMap.value = createdMap;
      upsertMapSummary(createdMap);
      renderSelectedMap(createdMap);
      state.createMapSaved.value = true;

      await loadMaps();

      return { ok: true, status: response?.status ?? 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;

      if (status === 422) {
        state.createMapError.value = "validation";
        state.createMapValidationErrors.value =
          error?.response?.data?.errors ?? {};
      } else if (status === 401) {
        state.createMapError.value = "unauthorized";
      } else {
        state.createMapError.value = "save-failed";
      }

      return { ok: false, status };
    } finally {
      state.creatingMap.value = false;
    }
  };

  const selectMap = async (mapId) => {
    state.loadingSelectedMap.value = true;
    state.selectedMapError.value = null;
    clearMetaFeedback();
    clearDeleteFeedback();

    try {
      const response = await mapsApi.show(mapId);
      const details = normalizeMapDetails(extractResourceData(response));
      state.selectedMap.value = details;

      if (!renderSelectedMap(details)) {
        state.selectedMapError.value = "invalid-geojson";
        return { ok: false, status: 422 };
      }

      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;
      state.selectedMap.value = null;
      clearRenderedFeatures();

      if (status === 401) {
        state.selectedMapError.value = "unauthorized";
      } else if (status === 404) {
        state.selectedMapError.value = "not-found";
      } else {
        state.selectedMapError.value = "load-failed";
      }

      return { ok: false, status };
    } finally {
      state.loadingSelectedMap.value = false;
    }
  };

  const saveSelectedMapMeta = async (meta) => {
    if (!state.selectedMap.value?.id) {
      return { ok: false, status: 0 };
    }

    state.savingSelectedMapMeta.value = true;
    clearMetaFeedback();
    clearDeleteFeedback();

    try {
      const currentMap = state.selectedMap.value;
      const nextMeta = normalizeMetaPayload(meta);
      const nextCollectionIds = Array.isArray(meta?.collections)
        ? normalizeCollectionIds(meta.collections)
        : normalizeCollectionIds(
            (currentMap.collections ?? []).map((collection) => collection.id),
          );

      await mapsApi.update(currentMap.id, {
        ...nextMeta,
        geojson: currentMap.geojson,
        collections: nextCollectionIds,
      });

      const refreshedResponse = await mapsApi.show(currentMap.id);
      const refreshedMap = normalizeMapDetails(
        extractResourceData(refreshedResponse),
      );

      state.selectedMap.value = refreshedMap;
      upsertMapSummary(refreshedMap);
      renderSelectedMap(refreshedMap);
      state.selectedMapMetaSaved.value = true;

      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status ?? 0;

      if (status === 422) {
        state.selectedMapMetaError.value = "validation";
        state.selectedMapMetaValidationErrors.value =
          error?.response?.data?.errors ?? {};
      } else if (status === 401) {
        state.selectedMapMetaError.value = "unauthorized";
      } else if (status === 404) {
        state.selectedMapMetaError.value = "not-found";
      } else {
        state.selectedMapMetaError.value = "save-failed";
      }

      return { ok: false, status };
    } finally {
      state.savingSelectedMapMeta.value = false;
    }
  };

  const deleteSelectedMap = async () => {
    if (!state.selectedMap.value?.id) {
      return { ok: false, status: 0 };
    }

    state.deletingSelectedMap.value = true;
    clearDeleteFeedback();

    try {
      const mapId = state.selectedMap.value.id;
      const response = await mapsApi.destroy(mapId);

      state.selectedMap.value = null;
      state.selectedMapError.value = null;
      clearMetaFeedback();
      clearRenderedFeatures();
      state.deleteSelectedMapSaved.value = true;

      await loadMaps();

      return { ok: true, status: response?.status ?? 204 };
    } catch (error) {
      const status = error?.response?.status ?? 0;

      if (status === 401) {
        state.deleteSelectedMapError.value = "unauthorized";
      } else if (status === 404) {
        state.deleteSelectedMapError.value = "not-found";
      } else {
        state.deleteSelectedMapError.value = "delete-failed";
      }

      return { ok: false, status };
    } finally {
      state.deletingSelectedMap.value = false;
    }
  };

  const clearSelection = () => {
    state.selectedMap.value = null;
    state.selectedMapError.value = null;
    clearMetaFeedback();
    clearDeleteFeedback();
    clearRenderedFeatures();
  };

  const clear = () => {
    state.maps.value = [];
    state.mapsError.value = null;
    state.availableCollections.value = [];
    state.availableCollectionsError.value = null;
    clearCreateFeedback();
    clearSelection();
  };

  return {
    maps: state.maps,
    loadingMaps: state.loadingMaps,
    mapsError: state.mapsError,
    creatingMap: state.creatingMap,
    createMapError: state.createMapError,
    createMapValidationErrors: state.createMapValidationErrors,
    createMapSaved: state.createMapSaved,
    deletingSelectedMap: state.deletingSelectedMap,
    deleteSelectedMapError: state.deleteSelectedMapError,
    deleteSelectedMapSaved: state.deleteSelectedMapSaved,
    availableCollections: state.availableCollections,
    loadingAvailableCollections: state.loadingAvailableCollections,
    availableCollectionsError: state.availableCollectionsError,
    selectedMap: state.selectedMap,
    loadingSelectedMap: state.loadingSelectedMap,
    selectedMapError: state.selectedMapError,
    renderedFeatureCount: state.renderedFeatureCount,
    savingSelectedMapMeta: state.savingSelectedMapMeta,
    selectedMapMetaError: state.selectedMapMetaError,
    selectedMapMetaValidationErrors: state.selectedMapMetaValidationErrors,
    selectedMapMetaSaved: state.selectedMapMetaSaved,
    loadMaps,
    loadAvailableCollections,
    createMap,
    selectMap,
    saveSelectedMapMeta,
    deleteSelectedMap,
    clearSelection,
    clear,
  };
}
