import { describe, it, expect } from "vitest";
import { formatDistance } from "@/utils/geo";

// U+202F (narrow no-break space) is the separator Intl emits before the unit
// symbol in French.
const NNBSP = "\u202f";

describe("formatDistance", () => {
  describe("English — byte-identical to the previous fixed-point formatter", () => {
    it.each([
      [0, true, "0 m"],
      [5, true, "5 m"],
      [340, true, "340 m"],
      [500, true, "500 m"],
      [999, true, "999 m"],
      [999.999, true, "1000 m"],
      [1000, true, "1.00 km"],
      [1005, true, "1.00 km"],
      [1005.5, true, "1.01 km"],
      [1234.56, true, "1.23 km"],
      [2345.67, true, "2.35 km"],
      [1005000, true, "1005.00 km"],
      [0, false, "0 ft"],
      [5, false, "16 ft"],
      [100, false, "328 ft"],
      [160, false, "525 ft"],
      [161, false, "0.10 mi"],
      [340, false, "0.21 mi"],
      [1000, false, "0.62 mi"],
      [1609.344, false, "1.00 mi"],
      [2345.67, false, "1.46 mi"],
    ])("formats %s m (metric: %s) as %s", (metres, isMetric, expected) => {
      expect(formatDistance(metres, isMetric)).toBe(expected);
    });
  });

  describe("French — localised separators and unit symbols", () => {
    it.each([
      [2345.67, true, `2,35${NNBSP}km`],
      [1234.56, true, `1,23${NNBSP}km`],
      [340, true, `340${NNBSP}m`],
      [0, true, `0${NNBSP}m`],
      [1609.344, false, `1,00${NNBSP}mi`],
      [100, false, `328${NNBSP}pi`],
    ])("formats %s m (metric: %s) as %s", (metres, isMetric, expected) => {
      expect(formatDistance(metres, isMetric, "fr")).toBe(expected);
    });
  });

  it("defaults to English", () => {
    expect(formatDistance(1000)).toBe("1.00 km");
  });

  it("uses two fraction digits for km and mi, none for m and ft", () => {
    expect(formatDistance(1000, true)).toBe("1.00 km");
    expect(formatDistance(1005.5, true)).toBe("1.01 km");
    expect(formatDistance(340.5, true)).toBe("341 m");
    expect(formatDistance(1609.344, false)).toBe("1.00 mi");
    expect(formatDistance(0.5, false)).toBe("2 ft");
  });

  it("switches imperial from feet to miles at 0.1 mi", () => {
    expect(formatDistance(160, false)).toBe("525 ft");
    expect(formatDistance(161, false)).toBe("0.10 mi");
  });

  it("never groups thousands", () => {
    expect(formatDistance(1005000, true)).toBe("1005.00 km");
  });
});
