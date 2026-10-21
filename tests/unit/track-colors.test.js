import { describe, it, expect } from "vitest";
import {
  BRIGHT_COLORS,
  assignTrackColors,
  colorForId,
} from "@/utils/track/colors.js";

describe("track colours", () => {
  it("uses a palette of unique colours", () => {
    expect(new Set(BRIGHT_COLORS).size).toBe(BRIGHT_COLORS.length);
  });

  it("derives a deterministic palette colour from an id", () => {
    const first = colorForId("route-1");
    expect(colorForId("route-1")).toBe(first);
    expect(BRIGHT_COLORS).toContain(first);
    expect(colorForId("route-2")).toBe(colorForId("route-2"));
  });

  it("fills missing colours sequentially, skipping used colours", () => {
    const docs = [{ id: "a" }, { id: "b", color: "#3498db" }, { id: "c" }];

    const result = assignTrackColors(docs);

    expect(result).toBe(docs);
    expect(docs[0].color).toBe("#e74c3c");
    expect(docs[1].color).toBe("#3498db");
    expect(docs[2].color).toBe("#2ecc71");
  });

  it("is idempotent", () => {
    const docs = [{ id: "a" }, { id: "b" }];
    assignTrackColors(docs);
    const assigned = docs.map((doc) => doc.color);

    assignTrackColors(docs);

    expect(docs.map((doc) => doc.color)).toEqual(assigned);
  });

  it("falls back to the id-derived colour once the palette is exhausted", () => {
    const docs = BRIGHT_COLORS.map((color, index) => ({
      id: `used-${index}`,
      color,
    }));
    docs.push({ id: "overflow" }, { id: "overflow-2" });

    assignTrackColors(docs);

    expect(docs.at(-2).color).toBe(colorForId("overflow"));
    expect(docs.at(-1).color).toBe(colorForId("overflow-2"));
  });
});
