import { describe, it, expect } from "vitest";
import { totalDistance } from "@/utils/geo.js";
import {
  createTrackId,
  documentBounds,
  documentDistance,
  documentPointCount,
  documentPoints,
  fileSafeName,
  lineGeometry,
  migrateActiveRecording,
  migrateRecording,
  migrateRoute,
  normaliseElevation,
  normalisePoint,
  normaliseTime,
  normaliseWaypoint,
  sanitiseTrackDocument,
  waypointCount,
} from "@/utils/track/index.js";

describe("track model / migration", () => {
  it("migrates a legacy route to a v2 route document", () => {
    const doc = migrateRoute({
      id: "route-1",
      name: "Morning Loop",
      type: "rte",
      points: [{ lat: 51.5, lng: -0.1 }],
      distance: 1234,
    });

    expect(doc).toMatchObject({
      v: 2,
      id: "route-1",
      kind: "route",
      name: "Morning Loop",
      gpxType: "rte",
      source: { format: "legacy" },
      segments: [{ points: [{ lat: 51.5, lng: -0.1 }] }],
      waypoints: [],
    });
    expect(doc).not.toHaveProperty("distance");
  });

  it("returns an already-v2 route unchanged", () => {
    const v2 = {
      v: 2,
      id: "route-2",
      kind: "route",
      name: null,
      gpxType: "trk",
      createdAt: null,
      source: { format: "gpx" },
      segments: [],
      waypoints: [],
    };
    expect(migrateRoute(v2)).toBe(v2);
  });

  it("migrates a legacy saved recording", () => {
    const doc = migrateRecording({
      id: "rec-1",
      timestamp: 1_700_000_000_000,
      points: [{ lat: 1, lng: 2, t: 1_700_000_000_000 }],
      distance: 42,
      duration: 5000,
    });

    expect(doc).toMatchObject({
      v: 2,
      id: "rec-1",
      kind: "recording",
      gpxType: null,
      createdAt: 1_700_000_000_000,
      duration: 5000,
      source: { format: "legacy" },
      segments: [{ points: [{ lat: 1, lng: 2, t: 1_700_000_000_000 }] }],
      waypoints: [],
    });
    expect(doc).not.toHaveProperty("distance");
  });

  it("returns an already-v2 recording unchanged", () => {
    const v2 = {
      v: 2,
      id: "rec-2",
      kind: "recording",
      name: null,
      gpxType: null,
      createdAt: 1_700_000_000_000,
      source: { format: "gps" },
      segments: [{ points: [{ lat: 1, lng: 2, t: 1_700_000_000_000 }] }],
      waypoints: [],
      duration: 5000,
      color: "#3498db",
    };
    expect(migrateRecording(v2)).toBe(v2);
  });

  it("omits createdAt and duration when the legacy recording lacks them", () => {
    const doc = migrateRecording({ id: "rec-3", points: [] });

    expect(doc.createdAt).toBeNull();
    expect(doc).not.toHaveProperty("duration");
  });

  it("migrates the legacy active-recording shape", () => {
    const migrated = migrateActiveRecording({
      points: [{ lat: 1, lng: 2 }],
      startTime: 123,
    });

    expect(migrated).toEqual({
      createdAt: 123,
      segments: [{ points: [{ lat: 1, lng: 2 }] }],
    });
  });

  it("preserves a v2 active-recording shape", () => {
    const v2 = {
      segments: [{ points: [{ lat: 1, lng: 2 }] }],
      createdAt: 5,
    };
    expect(migrateActiveRecording(v2)).toBe(v2);
  });
});

describe("track model / sanitisation", () => {
  it("sanitises a v2 document, dropping invalid points and empty segments", () => {
    const doc = sanitiseTrackDocument(
      {
        v: 2,
        kind: "recording",
        createdAt: "not a number",
        duration: "long",
        source: [],
        segments: [
          {
            points: [
              { lat: 1, lng: 2 },
              { lat: 999, lng: 0 },
            ],
          },
          { points: [{ lat: 200, lng: 0 }] },
          { points: [{ lat: 3, lng: 4 }] },
          "junk",
        ],
        waypoints: [],
      },
      { kind: "recording" },
    );

    expect(doc.v).toBe(2);
    expect(doc.kind).toBe("recording");
    expect(typeof doc.id).toBe("string");
    expect(doc.createdAt).toBeNull();
    expect(doc.source).toEqual({});
    expect(doc).not.toHaveProperty("duration");
    expect(doc.segments).toHaveLength(2);
    expect(doc.segments[0].points).toEqual([{ lat: 1, lng: 2 }]);
    expect(doc.segments[1].points).toEqual([{ lat: 3, lng: 4 }]);
  });

  it("returns null when no usable points survive", () => {
    expect(
      sanitiseTrackDocument(
        { segments: [{ points: [] }, { points: [{ lat: 999, lng: 0 }] }] },
        { kind: "route" },
      ),
    ).toBeNull();
    expect(sanitiseTrackDocument("junk")).toBeNull();
  });

  it("keeps route metadata and normalises gpxType", () => {
    const doc = sanitiseTrackDocument(
      {
        v: 2,
        id: "r1",
        name: "  Loop  ",
        gpxType: "rte",
        color: "#e74c3c",
        source: { format: "gpx" },
        segments: [{ points: [{ lat: 1, lng: 2 }] }],
        waypoints: [],
      },
      { kind: "route" },
    );

    expect(doc).toMatchObject({
      v: 2,
      kind: "route",
      id: "r1",
      name: "Loop",
      gpxType: "rte",
      color: "#e74c3c",
      source: { format: "gpx" },
    });
  });

  it("normalises waypoints while preserving descriptive extras", () => {
    expect(
      normaliseWaypoint({
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
      }),
    ).toEqual({
      lat: 51.5,
      lng: -0.1,
      name: "Lookout",
      desc: "A view",
      cmt: "comment",
      sym: "Flag",
      type: "POI",
      links: [{ href: "https://example.com" }],
    });
    expect(normaliseWaypoint({ lat: 999, lng: 0 })).toBeNull();
  });
});

