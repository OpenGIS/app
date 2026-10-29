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
  nearestPointOnTrack,
  normalisePoint,
  ON_ROUTE_METRES,
  parseTrackFile,
  toGPX,
  toGeoJSON,
  trackFilename,
  trackMime,
} from "@/utils/track/index.js";
import { migrateLocalToSession } from "@/resilience/persistedState";
import { hydrateNavigation } from "@/resilience/hydrators/navigation.js";
import { hydrateRoutes } from "@/resilience/hydrators/routes.js";
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
    onCleanup,
    useLocale,
  }) {
    const routes = useStorage("routes", {
      version: 1,
      defaults: [],
      hydrate: hydrateRoutes,
      crossTab: true,
      onSync: () => reconcileRoutes(),
    }).state;
    assignTrackColors(routes);

    migrateLocalToSession("navigation", instanceId);

    const navigationStore = useStorage("navigation", {
      version: 1,
      storage: "session",
      defaults: { routeId: null, visible: [], followOwned: false },
      hydrate: hydrateNavigation,
    });
    const navigation = navigationStore.state;
    const flushNavigation = navigationStore.flush;

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

    // Feature ids rendered for each visible route, so a re-render or removal
    // can clean up exactly the waypoints that were drawn.
    const renderedWaypoints = new Map();

    const removeRouteFeatures = (routeOrId) => {
      const id =
        typeof routeOrId === "object" && routeOrId !== null
          ? routeOrId.id
          : routeOrId;
      if (id === null || id === undefined) return;

      geoJSON.removeFeature(lineFeatureId(id));
      for (const featureId of renderedWaypoints.get(id) ?? []) {
        geoJSON.removeFeature(featureId);
      }
      renderedWaypoints.delete(id);
    };

    const renderRoute = (route) => {
      removeRouteFeatures(route);

      const waypointIds = [];
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
        const featureId = waypointFeatureId(route.id, index);
        waypointIds.push(featureId);
        geoJSON.setFeature({
          type: "Feature",
          id: featureId,
          geometry: { type: "Point", coordinates },
          properties: {
            "ogis.color": route.color,
            "ogis.radius": 5,
          },
        });
      });

      renderedWaypoints.set(route.id, waypointIds);
      return geometry;
    };

    const isVisible = (id) => visible.has(id);

    /** Mirror the current visible set into the navigation store. */
    const persistVisibility = () => {
      navigation.visible = [...visible];
      flushNavigation();
    };

    /** Mirror the current navigation owner into the navigation store. */
    const persistNavigation = () => {
      navigation.routeId = navigating.value ?? null;
      navigation.followOwned = navigating.value ? followOwned : false;
      flushNavigation();
    };

    /** Clear persisted navigation without touching route visibility. */
    const clearPersistedNavigation = () => {
      navigation.routeId = null;
      navigation.followOwned = false;
      flushNavigation();
    };

    const showOnMap = (
      id,
      { fit = true, claim = true, persist = true } = {},
    ) => {
      if (visible.has(id)) return;
      const route = routes.find((item) => item.id === id);
      if (!route) return;
      if (claim) actions.claimMap();

      renderRoute(route);
      visible.add(id);

      const bounds = documentBounds(route);
      const map = getMap();
      if (fit && map && bounds && locate.mode.value !== "following") {
        map.fitBounds(bounds, { padding: 40 });
      }

      if (persist) persistVisibility();
    };

    // Restore visibility without moving the camera, claiming the map or
    // rewriting storage unless stale ids had to be dropped.
    const storedVisible = Array.isArray(navigation.visible)
      ? navigation.visible
      : [];
    const routeIds = new Set(routes.map((route) => route.id));
    const restoredVisible = storedVisible.filter((id) => routeIds.has(id));

    for (const id of restoredVisible) {
      showOnMap(id, { fit: false, claim: false, persist: false });
    }
    if (restoredVisible.length !== storedVisible.length) persistVisibility();

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
      persistNavigation();
    };

    const hideOnMap = (id) => {
      const route = routes.find((item) => item.id === id);
      if (!route) return;

      removeRouteFeatures(route);
      visible.delete(id);
      if (navigating.value === id) stopNavigation();
      persistVisibility();
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
      persistVisibility();
    };

    /**
     * Reconcile map and navigation state after another tab replaced the route
     * store. Visibility is last-writer-wins: a route that disappeared is
     * hidden, and a visible route whose document changed is re-rendered.
     */
    const reconcileRoutes = () => {
      if (!Array.isArray(routes)) return;

      assignTrackColors(routes);
      const ids = new Set(routes.map((route) => route.id));
      let visibilityChanged = false;

      for (const id of [...visible]) {
        const route = ids.has(id)
          ? routes.find((item) => item.id === id)
          : null;
        if (!route) {
          removeRouteFeatures(id);
          visible.delete(id);
          visibilityChanged = true;
          continue;
        }

        if (!renderRoute(route)) {
          removeRouteFeatures(route);
          visible.delete(id);
          visibilityChanged = true;
          if (navigating.value === id) stopNavigation();
        }
      }

      if (visibilityChanged) persistVisibility();
      if (navigating.value && !ids.has(navigating.value)) stopNavigation();
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

    const startNavigation = (
      id,
      { restore = false, followOwned: restoredFollowOwned = false } = {},
    ) => {
      const route = routes.find((item) => item.id === id);
      if (!route) return false;
      if (!isVisible(id) || !lineGeometry(route)) return false;
      if (navigating.value && navigating.value !== id) return false;

      if (restore) {
        if (locate.mode.value !== "following") return false;

        followOwned = Boolean(restoredFollowOwned);
        navigating.value = id;
        persistNavigation();
        setMenuNavigation(navigationState.value);
        return true;
      }

      const alreadyFollowing = locate.mode.value === "following";
      actions.claimMap({ except: "navigate" });
      locate.startFollowing({
        onStarted: () => {
          followOwned = !alreadyFollowing;
          navigating.value = id;
          persistNavigation();
          closePanel();
        },
      });
      return true;
    };

    /**
     * Resume persisted navigation once locate has settled.
     *
     * Runs after mount and never opens the app's permission explainer.
     * Visibility is restored first and is left untouched by any navigation
     * failure, so a denied geolocation restore only clears navigation. Every
     * failure is silent.
     */
    const restoreNavigation = async () => {
      const storedRouteId = navigation.routeId;
      if (!storedRouteId) return;

      try {
        const route = routes.find((item) => item.id === storedRouteId);
        if (!route || !lineGeometry(route)) {
          clearPersistedNavigation();
          return;
        }

        showOnMap(storedRouteId, { fit: false, claim: false, persist: false });
        persistVisibility();

        await locate.restoreComplete;

        // The user acted while the restore was pending; leave their state be.
        if (navigating.value || navigation.routeId !== storedRouteId) return;

        if (locate.mode.value !== "following") {
          clearPersistedNavigation();
          return;
        }

        const restored = startNavigation(storedRouteId, {
          restore: true,
          followOwned: navigation.followOwned,
        });
        if (!restored) clearPersistedNavigation();
      } catch {
        if (navigation.routeId === storedRouteId) clearPersistedNavigation();
      }
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

    const stopLocateModeWatch = watch(locate.mode, (mode) => {
      if (navigating.value && mode !== "following") {
        stopNavigation({ stopFollow: false });
      }
    });

    onCleanup(stopNavigationIndicator);
    onCleanup(stopLocateModeWatch);
    onCleanup(unbindMapBearing);

    // Non-blocking: the app mounts immediately and navigation resumes only if
    // the locate restore re-entered following.
    restoreNavigation();

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
