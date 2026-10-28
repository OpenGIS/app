import { createApp, shallowRef } from "vue";
import App from "./App.vue";
import "./assets/sass/theme.scss";

import { emitter } from "./emitter.js";
import { initLocaleCache } from "./composables/useLocale.js";
import { getMapInstance } from "./composables/useMap.js";
import { usePersistedState as _usePersistedState } from "./resilience/persistedState.js";
import { useSettings as _useSettings } from "./composables/useSettings.js";
import { useLocale as _useLocale } from "./composables/useLocale.js";
import { setupServiceWorker } from "./utils/serviceWorker.js";
import {
  installGlobalErrorHandlers,
  installVueErrorHandler,
  reportError,
} from "./resilience/errors.js";
import { installFeature } from "./resilience/boot.js";

import { RecordingsFeature } from "./features/recordings/index.js";
import { OfflineFeature } from "./features/offline/index.js";
import { RoutesFeature } from "./features/routes/index.js";
// Auth features — commented out: the app is currently in SPA front-end only mode
// (no backend). Re-enable when the API/auth backend is available.
// import { AccountFeature } from "./features/account/index.js";
// import { MapsFeature } from "./features/maps/index.js";
// import { CollectionsFeature } from "./features/collections/index.js";

const boot = () => {
  // Global handlers go in first, so a failure anywhere in boot is contained.
  installGlobalErrorHandlers();

  // --- Instance config ---
  // The instance ID scopes localStorage keys, enabling iframe isolation.
  // Override via ?id= URL param (e.g. an embedded iframe with id="trip-planner").
  const params = new URLSearchParams(window.location.search);
  const instanceId =
    (params.get("id") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) ||
    "app";
  const locale = params.get("locale") || null;

  // --- App setup ---
  initLocaleCache(instanceId, locale, {});

  const app = createApp(App);
  installVueErrorHandler(app);

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

  const removeConfig = (ref, config) => () => {
    ref.value = ref.value.filter((item) => item !== config);
  };

  // --- Internal feature context ---
  // Passed to each feature's install() method. Provides scoped access to
  // app services without exposing the raw Vue app or emitter. Registration
  // methods return a disposer so installFeature can roll a failure back.
  const featureCtx = {
    app,
    instanceId,
    map: mapRef,
    emitter,
    useStorage: (namespace, definition) =>
      _usePersistedState(namespace, definition, instanceId),
    useSettings: () => _useSettings(),
    useLocale: () => _useLocale(instanceId),
    getMap: () => getMapInstance(instanceId),
    onMapReady: (callback) => {
      const listener = ({ map }) => {
        try {
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
        } catch (error) {
          reportError(error, { source: "map-ready" });
        }
      };
      emitter.once("map:ready", listener);
      return () => emitter.off("map:ready", listener);
    },
    on: (e, f) => {
      emitter.on(e, f);
      return () => emitter.off(e, f);
    },
    once: (e, f) => {
      emitter.once(e, f);
      return () => emitter.off(e, f);
    },
    off: (e, f) => emitter.off(e, f),
    emit: (e, ...a) => emitter.emit(e, ...a),
    provide: (key, value) => app.provide(key, value),
    addButton: (config) => {
      buttonsRef.value = [...buttonsRef.value, config];
      return removeConfig(buttonsRef, config);
    },
    addPanel: (config) => {
      panelsRef.value = [...panelsRef.value, config];
      return removeConfig(panelsRef, config);
    },
  };

  // --- Install core features ---
  // Each feature is isolated: one failing install is reported and rolled back
  // without preventing the others from installing or the app from mounting.
  installFeature("recordings", RecordingsFeature, featureCtx);
  installFeature("offline", OfflineFeature, featureCtx);
  installFeature("routes", RoutesFeature, featureCtx);
  // Auth features — commented out (SPA front-end only mode).
  // installFeature("account", AccountFeature, featureCtx);
  // installFeature("maps", MapsFeature, featureCtx);
  // installFeature("collections", CollectionsFeature, featureCtx);

  // --- Mount ---
  app.mount("#app");

  // A successful mount is boot success: tell the static fallback before any
  // optional post-boot work runs.
  window.__ogisBoot?.ready?.();

  // --- Service worker ---
  // Registers the app-shell worker in production (or when opted in with
  // VITE_SW=1). In dev any legacy registration is unregistered and all origin
  // caches are purged so poisoned profiles self-heal. See src/utils/serviceWorker.js.
  // A worker failure must never turn a successful mount into a boot fallback.
  try {
    setupServiceWorker()?.catch?.((error) =>
      reportError(error, { source: "service-worker" }),
    );
  } catch (error) {
    reportError(error, { source: "service-worker" });
  }
};

try {
  boot();
} catch (error) {
  reportError(error, { source: "boot" });
  window.__ogisBoot?.fail?.(error);
}
