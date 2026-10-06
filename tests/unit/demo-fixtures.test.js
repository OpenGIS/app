import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO } from "../fixtures/demo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GPX_PATH = join(HERE, "..", "fixtures", "route.gpx");

const collection = JSON.parse(readFileSync(DEMO.sourceFile, "utf8"));
const feature = collection.features.find(
  (entry) => entry.properties?.title === DEMO.day,
);
const longest = feature.geometry.coordinates.reduce((a, b) =>
  b.length > a.length ? b : a,
);

/** Whether a `{west, south, east, north}` box fully contains another. */
const containsBox = (outer, inner) =>
  inner.west >= outer.west &&
  inner.south >= outer.south &&
  inner.east <= outer.east &&
  inner.north <= outer.north;

/** Whether a `{lat, lng}` point sits inside a box. */
const containsPoint = (box, { lat, lng }) =>
  lng >= box.west && lng <= box.east && lat >= box.south && lat <= box.north;

/** Tight bounding box of `{lat, lng}` points. */
const bboxOf = (points) => ({
  west: Math.min(...points.map((point) => point.lng)),
  south: Math.min(...points.map((point) => point.lat)),
  east: Math.max(...points.map((point) => point.lng)),
  north: Math.max(...points.map((point) => point.lat)),
});

describe("DEMO — slice provenance", () => {
  it("is a contiguous excerpt of the Day 13 longest segment", () => {
    const rawKeys = longest.map(
      (point) => `${point[0]},${point[1]},${point[3]}`,
    );
    const sliceKeys = DEMO.slice.map(
      (point) => `${point.lng},${point.lat},${point.t}`,
    );

    const startIndex = rawKeys.indexOf(sliceKeys[0]);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(rawKeys.slice(startIndex, startIndex + sliceKeys.length)).toEqual(
      sliceKeys,
    );
  });

  it("starts at the first point of the feature", () => {
    const [lng, lat, , t] = feature.geometry.coordinates[0][0];
    expect(DEMO.start).toEqual({ lat, lng, t });
  });
});

describe("DEMO — geometry invariants", () => {
  it("keeps the slice bbox, offline region and route inside the bounds", () => {
    expect(containsBox(DEMO.bounds, DEMO.sliceBBox)).toBe(true);
    expect(containsBox(DEMO.bounds, DEMO.offlineRegion)).toBe(true);
    expect(containsBox(DEMO.bounds, bboxOf(DEMO.route))).toBe(true);
    for (const point of DEMO.route) {
      expect(containsPoint(DEMO.bounds, point)).toBe(true);
    }
  });

  it("places the centre inside the bounds and offline region", () => {
    expect(containsPoint(DEMO.bounds, DEMO.center)).toBe(true);
    expect(containsPoint(DEMO.offlineRegion, DEMO.center)).toBe(true);
  });

  it("orientates every box west<east and south<north", () => {
    for (const box of [DEMO.sliceBBox, DEMO.bounds, DEMO.offlineRegion]) {
      expect(box.west).toBeLessThan(box.east);
      expect(box.south).toBeLessThan(box.north);
    }
  });

  it("reports a positive slice distance and duration", () => {
    expect(DEMO.sliceDistance).toBeGreaterThan(0);
    expect(DEMO.sliceDuration).toBeGreaterThan(0);
    expect(DEMO.sliceDuration).toBe(DEMO.slice.at(-1).t - DEMO.slice[0].t);
  });

  it("gives every slice and route point numeric lat/lng/t", () => {
    for (const point of [...DEMO.slice, ...DEMO.route]) {
      expect(typeof point.lat).toBe("number");
      expect(typeof point.lng).toBe("number");
      expect(typeof point.t).toBe("number");
      expect(Number.isFinite(point.lat)).toBe(true);
      expect(Number.isFinite(point.lng)).toBe(true);
      expect(Number.isFinite(point.t)).toBe(true);
    }
  });
});

describe("DEMO — route.gpx", () => {
  it("has one trkpt per route point, all inside the bounds", () => {
    const gpx = readFileSync(GPX_PATH, "utf8");
    const matches = [
      ...gpx.matchAll(/<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"/g),
    ];
    expect(matches).toHaveLength(DEMO.route.length);
    for (const [, lat, lon] of matches) {
      expect(
        containsPoint(DEMO.bounds, { lat: Number(lat), lng: Number(lon) }),
      ).toBe(true);
    }
  });
});
