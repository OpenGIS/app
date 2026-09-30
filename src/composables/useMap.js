import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import cspWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker.js?url";

// Use the pre-built CSP worker so Vite's production minification does not
// mangle variable names referenced inside the serialised worker blob.
maplibregl.setWorkerUrl(cspWorkerUrl);
import { inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useStorage } from "@/composables/useStorage";
import { parseUrlHash, updateUrlHash } from "@/composables/useUrlHash";
import { useSettings } from "@/composables/useSettings";
import { useLocale } from "@/composables/useLocale";
import { emitter } from "@/emitter.js";
import { mapDefaults, globeProjection, scaleMaxWidth } from "@/defaults/maplibre";

// Module-level state — one map instance per app context.
const mapCache = new Map();

function throttle(fn, delay) {
    let lastCall = 0;
    return (...args) => {
        const now = Date.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            fn(...args);
        }
    };
}

/**
 * Returns true if a text-field layout value references an OSM name field.
 * Road refs, house numbers, and other non-name fields are excluded.
 */
function isNameBased(textField) {
    if (!textField) return false;
    const str =
        typeof textField === "string" ? textField : JSON.stringify(textField);
    return str.includes("name");
}

/**
 * Apply a multilingual coalesce expression to all symbol layers that render
 * OSM name fields. Called after map load and whenever the active language changes.
 * Layers whose text-field does not reference a name property (e.g. road refs)
 * are left untouched.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {string} tag - BCP 47 language subtag (e.g. 'fr', 'en')
 */
function applyMapLanguage(map, tag) {
    const expression = [
        "coalesce",
        ["get", `name:${tag}`],
        ["get", "name"],
        ["get", "name:en"],
    ];
    const layers = map.getStyle()?.layers ?? [];
    for (const layer of layers) {
        if (layer.type !== "symbol") continue;
        const textField = map.getLayoutProperty(layer.id, "text-field");
        if (isNameBased(textField)) {
            map.setLayoutProperty(layer.id, "text-field", expression);
        }
    }
}

/**
 * Composable for MapLibre map lifecycle management.
 *
 * Call with (containerRef, options) from a component setup context to initialise
 * the map and register mount/unmount lifecycle hooks.
 * Call without arguments from any context to access the current map instance.
 *
 * @param {import('vue').Ref<HTMLElement|null>} [containerRef] - Template ref for the map container element
 * @param {Object} [options={}] - MapLibre MapOptions to merge with defaults
 */
