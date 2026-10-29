import { inject } from "vue";
import { getMapInstance } from "@/composables/useMap.js";
import { emitter } from "@/emitter.js";
import { reportError } from "@/resilience/errors.js";
import { BRIGHT_COLORS } from "@/utils/track/colors.js";

const SOURCE_ID = "ogis-geojson";
const LAYER_IDS = {
  polygonFill: "ogis-geojson-polygon-fill",
  polygonOutline: "ogis-geojson-polygon-outline",
  line: "ogis-geojson-line",
  point: "ogis-geojson-point",
  direction: "ogis-geojson-direction",
};
const DIRECTION_IMAGE_ID = "ogis-geojson-direction-arrow";

const LINE_TYPES = new Set(["LineString", "MultiLineString"]);
const POINT_TYPES = new Set(["Point", "MultiPoint"]);
const POLYGON_TYPES = new Set(["Polygon", "MultiPolygon"]);

function getGeometryCategory(geometry) {
  if (!geometry?.type) return null;
  if (LINE_TYPES.has(geometry.type)) return "line";
  if (POINT_TYPES.has(geometry.type)) return "point";
  if (POLYGON_TYPES.has(geometry.type)) return "polygon";
  return null;
}

function randomBrightColor() {
  return BRIGHT_COLORS[Math.floor(Math.random() * BRIGHT_COLORS.length)];
}

function createDirectionArrowImage() {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;

  const ctx = canvas.getContext?.("2d");
  if (!ctx || typeof ctx.getImageData !== "function") return null;

  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.fillStyle = "white";

  ctx.beginPath();
  ctx.moveTo(32, 19);
  ctx.lineTo(52, 37);
  ctx.lineTo(44, 45);
  ctx.lineTo(32, 34);
  ctx.lineTo(20, 45);
  ctx.lineTo(12, 37);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  return ctx.getImageData(0, 0, 64, 64);
}

// Module-level cache: instanceId -> manager
const cache = new Map();

