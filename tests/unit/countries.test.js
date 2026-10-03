import { describe, it, expect } from "vitest";
import {
  COUNTRY_BOUNDS,
  WRAP_OVERRIDES,
  countryCodeToBounds,
  countryCodeFromLocale,
  countryCodeFromTimeZone,
} from "@/utils/countries.js";

describe("COUNTRY_BOUNDS", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(COUNTRY_BOUNDS)).toBe(true);
  });

  it("preserves odd entries exactly", () => {
    expect(COUNTRY_BOUNDS.AQ).toEqual([-180.0, -90.0, 180.0, -63.2706604895]);
    expect(COUNTRY_BOUNDS.RU).toEqual([-180.0, 41.151416124, 180.0, 81.2504]);
  });
});

describe("countryCodeToBounds — known codes", () => {
  it("returns exact bounds for GB", () => {
    expect(countryCodeToBounds("GB")).toEqual([
      [-7.57216793459, 49.959999905],
      [1.68153079591, 58.6350001085],
    ]);
  });

  it("returns exact bounds for US", () => {
    expect(countryCodeToBounds("US")).toEqual([
      [-171.791110603, 18.91619],
      [-66.96466, 71.3577635769],
    ]);
  });

  it("returns exact bounds for FR", () => {
    expect(countryCodeToBounds("FR")).toEqual([
      [-54.5247541978, 2.05338918702],
      [9.56001631027, 51.1485061713],
    ]);
  });

  it("returns exact bounds for CA", () => {
    expect(countryCodeToBounds("CA")).toEqual([
      [-140.99778, 41.6751050889],
      [-52.6480987209, 83.23324],
    ]);
  });
});

describe("countryCodeToBounds — unknown codes fall back to a random country", () => {
  it.each(["ZZ", "", "HK"])(
    "maps %j to the first key (AF) when random is 0",
    (code) => {
      expect(countryCodeToBounds(code, () => 0)).toEqual([
        [60.5284298033, 29.318572496],
        [75.1580277851, 38.4862816432],
      ]);
    },
  );

  it("maps to the last key when random approaches 1", () => {
    const keys = Object.keys(COUNTRY_BOUNDS);
    const last = COUNTRY_BOUNDS[keys[keys.length - 1]];
    expect(countryCodeToBounds("ZZ", () => 0.9999999999)).toEqual([
      [last[0], last[1]],
      [last[2], last[3]],
    ]);
  });
});

describe("countryCodeToBounds — shape and orientation", () => {
  it("returns [[minLon, minLat], [maxLon, maxLat]] for GB", () => {
    const [[minLon, minLat], [maxLon, maxLat]] = countryCodeToBounds("GB");
    expect(minLon).toBeLessThan(maxLon);
    expect(minLat).toBeLessThan(maxLat);
    expect(minLon).toBe(-7.57216793459);
    expect(minLat).toBe(49.959999905);
    expect(maxLon).toBe(1.68153079591);
    expect(maxLat).toBe(58.6350001085);
  });
});

describe("countryCodeToBounds — antimeridian overrides", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(WRAP_OVERRIDES)).toBe(true);
  });

  it("returns the exact FJ override", () => {
    expect(countryCodeToBounds("FJ")).toEqual([
      [177.28504, -18.28799],
      [-179.79332, -16.020882],
    ]);
  });

  it("returns the exact RU override", () => {
    expect(countryCodeToBounds("RU")).toEqual([
      [19.66064, 41.151416],
      [-169.89958, 81.2504],
    ]);
  });

  it("is case-insensitive for lowercase codes", () => {
    expect(countryCodeToBounds("fj")).toEqual(countryCodeToBounds("FJ"));
    expect(countryCodeToBounds("ru")).toEqual(countryCodeToBounds("RU"));
  });

  it("keeps the FJ span under 10°", () => {
    const [[west], [east]] = countryCodeToBounds("FJ");
    expect((east - west + 360) % 360).toBeLessThan(10);
  });

  it("keeps the RU span under 180°", () => {
    const [[west], [east]] = countryCodeToBounds("RU");
    expect((east - west + 360) % 360).toBeLessThan(180);
  });

  it("signals the wrap with west > east for both overrides", () => {
    for (const code of ["FJ", "RU"]) {
      const [[west, south], [east, north]] = countryCodeToBounds(code);
      expect(west).toBeGreaterThan(east);
      expect(south).toBeLessThan(north);
    }
  });

  it("only overrides keys that exist in COUNTRY_BOUNDS", () => {
    for (const code of Object.keys(WRAP_OVERRIDES)) {
      expect(COUNTRY_BOUNDS).toHaveProperty(code);
    }
  });

  it("applies the override through the random fallback", () => {
    const keys = Object.keys(COUNTRY_BOUNDS);
    for (const code of ["FJ", "RU"]) {
      const random = () => keys.indexOf(code) / keys.length;
      expect(countryCodeToBounds("ZZ", random)).toEqual(
        countryCodeToBounds(code),
      );
    }
  });

  it("leaves AQ table bounds unchanged", () => {
    expect(COUNTRY_BOUNDS.AQ).toEqual([-180.0, -90.0, 180.0, -63.2706604895]);
    expect(countryCodeToBounds("AQ")).toEqual([
      [-180.0, -90.0],
      [180.0, -63.2706604895],
    ]);
  });
});

describe("countryCodeFromTimeZone", () => {
  it.each([
    ["Europe/Paris", "FR"],
    ["America/Toronto", "CA"],
    ["Pacific/Auckland", "NZ"],
    ["Asia/Calcutta", "IN"],
    ["America/New_York", "US"],
  ])("maps %s to %s", (zone, expected) => {
    expect(countryCodeFromTimeZone(zone)).toBe(expected);
  });

  it("returns null for UTC", () => {
    expect(countryCodeFromTimeZone("UTC")).toBeNull();
  });

  it("returns null for an unknown zone", () => {
    expect(countryCodeFromTimeZone("Not/AZone")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(countryCodeFromTimeZone("")).toBeNull();
  });

  it.each([null, 42])("returns null for non-string input %j", (v) => {
    expect(countryCodeFromTimeZone(v)).toBeNull();
  });

  it("does not throw on a default-argument call", () => {
    expect(() => countryCodeFromTimeZone()).not.toThrow();
  });

  it("caches the reverse map across repeat calls", () => {
    expect(countryCodeFromTimeZone("Europe/Paris")).toBe("FR");
    expect(countryCodeFromTimeZone("America/Toronto")).toBe("CA");
    expect(countryCodeFromTimeZone("Europe/Paris")).toBe("FR");
  });
});

describe("countryCodeFromLocale", () => {
  it("resolves en-GB to GB", () => {
    expect(countryCodeFromLocale("en-GB")).toBe("GB");
  });

  it("resolves en-US to US", () => {
    expect(countryCodeFromLocale("en-US")).toBe("US");
  });

  it("resolves fr to FR via maximization", () => {
    expect(countryCodeFromLocale("fr")).toBe("FR");
  });

  it("resolves fr-FR to FR", () => {
    expect(countryCodeFromLocale("fr-FR")).toBe("FR");
  });

  it("resolves en-HK to HK", () => {
    expect(countryCodeFromLocale("en-HK")).toBe("HK");
  });

  it("returns null for a language with no region (zxx)", () => {
    expect(countryCodeFromLocale("zxx")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(countryCodeFromLocale("")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(countryCodeFromLocale("not a locale!!")).toBeNull();
  });
});
