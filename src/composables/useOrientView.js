import { inject } from "vue";
import { getMapInstance } from "@/composables/useMap";
import { orientCameraDefaults } from "@/defaults/maplibre";
import {
  fitZoomForDisc,
  horizonDistanceMetres,
  orientFlightDurationMs,
} from "@/utils/orient";
import { haversine } from "@/utils/geo";

// Angles within this epsilon of zero are treated as already north-up/flat, so
// a no-op ease is skipped when the view needs no rotation.
const ANGLE_EPSILON_DEG = 0.01;

/**
 * Composable for orienting the view into a flat, 2D, north-up camera.
 *
 * A single entry point, `orientView`, exposes two targets:
 * - Current camera (default): switch to the mercator projection and reset
 *   bearing and pitch to 0, leaving centre and zoom untouched.
 * - Current location (`{ target: { lat, lng } }`): switch projection first,
 *   then fly to the location at a zoom that fits the line-of-sight horizon
 *   disc, using a distance-scaled, gently-paced duration.
 *
 * Flights never set `essential`, so MapLibre automatically zeroes their
 * durations for reduced-motion users, and never use `maxDuration`, which would
 * make the flight instant.
 *
 * @returns {{ orientView: (options?: { target?: { lat: number, lng: number } }) => boolean }}
 */
export const useOrientView = () => {
  const instanceId = inject("ogisAppId", "app");

  /** Switch to the mercator projection, when not already using it. */
  const toMercator = (map) => {
    if (map.getProjection?.()?.type !== "mercator") {
      map.setProjection({ type: "mercator" });
    }
  };

  /** Reset bearing and pitch to 0, skipping the ease when already there. */
  const resetRotation = (map) => {
    const bearing = map.getBearing();
    const pitch = map.getPitch();
    if (
      Math.abs(bearing) < ANGLE_EPSILON_DEG &&
      Math.abs(pitch) < ANGLE_EPSILON_DEG
    ) {
      return;
    }
    // No `essential`: MapLibre zeroes the duration under reduced-motion.
    map.easeTo({ bearing: 0, pitch: 0 });
  };

  /** Fly to a location, fitted to the line-of-sight horizon. */
  const orientToLocation = (map, target) => {
    const { lat, lng } = target;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    // Leave it to a later fix if the canvas has no usable size yet.
    const canvas = map.getCanvas();
    const minDim = Math.min(canvas.clientWidth, canvas.clientHeight);
    if (!minDim) return false;

    // Switch projection before computing the flight, so the fitted zoom is
    // measured against the target projection.
    toMercator(map);

    const zoom = fitZoomForDisc({
      widthPx: canvas.clientWidth,
      heightPx: canvas.clientHeight,
      latitude: lat,
      radiusMetres: horizonDistanceMetres(orientCameraDefaults.eyeHeightMetres),
      paddingPx: Math.round(minDim * orientCameraDefaults.fitPaddingFraction),
    });
    const centre = map.getCenter();
    const duration = orientFlightDurationMs({
      distanceMetres: haversine(
        { lat: centre.lat, lng: centre.lng },
        { lat, lng },
      ),
      bearingDeg: map.getBearing(),
    });

    map.flyTo({ center: [lng, lat], zoom, bearing: 0, pitch: 0, duration });
    return true;
  };

  /**
   * Put the view into 2D (mercator), north-up (bearing 0), flat (pitch 0).
   *
   * @param {Object} [options]
   * @param {{ lat: number, lng: number }} [options.target] - Fly to this
   *   location with a fitted horizon zoom. Omit to leave centre and zoom alone.
   * @returns {boolean} Camera target: true once the map exists. Location
   *   target: true when the flight was started, false when the map, target or
   *   canvas is not ready.
   */
  const orientView = (options = {}) => {
    const map = getMapInstance(instanceId);
    if (!map) return false;

    if (options.target) return orientToLocation(map, options.target);

    toMercator(map);
    resetRotation(map);
    return true;
  };

  return { orientView };
};
