import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Same import the app uses in src/App.vue — proves the sprite ships in-repo.
import sprite from "@/icons/ogis-icons.svg?raw";

const ICONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "icons",
);

const readJson = (file) =>
  JSON.parse(readFileSync(join(ICONS_DIR, file), "utf8"));

const generatedCodepoints = readJson("ogis-icons.json");
const sourceCodepoints = readJson("codepoints.json");

/** Symbol ids present in the vendored SVG sprite. */
const symbolIds = [...sprite.matchAll(/<symbol[^>]*\bid="([^"]+)"/g)].map(
  (match) => match[1],
);

/**
 * Every icon id the running app references. Tied to app usage, not the whole
 * sprite, so an accidental deletion of a used symbol fails here:
 *  - position / position-heading — map-marker HTML in useLocate.js
 *  - position-locked / position-unlocked — located and following states of the
 *    locate control in components/ui/controls/locate.vue (position remains its
 *    inactive-state icon)
 *  - layout-sidebar-inset — panel toggle in components/ui/controls.vue
 *  - info-circle — attribution chip in components/ui/controls/attribution.vue
 *  - check / pencil / share / dice — Info panel actions in
 *    components/panels/info.vue
 *  - route / graph-down / file-arrow-down / person-circle / list / map —
 *    feature nav icons in src/features/{recordings,routes,offline,account,
 *    collections,maps}/index.js
 */
const REQUIRED_ICON_IDS = [
  "position",
  "position-heading",
  "position-locked",
  "position-unlocked",
  "layout-sidebar-inset",
  "info-circle",
  "check",
  "pencil",
  "share",
  "dice",
  "route",
  "graph-down",
  "file-arrow-down",
  "person-circle",
  "list",
  "map",
];

describe("vendored icon sprite", () => {
  it("contains every icon id the app references", () => {
    const missing = REQUIRED_ICON_IDS.filter((id) => !symbolIds.includes(id));
    expect(missing, `missing sprite symbols: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("defines 57 symbols with unique ids", () => {
    expect(symbolIds).toHaveLength(57);
    expect(new Set(symbolIds).size).toBe(57);
  });
});

describe("generated icon output consistency", () => {
  it("maps every sprite symbol to a generated codepoint entry", () => {
    const missing = symbolIds.filter((id) => !(id in generatedCodepoints));
    expect(
      missing,
      `sprite symbols absent from ogis-icons.json: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps exactly one orphan codepoint — the upstream 'logo' entry", () => {
    const orphans = Object.keys(generatedCodepoints).filter(
      (id) => !symbolIds.includes(id),
    );
    expect(orphans).toEqual(["logo"]);
  });

  it("has 58 generated codepoint entries", () => {
    expect(Object.keys(generatedCodepoints)).toHaveLength(58);
  });

  it("matches the source codepoints file exactly", () => {
    expect(generatedCodepoints).toEqual(sourceCodepoints);
  });
});

describe("codepoint stability", () => {
  it.each([
    ["file-arrow-down", 0xf133],
    ["map", 0xf134],
    ["waymark-logo", 0xf135],
    ["share", 0xf136],
    ["dice", 0xf137],
  ])("pins %s to U+%s in source and generated maps", (name, codepoint) => {
    expect(sourceCodepoints[name]).toBe(codepoint);
    expect(generatedCodepoints[name]).toBe(codepoint);
  });
});
