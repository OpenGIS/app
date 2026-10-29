import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPersistedStateForTests,
  usePersistedState,
} from "@/resilience/persistedState";
import {
  hydrateRecordingActive,
  hydrateRecordings,
  migrateRecordingsSession,
} from "@/resilience/hydrators/recordings.js";
import { hydrateRoutes } from "@/resilience/hydrators/routes.js";
import { hydrateOfflineRegions } from "@/resilience/hydrators/offlineRegions.js";
import { hydrateLocate } from "@/resilience/hydrators/locate.js";
import { hydrateNavigation } from "@/resilience/hydrators/navigation.js";
import { hydrateSync } from "@/resilience/hydrators/sync.js";
import { hydrateView } from "@/resilience/hydrators/view.js";

const envelope = (data, version = 1) =>
  JSON.stringify({ __ogisState: 1, version, data });

const TIMESTAMP = 1_700_000_000_000;

const legacyRecording = () => ({
  id: "rec-1",
  timestamp: TIMESTAMP,
  duration: 5000,
  distance: 42,
  points: [
    { lat: 1, lng: 2, t: TIMESTAMP },
    { lat: 3, lng: 4 },
    { lat: 999, lng: 0 },
  ],
});

const v2Recording = () => ({
  v: 2,
  id: "rec-2",
  kind: "recording",
  name: "Morning",
  gpxType: null,
  createdAt: TIMESTAMP,
  source: { format: "gps" },
  segments: [
    {
      points: [
        { lat: 1, lng: 2 },
        { lat: 3, lng: 4 },
      ],
    },
  ],
  waypoints: [],
  duration: 1000,
  color: "#3498db",
});

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

describe("recordings hydrator", () => {
  it("migrates a legacy saved/active value and ignores the active document", () => {
    const active = {
      points: [
        { lat: 5, lng: 6 },
        { lat: 7, lng: 8 },
      ],
      startTime: TIMESTAMP,
    };

    const result = hydrateRecordings({
      saved: [legacyRecording()],
      active,
    });

    expect(result).toEqual({ saved: expect.any(Array) });
    expect(result.saved).toHaveLength(1);
    expect(result.saved[0]).toMatchObject({
      v: 2,
      kind: "recording",
      id: "rec-1",
      name: null,
      gpxType: null,
      createdAt: TIMESTAMP,
      duration: 5000,
      source: { format: "legacy" },
    });
    expect(result.saved[0].segments[0].points).toEqual([
      { lat: 1, lng: 2, t: TIMESTAMP },
      { lat: 3, lng: 4 },
    ]);
  });

  it("rejects an uninterpretable top level", () => {
    expect(() => hydrateRecordings("nope")).toThrow();
    expect(() => hydrateRecordings(null)).toThrow();
    expect(() => hydrateRecordings([])).toThrow();
  });

  it("rejects a non-array saved list", () => {
    expect(() => hydrateRecordings({ saved: "nope" })).toThrow();
  });

  it("drops invalid and empty saved documents", () => {
    const result = hydrateRecordings({
      saved: [
        "junk",
        {},
        { id: "empty", points: [] },
        { id: "bad-points", points: [{ lat: 999, lng: 0 }] },
        legacyRecording(),
      ],
      active: null,
    });

    expect(result.saved.map((doc) => doc.id)).toEqual(["rec-1"]);
  });

  it("keeps the first document when saved recording ids collide", () => {
    const result = hydrateRecordings({
      saved: [
        { ...v2Recording(), id: "same", name: "First" },
        { ...v2Recording(), id: "same", name: "Second" },
      ],
      active: null,
    });

    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].name).toBe("First");
  });

  it("preserves waypoint extras and strips invalid optional values", () => {
    const result = hydrateRecordings({
      saved: [
        {
          ...v2Recording(),
          waypoints: [
            {
              lat: "51.5",
              lng: "-0.1",
              ele: -9999,
              t: "not a time",
              name: "Lookout",
              desc: "A view",
              cmt: "comment",
              sym: "Flag",
              type: "POI",
              links: [{ href: "https://example.com" }],
            },
          ],
        },
      ],
      active: null,
    });

    expect(result.saved[0].waypoints).toEqual([
      {
        lat: 51.5,
        lng: -0.1,
        name: "Lookout",
        desc: "A view",
        cmt: "comment",
        sym: "Flag",
        type: "POI",
        links: [{ href: "https://example.com" }],
      },
    ]);
  });

  it("passes a valid v2 document through with its fields intact", () => {
    const [doc] = hydrateRecordings({
      saved: [v2Recording()],
      active: null,
    }).saved;

    expect(doc).toMatchObject({
      v: 2,
      kind: "recording",
      id: "rec-2",
      name: "Morning",
      createdAt: TIMESTAMP,
      duration: 1000,
      color: "#3498db",
      source: { format: "gps" },
    });
    expect(doc.segments[0].points).toHaveLength(2);
  });

  it("hydrates an envelope v1 value through the primitive", () => {
    localStorage.setItem(
      "ogis_recordings_hydrator-envelope",
      envelope({ saved: [v2Recording()], active: null }),
    );

    const store = usePersistedState(
      "recordings",
      {
        version: 2,
        defaults: { saved: [] },
        hydrate: hydrateRecordings,
      },
      "hydrator-envelope",
    );

    expect(store.state.saved).toHaveLength(1);
    expect(store.state.saved[0].id).toBe("rec-2");
  });

  it("falls back to defaults and quarantines invalid stored data", () => {
    const raw = JSON.stringify({ saved: "nope" });
    localStorage.setItem("ogis_recordings_hydrator-bad", raw);

    const store = usePersistedState(
      "recordings",
      {
        version: 2,
        defaults: { saved: [] },
        hydrate: hydrateRecordings,
      },
      "hydrator-bad",
    );

    expect(store.state).toEqual({ saved: [] });
    expect(
      localStorage.getItem("ogis_quarantine_recordings_hydrator-bad"),
    ).toBe(raw);
  });
});

