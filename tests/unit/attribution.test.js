import { describe, it, expect } from "vitest";
import { buildAttribution } from "@/utils/attribution";

describe("buildAttribution", () => {
  it("collects source attributions and joins them with the separator", () => {
    const style = {
      sources: {
        first: { attribution: "© A" },
        second: { attribution: "© B contributors" },
      },
    };

    expect(buildAttribution(style)).toBe("© A © B contributors");
  });

  it("dedupes identical attributions", () => {
    const style = {
      sources: {
        first: { attribution: "© A" },
        second: { attribution: "© A" },
      },
    };

    expect(buildAttribution(style)).toBe("© A");
  });

  it("drops whitespace-only attributions", () => {
    const style = {
      sources: {
        first: { attribution: "© A" },
        blank: { attribution: "   " },
        empty: { attribution: "" },
      },
    };

    expect(buildAttribution(style)).toBe("© A");
  });

  it("removes entries that are substrings of another entry", () => {
    const style = {
      sources: {
        short: { attribution: "OpenStreetMap" },
        long: { attribution: "© OpenStreetMap contributors" },
        other: { attribution: "© OpenFreeMap" },
      },
    };

    expect(buildAttribution(style)).toBe(
      "© OpenFreeMap © OpenStreetMap contributors",
    );
  });

  it("sorts entries by length before joining", () => {
    const style = {
      sources: {
        long: { attribution: "© Long attribution" },
        short: { attribution: "© A" },
      },
    };

    expect(buildAttribution(style)).toBe("© A © Long attribution");
  });

  it("ignores sources without an attribution", () => {
    const style = {
      sources: {
        bare: { type: "vector" },
        nullish: { attribution: null },
        numeric: { attribution: 42 },
      },
    };

    expect(buildAttribution(style)).toBe("");
  });

  it("returns an empty string for missing or empty input", () => {
    expect(buildAttribution(undefined)).toBe("");
    expect(buildAttribution(null)).toBe("");
    expect(buildAttribution({})).toBe("");
    expect(buildAttribution({ sources: {} })).toBe("");
  });
});
