import { describe, it, expect, beforeEach } from "vitest";
import {
  parseUrlHash,
  updateUrlHash,
  formatUrlHash,
} from "@/composables/useUrlHash";

describe("formatUrlHash", () => {
  it("formats all five segments", () => {
    expect(formatUrlHash(16, 12.34, 56.78, 45, 120)).toBe(
      "#map=16/12.340000/56.780000/45/120",
    );
  });

  it("defaults pitch and bearing to zero", () => {
    expect(formatUrlHash(14.7, 12.34, 56.78)).toBe(
      "#map=15/12.340000/56.780000/0/0",
    );
  });

  it("rounds zoom, pitch and bearing to integers", () => {
    expect(formatUrlHash(10.5, 12.34, 56.78, 44.4, 120.5)).toBe(
      "#map=11/12.340000/56.780000/44/121",
    );
  });

  it("writes latitude and longitude to six decimal places", () => {
    expect(formatUrlHash(8, -33.86882, 151.20929, 0, 0)).toBe(
      "#map=8/-33.868820/151.209290/0/0",
    );
  });
});

describe("parseUrlHash", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("returns null when hash is empty", () => {
    expect(parseUrlHash()).toBeNull();
  });

  it("returns null when hash has wrong format", () => {
    window.location.hash = "#something-else";
    expect(parseUrlHash()).toBeNull();
  });

  it("parses integer zoom with positive coords", () => {
    window.location.hash = "#map=10/12.340000/56.780000";
    const result = parseUrlHash();
    expect(result).toEqual({
      zoom: 10,
      center: [56.78, 12.34], // [lng, lat]
      pitch: 0,
      bearing: 0,
    });
  });

  it("parses fractional zoom", () => {
    window.location.hash = "#map=14.5/48.8566/2.3522";
    const result = parseUrlHash();
    expect(result).toEqual({
      zoom: 14.5,
      center: [2.3522, 48.8566],
      pitch: 0,
      bearing: 0,
    });
  });

  it("parses negative latitude and longitude", () => {
    window.location.hash = "#map=8/-33.868820/151.209290";
    const result = parseUrlHash();
    expect(result).toEqual({
      zoom: 8,
      center: [151.20929, -33.86882],
      pitch: 0,
      bearing: 0,
    });
  });

  it("parses zero zoom", () => {
    window.location.hash = "#map=0/0/0";
    const result = parseUrlHash();
    expect(result).toEqual({
      zoom: 0,
      center: [0, 0],
      pitch: 0,
      bearing: 0,
    });
  });

  it("parses a five-segment hash with pitch and bearing", () => {
    window.location.hash = "#map=16/12.340000/56.780000/45/120";
    const result = parseUrlHash();
    expect(result).toEqual({
      zoom: 16,
      center: [56.78, 12.34],
      pitch: 45,
      bearing: 120,
    });
  });

  it("defaults pitch and bearing to zero for a three-segment hash", () => {
    window.location.hash = "#map=12/12.34/56.78";
    const result = parseUrlHash();
    expect(result.pitch).toBe(0);
    expect(result.bearing).toBe(0);
  });

  it("ignores extra path segments after the three values", () => {
    window.location.hash = "#map=12/12.34/56.78/extra/stuff";
    const result = parseUrlHash();
    expect(result).toEqual({
      zoom: 12,
      center: [56.78, 12.34],
      pitch: 0,
      bearing: 0,
    });
  });

  it("ignores extra path segments after the five values", () => {
    window.location.hash = "#map=12/12.34/56.78/45/120/extra";
    const result = parseUrlHash();
    expect(result).toEqual({
      zoom: 12,
      center: [56.78, 12.34],
      pitch: 45,
      bearing: 120,
    });
  });

  it("returns null when zoom is missing", () => {
    window.location.hash = "#map=/12.34/56.78";
    expect(parseUrlHash()).toBeNull();
  });

  it("returns null when longitude is missing", () => {
    window.location.hash = "#map=10/12.34";
    expect(parseUrlHash()).toBeNull();
  });
});

describe("updateUrlHash", () => {
  it("formats hash with rounded zoom, pitch and bearing", () => {
    updateUrlHash(14.7, 12.34, 56.78, 44.6, 120.2);
    expect(window.location.hash).toBe("#map=15/12.340000/56.780000/45/120");
  });

  it("formats zero coordinates", () => {
    updateUrlHash(0, 0, 0);
    expect(window.location.hash).toBe("#map=0/0.000000/0.000000/0/0");
  });

  it("formats negative coordinates", () => {
    updateUrlHash(8, -33.86882, 151.20929);
    expect(window.location.hash).toBe("#map=8/-33.868820/151.209290/0/0");
  });

  it("rounds zoom down from .4", () => {
    updateUrlHash(10.4, 12.34, 56.78);
    expect(window.location.hash).toBe("#map=10/12.340000/56.780000/0/0");
  });

  it("rounds zoom up from .5", () => {
    updateUrlHash(10.5, 12.34, 56.78);
    expect(window.location.hash).toBe("#map=11/12.340000/56.780000/0/0");
  });

  it("rounds pitch and bearing to integers", () => {
    updateUrlHash(16, 12.34, 56.78, 59.5, 359.6);
    expect(window.location.hash).toBe("#map=16/12.340000/56.780000/60/360");
  });
});
