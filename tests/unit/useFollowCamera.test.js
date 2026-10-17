import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/composables/useMap.js", () => ({
  getMapInstance: vi.fn(),
  setMapViewSuppressed: vi.fn(),
  persistMapView: vi.fn(),
}));

import {
  getMapInstance,
  setMapViewSuppressed,
  persistMapView,
} from "@/composables/useMap.js";
import { useFollowCamera } from "@/composables/useFollowCamera.js";
import { followFitZoom } from "@/utils/follow.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A mock faithful to the MapLibre surface the driver touches. `getMinZoom`/
 * `getMaxZoom` are included because the derived zoom is clamped to the map's
 * range.
 */
const createMap = ({
  bearing = 0,
  pitch = 0,
  zoom = 10,
  center = { lat: 0, lng: 0 },
  width = 1000,
  height = 800,
} = {}) => ({
  stop: vi.fn(),
  getCenter: vi.fn(() => ({ ...center })),
  getBearing: vi.fn(() => bearing),
  getPitch: vi.fn(() => pitch),
  getZoom: vi.fn(() => zoom),
  getMinZoom: vi.fn(() => 1),
  getMaxZoom: vi.fn(() => 22),
  getCanvas: vi.fn(() => ({ clientWidth: width, clientHeight: height })),
  jumpTo: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
});

let rafCallbacks;
let rafSequence;
let clockMs;
let instanceSeq = 0;

const nextInstanceId = () => `follow-test-${instanceSeq++}`;

/** Run one animation frame, advancing the fake clock. */
const flushFrame = (advanceMs = 16) => {
  clockMs += advanceMs;
  const pending = Array.from(rafCallbacks.values());
  rafCallbacks.clear();
  for (const callback of pending) callback(clockMs);
};

const lastJump = (map) => map.jumpTo.mock.calls.at(-1)[0];

beforeEach(() => {
  rafCallbacks = new Map();
  rafSequence = 0;
  clockMs = 0;
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    const id = ++rafSequence;
    rafCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id) => rafCallbacks.delete(id));
  // Pretend the user prefers reduced motion so damping snaps and the
  // target->pose mapping can be asserted exactly.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Target -> pose mapping ──────────────────────────────────────────────────

describe("useFollowCamera / target -> pose", () => {
  it("passes an explicit bearing, pitch and zoom straight through", () => {
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 123, pitch: 45, zoom: 14 });
    flushFrame();

    const jump = lastJump(map);
    expect(jump.bearing).toBeCloseTo(123, 6);
    expect(jump.pitch).toBeCloseTo(45, 6);
    expect(jump.zoom).toBeCloseTo(14, 6);
  });

  it("accepts bearingDeg as an alias for bearing", () => {
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearingDeg: 77, pitch: 0, zoom: 12 });
    flushFrame();

    expect(lastJump(map).bearing).toBeCloseTo(77, 6);
  });

  it("derives a flat, viewport-fitted pose at rest", () => {
    const map = createMap({ width: 1000, height: 800 });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({
      lat: 45,
      lng: -60,
      compassHeading: 90,
      speedKmh: 0,
      timestampMs: 0,
    });
    flushFrame();

    const jump = lastJump(map);
    expect(jump.bearing).toBeCloseTo(90, 3);
    expect(jump.pitch).toBeCloseTo(0, 3);
    expect(jump.zoom).toBeCloseTo(
      followFitZoom({ widthPx: 1000, heightPx: 800, latitude: 45 }),
      6,
    );
  });

  it("tilts, pulls back one level and follows the course at speed", () => {
    const map = createMap({ width: 1000, height: 800 });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({
      lat: 45,
      lng: -60,
      compassHeading: 90,
      courseDeg: 180,
      speedKmh: 100,
      timestampMs: 0,
    });
    flushFrame();

    const jump = lastJump(map);
    expect(jump.pitch).toBeCloseTo(60, 3);
    expect(jump.bearing).toBeCloseTo(180, 3);
    const fit = followFitZoom({ widthPx: 1000, heightPx: 800, latitude: 45 });
    expect(jump.zoom).toBeCloseTo(fit - 1, 6);
  });

  it("holds the previous bearing when the blend is undecidable", () => {
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({
      lat: 45,
      lng: -60,
      compassHeading: 45,
      speedKmh: 0,
      timestampMs: 0,
    });
    flushFrame();

    driver.setTarget({
      lat: 46,
      lng: -60,
      compassHeading: null,
      courseDeg: null,
      speedKmh: 0,
      timestampMs: 0,
    });
    flushFrame();

    expect(lastJump(map).bearing).toBeCloseTo(45, 3);
  });

  it("ignores a target without finite coordinates", () => {
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: NaN, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();

    expect(map.jumpTo).not.toHaveBeenCalled();
  });
});

// ─── Late map ────────────────────────────────────────────────────────────────

describe("useFollowCamera / late map", () => {
  it("stores the target and drives once a late map resolves", () => {
    getMapInstance.mockReturnValue(null);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 30, pitch: 20, zoom: 12 });

    // No map yet: the loop must not throw, and must keep waiting.
    expect(() => flushFrame()).not.toThrow();

    const map = createMap();
    getMapInstance.mockReturnValue(map);
    flushFrame();
    flushFrame();

    expect(map.stop).toHaveBeenCalledTimes(1);
    expect(lastJump(map).bearing).toBeCloseTo(30, 3);
    expect(lastJump(map).zoom).toBeCloseTo(12, 6);
  });
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

describe("useFollowCamera / lifecycle", () => {
  it("start and stop are idempotent", () => {
    const id = nextInstanceId();
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(id);

    driver.start();
    driver.start();
    flushFrame();
    expect(map.stop).toHaveBeenCalledTimes(1);

    driver.stop();
    driver.stop();
    expect(persistMapView).toHaveBeenCalledTimes(1);
    expect(persistMapView).toHaveBeenCalledWith(id);
    expect(setMapViewSuppressed).toHaveBeenLastCalledWith(id, false);
  });

  it("suppresses persistence while active and releases it on stop", () => {
    const id = nextInstanceId();
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(id);

    driver.start();
    expect(setMapViewSuppressed).toHaveBeenLastCalledWith(id, true);

    driver.stop();
    expect(setMapViewSuppressed).toHaveBeenLastCalledWith(id, false);
  });
});
