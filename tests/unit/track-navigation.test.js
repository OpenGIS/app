import { describe, it, expect } from "vitest";
import {
  geodesicLine,
  ON_ROUTE_METRES,
  nearestPointOnTrack,
} from "@/utils/track/index.js";

const track = (...segments) => ({
  v: 2,
  segments: segments.map((points) => ({ points })),
});

describe("track navigation / nearest point", () => {
  it("projects onto the middle of an east-west line near the equator", () => {
    const doc = track([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1 },
    ]);

    const result = nearestPointOnTrack(doc, { lat: 0.001, lng: 0.05 });

    expect(result).not.toBeNull();
    expect(result.point.lat).toBeCloseTo(0, 6);
    expect(result.point.lng).toBeCloseTo(0.05, 6);
    expect(result.distance).toBeCloseTo(111.19, 1);
    expect(result.bearing).toBeCloseTo(180, 0);
    expect(result.segmentIndex).toBe(0);
    expect(result.pointIndex).toBe(0);
  });

  it("clamps to the nearest endpoint beyond a segment end", () => {
    const doc = track([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1 },
    ]);

    const result = nearestPointOnTrack(doc, { lat: 0, lng: 0.2 });

    expect(result.point.lat).toBeCloseTo(0, 6);
    expect(result.point.lng).toBeCloseTo(0.1, 6);
    expect(result.distance).toBeGreaterThan(11_000);
    expect(result.distance).toBeLessThan(11_300);
    expect(result.pointIndex).toBe(0);
  });

  it("never bridges the gap between segments", () => {
    const doc = track(
      [
        { lat: 0, lng: -0.01 },
        { lat: 0, lng: 0 },
      ],
      [
        { lat: 0, lng: 0.03 },
        { lat: 0.01, lng: 0.03 },
      ],
    );

    const result = nearestPointOnTrack(doc, { lat: 0.001, lng: 0.005 });

    expect(result.distance).toBeGreaterThan(500);
    expect(result.distance).toBeLessThan(650);
    expect(result.segmentIndex).toBe(0);
    expect(result.pointIndex).toBe(0);
    expect(result.point.lat).toBeCloseTo(0, 6);
    expect(result.point.lng).toBeCloseTo(0, 6);
  });

  it("handles a segment crossing the antimeridian", () => {
    const doc = track([
      { lat: 0, lng: 179.9 },
      { lat: 0, lng: -179.9 },
    ]);

    const result = nearestPointOnTrack(doc, { lat: 0, lng: 180 });

    expect(result.distance).toBeLessThan(1);
    expect(Math.abs(Math.abs(result.point.lng) - 180)).toBeLessThan(1e-6);
    expect(result.segmentIndex).toBe(0);
    expect(result.pointIndex).toBe(0);
  });

  it("treats a zero-length pair as its endpoint", () => {
    const doc = track([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
    ]);

    const result = nearestPointOnTrack(doc, { lat: 0, lng: 0.001 });

    expect(result.point.lat).toBeCloseTo(0, 6);
    expect(result.point.lng).toBeCloseTo(0, 6);
    expect(result.distance).toBeCloseTo(111.19, 1);
    expect(result.bearing).toBeCloseTo(270, 0);
    expect(result.pointIndex).toBe(0);
  });

  it("skips invalid points and pairs the remaining valid ones", () => {
    const doc = track([
      null,
      { lat: 0, lng: 0 },
      { lat: "nope", lng: 2 },
      { lat: 0, lng: 0.02 },
    ]);

    const result = nearestPointOnTrack(doc, { lat: 0.001, lng: 0.01 });

    expect(result.point.lat).toBeCloseTo(0, 6);
    expect(result.point.lng).toBeCloseTo(0.01, 6);
    expect(result.distance).toBeCloseTo(111.19, 1);
    expect(result.pointIndex).toBe(1);
  });

  it("returns null for missing or invalid documents", () => {
    expect(nearestPointOnTrack(null, { lat: 0, lng: 0 })).toBeNull();
    expect(nearestPointOnTrack({}, { lat: 0, lng: 0 })).toBeNull();
    expect(
      nearestPointOnTrack({ segments: "nope" }, { lat: 0, lng: 0 }),
    ).toBeNull();
    expect(
      nearestPointOnTrack({ segments: [] }, { lat: 0, lng: 0 }),
    ).toBeNull();
    expect(nearestPointOnTrack(track([]), { lat: 0, lng: 0 })).toBeNull();
  });

  it("returns null for missing or invalid positions", () => {
    const doc = track([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1 },
    ]);

    expect(nearestPointOnTrack(doc, null)).toBeNull();
    expect(nearestPointOnTrack(doc, {})).toBeNull();
    expect(nearestPointOnTrack(doc, { lat: 91, lng: 0 })).toBeNull();
    expect(nearestPointOnTrack(doc, { lat: "north", lng: 0 })).toBeNull();
  });

  it("reports a large distance and sensible bearing far from the track", () => {
    const doc = track([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1 },
    ]);

    const result = nearestPointOnTrack(doc, { lat: 18, lng: 0.05 });

    expect(result.distance).toBeGreaterThan(1_900_000);
    expect(result.distance).toBeLessThan(2_100_000);
    expect(result.bearing).toBeGreaterThan(175);
    expect(result.bearing).toBeLessThan(185);
  });

  it("returns cardinal bearings from the user to the nearest point", () => {
    const east = track([
      { lat: 0, lng: 0.001 },
      { lat: 0, lng: 0.002 },
    ]);
    const north = track([
      { lat: 0.001, lng: 0 },
      { lat: 0.002, lng: 0 },
    ]);

    expect(nearestPointOnTrack(east, { lat: 0, lng: 0 }).bearing).toBeCloseTo(
      90,
      0,
    );
    const northBearing = nearestPointOnTrack(north, {
      lat: 0,
      lng: 0,
    }).bearing;
    expect(Math.min(northBearing, 360 - northBearing)).toBeLessThan(1);
  });

  it("returns a bare point with the chosen pair indices", () => {
    const doc = track(
      [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.01 },
      ],
      [
        { lat: 1, lng: 1, ele: 10, t: 1_700_000_000 },
        { lat: 1, lng: 1.01, ele: 11, t: 1_700_000_001 },
      ],
    );

    const result = nearestPointOnTrack(doc, { lat: 1.001, lng: 1.005 });

    expect(Object.keys(result.point).sort()).toEqual(["lat", "lng"]);
    expect(result.segmentIndex).toBe(1);
    expect(result.pointIndex).toBe(0);
  });

  it("exposes the on-route threshold", () => {
    expect(ON_ROUTE_METRES).toBe(5);
  });
});

