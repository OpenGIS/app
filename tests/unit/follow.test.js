import { describe, it, expect } from "vitest";
import {
  BEARING_BLEND_END_KMH,
  BEARING_BLEND_START_KMH,
  OFFSET_FRACTION_MAX,
  PITCH_KEYFRAMES,
  blendBearing,
  damp,
  dampAngle,
  dampingFactor,
  deadReckon,
  deriveCourse,
  deriveSpeed,
  followFitZoom,
  lookAheadMetres,
  offsetFractionForPitch,
  pitchForSpeedKmh,
  zoomPullBackForSpeed,
} from "@/utils/follow";
import {
  fitZoomForDisc,
  horizonDistanceMetres,
  horizonFitZoom,
} from "@/utils/orient";
import { orientCameraDefaults } from "@/defaults/maplibre";

const METRES_PER_DEGREE_LATITUDE = 111_194.93;

describe("pitchForSpeedKmh", () => {
  it("returns the exact agreed keyframes", () => {
    for (const { speedKmh, pitchDeg } of PITCH_KEYFRAMES) {
      expect(pitchForSpeedKmh(speedKmh)).toBe(pitchDeg);
    }
  });

  it("interpolates linearly between keyframes", () => {
    expect(pitchForSpeedKmh(10)).toBeCloseTo(37, 6);
    expect(pitchForSpeedKmh(45)).toBeCloseTo(53, 6);
  });

  it("is monotone across 0–100 km/h", () => {
    let previous = -Infinity;
    for (let speed = 0; speed <= 100; speed += 0.5) {
      const pitch = pitchForSpeedKmh(speed);
      expect(pitch).toBeGreaterThanOrEqual(previous);
      previous = pitch;
    }
  });

  it("clamps outside 0–100 km/h", () => {
    expect(pitchForSpeedKmh(-20)).toBe(0);
    expect(pitchForSpeedKmh(150)).toBe(60);
  });

  it("returns 0 for non-finite or missing speed", () => {
    expect(pitchForSpeedKmh(null)).toBe(0);
    expect(pitchForSpeedKmh(undefined)).toBe(0);
    expect(pitchForSpeedKmh(NaN)).toBe(0);
    expect(pitchForSpeedKmh(Infinity)).toBe(0);
  });
});

describe("zoomPullBackForSpeed", () => {
  it("keeps the zoom unchanged at rest and walking pace", () => {
    expect(zoomPullBackForSpeed(0)).toBe(0);
    expect(zoomPullBackForSpeed(3)).toBe(0);
    expect(zoomPullBackForSpeed(5)).toBe(0);
  });

  it("pulls back one zoom level at 100 km/h and clamps beyond", () => {
    expect(zoomPullBackForSpeed(100)).toBe(1);
    expect(zoomPullBackForSpeed(200)).toBe(1);
  });

  it("is monotone and stays within [0, 1]", () => {
    let previous = -Infinity;
    for (let speed = 0; speed <= 120; speed += 1) {
      const pull = zoomPullBackForSpeed(speed);
      expect(pull).toBeGreaterThanOrEqual(previous);
      expect(pull).toBeGreaterThanOrEqual(0);
      expect(pull).toBeLessThanOrEqual(1);
      previous = pull;
    }
  });

  it("returns 0 for non-finite or negative speed", () => {
    expect(zoomPullBackForSpeed(null)).toBe(0);
    expect(zoomPullBackForSpeed(NaN)).toBe(0);
    expect(zoomPullBackForSpeed(-10)).toBe(0);
  });
});

describe("offsetFractionForPitch", () => {
  it("is 0 flat and rises to the maximum at the ramp pitch", () => {
    expect(offsetFractionForPitch(0)).toBe(0);
    expect(offsetFractionForPitch(30)).toBeCloseTo(OFFSET_FRACTION_MAX / 2, 6);
    expect(offsetFractionForPitch(60)).toBeCloseTo(OFFSET_FRACTION_MAX, 6);
  });

  it("clamps above the ramp pitch and below zero", () => {
    expect(offsetFractionForPitch(85)).toBe(OFFSET_FRACTION_MAX);
    expect(offsetFractionForPitch(-15)).toBe(0);
  });

  it("returns 0 for non-finite input", () => {
    expect(offsetFractionForPitch(NaN)).toBe(0);
    expect(offsetFractionForPitch(null)).toBe(0);
  });
});

