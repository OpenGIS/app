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
import { emitter } from "@/emitter.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A mock faithful to the MapLibre surface the driver touches. `getMinZoom`/
 * `getMaxZoom` are included because the derived zoom is clamped to the map's
 * range. `on` records listeners so a test can fire movement events by hand
 * (with or without an `originalEvent`), exactly as MapLibre would.
 */
const createMap = ({
  bearing = 0,
  pitch = 0,
  zoom = 10,
  center = { lat: 0, lng: 0 },
  width = 1000,
  height = 800,
} = {}) => {
  const handlers = new Map();
  return {
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
    on: vi.fn((type, handler) => {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    }),
    fire: (type, event) => {
      for (const handler of handlers.get(type) ?? []) handler(event);
    },
  };
};

let rafCallbacks;
let rafSequence;
let clockMs;
let reducedMotion;
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
  reducedMotion = true;
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    const id = ++rafSequence;
    rafCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id) => rafCallbacks.delete(id));
  // Pretend the user prefers reduced motion so damping snaps and the
  // target->pose mapping can be asserted exactly. Tests that need the glide
  // set `reducedMotion = false` before starting the driver.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reducedMotion })),
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

// ─── Interaction suspension and idle resume ──────────────────────────────────

describe("useFollowCamera / interaction suspension", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores controller-driven movement events (no originalEvent)", () => {
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();
    expect(lastJump(map).bearing).toBeCloseTo(10, 3);

    // The controller's own jumpTo emits movement with no originating event.
    map.fire("movestart", {});
    map.fire("move", {});
    expect(vi.getTimerCount()).toBe(0);

    // Still driving: a new fix moves the camera.
    driver.setTarget({ lat: 45, lng: -60, bearing: 80, pitch: 0, zoom: 12 });
    flushFrame();
    expect(lastJump(map).bearing).toBeCloseTo(80, 3);
  });

  it("suspends on a user event, freezes the camera and resumes to the latest pose", () => {
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();
    expect(lastJump(map).bearing).toBeCloseTo(10, 3);

    // A user pan: the movement carries an originalEvent.
    map.fire("movestart", { originalEvent: {} });
    expect(vi.getTimerCount()).toBe(1);

    // A new fix while suspended updates the stored pose but not the camera.
    const frozen = map.jumpTo.mock.calls.length;
    driver.setTarget({ lat: 46, lng: -61, bearing: 200, pitch: 0, zoom: 12 });
    flushFrame();
    expect(map.jumpTo.mock.calls.length).toBe(frozen);

    // Motion returns: the idle delay elapses and the glide begins.
    reducedMotion = false;
    vi.advanceTimersByTime(5000);
    flushFrame(); // first glide frame, progress ~0
    flushFrame(1200); // glide completes
    expect(lastJump(map).bearing).toBeCloseTo(200, 3);
  });

  it("resets the idle timer on a repeated gesture", () => {
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();

    map.fire("movestart", { originalEvent: {} });
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(4000);
    map.fire("dragstart", { originalEvent: {} });
    vi.advanceTimersByTime(4000); // 8 s total: the first timer would have fired
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1000); // the reset timer fires at 9 s
    expect(vi.getTimerCount()).toBe(0);
  });

  it("snaps instantly on resume under reduced motion", () => {
    reducedMotion = true;
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();

    map.fire("movestart", { originalEvent: {} });
    driver.setTarget({ lat: 45, lng: -60, bearing: 200, pitch: 0, zoom: 12 });
    vi.advanceTimersByTime(5000);
    flushFrame();
    expect(lastJump(map).bearing).toBeCloseTo(200, 3);
  });

  it("stop while suspended cancels the timer, persists once and releases suppression", () => {
    const id = nextInstanceId();
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(id);

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();

    map.fire("movestart", { originalEvent: {} });
    expect(vi.getTimerCount()).toBe(1);

    driver.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(persistMapView).toHaveBeenCalledTimes(1);
    expect(persistMapView).toHaveBeenCalledWith(id);
    expect(setMapViewSuppressed).toHaveBeenLastCalledWith(id, false);

    // A fired-late timer cannot resurrect the camera after stop.
    vi.advanceTimersByTime(10000);
    flushFrame();
    expect(persistMapView).toHaveBeenCalledTimes(1);
  });

  it("recomputes the follow fit on resize and detaches listeners on destroy", () => {
    const map = createMap({ width: 1000, height: 800 });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({
      lat: 45,
      lng: -60,
      compassHeading: 0,
      speedKmh: 0,
      timestampMs: 0,
    });
    flushFrame();
    const zoomBefore = lastJump(map).zoom;

    // The viewport grows; a resize recomputes the horizon-fit baseline.
    map.getCanvas.mockReturnValue({ clientWidth: 2000, clientHeight: 1600 });
    map.fire("resize", {});
    flushFrame();
    const zoomAfter = lastJump(map).zoom;
    expect(zoomAfter).toBeCloseTo(
      followFitZoom({ widthPx: 2000, heightPx: 1600, latitude: 45 }),
      6,
    );
    expect(zoomAfter).toBeGreaterThan(zoomBefore);

    // App destroy releases suppression and detaches the map listeners.
    emitter.emit("destroy");
    expect(driver.isActive.value).toBe(false);
    expect(map.off).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(map.off).toHaveBeenCalledWith("movestart", expect.any(Function));
    expect(setMapViewSuppressed).toHaveBeenLastCalledWith(
      expect.any(String),
      false,
    );
  });
});
