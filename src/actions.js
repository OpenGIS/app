import { fitCountryBounds } from "@/composables/useMap";

/**
 * Map action descriptors.
 *
 * An action is a plain object consumed by `useActions().perform(action,
 * payload)`:
 *
 * - `needsMap` — the action moves or rotates the camera, so it must have a
 *   resolved map and must claim the map from any active mode first.
 * - `dismissPanel` — the action needs an unobstructed view, so the side pane is
 *   closed on compact layouts before it runs.
 * - `requires({ map, instanceId, orientView })` — a precondition that blocks
 *   the action; returning false aborts before any mode is stopped or the UI
 *   changes.
 * - `except` — a mode id to leave running when claiming the map.
 * - `run({ map, instanceId, orientView }, payload)` — the action itself.
 */

/**
 * Build the OSM note URL for the map's live centre and rounded zoom.
 *
 * @param {import('maplibre-gl').Map} map
 * @returns {string}
 */
const osmNoteUrl = (map) => {
  const centre = map.getCenter();
  const zoom = Math.round(map.getZoom());
  return `https://www.openstreetmap.org/note/new#map=${zoom}/${centre.lat.toFixed(6)}/${centre.lng.toFixed(6)}&layers=DN`;
};

export const actions = {
  random: {
    needsMap: true,
    dismissPanel: true,
    run: ({ map }) => fitCountryBounds(map, ""),
  },
  improve: {
    needsMap: true,
    run: ({ map, orientView }) => {
      orientView();
      window.open(osmNoteUrl(map), "_blank", "noopener,noreferrer");
    },
  },
};