describe("lookAheadMetres", () => {
  const base = {
    pitchDeg: 60,
    zoom: 15,
    latitude: 45,
    viewportHeightPx: 900,
  };

  it("is 0 for a flat camera", () => {
    expect(lookAheadMetres({ ...base, pitchDeg: 0 })).toBe(0);
  });

  it("is positive and increases with pitch", () => {
    const shallow = lookAheadMetres({ ...base, pitchDeg: 30 });
    const steep = lookAheadMetres(base);
    expect(shallow).toBeGreaterThan(0);
    expect(steep).toBeGreaterThan(shallow);
  });

  it("scales with viewport height", () => {
    const normal = lookAheadMetres(base);
    const tall = lookAheadMetres({ ...base, viewportHeightPx: 1800 });
    expect(tall).toBeCloseTo(normal * 2, 6);
  });

  it("halves for each extra zoom level", () => {
    const at15 = lookAheadMetres(base);
    const at16 = lookAheadMetres({ ...base, zoom: 16 });
    expect(at16).toBeCloseTo(at15 / 2, 6);
  });

  it("shrinks at higher latitude for the same zoom", () => {
    const equator = lookAheadMetres({ ...base, latitude: 0 });
    const polar = lookAheadMetres({ ...base, latitude: 70 });
    expect(polar).toBeLessThan(equator);
  });

  it("returns 0 for invalid inputs", () => {
    expect(lookAheadMetres({ ...base, pitchDeg: NaN })).toBe(0);
    expect(lookAheadMetres({ ...base, zoom: NaN })).toBe(0);
    expect(lookAheadMetres({ ...base, latitude: NaN })).toBe(0);
    expect(lookAheadMetres({ ...base, viewportHeightPx: 0 })).toBe(0);
    expect(lookAheadMetres()).toBe(0);
  });

  it("stays finite near 90° of pitch", () => {
    const nearVertical = lookAheadMetres({ ...base, pitchDeg: 89.999 });
    expect(Number.isFinite(nearVertical)).toBe(true);
    expect(nearVertical).toBeGreaterThan(0);
  });
});

describe("blendBearing", () => {
  it("returns null when both sources are missing", () => {
    expect(blendBearing({})).toBeNull();
    expect(blendBearing({ compassDeg: null, courseDeg: undefined })).toBeNull();
    expect(blendBearing()).toBeNull();
  });

  it("falls back to the one available source", () => {
    expect(blendBearing({ compassDeg: 10 })).toBe(10);
    expect(blendBearing({ courseDeg: 45 })).toBe(45);
  });

  it("favours the compass at rest", () => {
    expect(
      blendBearing({ compassDeg: 10, courseDeg: 90, speedKmh: 0 }),
    ).toBeCloseTo(10, 6);
  });

  it("favours the course over ground at high speed", () => {
    expect(
      blendBearing({ compassDeg: 10, courseDeg: 90, speedKmh: 100 }),
    ).toBeCloseTo(90, 6);
  });

  it("uses a smoothstep between the blend thresholds", () => {
    const midpoint = (BEARING_BLEND_START_KMH + BEARING_BLEND_END_KMH) / 2;
    expect(
      blendBearing({ compassDeg: 0, courseDeg: 100, speedKmh: midpoint }),
    ).toBeCloseTo(50, 6);
  });

  it("blends the short way across the 0/360 wrap", () => {
    expect(
      blendBearing({ compassDeg: 350, courseDeg: 10, speedKmh: 100 }),
    ).toBeCloseTo(10, 6);
    expect(
      blendBearing({ compassDeg: 350, courseDeg: 10, speedKmh: 15 }),
    ).toBeCloseTo(0, 6);
    expect(
      blendBearing({ compassDeg: 10, courseDeg: 350, speedKmh: 15 }),
    ).toBeCloseTo(0, 6);
  });

  it("normalises the result to [0, 360)", () => {
    expect(blendBearing({ compassDeg: 370 })).toBe(10);
    expect(blendBearing({ courseDeg: -10 })).toBe(350);
    expect(blendBearing({ compassDeg: 720 })).toBe(0);
  });

  it("treats a non-finite speed as rest", () => {
    expect(
      blendBearing({ compassDeg: 20, courseDeg: 80, speedKmh: null }),
    ).toBeCloseTo(20, 6);
  });
});

