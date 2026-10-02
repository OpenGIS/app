import { inject } from "vue";
import { getMapInstance } from "@/composables/useMap.js";
import { emitter } from "@/emitter.js";

// Bright, visually distinct colours for auto-assignment
const BRIGHT_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#e67e22",
  "#9b59b6",
  "#1abc9c",
  "#e91e63",
  "#f1c40f",
  "#00bcd4",
  "#ff5722",
];

const SOURCE_ID = "ogis-geojson";
const LAYER_IDS = {
  polygonFill: "ogis-geojson-polygon-fill",
  polygonOutline: "ogis-geojson-polygon-outline",
  line: "ogis-geojson-line",
  point: "ogis-geojson-point",
};

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

  const setup = (mapInstance) => {
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

    // Apply any features that were set before the map was ready
    updateSource();
  };

  const cleanup = () => {
    if (!map) return;
    for (const layerId of Object.values(LAYER_IDS).reverse()) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    map = null;
  };

  // Hook into map lifecycle
  const existingMap = getMapInstance(instanceId);

  if (existingMap) {
    setup(existingMap);
  } else {
    emitter.once("map:ready", ({ map: m }) => setup(m));
  }

  emitter.once("destroy", () => {
    cleanup();
    cache.delete(instanceId);
  });

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

  return { setFeature, removeFeature, clearFeatures, setDefaults };
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
 * @returns {{ setFeature, removeFeature, clearFeatures, setDefaults }}
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
    cache.set(id, createManager(id));
  }
  return cache.get(id);
};
