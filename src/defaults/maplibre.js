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

/**
 * Tuning for the follow camera: a driver that owns the camera each frame and
 * damps it towards a moving target. Time constants are in seconds (the time
 * for a value to close ~63% of the gap to its target); the values are starting
 * points for later tuning.
 */
export const followCameraDefaults = {
  // Exponential-damping time constants, in seconds, per camera component.
  centreTimeConstantS: 0.35,
  bearingTimeConstantS: 0.3,
  pitchTimeConstantS: 0.4,
  zoomTimeConstantS: 0.4,
  // Third-person floor: the speed curve may only tilt the camera further, so
  // following enters a chase view immediately rather than resting on the flat
  // orientation pose. Clamped to the map's own pitch range.
  restPitch: 45,
  // Navigation zoom model: the close chase view rests at `restZoom` and pulls
  // back by only `zoomPullBack` level as speed rises to 100 km/h, keeping the
  // driver's immediate surroundings in view. The locate orientation flight
  // remains a separate, wider fit.
  restZoom: 17.5,
  zoomPullBack: 0.5,
  // Hand-off glide from the wide locate pose into the navigation pose. The
  // glide is eased over `handoffGlideMs`; each frame moves the zoom by at most
  // `handoffMaxZoomStep` levels, so a slow renderer cannot jump-cut the ~5.85
  // level zoom-in. Reduced-motion users snap instead of gliding.
  handoffGlideMs: 1600,
  handoffMaxZoomStep: 0.35,
  // Lower-third composition: the map centre is displaced ahead of the user
  // along the bearing so the user sits below the screen midpoint in the
  // third-person view. The offset scales from 0 at pitch 0 to
  // `maxOffsetFraction` at `offsetRampPitchDeg`, and is clamped to the
  // look-ahead limits below.
  maxOffsetFraction: 0.2,
  offsetRampPitchDeg: 60,
  lookAheadMinMetres: 0,
  lookAheadMaxMetres: 5000,
  // Interaction suspension: a user gesture (pan/zoom/rotate/pitch) suspends the
  // driver, leaving the camera where it was put, and the driver glides back to
  // the follow pose after this idle delay. Time is in milliseconds.
  idleResumeDelayMs: 5000,
  // Length of that resume glide, in milliseconds. Reduced-motion users snap
  // instead of gliding.
  resumeGlideMs: 1200,
};

/** Max pixel width of the MapLibre ScaleControl. */
export const scaleMaxWidth = 120;
