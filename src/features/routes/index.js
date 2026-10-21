// routes/index.js — GPX & GeoJSON routes feature for ogis.app
import { computed, reactive, ref, watch, watchEffect } from "vue";
import { useActions } from "@/composables/useActions";
import { useGeoJSON } from "@/composables/useGeoJSON.js";
import { useLocate } from "@/composables/useLocate.js";
import { useUI } from "@/composables/useUI.js";
import { formatCompactDistance, formatDistance } from "@/utils/geo.js";
import { shareFile } from "@/utils/share.js";
import { assignTrackColors } from "@/utils/track/colors.js";
import {
  documentBounds,
  lineGeometry,
  migrateRoute,
  nearestPointOnTrack,
  normalisePoint,
  ON_ROUTE_METRES,
  parseTrackFile,
  toGPX,
  toGeoJSON,
  trackFilename,
  trackMime,
} from "@/utils/track/index.js";
import RoutesPanel from "./RoutesPanel.vue";

const lineFeatureId = (id) => `routes-route-${id}`;
const waypointFeatureId = (id, index) => `routes-waypoint-${id}-${index}`;

export const RoutesFeature = {
  install({
    useStorage,
    useSettings,
    getMap,
    onMapReady,
    instanceId,
    provide,
    addPanel,
    useLocale,
  }) {
    const routes = useStorage("routes", []);
    const migrating = routes.map((route) => migrateRoute(route));
    routes.splice(0, routes.length, ...migrating);
    assignTrackColors(routes);

    const navigating = ref(null);
    const error = ref(null);
    const visible = reactive(new Set());
    const { isMetric } = useSettings();
    const geoJSON = useGeoJSON(instanceId);
    const locate = useLocate(instanceId);
    const actions = useActions(instanceId);
    const { closePanel, setMenuNavigation } = useUI(instanceId);
    const { t, locale } = useLocale();

    // Map rotation, used to orient the navigation arrow relative to the
    // current camera. Updated only on meaningful bearing changes.
    const mapBearing = ref(0);
    const MAP_BEARING_EPSILON_DEG = 0.5;

    let boundMap = null;
    let followOwned = false;

    const angularDifference = (a, b) => {
      const difference = Math.abs(a - b) % 360;
      return difference > 180 ? 360 - difference : difference;
    };

    const normaliseDegrees = (degrees) => ((degrees % 360) + 360) % 360;

    const syncMapBearing = () => {
      if (!boundMap) return;
      const bearing = boundMap.getBearing();
      if (
        angularDifference(bearing, mapBearing.value) >= MAP_BEARING_EPSILON_DEG
      ) {
        mapBearing.value = bearing;
      }
    };

    const unbindMapBearing = () => {
      if (!boundMap) return;
      boundMap.off("move", syncMapBearing);
      boundMap.off("rotate", syncMapBearing);
      boundMap = null;
    };

    const bindMapBearing = (map) => {
      if (!map || map === boundMap) return;
      unbindMapBearing();
      boundMap = map;
      mapBearing.value =
        typeof map.getBearing === "function" ? map.getBearing() : 0;
      map.on("move", syncMapBearing);
      map.on("rotate", syncMapBearing);
    };

    const existingMap = getMap();
    if (existingMap) bindMapBearing(existingMap);
    else if (typeof onMapReady === "function") {
      onMapReady(({ map }) => bindMapBearing(map));
    }

    const renderRoute = (route) => {
      const geometry = lineGeometry(route);
      if (geometry) {
        geoJSON.setFeature({
          type: "Feature",
          id: lineFeatureId(route.id),
          geometry,
          properties: {
            "ogis.color": route.color,
            "ogis.width": 4,
            "ogis.opacity": 0.85,
            "ogis.direction": true,
          },
        });
      }

      (route.waypoints ?? []).forEach((waypoint, index) => {
        const point = normalisePoint(waypoint);
        if (!point) return;
        const coordinates = [point.lng, point.lat];
        if (point.ele !== undefined) coordinates.push(point.ele);
        geoJSON.setFeature({
          type: "Feature",
          id: waypointFeatureId(route.id, index),
          geometry: { type: "Point", coordinates },
          properties: {
            "ogis.color": route.color,
            "ogis.radius": 5,
          },
        });
      });

      return geometry;
    };

    const removeRouteFeatures = (route) => {
      geoJSON.removeFeature(lineFeatureId(route.id));
      (route.waypoints ?? []).forEach((waypoint, index) => {
        geoJSON.removeFeature(waypointFeatureId(route.id, index));
      });
    };

    const isVisible = (id) => visible.has(id);

    const showOnMap = (id) => {
      const route = routes.find((item) => item.id === id);
      if (!route) return;
      actions.claimMap();

      renderRoute(route);
      visible.add(id);

      const bounds = documentBounds(route);
      const map = getMap();
      if (map && bounds && locate.mode.value !== "following") {
        map.fitBounds(bounds, { padding: 40 });
      }
    };

    const stopNavigation = ({ stopFollow = true, handoff = false } = {}) => {
      navigating.value = null;
      setMenuNavigation(null);
      if (
        !handoff &&
        stopFollow &&
        followOwned &&
        locate.mode.value === "following"
      ) {
        locate.stop();
      }
      followOwned = false;
    };

    const hideOnMap = (id) => {
      const route = routes.find((item) => item.id === id);
      if (!route) return;

      removeRouteFeatures(route);
      visible.delete(id);
      if (navigating.value === id) stopNavigation();
    };

    const toggleVisibility = (id) => {
      if (visible.has(id)) hideOnMap(id);
      else showOnMap(id);
    };

    const deleteRoute = (id) => {
      const index = routes.findIndex((route) => route.id === id);
      if (index === -1) return;

      const [route] = routes.splice(index, 1);
      removeRouteFeatures(route);
      visible.delete(id);
      if (navigating.value === id) stopNavigation();
    };

    const importTracks = async (files) => {
      const imported = [];
      let failure = null;

      for (const file of files) {
        try {
          imported.push(...(await parseTrackFile(file)));
        } catch (err) {
          failure = err;
        }
      }

      if (imported.length) {
        assignTrackColors([...routes, ...imported]);
        routes.push(...imported);
      }

      error.value = failure;
      return imported.length;
    };

    const startNavigation = (id) => {
      const route = routes.find((item) => item.id === id);
      if (!route) return;
      if (!isVisible(id) || !lineGeometry(route)) return;
      if (navigating.value && navigating.value !== id) return;

      const alreadyFollowing = locate.mode.value === "following";
      actions.claimMap({ except: "navigate" });
      locate.startFollowing({
        onStarted: () => {
          followOwned = !alreadyFollowing;
          navigating.value = id;
          closePanel();
        },
      });
    };

    const locatingState = () => ({
      state: "locating",
      label: "…",
      title: t("panel.routes.navigationLocating"),
      bearingDeg: 0,
    });

    const navigationState = computed(() => {
      if (!navigating.value) return null;

      const route = routes.find((item) => item.id === navigating.value);
      if (!route) return null;

      const position = locate.position.value;
      if (!position) return locatingState();

      const nearest = nearestPointOnTrack(route, position);
      if (!nearest) return locatingState();

      if (nearest.distance <= ON_ROUTE_METRES) {
        const label = t("panel.routes.navigationOnRoute");
        return {
          state: "on-route",
          label,
          title: label,
          bearingDeg: 0,
        };
      }

      return {
        state: "off-route",
        label: formatCompactDistance(
          nearest.distance,
          isMetric.value,
          locale.value,
        ),
        title: t("panel.routes.navigationOffRoute", {
          distance: formatDistance(
            nearest.distance,
            isMetric.value,
            locale.value,
          ),
        }),
        bearingDeg: Number.isFinite(nearest.bearing)
          ? normaliseDegrees(nearest.bearing - mapBearing.value)
          : 0,
        point: nearest.point,
        position: { lat: position.lat, lng: position.lng },
        distance: nearest.distance,
      };
    });

    const stopNavigationIndicator = watchEffect(() => {
      setMenuNavigation(navigationState.value);
    });

    watch(locate.mode, (mode) => {
      if (navigating.value && mode !== "following") {
        stopNavigation({ stopFollow: false });
      }
    });

    const shareTrack = async (route, format) => {
      const name = route.name || t("panel.routes.defaultName");
      const content =
        format === "gpx"
          ? toGPX(route, { name })
          : JSON.stringify(toGeoJSON(route, { name }), null, 2);
      const blob = new Blob([content], { type: trackMime(format) });
      const filename = trackFilename(route, format, { name });

      await shareFile(blob, filename, { title: name });
    };

    const unregisterNavigate = actions.registerMode("navigate", {
      active: computed(() => navigating.value !== null),
      stop: stopNavigation,
    });

    provide("routes", {
      routes,
      navigating,
      error,
      isMetric,
      importTracks,
      deleteRoute,
      showOnMap,
      hideOnMap,
      toggleVisibility,
      isVisible,
      startNavigation,
      stopNavigation,
      shareTrack,
      formatDistance,
    });

    addPanel({
      id: "routes",
      icon: "graph-down",
      title: () => t("menu.routes"),
      component: RoutesPanel,
    });

    return () => {
      stopNavigationIndicator();
      unregisterNavigate();
      stopNavigation();
      unbindMapBearing();
      setMenuNavigation(null);
    };
  },
};
