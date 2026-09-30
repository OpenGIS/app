import { inject, ref } from "vue";
import { emitter } from "@/emitter.js";
import { getMapInstance } from "@/composables/useMap";
import { buildAttribution } from "@/utils/attribution";

// Module-level state — one attribution string per app context, shared by the
// map-corner chip and the Info panel so both stay in sync with the live style.
const cache = new Map();

/**
 * Reactive attribution HTML for the current map style.
 *
 * Computed once the map is ready and refreshed on the same `styledata` /
 * `sourcedata` events MapLibre's own AttributionControl listens to.
 */
export const useAttribution = () => {
  const instanceId = inject("onrteAppId", "app");

  if (cache.has(instanceId)) return cache.get(instanceId);

  const attributionHtml = ref("");

  const update = () => {
    const map = getMapInstance(instanceId);
    attributionHtml.value = map ? buildAttribution(map.getStyle()) : "";
  };

  const attach = (map) => {
    update();
    map.on("styledata", update);
    map.on("sourcedata", update);
  };

  const existing = getMapInstance(instanceId);
  if (existing) {
    attach(existing);
  } else {
    emitter.once("map:ready", ({ map }) => attach(map));
  }

  const api = { attributionHtml };
  cache.set(instanceId, api);
  return api;
};
