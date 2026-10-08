## Git Policy

**NEVER** stage (`git add`) changes! Git may be used in read-only mode for context (e.g. `git diff`, `git log`, `git status`).

## Read **ALL** of the [Docs](docs/README.md)!

---

## Commands

```bash
npm run dev          # start Vite dev server (app at http://localhost:5174)
npm run build        # build the app for distribution
npm run test:unit    # run vitest unit tests
npm run test:e2e -- tests/e2e/{spec}.spec.js   # run only the relevant E2E spec (development)
npm run test:e2e                            # full E2E suite incl. screenshots — local final verification
npm run test:e2e -- --project=screenshots tests/e2e/screenshots/ui-states.spec.js  # screenshot matrix only
npm test             # run unit tests only (rapid development)
npm run format:check # Prettier format gate (the same check CI runs)
npm run format       # rewrite files with Prettier
```

### Running tests — timing guidance

`npm test` runs the unit suite (Vitest) only. Use it, plus targeted single-spec E2E runs, during rapid development. **Unit tests need Node 24** (CI uses Node 24); on older Node the `tests/unit/countries.test.js` cases that depend on `Intl.Locale.prototype.getTimeZones` fail, because `countryCodeFromTimeZone` deliberately returns null when it is unavailable.

CI is a quick gate: unit tests, Prettier, and the **functional** E2E suite only — the screenshot matrix is excluded (`--grep-invert @screenshots`) and sharded three ways, so the shards finish in single-digit minutes. See `docs/13.ci.md`.

**Final verification before declaring a task complete is the full local E2E run** (`npm run test:e2e`). It includes the `@screenshots` matrix — which runs in a dedicated, always-SwiftShader `screenshots` Playwright project with SwiftShader pinned to a single raster thread so the regenerated matrix is byte-reproducible — plus the functional specs on the local GPU path. Visual verification belongs on the development machine: GitHub runners render with SwiftShader, where captures are far slower than local GPU rendering, so the full matrix is a local final-verification step rather than a CI one.

Formatting is gated by Prettier: CI's `unit` job runs `npm run format:check`. Run `npm run format` before completing a task. The `format`/`format:check` scripts pass [`.gitignore`](.gitignore), [`.prettierignore`](.prettierignore) and a global `~/.config/prettier/ignore` explicitly via `--ignore-path` — Prettier has no native global ignore, and `--ignore-path` overrides its defaults rather than adding to them, so every ignore file is named on the command line. [`.prettierignore`](.prettierignore) excludes generated and vendored output (build directories, `tests/fixtures/`, the lockfile, `CHANGELOG.md`); the global file excludes tooling scratch space.

Locally, functional E2E specs run against the full Chromium build with GPU rendering (the default; `--use-angle=metal` on macOS); CI and `E2E_SWIFTSHADER=1` swap them to SwiftShader. The `screenshots` project is **always** SwiftShader-rendered regardless of environment and pins SwiftShader to a single raster thread, so the committed matrix regenerates deterministically. Run the full suite with the default single worker — the `screenshots` matrix is contention-sensitive, so concurrent SwiftShader workers starve the page's main thread and the animation-settle poller times out with nothing actually stuck; one worker is flake-free. Do not pass `--workers=N`: an explicit flag overrides the default and reintroduces the flake. Prefer targeted single-spec runs while developing; run just the matrix with `npm run test:e2e -- --project=screenshots tests/e2e/screenshots/ui-states.spec.js`, and set `E2E_SCREENSHOTS_DIR="$TMPDIR/ogis-shots"` to capture it to a throwaway directory without touching the committed PNGs. On a fresh machine, `npx playwright install chromium` installs the full build required by the local GPU mode. See `docs/9.testing.md` for rendering-mode and permission details.

When running E2E tests with a shell tool, use `mode="sync"` with `initial_wait` set to at least **180** for a single spec and **1800** for the full suite — the pinned single-thread SwiftShader matrix is slow, so allow ample time. You will be automatically notified when the command completes — **do not poll repeatedly with short waits**. Wait for the completion notification, then read the output once.

## Key Conventions

### Instance isolation

The `instanceId` is read from the `?id=` URL param (default `'app'`) and passed via `app.provide('ogisAppId', instanceId)`. Composables that persist state call `inject('ogisAppId', 'app')` to scope their localStorage keys; `useLocale` scopes a per-instance in-memory cache the same way, and `useSettings` is storage-free (OS-derived). This supports iframe isolation — each iframe gets its own `?id=` and its own storage namespace.

### localStorage key format

```
ogis_{namespace}_{instanceId}
```

Examples: `ogis_view_app`, `ogis_recordings_app`. The instance id is always last — this makes keys easy to read in browser DevTools.

### Composable pattern

Logic lives in composables, not components. Per-instance state is cached in a module-level `Map` keyed by `instanceId`. Example pattern:

```js
const cache = new Map();

export const useMyFeature = () => {
  const instanceId = inject("ogisAppId", "app");

  if (!cache.has(instanceId)) {
    cache.set(instanceId, {
      state: useStorage("my-feature", {/* defaults */}),
    });
  }

  return cache.get(instanceId);
};
```

### CSS selectors

Core elements use `.ogis-*` classes:

- `.ogis-map` — MapLibre container
- `.ogis-controls` — corner-controls overlay (`.ogis-corner--tl/tr/br/bl` clusters)
- `.ogis-attribution-chip` — bottom-left attribution chip
- `.ogis-panel` — Bootstrap offcanvas side panel
- `--ogis-panel-width` — CSS custom property for panel width

### GeoJSON property keys

GeoJSON features use `ogis.*` properties for styles: `ogis.color`, `ogis.width`, `ogis.opacity`, `ogis.radius`, `ogis.fillOpacity`. These are used in MapLibre layer expressions and in feature data.

### Demo area and coordinates

The E2E demo area is derived from the committed GPS fixture: the opening ~2 km
("Day 13") slice of
[`tests/fixtures/recording.geojson`](tests/fixtures/recording.geojson),
which starts at Grand Falls-Windsor, Newfoundland. It is defined **once** in
[`tests/fixtures/demo.mjs`](tests/fixtures/demo.mjs) (exports `DEMO`),
which [`tests/fixtures/map/demoArea.mjs`](tests/fixtures/map/demoArea.mjs)
re-exports as `DEMO_AREA`. That is the single source of truth — **do not
hardcode demo coordinates** in docs or examples.

Examples should reference the module, or use neutral illustrative values that do
not correspond to any canonical area. Remember MapLibre `center` arrays are
`[lng, lat]`.

### Features

Features are plain objects with an `install(ctx)` method. A feature lives in `src/features/{name}/` and is registered in `src/main.js`. See `docs/10.features.md` for the full pattern.

---

## Adding a New Feature

1. Create `src/features/{name}/index.js` with `install(ctx)` method
2. Create `src/features/{name}/{Name}Button.vue` and `{Name}Panel.vue` as needed
3. Register in `src/main.js`: `MyFeature.install(featureCtx)`
4. Create `tests/e2e/features/{name}.spec.js`
5. Run `npm run test:e2e -- tests/e2e/features/{name}.spec.js` during development; run the full local E2E suite (`npm run test:e2e`) as final verification

See `docs/10.features.md` for the full feature pattern.

---

## MCP

A Playwright MCP server is configured in `.github/mcp.json`. Agents with MCP support can use it to navigate the app and inspect the DOM directly.
