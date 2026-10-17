/**
 * Default MapLibre GL JS options for ogis.app.
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
  minZoom: 1,
};

/**
 * Globe projection applied on a first visit (no stored or URL-hash view).
 * Set via map.setProjection() on style.load.
 */
export const globeProjection = { type: "globe" };

/**
 * Tuning for the Locate orientation flight: the one-shot reset to a north-up,
 * viewport-fitted line-of-sight disc on the first fix.
 */
export const orientCameraDefaults = {
  eyeHeightMetres: 1.83, // six-foot observer — the line-of-sight disc
  fitPaddingFraction: 0.08, // padding each side, of the smaller viewport axis
  durationMinMs: 600,
  durationMaxMs: 4000,
  durationPivotMs: 700,
  durationMsPerDecade: 800,
  durationPivotMetres: 1000,
  maxRotationDegPerSecond: 70,
};

/** Max pixel width of the MapLibre ScaleControl. */
export const scaleMaxWidth = 120;
