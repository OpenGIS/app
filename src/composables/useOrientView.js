import { inject } from "vue";
import { getMapInstance } from "@/composables/useMap";
import { horizonFitZoom, orientFlightDurationMs } from "@/utils/orient";
import { haversine } from "@/utils/geo";

// Angles within this epsilon of zero are treated as already north-up/flat, so
// a no-op ease is skipped when the view needs no rotation.
const ANGLE_EPSILON_DEG = 0.01;

/**
 * Composable for orienting the view into a flat, north-up camera.
 *
 * `orientView` is projection-neutral and exposes two targets:
 * - Current camera (default): reset bearing and pitch to 0, leaving the
 *   active projection, centre and zoom untouched.
 * - Current location (`{ target: { lat, lng } }`): fly to the location at a
 *   zoom that fits the line-of-sight horizon disc, keeping the active
 *   projection and using a distance-scaled, gently-paced duration.
 *
 * `switchProjection` is the scoped projection facility: it switches to a
 * given projection and returns an idempotent restore handle that reapplies
 * the previously active one.
 *
 * Flights never set `essential`, so MapLibre automatically zeroes their
 * durations for reduced-motion users, and never use `maxDuration`, which would
 * make the flight instant.
 *
 * @returns {{
 *   orientView: (options?: { target?: { lat: number, lng: number } }) => boolean,
 *   switchProjection: (type?: string) => () => void,
 * }}
 */
export const useOrientView = () => {
  const instanceId = inject("ogisAppId", "app");

  /**
   * Scoped projection switch. Resolves the map the same way `orientView`
   * does; with no map it returns a safe no-op. When the current projection
   * differs from `type`, switches to it. Returns an idempotent restore
   * handle that reapplies the previous projection, skipping the restore when
   * that value is unknown or already active.
   *
   * @param {string} [type] - Projection to switch to.
   * @returns {() => void} Restore handle, safe to call multiple times.
   */
  const switchProjection = (type = "mercator") => {
    const map = getMapInstance(instanceId);
    if (!map) return () => {};

    const previous = map.getProjection?.()?.type;
    if (previous !== type) {
      map.setProjection({ type });
    }

    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      if (!previous) return;
      if (map.getProjection?.()?.type === previous) return;
      map.setProjection({ type: previous });
    };
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

    const zoom = horizonFitZoom({
      widthPx: canvas.clientWidth,
      heightPx: canvas.clientHeight,
      latitude: lat,
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
   * Reset the camera rotation to north-up (bearing 0) and flat (pitch 0),
   * leaving the active projection, centre and zoom alone.
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

    resetRotation(map);
    return true;
  };

  return { orientView, switchProjection };
};
