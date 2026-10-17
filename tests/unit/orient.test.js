import { describe, it, expect } from "vitest";
import {
  horizonDistanceMetres,
  fitZoomForDisc,
  shortestBearingDelta,
  orientFlightDurationMs,
} from "@/utils/orient";

describe("horizonDistanceMetres", () => {
  it("is zero at zero eye height", () => {
    expect(horizonDistanceMetres(0)).toBe(0);
  });

  it("is ~4828.9 m for a 1.83 m observer", () => {
    expect(horizonDistanceMetres(1.83)).toBeCloseTo(4828.9, 0);
  });

  it("increases monotonically with eye height", () => {
    const heights = [0, 0.5, 1.83, 10, 100, 1000];
    for (let i = 1; i < heights.length; i++) {
      expect(horizonDistanceMetres(heights[i])).toBeGreaterThan(
        horizonDistanceMetres(heights[i - 1]),
      );
    }
  });
});

describe("fitZoomForDisc", () => {
  const radiusMetres = horizonDistanceMetres(1.83);

  it("fits the horizon disc to ~z12.33 for a 1440x900 desktop viewport", () => {
    const zoom = fitZoomForDisc({
      widthPx: 1440,
      heightPx: 900,
      latitude: 45,
      radiusMetres,
      paddingPx: 0,
    });
    expect(zoom).toBeCloseTo(12.33, 1);
    expect(Math.abs(zoom - 12.33)).toBeLessThan(0.05);
  });

  it("zooms in as the smaller viewport axis grows", () => {
    const base = { latitude: 45, radiusMetres, paddingPx: 0 };
    const small = fitZoomForDisc({ ...base, widthPx: 1200, heightPx: 600 });
    const large = fitZoomForDisc({ ...base, widthPx: 1200, heightPx: 1200 });
    expect(large).toBeGreaterThan(small);
  });

  it("ignores growth of the larger axis beyond the smaller", () => {
    const base = { latitude: 45, radiusMetres, paddingPx: 0 };
    const before = fitZoomForDisc({ ...base, widthPx: 1200, heightPx: 600 });
    const after = fitZoomForDisc({ ...base, widthPx: 1600, heightPx: 600 });
    expect(after).toBe(before);
  });

  it("zooms out as padding grows", () => {
    const base = { widthPx: 1440, heightPx: 900, latitude: 45, radiusMetres };
    const none = fitZoomForDisc({ ...base, paddingPx: 0 });
    const padded = fitZoomForDisc({ ...base, paddingPx: 50 });
    expect(padded).toBeLessThan(none);
  });

  it("zooms out at higher latitude for the same ground distance", () => {
    const base = { widthPx: 1440, heightPx: 900, radiusMetres, paddingPx: 0 };
    const equator = fitZoomForDisc({ ...base, latitude: 0 });
    const polar = fitZoomForDisc({ ...base, latitude: 80 });
    expect(polar).toBeLessThan(equator);
  });

  it("clamps to [0, 22]", () => {
    const huge = fitZoomForDisc({
      widthPx: 1e9,
      heightPx: 1e9,
      latitude: 0,
      radiusMetres,
      paddingPx: 0,
    });
    const tiny = fitZoomForDisc({
      widthPx: 1440,
      heightPx: 900,
      latitude: 0,
      radiusMetres: 1e12,
      paddingPx: 0,
    });
    expect(huge).toBe(22);
    expect(tiny).toBe(0);
  });
});

describe("shortestBearingDelta", () => {
  it("returns the shortest angular distance to north", () => {
    expect(shortestBearingDelta(0)).toBe(0);
    expect(shortestBearingDelta(90)).toBe(90);
    expect(shortestBearingDelta(180)).toBe(180);
    expect(shortestBearingDelta(270)).toBe(90);
    expect(shortestBearingDelta(359)).toBe(1);
    expect(shortestBearingDelta(-10)).toBe(10);
    expect(shortestBearingDelta(370)).toBe(10);
    expect(shortestBearingDelta(720)).toBe(0);
  });
});

describe("orientFlightDurationMs", () => {
  it("uses the minimum for a zero-distance, north-up flight", () => {
    expect(orientFlightDurationMs({ distanceMetres: 0, bearingDeg: 0 })).toBe(
      600,
    );
  });

  it("scales with distance along the logarithmic curve", () => {
    expect(
      orientFlightDurationMs({ distanceMetres: 10_000, bearingDeg: 0 }),
    ).toBe(1500);
    expect(
      orientFlightDurationMs({ distanceMetres: 100_000, bearingDeg: 0 }),
    ).toBe(2300);
  });

  it("clamps to the maximum for antipodal distances", () => {
    expect(
      orientFlightDurationMs({ distanceMetres: 20_015_000, bearingDeg: 0 }),
    ).toBe(4000);
    expect(
      orientFlightDurationMs({ distanceMetres: 20_000_000, bearingDeg: 0 }),
    ).toBe(4000);
  });

  it("applies the rotation-speed floor to a half-turn reset", () => {
    const duration = orientFlightDurationMs({
      distanceMetres: 0,
      bearingDeg: 180,
    });
    expect(duration).toBeCloseTo((180 / 70) * 1000, 0);
  });

  it("uses the shortest path for bearings past 180°", () => {
    const at90 = orientFlightDurationMs({ distanceMetres: 0, bearingDeg: 90 });
    const at270 = orientFlightDurationMs({
      distanceMetres: 0,
      bearingDeg: 270,
    });
    expect(at270).toBe(at90);
  });

  it("lets the distance curve win when it exceeds the rotation floor", () => {
    const farNorth = orientFlightDurationMs({
      distanceMetres: 100_000,
      bearingDeg: 0,
    });
    const farTurn = orientFlightDurationMs({
      distanceMetres: 100_000,
      bearingDeg: 90,
    });
    expect(farTurn).toBe(farNorth);
  });

  it("is monotonic non-decreasing in distance, always within bounds", () => {
    let previous = 0;
    for (let i = 0; i <= 40; i++) {
      const distanceMetres = 1.5 ** i;
      const duration = orientFlightDurationMs({
        distanceMetres,
        bearingDeg: 0,
      });
      expect(duration).toBeGreaterThanOrEqual(previous);
      expect(duration).toBeGreaterThanOrEqual(600);
      expect(duration).toBeLessThanOrEqual(4000);
      previous = duration;
    }
  });
});
