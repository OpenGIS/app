// routes/index.js — GPX routes feature for ogis.app
import { computed, ref } from "vue";
import { useActions } from "@/composables/useActions";
import { useGeoJSON } from "@/composables/useGeoJSON.js";
import { totalDistance, formatDistance } from "@/utils/geo.js";
import { parseGPX } from "./gpx.js";
import RoutesPanel from "./RoutesPanel.vue";

export const RoutesFeature = {
  install({
    useStorage,
    useSettings,
    getMap,
    instanceId,
    provide,
    addPanel,
    useLocale,
  }) {
    const routes = useStorage("routes", []);
    const navigating = ref(null);
    const error = ref(null);
    const { isMetric } = useSettings();
    const geoJSON = useGeoJSON(instanceId);
    const actions = useActions(instanceId);
    const { t } = useLocale();

    let watchId = null;

    const renderRoute = (route) => {
      const coordinates = route.points.map((p) => [p.lng, p.lat]);
      if (coordinates.length < 2) return;
      geoJSON.setFeature({
        type: "Feature",
        id: `routes-route-${route.id}`,
        geometry: { type: "LineString", coordinates },
        properties: { "ogis.width": 4, "ogis.opacity": 0.85 },
      });
    };

    const renderAll = () => {
      for (const route of routes) renderRoute(route);
    };

    const importGPX = async (file) => {
      try {
        const text = await file.text();
        const parsed = parseGPX(
          text,
          file.name.replace(/\.gpx$/i, "") || t("panel.routes.defaultName"),
        );
        for (const { name, points, type } of parsed) {
          const route = {
            id:
              Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            name,
            type,
            points,
            distance: totalDistance(points),
          };
          routes.push(route);
          renderRoute(route);
        }
        error.value = null;
        return parsed.length;
      } catch (err) {
        // Keep the error object (with its stable `code`) so the panel can map
        // it to a translated message; unknown errors fall back to a generic
        // translated import error.
        error.value = err;
        return 0;
      }
    };

    const stopNavigation = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      navigating.value = null;
      geoJSON.removeFeature("routes-position");
    };

    const deleteRoute = (id) => {
      const index = routes.findIndex((r) => r.id === id);
      if (index !== -1) routes.splice(index, 1);
      geoJSON.removeFeature(`routes-route-${id}`);
      if (navigating.value === id) stopNavigation();
    };

    const fitRoute = (route) => {
      const coords = route.points.map((p) => [p.lng, p.lat]);
      const map = getMap();
      if (map && coords.length > 1) {
        const lngs = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 40 },
        );
      }
    };

    const showOnMap = (id) => {
      const route = routes.find((r) => r.id === id);
      if (!route) return;
      actions.claimMap();
      fitRoute(route);
    };

    const startNavigation = (id) => {
      if (watchId !== null) return;
      const route = routes.find((r) => r.id === id);
      if (!route) return;
      actions.claimMap({ except: "navigate" });
      navigating.value = id;
      fitRoute(route);
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          geoJSON.setFeature({
            type: "Feature",
            id: "routes-position",
            geometry: {
              type: "Point",
              coordinates: [pos.coords.longitude, pos.coords.latitude],
            },
            properties: { "ogis.color": "#0d6efd", "ogis.radius": 8 },
          });
        },
        null,
        { enableHighAccuracy: true, maximumAge: 2000 },
      );
    };

    const unregisterNavigate = actions.registerMode("navigate", {
      active: computed(() => navigating.value !== null),
      stop: () => stopNavigation(),
    });

    // Crash recovery: render persisted routes after a reload.
    renderAll();

    provide("routes", {
      routes,
      navigating,
      error,
      isMetric,
      importGPX,
      deleteRoute,
      showOnMap,
      startNavigation,
      stopNavigation,
      formatDistance,
    });

    addPanel({
      id: "routes",
      icon: "graph-down",
      title: () => t("menu.routes"),
      component: RoutesPanel,
    });

    return () => {
      unregisterNavigate();
      stopNavigation();
    };
  },
};