describe("deriveCourse", () => {
  const prev = { lat: 0, lng: 0 };

  it("computes cardinal courses", () => {
    expect(deriveCourse(prev, { lat: 0.001, lng: 0 })).toBeCloseTo(0, 6);
    expect(deriveCourse(prev, { lat: 0, lng: 0.001 })).toBeCloseTo(90, 6);
    expect(deriveCourse(prev, { lat: -0.001, lng: 0 })).toBeCloseTo(180, 6);
    expect(deriveCourse(prev, { lat: 0, lng: -0.001 })).toBeCloseTo(270, 6);
  });

  it("crosses the antimeridian the short way", () => {
    const west = { lat: 0, lng: 179.999 };
    const east = { lat: 0, lng: -179.999 };
    expect(deriveCourse(west, east)).toBeCloseTo(90, 3);
    expect(deriveCourse(east, west)).toBeCloseTo(270, 3);
  });

  it("returns null below the minimum displacement", () => {
    expect(deriveCourse(prev, { lat: 0, lng: 0.000001 })).toBeNull();
    expect(deriveCourse(prev, { lat: 0, lng: 0 })).toBeNull();
  });

  it("honours a custom minimum displacement", () => {
    expect(
      deriveCourse(prev, { lat: 0.001, lng: 0 }, { minDistanceMetres: 1000 }),
    ).toBeNull();
  });

  it("returns null for invalid fixes", () => {
    expect(deriveCourse(null, { lat: 1, lng: 1 })).toBeNull();
    expect(deriveCourse(prev, { lat: NaN, lng: 0 })).toBeNull();
    expect(deriveCourse(prev, undefined)).toBeNull();
  });

  it("works at high latitude", () => {
    const course = deriveCourse({ lat: 80, lng: 0 }, { lat: 80, lng: 0.1 });
    expect(course).toBeGreaterThan(89);
    expect(course).toBeLessThan(91);
  });
});

describe("deriveSpeed", () => {
  const prev = { lat: 0, lng: 0 };
  const oneMilliDegreeNorth = { lat: 0.001, lng: 0 };

  it("returns metres per second", () => {
    const expectedMetres = METRES_PER_DEGREE_LATITUDE / 1000;
    expect(deriveSpeed(prev, oneMilliDegreeNorth, 1)).toBeCloseTo(
      expectedMetres,
      0,
    );
    expect(deriveSpeed(prev, oneMilliDegreeNorth, 10)).toBeCloseTo(
      expectedMetres / 10,
      3,
    );
  });

  it("returns null when dt is not positive", () => {
    expect(deriveSpeed(prev, oneMilliDegreeNorth, 0)).toBeNull();
    expect(deriveSpeed(prev, oneMilliDegreeNorth, -1)).toBeNull();
    expect(deriveSpeed(prev, oneMilliDegreeNorth, NaN)).toBeNull();
  });

  it("returns 0 below the jitter guard rather than null", () => {
    expect(deriveSpeed(prev, { lat: 0.000001, lng: 0 }, 1)).toBe(0);
    expect(deriveSpeed(prev, prev, 1)).toBe(0);
  });

  it("returns null for invalid fixes", () => {
    expect(deriveSpeed(null, oneMilliDegreeNorth, 1)).toBeNull();
    expect(deriveSpeed(prev, { lat: 0, lng: Infinity }, 1)).toBeNull();
  });
});

describe("dampingFactor", () => {
  it("is 0 for a non-positive frame interval", () => {
    expect(dampingFactor(0, 0.35)).toBe(0);
    expect(dampingFactor(-0.016, 0.35)).toBe(0);
  });

  it("approaches 1 as the interval grows", () => {
    expect(dampingFactor(10, 0.35)).toBeGreaterThan(0.999);
    expect(dampingFactor(10, 0.35)).toBeLessThanOrEqual(1);
  });

  it("matches the exponential formula at one time constant", () => {
    expect(dampingFactor(0.5, 0.5)).toBeCloseTo(1 - Math.exp(-1), 12);
  });

  it("snaps for an invalid or non-positive time constant", () => {
    expect(dampingFactor(0.016, 0)).toBe(1);
    expect(dampingFactor(0.016, -1)).toBe(1);
    expect(dampingFactor(0.016, NaN)).toBe(1);
    expect(dampingFactor(NaN, 0.35)).toBe(1);
  });
});

describe("damp", () => {
  it("interpolates with factor 0, 1 and an intermediate value", () => {
    expect(damp(0, 10, 0)).toBe(0);
    expect(damp(0, 10, 1)).toBe(10);
    expect(damp(0, 10, 0.25)).toBe(2.5);
  });

  it("clamps the factor to [0, 1]", () => {
    expect(damp(0, 10, 2)).toBe(10);
    expect(damp(0, 10, -1)).toBe(0);
  });

  it("returns the current value for invalid target or factor", () => {
    expect(damp(4, NaN, 0.5)).toBe(4);
    expect(damp(4, 10, NaN)).toBe(4);
  });
});

