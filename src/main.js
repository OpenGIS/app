import { createApp, shallowRef } from "vue";
import App from "./App.vue";
import "./assets/sass/theme.scss";

import { emitter } from "./emitter.js";
import { initLocaleCache } from "./composables/useLocale.js";
import { getMapInstance } from "./composables/useMap.js";
import { useStorage as _useStorage } from "./composables/useStorage.js";
import { useSettings as _useSettings } from "./composables/useSettings.js";
import { useLocale as _useLocale } from "./composables/useLocale.js";
import { setupServiceWorker } from "./utils/serviceWorker.js";

import { RecordingsFeature } from "./features/recordings/index.js";
import { OfflineFeature } from "./features/offline/index.js";
import { RoutesFeature } from "./features/routes/index.js";
// Auth features — commented out: the app is currently in SPA front-end only mode
// (no backend). Re-enable when the API/auth backend is available.
// import { AccountFeature } from "./features/account/index.js";
// import { MapsFeature } from "./features/maps/index.js";
// import { CollectionsFeature } from "./features/collections/index.js";

// --- Instance config ---
// The instance ID scopes localStorage keys, enabling iframe isolation.
// Override via ?id= URL param (e.g. an embedded iframe with id="trip-planner").
const params = new URLSearchParams(window.location.search);
const instanceId =
  (params.get("id") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "app";
const locale = params.get("locale") || null;

// --- App setup ---
initLocaleCache(instanceId, locale, {});

const app = createApp(App);

app.provide("ogisAppId", instanceId);
app.provide("navigatorLocale", locale);
app.provide("navigatorMessages", {});

// Reactive button and panel registries — features register into these.
const buttonsRef = shallowRef([]);
const panelsRef = shallowRef([]);
app.provide("navigatorButtons", buttonsRef);
app.provide("navigatorPanels", panelsRef);

// Reactive map ref — null until MapLibre emits map:ready.
const mapRef = shallowRef(null);
emitter.once("map:ready", ({ map }) => {
  mapRef.value = map;
});

// Auto-cleanup tracking for feature-added map sources/layers.
const trackedSources = [];
const trackedLayers = [];

emitter.on("destroy", () => {
  mapRef.value = null;
  const map = getMapInstance(instanceId);
  if (map) {
    for (const layerId of [...trackedLayers].reverse()) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    }
    for (const sourceId of [...trackedSources].reverse()) {
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  }
});

// --- Internal feature context ---
// Passed to each feature's install() method. Provides scoped access to
// app services without exposing the raw Vue app or emitter.
const featureCtx = {
  app,
  instanceId,
  map: mapRef,
  emitter,
  useStorage: (namespace, defaultState) =>
    _useStorage(namespace, defaultState, instanceId),
  useSettings: () => _useSettings(),
  useLocale: () => _useLocale(instanceId),
  getMap: () => getMapInstance(instanceId),
  onMapReady: (callback) => {
    emitter.once("map:ready", ({ map }) => {
      callback({
        map,
        addSource: (sourceId, options) => {
          map.addSource(sourceId, options);
          trackedSources.push(sourceId);
        },
        addLayer: (layerConfig, before) => {
          map.addLayer(layerConfig, before);
          trackedLayers.push(layerConfig.id);
        },
      });
    });
  },
  on: (e, f) => emitter.on(e, f),
  once: (e, f) => emitter.once(e, f),
  off: (e, f) => emitter.off(e, f),
  emit: (e, ...a) => emitter.emit(e, ...a),
  provide: (key, value) => app.provide(key, value),
  addButton: (config) => {
    buttonsRef.value = [...buttonsRef.value, config];
  },
  addPanel: (config) => {
    panelsRef.value = [...panelsRef.value, config];
  },
};

// --- Install core features ---
RecordingsFeature.install(featureCtx);
OfflineFeature.install(featureCtx);
RoutesFeature.install(featureCtx);
// Auth features — commented out (SPA front-end only mode).
// AccountFeature.install(featureCtx);
// MapsFeature.install(featureCtx);
// CollectionsFeature.install(featureCtx);

// --- Mount ---
app.mount("#app");

// --- Service worker ---
// Registers the app-shell worker in production (or when opted in with
// VITE_SW=1). In dev any legacy registration is unregistered and all origin
// caches are purged so poisoned profiles self-heal. See src/utils/serviceWorker.js.
setupServiceWorker();
