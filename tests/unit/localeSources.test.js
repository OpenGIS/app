import { describe, it, expect } from "vitest";

import {
  ALGORITHM,
  computeSources,
  findStaleSources,
  hashMessage,
} from "../../scripts/locales-sources.js";

const MESSAGES = {
  "menu.info": "Info",
  "menu.menu": "Menu",
  "panel.privacy.title": "Your Private Data",
};

describe("hashMessage", () => {
  it("is deterministic and returns 16 lowercase hex characters", () => {
    const hash = hashMessage("Menu");
    expect(hash).toBe(hashMessage("Menu"));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs for different input", () => {
    expect(hashMessage("Menu")).not.toBe(hashMessage("Info"));
  });
});

describe("computeSources", () => {
  it("stamps every key and sorts them for stable diffs", () => {
    const stamp = computeSources(MESSAGES);
    expect(stamp.algorithm).toBe(ALGORITHM);
    expect(Object.keys(stamp.sources)).toEqual([
      "menu.info",
      "menu.menu",
      "panel.privacy.title",
    ]);
    expect(stamp.sources["menu.info"]).toBe(hashMessage("Info"));
  });
});

describe("findStaleSources", () => {
  it("reports nothing for an exact match", () => {
    expect(findStaleSources(MESSAGES, computeSources(MESSAGES))).toEqual({
      stale: [],
      missing: [],
      orphaned: [],
    });
  });

  it("reports a changed value as stale", () => {
    const stamp = computeSources(MESSAGES);
    const changed = { ...MESSAGES, "menu.info": "Information" };
    expect(findStaleSources(changed, stamp).stale).toEqual(["menu.info"]);
  });

  it("reports an unstamped key as missing and a removed key as orphaned", () => {
    const stamp = computeSources({ "menu.info": "Info" });
    const result = findStaleSources(
      { "menu.info": "Info", "menu.menu": "Menu" },
      stamp,
    );
    expect(result.missing).toEqual(["menu.menu"]);
    expect(result.orphaned).toEqual([]);

    const removed = findStaleSources({}, stamp);
    expect(removed.missing).toEqual([]);
    expect(removed.orphaned).toEqual(["menu.info"]);
  });

  it("round-trips a computed stamp", () => {
    expect(findStaleSources(MESSAGES, computeSources(MESSAGES))).toEqual({
      stale: [],
      missing: [],
      orphaned: [],
    });
  });

  it("fails loudly on an unexpected algorithm", () => {
    expect(() =>
      findStaleSources(MESSAGES, { algorithm: "sha256-8", sources: {} }),
    ).toThrow(/algorithm/);
  });
});