describe("track navigation / geodesic line", () => {
  it("returns [lng, lat] endpoints for a short line", () => {
    const line = geodesicLine(
      { lat: 10, lng: 20 },
      { lat: 12, lng: 22 },
      { maxStepMetres: 1_000_000 },
    );

    expect(line).toHaveLength(2);
    expect(line[0]).toEqual([20, 10]);
    expect(line.at(-1)).toEqual([22, 12]);
  });

  it("spaces points roughly one per maxStepMetres", () => {
    const line = geodesicLine(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { maxStepMetres: 250_000 },
    );

    expect(line).toHaveLength(5);
  });

  it("uses a 25 km step by default", () => {
    const line = geodesicLine({ lat: 0, lng: 0 }, { lat: 0, lng: 10 });

    expect(line).toHaveLength(45);
  });

  it("bows poleward along the great circle rather than the projection", () => {
    const line = geodesicLine(
      { lat: 45, lng: 0 },
      { lat: 45, lng: 90 },
      { maxStepMetres: 1_000_000 },
    );

    expect(line).toHaveLength(7);
    expect(line[3][0]).toBeCloseTo(45, 1);
    expect(line[3][1]).toBeGreaterThan(50);
    line
      .slice(1, -1)
      .forEach(([, latitude]) => expect(latitude).toBeGreaterThan(45));
  });

  it("crosses the antimeridian at 180°", () => {
    const line = geodesicLine({ lat: 0, lng: 179 }, { lat: 0, lng: -179 });

    expect(line).toHaveLength(9);
    expect(line[0]).toEqual([179, 0]);
    expect(line.at(-1)).toEqual([-179, 0]);
    expect(Math.abs(Math.abs(line[4][0]) - 180)).toBeLessThan(1e-6);
  });

  it("returns two coincident points for identical endpoints", () => {
    expect(geodesicLine({ lat: 5, lng: 5 }, { lat: 5, lng: 5 })).toEqual([
      [5, 5],
      [5, 5],
    ]);
  });

  it("caps long connectors at 64 points", () => {
    const line = geodesicLine({ lat: 0, lng: 0 }, { lat: 0, lng: 170 });

    expect(line).toHaveLength(64);
    expect(line[0]).toEqual([0, 0]);
    expect(line.at(-1)).toEqual([170, 0]);
  });

  it("falls back to the default step for invalid spacing", () => {
    const expected = geodesicLine({ lat: 0, lng: 0 }, { lat: 0, lng: 10 });

    for (const maxStepMetres of [0, -1, NaN, Infinity]) {
      const line = geodesicLine(
        { lat: 0, lng: 0 },
        { lat: 0, lng: 10 },
        { maxStepMetres },
      );
      expect(line).toHaveLength(expected.length);
    }
  });

  it("returns an empty array for invalid input", () => {
    expect(geodesicLine(null, { lat: 0, lng: 0 })).toEqual([]);
    expect(geodesicLine({ lat: 0, lng: 0 }, null)).toEqual([]);
    expect(geodesicLine({ lat: 91, lng: 0 }, { lat: 0, lng: 0 })).toEqual([]);
    expect(geodesicLine({ lat: 0, lng: 181 }, { lat: 0, lng: 0 })).toEqual([]);
    expect(geodesicLine({ lat: "north", lng: 0 }, { lat: 0, lng: 0 })).toEqual(
      [],
    );
  });
});
