import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetPersistedStateForTests } from "@/resilience/persistedState";
import { hydrateRoutes } from "@/resilience/hydrators/routes.js";
import { hydrateOfflineRegions } from "@/resilience/hydrators/offlineRegions.js";
import { hydrateLocate } from "@/resilience/hydrators/locate.js";
import { hydrateNavigation } from "@/resilience/hydrators/navigation.js";
import { hydrateSync } from "@/resilience/hydrators/sync.js";
import { hydrateView } from "@/resilience/hydrators/view.js";

const TIMESTAMP = 1_700_000_000_000;

const v2Route = () => ({
  v: 2,
  id: "route-2",
  kind: "route",
  name: "Loop",
  gpxType: "rte",
  createdAt: null,
  source: { format: "gpx" },
  segments: [
    {
      points: [
        { lat: 1, lng: 2 },
        { lat: 3, lng: 4 },
      ],
    },
  ],
  waypoints: [],
  color: "#e74c3c",
});

const validRegion = () => ({
  id: "region-1",
  name: "Test Region",
  createdAt: TIMESTAMP,
  bounds: { west: -60, south: 45, east: -55, north: 50 },
  minZoom: 10,
  maxZoom: 11,
  tileCount: 12,
  estimatedBytes: 720000,
});

beforeEach(() => {
  __resetPersistedStateForTests();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  __resetPersistedStateForTests();
});

