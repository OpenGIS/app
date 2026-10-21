import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// The composable reads its instance id via Vue's inject() with an "app"
// fallback. Outside a component there is no app context, so inject is stubbed
// to the fallback — the value a callback outside setup would actually see.
vi.mock("vue", async (importOriginal) => ({
  ...(await importOriginal()),
  inject: vi.fn(() => "app"),
}));

let mockMapInstance = null;

vi.mock("@/composables/useMap.js", () => ({
  getMapInstance: vi.fn(() => mockMapInstance),
}));

import { inject } from "vue";
import { getMapInstance } from "@/composables/useMap.js";
import { useOrientView } from "@/composables/useOrientView.js";
import {
  fitZoomForDisc,
  horizonDistanceMetres,
  orientFlightDurationMs,
} from "@/utils/orient.js";
import { orientCameraDefaults } from "@/defaults/maplibre.js";
import { haversine } from "@/utils/geo.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A mock faithful to the MapLibre GL JS 5.24 surface this composable touches.
 *
 * `getProjection()` is included because the composable reads
 * `map.getProjection?.().type`: on real MapLibre it delegates to the style,
 * returning the stylesheet projection specification — a plain JSON object
 * such as `{ type: "globe" }` or `{ type: "mercator" }`. Omitting it here
 * would make the mock lie about a method the live map provides. `setProjection`
 * records the new value so the projected state stays faithful across a switch
 * and its restore.
 */
const createMap = ({
  projection = "globe",
  bearing = 0,
  pitch = 0,
  center = { lat: 0, lng: 0 },
  width = 1440,
  height = 900,
} = {}) => {
  let currentProjection = projection;
  return {
    getProjection: vi.fn(() => ({ type: currentProjection })),
    setProjection: vi.fn((spec) => {
      currentProjection = spec.type;
    }),
    getBearing: vi.fn(() => bearing),
    getPitch: vi.fn(() => pitch),
    getCenter: vi.fn(() => ({ ...center })),
    getCanvas: vi.fn(() => ({ clientWidth: width, clientHeight: height })),
    easeTo: vi.fn(),
    flyTo: vi.fn(),
  };
};

/** The fitted zoom the production code must compute for a canvas and target. */
const expectedZoom = ({ widthPx, heightPx, latitude }) =>
  fitZoomForDisc({
    widthPx,
    heightPx,
    latitude,
    radiusMetres: horizonDistanceMetres(orientCameraDefaults.eyeHeightMetres),
    paddingPx: Math.round(
      Math.min(widthPx, heightPx) * orientCameraDefaults.fitPaddingFraction,
    ),
  });

beforeEach(() => {
  mockMapInstance = null;
  vi.clearAllMocks();
});

// ─── Camera target ───────────────────────────────────────────────────────────