describe("recording active hydrator", () => {
  const legacyActive = () => ({
    points: [
      { lat: 5, lng: 6 },
      { lat: 7, lng: 8 },
    ],
    startTime: TIMESTAMP,
  });

  it("migrates a legacy active recording", () => {
    const result = hydrateRecordingActive({ active: legacyActive() });

    expect(result.active).toMatchObject({
      v: 2,
      kind: "recording",
      createdAt: TIMESTAMP,
    });
    expect(result.active.segments[0].points).toHaveLength(2);
  });

  it("passes a valid v2 active document through", () => {
    const result = hydrateRecordingActive({ active: v2Recording() });

    expect(result.active).toMatchObject({
      v: 2,
      kind: "recording",
      id: "rec-2",
      name: "Morning",
      createdAt: TIMESTAMP,
    });
    expect(result.active.segments[0].points).toHaveLength(2);
  });

  it("returns null for a missing or null active value", () => {
    expect(hydrateRecordingActive({ active: null })).toEqual({ active: null });
    expect(hydrateRecordingActive({})).toEqual({ active: null });
  });

  it("returns null when the active document has fewer than two points", () => {
    expect(hydrateRecordingActive({ active: { points: [] } })).toEqual({
      active: null,
    });
    expect(
      hydrateRecordingActive({ active: { points: [{ lat: 1, lng: 2 }] } }),
    ).toEqual({ active: null });
    expect(hydrateRecordingActive({ active: { points: "nope" } })).toEqual({
      active: null,
    });
  });

  it("returns null for a malformed active document", () => {
    expect(hydrateRecordingActive({ active: "junk" })).toEqual({
      active: null,
    });
    expect(hydrateRecordingActive({ active: {} })).toEqual({ active: null });
  });

  it("rejects a non-object top level", () => {
    expect(() => hydrateRecordingActive(null)).toThrow();
    expect(() => hydrateRecordingActive([])).toThrow();
    expect(() => hydrateRecordingActive("nope")).toThrow();
  });
});