function createManager(instanceId) {
  const features = new Map(); // id -> processed feature
  const originalFeatures = new Map(); // id -> original feature (for re-processing on setDefaults)
  const assignedColors = new Map(); // id -> auto-assigned colour
  let map = null;

  const defaults = {
    line: { color: null, width: 3, opacity: 0.85 },
    point: { color: null, radius: 6, opacity: 1 },
    polygon: { color: null, fillOpacity: 0.4, opacity: 0.85 },
  };

  const resolveColor = (id, props, category) => {
    if (props["ogis.color"]) return props["ogis.color"];
    if (defaults[category]?.color) return defaults[category].color;
    if (!assignedColors.has(id)) assignedColors.set(id, randomBrightColor());
    return assignedColors.get(id);
  };

  const processFeature = (feature) => {
    const category = getGeometryCategory(feature.geometry);
    if (!category) return null;

    const id = String(feature.id);
    const rawProps = feature.properties || {};
    const props = { ...rawProps };

    props["ogis.color"] = resolveColor(id, rawProps, category);

    if (category === "line") {
      if (props["ogis.width"] == null)
        props["ogis.width"] = defaults.line.width;
      if (props["ogis.opacity"] == null)
        props["ogis.opacity"] = defaults.line.opacity;
    } else if (category === "point") {
      if (props["ogis.radius"] == null)
        props["ogis.radius"] = defaults.point.radius;
      if (props["ogis.opacity"] == null)
        props["ogis.opacity"] = defaults.point.opacity;
    } else if (category === "polygon") {
      if (props["ogis.fillOpacity"] == null)
        props["ogis.fillOpacity"] = defaults.polygon.fillOpacity;
      if (props["ogis.opacity"] == null)
        props["ogis.opacity"] = defaults.polygon.opacity;
    }

    return { ...feature, properties: props };
  };

  const updateSource = () => {
    if (!map) return;
    const source = map.getSource(SOURCE_ID);
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: [...features.values()],
    });
  };

  const setupLayers = (mapInstance) => {
    map = mapInstance;
    mapInstance.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    // Polygon fill
    mapInstance.addLayer({
      id: LAYER_IDS.polygonFill,
      type: "fill",
      source: SOURCE_ID,
      filter: [
        "match",
        ["geometry-type"],
        ["Polygon", "MultiPolygon"],
        true,
        false,
      ],
      paint: {
        "fill-color": ["get", "ogis.color"],
        "fill-opacity": ["get", "ogis.fillOpacity"],
      },
    });

    // Polygon outline
    mapInstance.addLayer({
      id: LAYER_IDS.polygonOutline,
      type: "line",
      source: SOURCE_ID,
      filter: [
        "match",
        ["geometry-type"],
        ["Polygon", "MultiPolygon"],
        true,
        false,
      ],
      paint: {
        "line-color": ["get", "ogis.color"],
        "line-opacity": ["get", "ogis.opacity"],
        "line-width": 1.5,
      },
    });

    // Lines — round caps/joins for smooth mobile rendering
    mapInstance.addLayer({
      id: LAYER_IDS.line,
      type: "line",
      source: SOURCE_ID,
      filter: [
        "match",
        ["geometry-type"],
        ["LineString", "MultiLineString"],
        true,
        false,
      ],
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": ["get", "ogis.color"],
        "line-width": ["get", "ogis.width"],
        "line-opacity": ["get", "ogis.opacity"],
      },
    });

    // Points (circles)
    mapInstance.addLayer({
      id: LAYER_IDS.point,
      type: "circle",
      source: SOURCE_ID,
      filter: [
        "match",
        ["geometry-type"],
        ["Point", "MultiPoint"],
        true,
        false,
      ],
      paint: {
        "circle-color": ["get", "ogis.color"],
        "circle-radius": ["get", "ogis.radius"],
        "circle-opacity": ["get", "ogis.opacity"],
        "circle-stroke-color": "white",
        "circle-stroke-width": 1.5,
      },
    });

    // Direction chevrons for line features that opt in
    let directionImageReady = Boolean(
      mapInstance.hasImage?.(DIRECTION_IMAGE_ID),
    );
    if (!directionImageReady && typeof mapInstance.addImage === "function") {
      const image = createDirectionArrowImage();
      if (image) {
        mapInstance.addImage(DIRECTION_IMAGE_ID, image, { pixelRatio: 2 });
        directionImageReady = true;
      }
    }

    if (directionImageReady) {
      const directionLayer = {
        id: LAYER_IDS.direction,
        type: "symbol",
        source: SOURCE_ID,
        filter: [
          "all",
          [
            "match",
            ["geometry-type"],
            ["LineString", "MultiLineString"],
            true,
            false,
          ],
          ["==", ["get", "ogis.direction"], true],
        ],
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 110,
          "icon-image": DIRECTION_IMAGE_ID,
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            0.35,
            12,
            0.5,
            16,
            0.75,
            20,
            0.9,
          ],
          "icon-rotate": 90,
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-keep-upright": false,
          "icon-allow-overlap": false,
          "icon-ignore-placement": false,
        },
        paint: {
          "icon-opacity": 0.7,
        },
      };

      mapInstance.addLayer(directionLayer);
    }

    // Apply any features that were set before the map was ready
    updateSource();
  };

  const setup = (mapInstance) => {
    try {
      setupLayers(mapInstance);
      return true;
    } catch (error) {
      cleanup();
      reportError(error, { source: "geojson-setup", instanceId });
      return false;
    }
  };

  const cleanup = () => {
    const mapInstance = map;
    map = null;
    if (!mapInstance) return;

    for (const layerId of Object.values(LAYER_IDS).reverse()) {
      try {
        if (mapInstance.getLayer?.(layerId)) mapInstance.removeLayer(layerId);
      } catch (error) {
        reportError(error, {
          source: "geojson-cleanup",
          instanceId,
          layerId,
        });
      }
    }

    try {
      if (mapInstance.getSource?.(SOURCE_ID))
        mapInstance.removeSource(SOURCE_ID);
    } catch (error) {
      reportError(error, {
        source: "geojson-cleanup",
        instanceId,
        sourceId: SOURCE_ID,
      });
    }
  };

  // Hook into map lifecycle
  const existingMap = getMapInstance(instanceId);
  let readyListener = null;
  let destroyListener = null;

  if (existingMap) {
    setup(existingMap);
  } else {
    readyListener = ({ map: m }) => {
      readyListener = null;
      setup(m);
    };
    emitter.once("map:ready", readyListener);
  }

  let manager = null;

  /**
   * Terminal teardown for one instance.
   *
   * Removes both lifecycle listeners, tears down the map source and layers,
   * clears the in-memory feature sets and drops the cached manager only when
   * this manager is still the cached one. Idempotent.
   */
  const dispose = () => {
    if (readyListener) {
      emitter.off("map:ready", readyListener);
      readyListener = null;
    }
    if (destroyListener) {
      emitter.off("destroy", destroyListener);
      destroyListener = null;
    }

    cleanup();
    features.clear();
    originalFeatures.clear();
    assignedColors.clear();

    if (cache.get(instanceId) === manager) cache.delete(instanceId);
  };

  destroyListener = () => dispose();
  emitter.once("destroy", destroyListener);

  /**
   * Add or update a GeoJSON feature on the map.
   *
   * The feature must be a GeoJSON `Feature` object with an `id` property.
   * Style can be controlled via `ogis.*` properties on the feature:
   *
   * | Property | Applies to | Default |
   * |---|---|---|
   * | `ogis.color` | All types | auto (random bright) |
   * | `ogis.opacity` | All types | 0.85 (line/polygon), 1 (point) |
   * | `ogis.width` | Line | 3 |
   * | `ogis.radius` | Point | 6 |
   * | `ogis.fillOpacity` | Polygon | 0.4 |
   * | `ogis.direction` | Line | off (`true` shows direction chevrons) |
   *
   * @param {import('geojson').Feature} feature
   */
  const setFeature = (feature) => {
    if (!feature || feature.type !== "Feature") {
      console.warn(
        "[useGeoJSON] setFeature() requires a GeoJSON Feature object",
      );
      return;
    }
    if (feature.id == null) {
      console.warn("[useGeoJSON] Feature must have an id property");
      return;
    }
    if (!getGeometryCategory(feature.geometry)) {
      console.warn(
        "[useGeoJSON] Feature has unsupported or missing geometry type:",
        feature.geometry?.type,
      );
      return;
    }

    const id = String(feature.id);
    const processed = processFeature(feature);
    originalFeatures.set(id, feature);
    features.set(id, processed);
    updateSource();
  };

  /**
   * Remove a feature from the map by its id.
   * @param {string|number} id
   */
  const removeFeature = (id) => {
    const key = String(id);
    features.delete(key);
    originalFeatures.delete(key);
    assignedColors.delete(key);
    updateSource();
  };

  /**
   * Remove all features from the map.
   */
  const clearFeatures = () => {
    features.clear();
    originalFeatures.clear();
    assignedColors.clear();
    updateSource();
  };

  /**
   * Set default style values for one or more geometry types.
   * Affects all future `setFeature()` calls and re-renders existing features.
   *
   * @param {{ line?: object, point?: object, polygon?: object }} newDefaults
   * @example
   * geoJSON.setDefaults({
   *   line: { color: '#ff0000', width: 5 },
   *   point: { radius: 10 },
   * });
   */
  const setDefaults = (newDefaults) => {
    for (const [type, vals] of Object.entries(newDefaults)) {
      if (defaults[type]) {
        Object.assign(defaults[type], vals);
      }
    }
    // Re-process all existing features with the updated defaults
    for (const [id, original] of originalFeatures) {
      const processed = processFeature(original);
      if (processed) features.set(id, processed);
    }
    updateSource();
  };

  manager = {
    setFeature,
    removeFeature,
    clearFeatures,
    setDefaults,
    dispose,
  };

  return manager;
}

