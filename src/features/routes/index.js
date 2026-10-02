// routes/index.js — GPX routes feature for ogis.app
import { ref } from "vue";
import { useGeoJSON } from "@/composables/useGeoJSON.js";
import { totalDistance, formatDistance } from "@/utils/geo.js";
import { parseGPX } from "./gpx.js";
import RoutesPanel from "./RoutesPanel.vue";

export const RoutesFeature = {
  install({ useStorage, useSettings, getMap, instanceId, provide, addPanel }) {
    const routes = useStorage("routes", []);
    const navigating = ref(null);
    const error = ref(null);
    const { isMetric } = useSettings();
    const geoJSON = useGeoJSON(instanceId);

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
          file.name.replace(/\.gpx$/i, "") || "Route",
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
        error.value = err.message;
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

    const showOnMap = (id) => {
      const route = routes.find((r) => r.id === id);
      if (!route) return;
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

    const startNavigation = (id) => {
      if (watchId !== null) return;
      navigating.value = id;
      showOnMap(id);
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
      title: "Routes",
      component: RoutesPanel,
    });

    return () => {
      stopNavigation();
    };
  },
};