describe("routes hydrator", () => {
  it("migrates a legacy route array", () => {
    const result = hydrateRoutes([
      {
        id: "route-1",
        name: "Morning Loop",
        points: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      v: 2,
      id: "route-1",
      kind: "route",
      name: "Morning Loop",
      gpxType: "trk",
      createdAt: null,
      source: { format: "legacy" },
    });
    expect(result[0].segments[0].points).toHaveLength(2);
  });

  it("rejects a non-array top level", () => {
    expect(() => hydrateRoutes({})).toThrow();
    expect(() => hydrateRoutes(null)).toThrow();
  });

  it("drops invalid documents", () => {
    const result = hydrateRoutes([
      "junk",
      {},
      { id: "empty", points: [] },
      { id: "bad", points: [{ lat: 100, lng: 0 }] },
      v2Route(),
    ]);

    expect(result.map((route) => route.id)).toEqual(["route-2"]);
  });

  it("keeps the first document when ids collide", () => {
    const result = hydrateRoutes([
      { id: "same", name: "First", points: [{ lat: 1, lng: 2 }] },
      { id: "same", name: "Second", points: [{ lat: 3, lng: 4 }] },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("First");
  });

  it("passes a valid v2 route through with its fields intact", () => {
    const result = hydrateRoutes([v2Route()]);

    expect(result[0]).toMatchObject({
      v: 2,
      kind: "route",
      id: "route-2",
      name: "Loop",
      gpxType: "rte",
      color: "#e74c3c",
      source: { format: "gpx" },
    });
  });
});

describe("offline-regions hydrator", () => {
  it("drops malformed regions and keeps valid ones", () => {
    const result = hydrateOfflineRegions([
      null,
      "junk",
      { ...validRegion(), id: "" },
      { ...validRegion(), bounds: { west: 10, south: 0, east: -10, north: 1 } },
      { ...validRegion(), bounds: { west: -181, south: 0, east: 1, north: 1 } },
      { ...validRegion(), minZoom: 12, maxZoom: 11 },
      { ...validRegion(), tileCount: -1 },
      { ...validRegion(), estimatedBytes: -1 },
      { ...validRegion(), createdAt: "never" },
      { ...validRegion(), name: 42 },
      { ...validRegion(), name: "   " },
      validRegion(),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("region-1");
  });

  it("keeps the first region when ids collide", () => {
    const result = hydrateOfflineRegions([
      { ...validRegion(), id: "same", name: "First" },
      { ...validRegion(), id: "same", name: "Second" },
      { ...validRegion(), id: "other", name: "Other" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("First");
    expect(result[1].name).toBe("Other");
  });

  it("rejects a non-array top level", () => {
    expect(() => hydrateOfflineRegions({})).toThrow();
  });

  it("keeps every retained region safe for panel formatting", () => {
    const [region] = hydrateOfflineRegions([
      { ...validRegion(), tileCount: 3, estimatedBytes: 100 },
    ]);

    expect(typeof region.name).toBe("string");
    expect(region.tileCount.toLocaleString()).toBe("3");
    expect(Number.isNaN(new Date(region.createdAt).getTime())).toBe(false);
  });
});

describe("locate hydrator", () => {
  const validFix = () => ({
    lat: 48.953134,
    lng: -55.643057,
    accuracy: 8,
    heading: 90,
    at: TIMESTAMP,
  });

  const restored = (overrides = {}) => ({
    permissionGranted: true,
    mode: null,
    lastFix: null,
    ownerId: null,
    ...overrides,
  });

  it("coerces a usable permission flag", () => {
    expect(hydrateLocate({ permissionGranted: 1 })).toEqual(restored());
    expect(hydrateLocate({ permissionGranted: "true" })).toEqual(restored());
    expect(hydrateLocate({ permissionGranted: "yes" })).toEqual(
      restored({ permissionGranted: false }),
    );
    expect(hydrateLocate({})).toEqual(restored({ permissionGranted: false }));
  });

  it("round-trips a valid active session", () => {
    const state = restored({ mode: "active", lastFix: validFix() });

    expect(hydrateLocate(state)).toEqual(state);
  });

  it("round-trips a valid following session", () => {
    const state = restored({ mode: "following", lastFix: validFix() });

    expect(hydrateLocate(state)).toEqual(state);
  });

  it("adds a null owner id to version 2 data", () => {
    const result = hydrateLocate({
      permissionGranted: true,
      mode: "active",
      lastFix: validFix(),
    });

    expect(result.ownerId).toBeNull();
  });

  it("keeps a non-empty owner id and drops an invalid one", () => {
    const withOwner = restored({
      mode: "following",
      lastFix: validFix(),
      ownerId: "tab-1",
    });

    expect(hydrateLocate(withOwner)).toEqual(withOwner);
    expect(
      hydrateLocate({
        ...withOwner,
        ownerId: "   ",
      }).ownerId,
    ).toBeNull();
    expect(hydrateLocate({ ...withOwner, ownerId: 7 }).ownerId).toBeNull();
  });

  it("drops mode and fix from a legacy permission-only value", () => {
    expect(hydrateLocate({ permissionGranted: true })).toEqual(restored());
  });

  it("drops an invalid or error mode", () => {
    expect(
      hydrateLocate({
        permissionGranted: true,
        mode: "error",
        lastFix: validFix(),
      }),
    ).toEqual(restored());

    expect(
      hydrateLocate({
        permissionGranted: true,
        mode: "paused",
        lastFix: validFix(),
      }),
    ).toEqual(restored());
  });

  it("drops both values when the fix is missing or invalid", () => {
    expect(hydrateLocate({ permissionGranted: true, mode: "active" })).toEqual(
      restored(),
    );

    expect(
      hydrateLocate({
        permissionGranted: true,
        mode: "active",
        lastFix: { ...validFix(), lat: 91 },
      }),
    ).toEqual(restored());

    expect(
      hydrateLocate({
        permissionGranted: true,
        mode: "following",
        lastFix: { ...validFix(), accuracy: -1 },
      }),
    ).toEqual(restored());

    expect(
      hydrateLocate({
        permissionGranted: true,
        mode: "following",
        lastFix: { ...validFix(), at: 0 },
      }),
    ).toEqual(restored());
  });

  it("drops both values when a valid fix has no mode", () => {
    expect(
      hydrateLocate({
        permissionGranted: true,
        mode: null,
        lastFix: validFix(),
      }),
    ).toEqual(restored());
  });

  it("coerces a non-finite heading to null", () => {
    const result = hydrateLocate({
      permissionGranted: true,
      mode: "active",
      lastFix: { ...validFix(), heading: Number.POSITIVE_INFINITY },
    });

    expect(result.mode).toBe("active");
    expect(result.lastFix.heading).toBeNull();
  });

  it("rejects a non-object top level", () => {
    expect(() => hydrateLocate(null)).toThrow();
    expect(() => hydrateLocate([])).toThrow();
  });
});

describe("navigation hydrator", () => {
  it("round-trips valid navigation state", () => {
    const state = {
      routeId: "route-1",
      visible: ["route-1", "route-2"],
      followOwned: true,
      ownerId: "tab-1",
    };

    expect(hydrateNavigation(state)).toEqual(state);
  });

  it("normalises legacy and partial objects", () => {
    expect(hydrateNavigation({})).toEqual({
      routeId: null,
      visible: [],
      followOwned: false,
      ownerId: null,
    });
    expect(hydrateNavigation({ visible: ["route-1"] })).toEqual({
      routeId: null,
      visible: ["route-1"],
      followOwned: false,
      ownerId: null,
    });
    expect(
      hydrateNavigation({
        routeId: " route-1 ",
        visible: [" route-2 "],
        followOwned: true,
      }),
    ).toEqual({
      routeId: "route-1",
      visible: ["route-2", "route-1"],
      followOwned: true,
      ownerId: null,
    });
  });

  it("rejects a non-object top level", () => {
    expect(() => hydrateNavigation([])).toThrow();
    expect(() => hydrateNavigation(null)).toThrow();
    expect(() => hydrateNavigation("nope")).toThrow();
  });

  it("drops an empty or non-string route id", () => {
    expect(hydrateNavigation({ routeId: "   " }).routeId).toBeNull();
    expect(hydrateNavigation({ routeId: 7 }).routeId).toBeNull();
    expect(hydrateNavigation({ routeId: "r1" }).routeId).toBe("r1");
  });

  it("keeps only usable visible ids", () => {
    expect(
      hydrateNavigation({ visible: [" a ", 7, null, "", "b"] }).visible,
    ).toEqual(["a", "b"]);
  });

  it("dedupes visible ids preserving first-seen order", () => {
    expect(
      hydrateNavigation({ visible: ["b", "a", "b", " a "] }).visible,
    ).toEqual(["b", "a"]);
  });

  it("adds a navigated route missing from visible", () => {
    expect(hydrateNavigation({ routeId: "r1", visible: ["r2"] })).toEqual({
      routeId: "r1",
      visible: ["r2", "r1"],
      followOwned: false,
      ownerId: null,
    });
  });

  it("keeps a non-empty owner id only alongside a route", () => {
    expect(hydrateNavigation({ routeId: "r1", ownerId: "tab-1" }).ownerId).toBe(
      "tab-1",
    );
    expect(hydrateNavigation({ routeId: "r1", ownerId: "  " }).ownerId).toBe(
      null,
    );
    expect(hydrateNavigation({ routeId: "r1", ownerId: 7 }).ownerId).toBeNull();
    expect(hydrateNavigation({ ownerId: "tab-1" }).ownerId).toBeNull();
  });

  it("drops followOwned without a route", () => {
    const result = hydrateNavigation({ followOwned: true, visible: ["r1"] });

    expect(result.routeId).toBeNull();
    expect(result.followOwned).toBe(false);
    expect(result.visible).toEqual(["r1"]);
  });
});

describe("view hydrator", () => {
  const viewWithCentre = (centre) => ({
    mapView: { center: centre, zoom: 12, pitch: 0, bearing: 0 },
  });

  it("keeps a valid centre", () => {
    const result = hydrateView(
      viewWithCentre({ lat: 48.953134, lng: -55.643057 }),
    );

    expect(result.mapView.center).toEqual({
      lat: 48.953134,
      lng: -55.643057,
    });
  });

  it("nulls the centre for an out-of-range lng", () => {
    expect(
      hydrateView(viewWithCentre({ lat: 10, lng: 181 })).mapView.center,
    ).toBeNull();
    expect(
      hydrateView(viewWithCentre({ lat: 10, lng: -181 })).mapView.center,
    ).toBeNull();
  });

  it("nulls the centre for a non-finite lng", () => {
    expect(
      hydrateView(viewWithCentre({ lat: 10, lng: Number.POSITIVE_INFINITY }))
        .mapView.center,
    ).toBeNull();
    expect(
      hydrateView(viewWithCentre({ lat: 10, lng: Number.NaN })).mapView.center,
    ).toBeNull();
  });

  it("still nulls the centre for an out-of-range lat", () => {
    expect(
      hydrateView(viewWithCentre({ lat: 91, lng: 10 })).mapView.center,
    ).toBeNull();
    expect(
      hydrateView(viewWithCentre({ lat: -91, lng: 10 })).mapView.center,
    ).toBeNull();
  });
});

describe("sync hydrator", () => {
  it("repairs non-array queues and failed lists", () => {
    expect(hydrateSync({ queue: "nope", failed: null })).toEqual({
      queue: [],
      failed: [],
    });
  });

  it("keeps items with usable ids and drops the rest", () => {
    const result = hydrateSync({
      queue: [
        { id: "a", status: "pending" },
        { id: 7, status: "pending" },
        { id: "", status: "pending" },
        { status: "pending" },
        "junk",
      ],
      failed: [{ id: "b", lastError: null }],
    });

    expect(result.queue.map((item) => item.id)).toEqual(["a", 7]);
    expect(result.failed.map((item) => item.id)).toEqual(["b"]);
  });

  it("rejects a non-object top level", () => {
    expect(() => hydrateSync([])).toThrow();
    expect(() => hydrateSync(null)).toThrow();
  });
});