export const useMap = (containerRef = null, options = {}) => {
    const instanceId = inject("onrteAppId", "app");

    if (!mapCache.has(instanceId)) {
        mapCache.set(instanceId, {
            state: useStorage("view", {
                mapView: { center: null, zoom: null },
            }, instanceId),
            mapInstance: null,
            scaleControl: null,
            mapView: ref(null),
        });
    }

    const cached = mapCache.get(instanceId);

    if (containerRef !== null) {
        const { isMetric } = useSettings();
        const { mapLanguageTag } = useLocale();

        // Keep the scale control unit in sync with the OS-derived units.
        watch(isMetric, (metric) => {
            if (cached.scaleControl) {
                cached.scaleControl.setUnit(metric ? "metric" : "imperial");
            }
        });

        // Update map label language whenever the active locale changes.
        watch(mapLanguageTag, (tag) => {
            if (cached.mapInstance) applyMapLanguage(cached.mapInstance, tag);
        });

        onMounted(() => {
            const map = new maplibregl.Map({
                container: containerRef.value,
                ...mapDefaults,
                ...options,
            });

            map.on("style.load", () => {
                // Globe projection is always active — MapLibre transitions to
                // mercator automatically at higher zoom levels.
                map.setProjection(globeProjection);

                // Determine initial view: URL hash takes priority over localStorage
                const hashView = parseUrlHash();
                const hasStoredView = !!(
                    cached.state.mapView.center && cached.state.mapView.zoom
                );

                if (hashView) {
                    map.jumpTo({
                        center: hashView.center,
                        zoom: hashView.zoom,
                    });
                } else if (hasStoredView) {
                    map.jumpTo({
                        center: cached.state.mapView.center,
                        zoom: cached.state.mapView.zoom,
                    });
                }

                // Update the reactive ref and URL hash from the current map state.
                // Does NOT write localStorage — that only happens on user movement.
                const refreshView = () => {
                    const c = map.getCenter();
                    const z = map.getZoom();
                    cached.mapView.value = { lat: c.lat, lng: c.lng, zoom: z };
                    updateUrlHash(z, c.lat, c.lng);
                };

                // Only populate mapView when there is a meaningful view to share
                // (a URL hash or a previously persisted view). On a true first visit
                // mapView stays null so the "Current view / Share this view"
                // section in the menu remains hidden.
                if (hashView || hasStoredView) {
                    refreshView();
                } else {
                    const c = map.getCenter();
                    const z = map.getZoom();
                    updateUrlHash(z, c.lat, c.lng);
                }

                // On map movement: persist to localStorage, update ref, and update hash.
                const persistView = () => {
                    const c = map.getCenter();
                    const z = map.getZoom();
                    cached.state.mapView.center = c;
                    cached.state.mapView.zoom = z;
                    cached.mapView.value = {
                        lat: c.lat,
                        lng: c.lng,
                        zoom: z,
                    };
                    updateUrlHash(z, c.lat, c.lng);
                    emitter.emit("view:change", { center: { lat: c.lat, lng: c.lng }, zoom: z });
                };

                // Gesture-driven moves are throttled to avoid a write per frame.
                const throttledPersistView = throttle(persistView, 1000);

                map.on("moveend", (event) => {
                    // A programmatic camera move (flyTo/easeTo/jumpTo) carries no
                    // originalEvent. Its hash write must never be dropped by the
                    // throttle, otherwise the final view (e.g. the locate initial
                    // zoom to #map=16) can be swallowed, leaving a stale hash.
                    if (event?.originalEvent) {
                        throttledPersistView();
                    } else {
                        persistView();
                    }
                });

                cached.mapInstance = map;

                // Expose idle state as a data attribute so screenshot tests can
                // reliably wait for tiles to finish rendering before capturing.
                map.on("idle", () => {
                    if (containerRef.value) containerRef.value.dataset.mapIdle = "true";
                });
                map.on("movestart", () => {
                    if (containerRef.value) delete containerRef.value.dataset.mapIdle;
                });
                map.on("zoomstart", () => {
                    if (containerRef.value) delete containerRef.value.dataset.mapIdle;
                });

                // Apply the active language to map labels immediately after load.
                applyMapLanguage(map, mapLanguageTag.value);

                // Scale bar — unit follows the OS/browser region.
                const scaleControl = new maplibregl.ScaleControl({
                    maxWidth: scaleMaxWidth,
                    unit: isMetric.value ? "metric" : "imperial",
                });
                map.addControl(scaleControl, "bottom-left");
                cached.scaleControl = scaleControl;

                emitter.emit("map:ready", { map, instanceId });
            });
        });

        onUnmounted(() => {
            emitter.emit("destroy");
            cached.mapInstance?.remove();
            cached.mapInstance = null;
            mapCache.delete(instanceId);
        });
    }

    return {
        map: cached.mapInstance,
        mapView: cached.mapView,
    };
};

/**
 * Retrieve the MapLibre map instance without requiring a Vue inject context.
 * Use this from callbacks or composables that run outside of component setup.
 *
 * @param {string} [instanceId] - The app instance ID. Defaults to 'app'.
 * @returns {import('maplibre-gl').Map | null}
 */
export const getMapInstance = (instanceId = "app") => {
    const cached = mapCache.get(instanceId);
    return cached ? cached.mapInstance : null;
};