describe("dampAngle", () => {
  it("follows the shortest path around the circle", () => {
    expect(dampAngle(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(dampAngle(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(dampAngle(350, 10, 1)).toBeCloseTo(10, 6);
  });

  it("normalises the result to [0, 360)", () => {
    expect(dampAngle(720, 10, 1)).toBeCloseTo(10, 6);
    expect(dampAngle(0, 450, 1)).toBeCloseTo(90, 6);
  });

  it("clamps the factor", () => {
    expect(dampAngle(10, 90, 0)).toBe(10);
    expect(dampAngle(10, 90, 5)).toBe(90);
  });

  it("returns the current angle for invalid target or factor", () => {
    expect(dampAngle(30, NaN, 0.5)).toBe(30);
    expect(dampAngle(30, 60, NaN)).toBe(30);
  });
});

describe("deadReckon", () => {
  it("moves north along a meridian", () => {
    const next = deadReckon({ lat: 0, lng: 0 }, 0, METRES_PER_DEGREE_LATITUDE);
    expect(next.lat).toBeCloseTo(1, 3);
    expect(next.lng).toBeCloseTo(0, 6);
  });

  it("moves east along the equator", () => {
    const next = deadReckon({ lat: 0, lng: 0 }, 90, METRES_PER_DEGREE_LATITUDE);
    expect(next.lat).toBeCloseTo(0, 6);
    expect(next.lng).toBeCloseTo(1, 3);
  });

  it("returns the origin for zero distance", () => {
    expect(deadReckon({ lat: 12, lng: -34 }, 45, 0)).toEqual({
      lat: 12,
      lng: -34,
    });
  });

  it("wraps the antimeridian", () => {
    const next = deadReckon(
      { lat: 0, lng: 179.5 },
      90,
      METRES_PER_DEGREE_LATITUDE,
    );
    expect(next.lng).toBeCloseTo(-179.5, 3);
  });

  it("works at high latitude", () => {
    const north = deadReckon(
      { lat: 80, lng: 0 },
      0,
      METRES_PER_DEGREE_LATITUDE,
    );
    expect(north.lat).toBeCloseTo(81, 3);
    expect(north.lng).toBeCloseTo(0, 6);

    const east = deadReckon({ lat: 80, lng: 0 }, 90, 100_000);
    expect(east.lat).toBeCloseTo(80, 1);
    expect(east.lng).toBeGreaterThan(5);
    expect(east.lng).toBeLessThan(5.4);
  });

  it("returns the origin for invalid inputs", () => {
    expect(deadReckon({ lat: NaN, lng: 0 }, 90, 10)).toEqual({
      lat: NaN,
      lng: 0,
    });
    expect(deadReckon({ lat: 0, lng: 0 }, NaN, 10)).toEqual({ lat: 0, lng: 0 });
  });
});

describe("followFitZoom", () => {
  const widthPx = 1440;
  const heightPx = 900;
  const latitude = 45;

  it("matches the direct horizon-fit calculation", () => {
    const expected = fitZoomForDisc({
      widthPx,
      heightPx,
      latitude,
      radiusMetres: horizonDistanceMetres(orientCameraDefaults.eyeHeightMetres),
      paddingPx: Math.round(
        Math.min(widthPx, heightPx) * orientCameraDefaults.fitPaddingFraction,
      ),
    });
    expect(followFitZoom({ widthPx, heightPx, latitude })).toBe(expected);
    expect(followFitZoom({ widthPx, heightPx, latitude })).toBe(
      horizonFitZoom({ widthPx, heightPx, latitude }),
    );
  });

  it("zooms in as the viewport grows", () => {
    const small = followFitZoom({
      widthPx: 800,
      heightPx: 600,
      latitude,
    });
    const large = followFitZoom({
      widthPx: 1600,
      heightPx: 1200,
      latitude,
    });
    expect(large).toBeGreaterThan(small);
  });

  it("respects padding and eye-height options", () => {
    const plain = followFitZoom(
      { widthPx, heightPx, latitude },
      { paddingFraction: 0 },
    );
    const padded = followFitZoom(
      { widthPx, heightPx, latitude },
      { paddingFraction: 0.16 },
    );
    expect(padded).toBeLessThan(plain);

    const eyeLevel = followFitZoom(
      { widthPx, heightPx, latitude },
      { eyeHeightMetres: 1.83 },
    );
    const tall = followFitZoom(
      { widthPx, heightPx, latitude },
      { eyeHeightMetres: 10 },
    );
    expect(tall).toBeLessThan(eyeLevel);
  });

  it("clamps to [0, 22]", () => {
    expect(
      followFitZoom({
        widthPx: 1e9,
        heightPx: 1e9,
        latitude: 0,
      }),
    ).toBe(22);

    expect(
      followFitZoom(
        { widthPx, heightPx, latitude: 0 },
        { eyeHeightMetres: 1e15 },
      ),
    ).toBe(0);
  });
});

describe("PITCH_KEYFRAMES", () => {
  it("is sorted by speed and produces a strictly rising pitch curve", () => {
    for (let i = 1; i < PITCH_KEYFRAMES.length; i++) {
      expect(PITCH_KEYFRAMES[i].speedKmh).toBeGreaterThan(
        PITCH_KEYFRAMES[i - 1].speedKmh,
      );
      expect(PITCH_KEYFRAMES[i].pitchDeg).toBeGreaterThan(
        PITCH_KEYFRAMES[i - 1].pitchDeg,
      );
    }
  });
});
