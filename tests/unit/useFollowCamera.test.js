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
import { navigationZoomForSpeed } from "@/utils/follow.js";
import { followCameraDefaults } from "@/defaults/maplibre.js";
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
  dom = false,
} = {}) => {
  const handlers = new Map();
  let canvasEl = null;
  let containerEl = null;

  if (dom) {
    containerEl = document.createElement("div");
    canvasEl = document.createElement("canvas");
    containerEl.appendChild(canvasEl);
    document.body.appendChild(containerEl);
    Object.defineProperty(canvasEl, "clientWidth", { value: width });
    Object.defineProperty(canvasEl, "clientHeight", { value: height });
  }

  const map = {
    stop: vi.fn(),
    getCenter: vi.fn(() => ({ ...center })),
    getBearing: vi.fn(() => bearing),
    getPitch: vi.fn(() => pitch),
    getZoom: vi.fn(() => zoom),
    getMinZoom: vi.fn(() => 1),
    getMaxZoom: vi.fn(() => 22),
    getCanvas: vi.fn(
      () => canvasEl ?? { clientWidth: width, clientHeight: height },
    ),
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

  if (dom) {
    map.getCanvasContainer = vi.fn(() => containerEl);
    map.canvasEl = canvasEl;
    map.containerEl = containerEl;
    // Dispatch a DOM event at the canvas, so the capture-phase listener on the
    // container sees it exactly as it would in the browser.
    map.send = (type, props = {}) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, props);
      canvasEl.dispatchEvent(event);
      return event;
    };
  }

  return map;
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
  document.body.replaceChildren();
});

// ─── Target -> pose mapping ──────────────────────────────────────────────────

describe("useFollowCamera / target -> pose", () => {
  it("passes an explicit bearing, pitch and zoom straight through", () => {
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 123, pitch: 20, zoom: 14 });
    flushFrame();

    const jump = lastJump(map);
    expect(jump.bearing).toBeCloseTo(123, 6);
    // An explicit pitch is authoritative: it is neither floored at the rest
    // pitch nor derived from speed.
    expect(jump.pitch).toBeCloseTo(20, 6);
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

  it("derives a third-person navigation pose at rest", () => {
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
    expect(jump.pitch).toBeCloseTo(followCameraDefaults.restPitch, 3);
    expect(jump.zoom).toBeCloseTo(followCameraDefaults.restZoom, 6);
  });

  it.each([
    [5, 45],
    [15, 45],
    [30, 50],
  ])(
    "maps %s km/h to a %s° pitch, flooring the speed curve at rest",
    (speedKmh, expectedPitch) => {
      const map = createMap({ width: 1000, height: 800 });
      getMapInstance.mockReturnValue(map);
      const driver = useFollowCamera(nextInstanceId());

      driver.start();
      driver.setTarget({
        lat: 45,
        lng: -60,
        compassHeading: 90,
        speedKmh,
        timestampMs: 0,
      });
      flushFrame();

      expect(lastJump(map).pitch).toBeCloseTo(expectedPitch, 3);
    },
  );

  it("clamps the derived pitch to the map's pitch range", () => {
    const map = createMap({ width: 1000, height: 800 });
    map.getMinPitch = vi.fn(() => 0);
    map.getMaxPitch = vi.fn(() => 40);
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({
      lat: 45,
      lng: -60,
      compassHeading: 90,
      speedKmh: 100,
      timestampMs: 0,
    });
    flushFrame();

    expect(lastJump(map).pitch).toBeCloseTo(40, 3);
  });

  it("tilts, pulls back the navigation zoom and follows the course at speed", () => {
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
    expect(jump.zoom).toBeCloseTo(
      followCameraDefaults.restZoom - followCameraDefaults.zoomPullBack,
      6,
    );
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

  it("settles in wall-clock time when frames are seconds apart", () => {
    // A slow renderer (software rasterisation): the interval between frames is
    // seconds, and the damping must still converge over that real elapsed time
    // rather than being throttled by a capped per-frame step. The initial
    // hand-off is already snapped here (reduced motion) so this isolates the
    // damping path from the hand-off glide.
    const map = createMap();
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 0, pitch: 0, zoom: 12 });
    flushFrame(); // attach frame: dt is 0 by construction

    reducedMotion = false;
    driver.setTarget({ lat: 45, lng: -60, bearing: 90, pitch: 60, zoom: 12 });
    flushFrame(4000); // one real frame, four seconds later

    const jump = lastJump(map);
    expect(jump.pitch).toBeGreaterThan(59.5);
    expect(Math.abs(jump.bearing - 90)).toBeLessThan(1);
  });
});

