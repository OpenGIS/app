import { describe, it, expect } from "vitest";
import {
  MAP_STYLE_TIMEOUT_MS,
  isStyleRequestError,
  mapStatusMessageKey,
  resolveStyleTimeout,
} from "@/resilience/mapRecovery.js";

const STYLE_URL = "https://example.test/style.json";

describe("resolveStyleTimeout", () => {
  it("falls back to the default for missing or invalid values", () => {
    for (const value of [
      undefined,
      null,
      "",
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "not-a-number",
      {},
    ]) {
      expect(resolveStyleTimeout(value)).toBe(MAP_STYLE_TIMEOUT_MS);
    }
  });

  it("keeps a positive finite timeout", () => {
    expect(resolveStyleTimeout(500)).toBe(500);
    expect(resolveStyleTimeout("750")).toBe(750);
  });
});

describe("isStyleRequestError", () => {
  it("matches a failure carrying the style URL", () => {
    expect(isStyleRequestError({ error: { url: STYLE_URL } }, STYLE_URL)).toBe(
      true,
    );
  });

  it("ignores source failures", () => {
    expect(
      isStyleRequestError(
        { error: { url: STYLE_URL }, sourceId: "satellite" },
        STYLE_URL,
      ),
    ).toBe(false);
  });

  it("ignores routine tile, glyph and sprite failures", () => {
    for (const url of [
      "https://tiles.test/1/2/3.png",
      "https://glyphs.test/font.pbf",
      "https://sprites.test/sprite.json",
    ]) {
      expect(isStyleRequestError({ error: { url } }, STYLE_URL)).toBe(false);
    }
  });

  it("ignores malformed events", () => {
    for (const event of [
      null,
      undefined,
      "style failed",
      {},
      { error: null },
      { error: {} },
      { error: { url: 42 } },
    ]) {
      expect(isStyleRequestError(event, STYLE_URL)).toBe(false);
    }
  });

  it("ignores an unknown style URL", () => {
    expect(isStyleRequestError({ error: { url: STYLE_URL } }, null)).toBe(
      false,
    );
    expect(isStyleRequestError({ error: { url: STYLE_URL } }, "")).toBe(false);
  });

  it("never throws for events with throwing getters", () => {
    const event = {};
    Object.defineProperty(event, "error", {
      get() {
        throw new Error("getter boom");
      },
    });

    expect(() => isStyleRequestError(event, STYLE_URL)).not.toThrow();
    expect(isStyleRequestError(event, STYLE_URL)).toBe(false);
  });
});

describe("mapStatusMessageKey", () => {
  it("maps every supported failure code to a locale key", () => {
    for (const code of [
      "unavailable",
      "unsupported",
      "init",
      "style",
      "contextLost",
    ]) {
      expect(mapStatusMessageKey(code)).toBe(`map.status.${code}`);
    }
  });

  it("falls back to the unavailable message for unknown codes", () => {
    for (const code of [undefined, null, "", "other", 42]) {
      expect(mapStatusMessageKey(code)).toBe("map.status.unavailable");
    }
  });
});
