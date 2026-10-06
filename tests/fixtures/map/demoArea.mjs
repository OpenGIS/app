/**
 * Deterministic demo area — the single source of truth for the vendored E2E
 * map fixtures.
 *
 * One configurable area keeps the Playwright suite free of live external
 * requests: every committable map source is fetched once for this box and
 * committed under `tests/fixtures/map/assets/`, then served same-origin by
 * the E2E Vite plugin. Changing the area means editing this file, re-running
 * `npm run fixtures:refresh`, regenerating the `@screenshots` matrix and
 * committing the result.
 *
 * This file declares **area + policy only**. The authoritative list of map
 * sources lives in the generated, canonical
 * [`style.json`](./style.json) fixture: the generator rewrites that file's
 * URLs into the `__E2E_MAP_BASE__/<host>/<path>` placeholder form, then
 * derives the fetch list from it. Consumers: the fixture generator
 * (`refresh.mjs`), the E2E Vite middleware (`vitePlugin.mjs`), the E2E specs and
 * `docs/1.terminology.md`.
 *
 * The demo geometry itself lives in `../demo.mjs`, derived from the committed
 * recording fixture; this file adds area policy only.
 */

import { DEMO } from "../demo.mjs";

/** Marketing/demo centre used across examples, docs and the screenshot matrix. */
const CENTER = DEMO.center;

/**
 * Modest box around the demo centre. It covers the zoom-16 screenshot viewport
 * and the seeded offline region. The generator pads this box by at least one
 * tile margin at every zoom, so a 1280×720 viewport at `screenshotZoom`
 * centred on the demo centre never hits a gap. Tiles outside the padded box
 * (e.g. the larger z10–11 offline drag, or GB/CH cold-start fits) are not
 * vendored; the middleware degrades those to an instant empty 200, mirroring
 * the glyph fallback. The box is deliberately small — vendoring whole regions
 * at high zoom explodes the file count.
 */
const BOUNDS = DEMO.bounds;

/** Highest zoom the committed screenshot matrix and most specs use. */
const SCREENSHOT_ZOOM = DEMO.screenshotZoom;

/** Every integer zoom the fixture set covers, from the world view to the demo. */
const COVERAGE_ZOOMS = Array.from({ length: SCREENSHOT_ZOOM + 1 }, (_, z) => z);

/**
 * Sources deliberately NOT vendored, with the reason each is excluded. Every
 * other source in `style.json` must have a host in `committableHosts`; the
 * generator fails loudly on any host that is neither committable nor excluded
 * (a policy violation).
 */
const EXCLUDED_SOURCES = [
  {
    id: "attribution",
    reason:
      "Metadata-only source: declares no tiles or URL, so nothing to vendor.",
  },
  {
    id: "esri-satellite",
    reason:
      "Esri World Imagery licensing excludes redistribution. Left live in the style and served a fast 404 in E2E, exercising the app's graceful-degradation path.",
  },
];

/**
 * Hosts whose assets may be vendored and committed. Any tile, glyph or sprite
 * URL on another host is a policy violation and aborts the generator.
 *
 * - `tiles.openfreemap.org` — OpenFreeMap/OpenMapTiles (ODbL), attribution retained.
 * - `tiles.mapterhorn.com` — Mapterhorn DEM (open data), attribution retained.
 * - `tile.ogis.app` — first-party terrain/POI/path tiles.
 * - `www.ogis.org` — first-party glyphs and sprites.
 */
const COMMITTABLE_HOSTS = [
  "tiles.openfreemap.org",
  "tiles.mapterhorn.com",
  "tile.ogis.app",
  "www.ogis.org",
];

/**
 * Glyph ranges to vendor for every font stack the style declares. Only `0-255`
 * is genuinely rendered for the Latin demo/GB/CH views; ranges beyond it
 * degrade to an instant empty 200 at serve time.
 */
const GLYPH_RANGES = ["0-255"];

/**
 * Sprite policy. Only the 1× variants are vendored — the suite runs at
 * devicePixelRatio 1, so the @2x atlas is deliberately omitted.
 */
const SPRITE_SCALE = 1;

const freezeDeep = (value) => {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    return Object.freeze(value);
  }
  return value;
};

export const DEMO_AREA = freezeDeep({
  center: CENTER,
  bounds: BOUNDS,
  screenshotZoom: SCREENSHOT_ZOOM,
  coverageZooms: COVERAGE_ZOOMS,
  excludedSources: EXCLUDED_SOURCES,
  committableHosts: COMMITTABLE_HOSTS,
  glyphRanges: GLYPH_RANGES,
  spriteScale: SPRITE_SCALE,
});