describe("migrateRecordingsSession", () => {
  const saved = () => [{ id: "rec-1", points: [{ lat: 1, lng: 2 }] }];
  const active = () => ({
    points: [
      { lat: 5, lng: 6 },
      { lat: 7, lng: 8 },
    ],
    startTime: TIMESTAMP,
  });

  it("moves active to session and rewrites local as saved-only", () => {
    const activeDoc = active();
    localStorage.setItem(
      "ogis_recordings_migrate-legacy",
      JSON.stringify({ saved: saved(), active: activeDoc }),
    );

    expect(migrateRecordingsSession("migrate-legacy")).toBe(true);
    expect(
      JSON.parse(
        sessionStorage.getItem("ogis_recording-active_migrate-legacy"),
      ),
    ).toEqual({ active: activeDoc });
    expect(
      JSON.parse(localStorage.getItem("ogis_recordings_migrate-legacy")),
    ).toEqual({ saved: saved() });
  });

  it("unwraps an envelope input", () => {
    localStorage.setItem(
      "ogis_recordings_migrate-envelope",
      envelope({ saved: saved(), active: active() }, 1),
    );

    expect(migrateRecordingsSession("migrate-envelope")).toBe(true);
    expect(
      JSON.parse(
        sessionStorage.getItem("ogis_recording-active_migrate-envelope"),
      ),
    ).toEqual({ active: active() });
    expect(
      JSON.parse(localStorage.getItem("ogis_recordings_migrate-envelope")),
    ).toEqual({ saved: saved() });
  });

  it("keeps an existing session value and still strips local active", () => {
    localStorage.setItem(
      "ogis_recordings_migrate-both",
      JSON.stringify({ saved: saved(), active: active() }),
    );
    sessionStorage.setItem(
      "ogis_recording-active_migrate-both",
      JSON.stringify({ active: { kept: true } }),
    );

    expect(migrateRecordingsSession("migrate-both")).toBe(true);
    expect(
      JSON.parse(sessionStorage.getItem("ogis_recording-active_migrate-both")),
    ).toEqual({ active: { kept: true } });
    expect(
      JSON.parse(localStorage.getItem("ogis_recordings_migrate-both")),
    ).toEqual({ saved: saved() });
  });

  it("leaves malformed or non-object values untouched", () => {
    for (const [id, raw] of [
      ["migrate-bad-json", "not-json"],
      ["migrate-array", JSON.stringify([1, 2])],
      ["migrate-null", "null"],
    ]) {
      localStorage.setItem(`ogis_recordings_${id}`, raw);
      expect(migrateRecordingsSession(id)).toBe(false);
      expect(localStorage.getItem(`ogis_recordings_${id}`)).toBe(raw);
      expect(sessionStorage.getItem(`ogis_recording-active_${id}`)).toBeNull();
    }
  });

  it("leaves the local value untouched when the session write fails", () => {
    const activeDoc = active();
    const raw = JSON.stringify({ saved: saved(), active: activeDoc });
    localStorage.setItem("ogis_recordings_migrate-set-fails", raw);

    const setItem = vi
      .spyOn(sessionStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("session storage unavailable");
      });

    try {
      expect(migrateRecordingsSession("migrate-set-fails")).toBe(false);
    } finally {
      setItem.mockRestore();
    }

    expect(localStorage.getItem("ogis_recordings_migrate-set-fails")).toBe(raw);
    expect(
      JSON.parse(localStorage.getItem("ogis_recordings_migrate-set-fails")),
    ).toEqual({ saved: saved(), active: activeDoc });
    expect(
      sessionStorage.getItem("ogis_recording-active_migrate-set-fails"),
    ).toBeNull();
  });

  it("leaves a value without an active property untouched", () => {
    const raw = JSON.stringify({ saved: saved() });
    localStorage.setItem("ogis_recordings_migrate-saved-only", raw);

    expect(migrateRecordingsSession("migrate-saved-only")).toBe(false);
    expect(localStorage.getItem("ogis_recordings_migrate-saved-only")).toBe(
      raw,
    );
    expect(
      sessionStorage.getItem("ogis_recording-active_migrate-saved-only"),
    ).toBeNull();
  });

  it("is a no-op when there is no local value", () => {
    expect(migrateRecordingsSession("migrate-absent")).toBe(false);
  });
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
    };

    expect(hydrateNavigation(state)).toEqual(state);
  });

  it("normalises legacy and partial objects", () => {
    expect(hydrateNavigation({})).toEqual({
      routeId: null,
      visible: [],
      followOwned: false,
    });
    expect(hydrateNavigation({ visible: ["route-1"] })).toEqual({
      routeId: null,
      visible: ["route-1"],
      followOwned: false,
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
    });
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