describe("track model / document helpers", () => {
  const doc = {
    v: 2,
    id: "d1",
    kind: "route",
    name: "Split",
    gpxType: "trk",
    createdAt: null,
    source: { format: "gpx" },
    segments: [
      {
        points: [
          { lat: 0, lng: 0 },
          { lat: 0, lng: 0.001 },
        ],
      },
      {
        points: [
          { lat: 0, lng: 10 },
          { lat: 0, lng: 10.001 },
        ],
      },
    ],
    waypoints: [{ lat: -15, lng: -5, name: "POI" }],
  };

  it("flattens segment points without waypoints", () => {
    expect(documentPoints(doc)).toHaveLength(4);
    expect(documentPointCount(doc)).toBe(4);
    expect(waypointCount(doc)).toBe(1);
  });

  it("sums distance within segments and never across the gap", () => {
    const expected =
      totalDistance(doc.segments[0].points) +
      totalDistance(doc.segments[1].points);

    expect(documentDistance(doc)).toBeCloseTo(expected, 6);
    expect(documentDistance(doc)).toBeLessThan(1000);
  });

  it("computes bounds across segments and waypoints", () => {
    expect(documentBounds(doc)).toEqual([
      [-5, -15],
      [10.001, 0],
    ]);
  });

  it("returns null bounds for an empty document", () => {
    expect(documentBounds({ segments: [], waypoints: [] })).toBeNull();
  });

  it("builds a LineString for one usable segment", () => {
    expect(
      lineGeometry({
        segments: [
          {
            points: [
              { lat: 1, lng: 2, ele: 3 },
              { lat: 4, lng: 5, ele: 6 },
            ],
          },
        ],
      }),
    ).toEqual({
      type: "LineString",
      coordinates: [
        [2, 1, 3],
        [5, 4, 6],
      ],
    });
  });

  it("builds a MultiLineString and drops unusable segments from geometry", () => {
    const geometry = lineGeometry({
      segments: [
        {
          points: [
            { lat: 1, lng: 2 },
            { lat: 3, lng: 4 },
          ],
        },
        { points: [{ lat: 5, lng: 6 }] },
        {
          points: [
            { lat: 7, lng: 8 },
            { lat: 9, lng: 10 },
          ],
        },
      ],
    });

    expect(geometry).toEqual({
      type: "MultiLineString",
      coordinates: [
        [
          [2, 1],
          [4, 3],
        ],
        [
          [8, 7],
          [10, 9],
        ],
      ],
    });
  });

  it("returns null geometry when no segment has two points", () => {
    expect(lineGeometry({ segments: [{ points: [{ lat: 1, lng: 2 }] }] })).toBe(
      null,
    );
  });
});

describe("track model / normalisers", () => {
  it("keeps valid elevations and discards sentinels", () => {
    expect(normaliseElevation(0)).toBe(0);
    expect(normaliseElevation(-20)).toBe(-20);
    expect(normaliseElevation("12.5")).toBe(12.5);
    expect(normaliseElevation(-9999)).toBeUndefined();
    expect(normaliseElevation(-19999)).toBeUndefined();
    expect(normaliseElevation(-32768)).toBeUndefined();
    expect(normaliseElevation(undefined)).toBeUndefined();
    expect(normaliseElevation("high")).toBeUndefined();
  });

  it("normalises times to epoch milliseconds", () => {
    expect(normaliseTime(new Date("2024-01-01T00:00:00Z"))).toBe(
      1_704_067_200_000,
    );
    expect(normaliseTime("2024-01-01T00:00:00Z")).toBe(1_704_067_200_000);
    expect(normaliseTime(1_704_067_200)).toBe(1_704_067_200_000);
    expect(normaliseTime(1_704_067_200_000)).toBe(1_704_067_200_000);
    expect(normaliseTime("not a time")).toBeUndefined();
    expect(normaliseTime(Number.NaN)).toBeUndefined();
  });

  it("normalises points and omits invalid optional values", () => {
    expect(
      normalisePoint({
        lat: "51.5",
        lng: "-0.1",
        ele: -9999,
        t: "2024-01-01T00:00:00Z",
      }),
    ).toEqual({ lat: 51.5, lng: -0.1, t: 1_704_067_200_000 });

    expect(normalisePoint({ lat: 91, lng: 0 })).toBeNull();
    expect(normalisePoint({ lat: 0, lng: 181 })).toBeNull();
    expect(normalisePoint({ lat: null, lng: 0 })).toBeNull();
    expect(normalisePoint(null)).toBeNull();
  });

  it("sanitises download filenames", () => {
    expect(fileSafeName("Trail: Day 1/2", "route-1")).toBe("Trail Day 12");
    expect(fileSafeName("  bad<>name?  ", "fallback")).toBe("badname");
    expect(fileSafeName("", "route-1")).toBe("route-1");
    expect(fileSafeName(null, "fallback")).toBe("fallback");
  });

  it("creates distinct string ids", () => {
    const first = createTrackId();
    const second = createTrackId();
    expect(typeof first).toBe("string");
    expect(first).not.toBe(second);
  });
});