// ─── Hand-off ────────────────────────────────────────────────────────────────

describe("useFollowCamera / hand-off", () => {
  it("glides from the wide locate pose into the navigation pose without a jump", () => {
    reducedMotion = false;
    const startZoom = 11.65;
    const map = createMap({ zoom: startZoom, bearing: 0, pitch: 0 });
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

    let previousZoom = startZoom;
    let previousPitch = 0;
    let frames = 0;
    while (previousZoom < followCameraDefaults.restZoom - 1e-6) {
      flushFrame();
      const jump = lastJump(map);
      const zoom = jump.zoom;
      const step = zoom - previousZoom;
      expect(step).toBeGreaterThanOrEqual(-1e-9);
      expect(step).toBeLessThanOrEqual(
        followCameraDefaults.handoffMaxZoomStep + 1e-9,
      );
      expect(zoom).toBeLessThanOrEqual(followCameraDefaults.restZoom + 1e-9);
      // The same eased progress drives pitch, so a 45° tilt cannot jump-cut.
      const pitchStep = jump.pitch - previousPitch;
      expect(pitchStep).toBeGreaterThanOrEqual(-1e-9);
      expect(pitchStep).toBeLessThanOrEqual(5 + 1e-9);
      previousZoom = zoom;
      previousPitch = jump.pitch;
      frames += 1;
      expect(frames).toBeLessThan(400);
    }

    const jump = lastJump(map);
    expect(jump.zoom).toBeCloseTo(followCameraDefaults.restZoom, 6);
    expect(jump.bearing).toBeCloseTo(90, 6);
    expect(jump.pitch).toBeCloseTo(followCameraDefaults.restPitch, 6);
  });

  it("snaps into the navigation pose under reduced motion", () => {
    const map = createMap({ zoom: 11.65, bearing: 0, pitch: 0 });
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
    expect(jump.zoom).toBeCloseTo(followCameraDefaults.restZoom, 6);
    expect(jump.bearing).toBeCloseTo(90, 6);
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

  it("suspends on every user-gesture movement event", () => {
    for (const type of [
      "movestart",
      "dragstart",
      "zoomstart",
      "rotatestart",
      "pitchstart",
      "boxzoomstart",
      "move",
      "moveend",
    ]) {
      const map = createMap();
      getMapInstance.mockReturnValue(map);
      const driver = useFollowCamera(nextInstanceId());

      driver.start();
      driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
      flushFrame();

      map.fire(type, { originalEvent: {} });
      expect(vi.getTimerCount(), `${type} should arm the idle timer`).toBe(1);

      driver.stop();
    }
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

  it("suspends on pointerdown without arming the idle timer", () => {
    const map = createMap({ dom: true });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();
    const jumpsBefore = map.jumpTo.mock.calls.length;
    expect(rafCallbacks.size).toBeGreaterThan(0);

    map.send("pointerdown", { button: 0, pointerId: 1, isPrimary: true });

    // The loop is cancelled before MapLibre's gesture handlers run, and the
    // idle timer waits for pointerup so it cannot fire mid-drag.
    expect(rafCallbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // New fixes while the pointer is held must not move the camera.
    driver.setTarget({ lat: 46, lng: -61, bearing: 200, pitch: 0, zoom: 12 });
    flushFrame();
    expect(map.jumpTo.mock.calls.length).toBe(jumpsBefore);
  });

  it("resumes immediately on pointerup without movement", () => {
    const map = createMap({ dom: true });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();

    map.send("pointerdown", { button: 0, pointerId: 1, isPrimary: true });
    map.send("pointerup", { button: 0, pointerId: 1, isPrimary: true });

    expect(vi.getTimerCount()).toBe(0);
    expect(rafCallbacks.size).toBeGreaterThan(0);

    driver.setTarget({ lat: 45, lng: -60, bearing: 200, pitch: 0, zoom: 12 });
    flushFrame();
    expect(lastJump(map).bearing).toBeCloseTo(200, 3);
  });

  it("arms the idle timer on pointerup after movement and resumes after it", () => {
    const map = createMap({ dom: true });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();

    map.send("pointerdown", { button: 0, pointerId: 1, isPrimary: true });
    // A user-originated movement event marks the gesture as camera-changing,
    // but a held pointer never arms the timer.
    map.fire("movestart", { originalEvent: {} });
    expect(vi.getTimerCount()).toBe(0);

    map.send("pointerup", { button: 0, pointerId: 1, isPrimary: true });
    expect(vi.getTimerCount()).toBe(1);

    driver.setTarget({ lat: 45, lng: -60, bearing: 200, pitch: 0, zoom: 12 });
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
    flushFrame();
    expect(lastJump(map).bearing).toBeCloseTo(200, 3);
  });

  it("suspends on wheel, camera keys and double click, resetting the timer", () => {
    const map = createMap({ dom: true });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();

    // Non-camera keys and modifier chords are browser shortcuts, not gestures.
    map.send("keydown", { key: "a" });
    map.send("keydown", { key: "ArrowLeft", metaKey: true });
    expect(vi.getTimerCount()).toBe(0);

    map.send("wheel", {});
    expect(vi.getTimerCount()).toBe(1);
    expect(rafCallbacks.size).toBe(0);

    vi.advanceTimersByTime(4000);
    map.send("keydown", { key: "ArrowLeft" });
    vi.advanceTimersByTime(4000);
    expect(vi.getTimerCount()).toBe(1);

    map.send("dblclick", {});
    vi.advanceTimersByTime(4000);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1000); // 5 s after the last gesture
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-suspends on a second pointerdown during the resume glide", () => {
    reducedMotion = false;
    const map = createMap({ dom: true });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();

    map.fire("movestart", { originalEvent: {} });
    vi.advanceTimersByTime(5000);
    flushFrame();
    expect(rafCallbacks.size).toBeGreaterThan(0);

    map.send("pointerdown", { button: 0, pointerId: 1, isPrimary: true });
    expect(rafCallbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes every DOM listener on stop", () => {
    const map = createMap({ dom: true });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());
    const addSpy = vi.spyOn(map.containerEl, "addEventListener");
    const removeSpy = vi.spyOn(map.containerEl, "removeEventListener");
    const windowRemoveSpy = vi.spyOn(window, "removeEventListener");

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();

    const types = addSpy.mock.calls.map(([type]) => type);
    expect(types).toEqual(
      expect.arrayContaining([
        "pointerdown",
        "pointerup",
        "pointercancel",
        "wheel",
        "keydown",
        "dblclick",
        "touchstart",
      ]),
    );
    expect(
      addSpy.mock.calls.every(([, , options]) => options?.capture === true),
    ).toBe(true);

    driver.stop();

    for (const type of types) {
      expect(removeSpy).toHaveBeenCalledWith(
        type,
        expect.any(Function),
        expect.objectContaining({ capture: true }),
      );
    }
    // The window-level release fallback is removed too.
    expect(windowRemoveSpy).toHaveBeenCalledWith(
      "pointerup",
      expect.any(Function),
      expect.objectContaining({ capture: true }),
    );

    // A pointerdown after stop does nothing: the listeners are gone.
    map.send("pointerdown", { button: 0, pointerId: 1, isPrimary: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(rafCallbacks.size).toBe(0);
  });

  it("detaches DOM listeners and cancels cleanly on app destroy", () => {
    const map = createMap({ dom: true });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({ lat: 45, lng: -60, bearing: 10, pitch: 0, zoom: 12 });
    flushFrame();
    const removeSpy = vi.spyOn(map.containerEl, "removeEventListener");

    emitter.emit("destroy");

    expect(driver.isActive.value).toBe(false);
    expect(removeSpy).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
      expect.objectContaining({ capture: true }),
    );
    // Teardown never persists.
    expect(persistMapView).not.toHaveBeenCalled();
  });

  it("recomputes the look-ahead on resize and detaches listeners on destroy", () => {
    const map = createMap({ width: 1000, height: 800 });
    getMapInstance.mockReturnValue(map);
    const driver = useFollowCamera(nextInstanceId());

    driver.start();
    driver.setTarget({
      lat: 45,
      lng: -60,
      compassHeading: 0,
      speedKmh: 100,
      timestampMs: 0,
    });
    flushFrame();
    const before = lastJump(map);

    // The viewport grows; the navigation zoom is viewport-independent, but the
    // look-ahead must be recomputed against the taller canvas.
    map.getCanvas.mockReturnValue({ clientWidth: 2000, clientHeight: 1600 });
    map.fire("resize", {});
    flushFrame();
    const after = lastJump(map);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    expect(after.zoom).toBeCloseTo(
      followCameraDefaults.restZoom - followCameraDefaults.zoomPullBack,
      6,
    );
    expect(after.center[1] - before.center[1]).toBeGreaterThan(0.001);

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