describe("useOrientView / camera target", () => {
  it("does not switch a globe projection (projection-neutral)", () => {
    const map = createMap({ projection: "globe" });
    mockMapInstance = map;

    const { orientView } = useOrientView();
    expect(orientView()).toBe(true);

    expect(map.setProjection).not.toHaveBeenCalled();
  });

  it("does not switch when the projection is already mercator", () => {
    const map = createMap({ projection: "mercator" });
    mockMapInstance = map;

    const { orientView } = useOrientView();
    expect(orientView()).toBe(true);

    expect(map.setProjection).not.toHaveBeenCalled();
  });

  it("eases a rotated view to bearing 0 and pitch 0, leaving centre and zoom alone", () => {
    const map = createMap({ bearing: 120, pitch: 45 });
    mockMapInstance = map;

    const { orientView } = useOrientView();
    expect(orientView()).toBe(true);

    // Exact options: no centre or zoom keys, so the camera stays put.
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    expect(map.easeTo).toHaveBeenCalledWith({ bearing: 0, pitch: 0 });
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("skips the ease when the view is already north-up and flat", () => {
    const map = createMap({ bearing: 0, pitch: 0 });
    mockMapInstance = map;

    const { orientView } = useOrientView();
    expect(orientView()).toBe(true);

    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it("treats sub-epsilon angles as already aligned", () => {
    const map = createMap({ bearing: 0.005, pitch: -0.009 });
    mockMapInstance = map;

    const { orientView } = useOrientView();
    expect(orientView()).toBe(true);

    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it("returns false when there is no map", () => {
    const { orientView } = useOrientView();
    expect(orientView()).toBe(false);
    expect(getMapInstance).toHaveBeenCalledWith("app");
  });

  it("resolves the instance id through inject with the app fallback", () => {
    const map = createMap();
    mockMapInstance = map;

    const { orientView } = useOrientView();
    orientView();

    expect(inject).toHaveBeenCalledWith("ogisAppId", "app");
  });

  it("prefers an explicit instance id over inject", () => {
    const map = createMap();
    mockMapInstance = map;

    const { orientView } = useOrientView("secondary");
    expect(orientView()).toBe(true);

    expect(getMapInstance).toHaveBeenCalledWith("secondary");
    expect(inject).not.toHaveBeenCalled();
  });
});

// ─── Location target ─────────────────────────────────────────────────────────

describe("useOrientView / location target", () => {
  const TARGET = { lat: 45, lng: -60 };

  it("does not switch the projection when starting the flight", () => {
    const map = createMap({
      projection: "globe",
      center: { lat: 44, lng: -60 },
    });
    mockMapInstance = map;

    const { orientView } = useOrientView();
    expect(orientView({ target: TARGET })).toBe(true);

    expect(map.setProjection).not.toHaveBeenCalled();
    expect(map.flyTo).toHaveBeenCalledTimes(1);
  });

  it("flies to the target at the horizon-fitted zoom with the distance-scaled duration", () => {
    const centre = { lat: 44, lng: -60 };
    const map = createMap({ projection: "mercator", center: centre });
    mockMapInstance = map;

    const { orientView } = useOrientView();
    expect(orientView({ target: TARGET })).toBe(true);

    const { clientWidth: widthPx, clientHeight: heightPx } = map.getCanvas();
    const zoom = expectedZoom({
      widthPx,
      heightPx,
      latitude: TARGET.lat,
    });
    const duration = orientFlightDurationMs({
      distanceMetres: haversine(centre, TARGET),
      bearingDeg: 0,
    });

    expect(map.flyTo).toHaveBeenCalledTimes(1);
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [TARGET.lng, TARGET.lat],
      zoom,
      bearing: 0,
      pitch: 0,
      duration,
    });
    // ~111 km away, north-up: the duration curve, not a clamp.
    expect(duration).toBeGreaterThan(orientCameraDefaults.durationMinMs);
    expect(duration).toBeLessThan(orientCameraDefaults.durationMaxMs);
  });

  it("uses the minimum duration for a flight centred on the target", () => {
    // Zero distance, north-up — tests/unit/orient.test.js pins this exact
    // case at the 600 ms minimum.
    const map = createMap({ projection: "mercator", center: { ...TARGET } });
    mockMapInstance = map;

    const { orientView } = useOrientView();
    expect(orientView({ target: TARGET })).toBe(true);

    expect(map.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 600 }),
    );
  });

  it("returns false for invalid coordinates and touches nothing", () => {
    const map = createMap({ projection: "globe" });
    mockMapInstance = map;

    const { orientView } = useOrientView();
    expect(orientView({ target: { lat: NaN, lng: -60 } })).toBe(false);
    expect(orientView({ target: { lat: 45, lng: Infinity } })).toBe(false);

    expect(map.setProjection).not.toHaveBeenCalled();
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("returns false on a zero-size canvas and leaves the projection alone", () => {
    const map = createMap({ projection: "globe", width: 0, height: 0 });
    mockMapInstance = map;

    const { orientView } = useOrientView();
    expect(orientView({ target: TARGET })).toBe(false);

    expect(map.setProjection).not.toHaveBeenCalled();
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("returns false when there is no map", () => {
    const { orientView } = useOrientView();
    expect(orientView({ target: TARGET })).toBe(false);
  });
});

// ─── Scoped projection switching ─────────────────────────────────────────────

describe("useOrientView / switchProjection", () => {
  it("switches globe to mercator once and restores mercator to globe", () => {
    const map = createMap({ projection: "globe" });
    mockMapInstance = map;

    const { switchProjection } = useOrientView();
    const restore = switchProjection("mercator");

    expect(map.setProjection).toHaveBeenCalledTimes(1);
    expect(map.setProjection).toHaveBeenCalledWith({ type: "mercator" });

    restore();
    expect(map.setProjection).toHaveBeenCalledTimes(2);
    expect(map.setProjection).toHaveBeenLastCalledWith({ type: "globe" });
  });

  it("does not switch when already mercator and the restore is a no-op", () => {
    const map = createMap({ projection: "mercator" });
    mockMapInstance = map;

    const { switchProjection } = useOrientView();
    const restore = switchProjection("mercator");

    expect(map.setProjection).not.toHaveBeenCalled();

    restore();
    expect(map.setProjection).not.toHaveBeenCalled();
  });

  it("applies at most one restore when the handle is called twice", () => {
    const map = createMap({ projection: "globe" });
    mockMapInstance = map;

    const { switchProjection } = useOrientView();
    const restore = switchProjection("mercator");

    restore();
    restore();

    expect(map.setProjection).toHaveBeenCalledTimes(2);
    expect(map.setProjection).toHaveBeenLastCalledWith({ type: "globe" });
  });

  it("returns a safe no-op restore when there is no map", () => {
    const { switchProjection } = useOrientView();
    const restore = switchProjection("mercator");

    expect(typeof restore).toBe("function");
    expect(() => restore()).not.toThrow();
  });
});
