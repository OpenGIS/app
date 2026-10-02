/**
 * Default MapLibre GL JS options for On Route.
 *
 * Centralised here so they can be imported by composables and features
 * without duplicating magic values.
 */

/** Default map constructor options. */
export const mapDefaults = {
  // style: "https://tiles.openfreemap.org/styles/bright",
  style:
    "https://raw.githubusercontent.com/OpenGIS/outdoors/refs/heads/master/style.json",
  attributionControl: false,
  center: [0, 0],
  zoom: 1,
};

/**
 * Globe projection applied on a first visit (no stored or URL-hash view).
 * Set via map.setProjection() on style.load.
 */
export const globeProjection = { type: "globe" };

/** Zoom level applied on the first GPS fix in the Locate feature. */
export const locateZoom = 16;

/** Max pixel width of the MapLibre ScaleControl. */
export const scaleMaxWidth = 120;