/**
 * Composable for rendering GeoJSON features on the map.
 *
 * Maintains a single GeoJSON source with data-driven style layers for
 * points, lines, and polygons. Handles map lifecycle automatically —
 * features set before the map is ready are applied on `map:ready`.
 *
 * Call without arguments inside a Vue component's setup context.
 * Pass `instanceId` explicitly when calling from outside Vue (e.g. a plugin).
 *
 * @param {string|null} [instanceId]
 * @returns {{ setFeature, removeFeature, clearFeatures, setDefaults, dispose }}
 *   `dispose()` is terminal teardown for one instance: it removes the
 *   lifecycle listeners, cleans up the map source and layers, clears the
 *   in-memory feature sets and drops the cached manager. It is shared by
 *   routes, recordings and offline, so a single feature must not call it.
 *
 * @example
 * // In a Vue component
 * import { useGeoJSON } from '@/composables/useGeoJSON.js';
 * const geoJSON = useGeoJSON();
 * geoJSON.setFeature({ type: 'Feature', id: 'my-line', geometry: { ... } });
 *
 * @example
 * // In a feature install()
 * import { useGeoJSON } from '@/composables/useGeoJSON.js';
 * install({ instanceId }) {
 *   const geoJSON = useGeoJSON(instanceId);
 * }
 */
export const useGeoJSON = (instanceId = null) => {
  const id = instanceId ?? inject("ogisAppId", "app");
  if (!cache.has(id)) {
    // Publish only a fully created manager, so a creation failure cannot leave
    // a partial cache entry behind.
    const manager = createManager(id);
    cache.set(id, manager);
    return manager;
  }
  return cache.get(id);
};
