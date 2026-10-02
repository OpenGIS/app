// offline/index.js — Offline download feature for On Route App.
// Provides a side panel for downloading a map region (tiles + glyphs) so it
// works offline via the service worker map cache.
import OfflinePanel from "./OfflinePanel.vue";
import { useGeoJSON } from "@/composables/useGeoJSON.js";
import {
  estimateRegion,
  downloadRegion,
  regionUrlsForRegion,
} from "./download.js";

export const OfflineFeature = {
  install({ useStorage, getMap, provide, addPanel, onMapReady, instanceId }) {
    // Downloaded region metadata, persisted to localStorage.
    const regions = useStorage("offline-regions", []);

    // GeoJSON renderer, used to draw a downloaded region's bounds on the map.
    const geoJSON = useGeoJSON(instanceId);

    // Current style sources, refreshed once the map is ready.
    let styleSources = [];

    onMapReady(({ map }) => {
      styleSources = map.getStyle()?.sources
        ? Object.values(map.getStyle().sources)
        : [];
    });

    const estimate = async (bounds, minZoom, maxZoom) => {
      const map = getMap();
      const sourceList =
        map && map.getStyle()?.sources
          ? Object.values(map.getStyle().sources)
          : styleSources;
      return estimateRegion(sourceList, bounds, minZoom, maxZoom);
    };

    const download = async (opts) => {
      return downloadRegion({ ...opts, getMap });
    };

    const addRegion = (meta) => {
      regions.push({
        id: Date.now().toString(),
        createdAt: Date.now(),
        ...meta,
      });
    };

    // Post the given URLs to the service worker so it can purge them from the
    // map cache. Waits (bounded) for the worker to confirm it has deleted them.
    const requestDeleteUrls = (urls) =>
      new Promise((resolve) => {
        const controller = navigator.serviceWorker?.controller;
        if (!controller) {
          resolve(0);
          return;
        }
        const channel = new MessageChannel();
        const timeout = setTimeout(() => resolve(0), 3000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          resolve(event.data?.deleted ?? 0);
        };
        try {
          controller.postMessage({ type: "DELETE_URLS", urls }, [
            channel.port2,
          ]);
        } catch (err) {
          clearTimeout(timeout);
          resolve(0);
        }
      });

    const deleteRegion = async (region) => {
      // Remove the region metadata first so the list updates immediately even
      // if the service worker purge fails or is unavailable.
      const index = regions.findIndex((r) => r.id === region.id);
      if (index !== -1) regions.splice(index, 1);

      // Best-effort: re-enumerate the region's URLs so we can purge its tiles.
      // If the style/source can't be resolved (e.g. the TileJSON slug changed)
      // or there's no SW, just remove the metadata.
      let urls = [];
      try {
        const built = await regionUrlsForRegion({
          bounds: region.bounds,
          minZoom: region.minZoom,
          maxZoom: region.maxZoom,
          getMap,
        });
        urls = built.allUrls;
      } catch (err) {
        urls = [];
      }

      if (urls.length > 0) await requestDeleteUrls(urls);
    };

    // Draw the region's bounds on the map as a green polygon and navigate to
    // it, so the user can see what data they have downloaded.
    const showRegion = (region) => {
      if (!region.bounds) return;
      const { west, south, east, north } = region.bounds;
      const ring = [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ];
      geoJSON.setFeature({
        type: "Feature",
        id: "offline-region",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          "onrte.color": "#39d353",
          "onrte.fillOpacity": 0.25,
          "onrte.opacity": 0.9,
        },
      });
      const map = getMap();
      if (map) {
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 40 },
        );
      }
    };

    const getStorageInfo = async () => {
      let usage = 0;
      let quota = 0;
      let persisted = false;
      try {
        if (navigator.storage?.estimate) {
          const estimate = await navigator.storage.estimate();
          usage = estimate.usage ?? 0;
          quota = estimate.quota ?? 0;
        }
        if (navigator.storage?.persisted) {
          persisted = await navigator.storage.persisted();
        }
      } catch (err) {
        // Ignore — return zeros/false when the Storage API is unavailable.
      }
      return { usage, quota, persisted };
    };

    // Ask the browser to make this origin's storage persistent, so the
    // downloaded tiles are less likely to be evicted under disk pressure.
    // Resolves quickly; returns the resulting persistence state.
    const requestPersistence = async () => {
      try {
        if (navigator.storage?.persist) {
          return await navigator.storage.persist();
        }
        if (navigator.storage?.persisted) {
          return await navigator.storage.persisted();
        }
      } catch (err) {
        // Ignore — persistence unavailable in this browser.
      }
      return false;
    };

    provide("offline", {
      regions,
      estimate,
      download,
      addRegion,
      deleteRegion,
      showRegion,
      getStorageInfo,
      requestPersistence,
      getMap,
    });

    addPanel({
      id: "offline",
      icon: "file-arrow-down",
      title: "Offline Maps",
      component: OfflinePanel,
    });
  },
};
