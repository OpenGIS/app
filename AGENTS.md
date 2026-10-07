## Git Policy

**NEVER** stage (`git add`) changes! Git may be used in read-only mode for context (e.g. `git diff`, `git log`, `git status`).

## Read **ALL** of the [Docs](docs/README.md)!

---

## Commands

```bash
npm run dev          # start Vite dev server (app at http://localhost:5174)
npm run build        # build the app for distribution
npm run test:unit    # run vitest unit tests (<10 s)
npm run test:e2e -- tests/e2e/{spec}.spec.js   # run only the relevant E2E spec (development)
npm run test:e2e -- --workers=4                # full E2E suite incl. screenshots — local final verification
npm test             # run unit tests only (rapid development)
npm run format:check # Prettier format gate (the same check CI runs)
npm run format       # rewrite files with Prettier
```

### Running tests — timing guidance

`npm test` runs the unit suite (Vitest) only: 327 tests across 24 files, completing in under 10 seconds. Use it, plus targeted single-spec E2E runs, during rapid development.

CI is a quick gate: unit tests, Prettier, and the **functional** E2E suite only — the screenshot matrix is excluded (`--grep-invert @screenshots`) and sharded three ways. Functional shards are expected to finish in single-digit minutes (measured at ~8 min before the screenshot exclusion). See `docs/13.ci.md`.

**Final verification before declaring a task complete is the full local E2E run** (`npm run test:e2e -- --workers=4`). It includes the `@screenshots` matrix and regenerates the committed `screenshots/` artefacts. Visual verification belongs on the development machine: GitHub runners render with SwiftShader, where a capture costs ~50–60 s versus ~15 s locally, and the full matrix would need ~60–75 minutes of runner CPU.

Formatting is gated by Prettier: CI's `unit` job runs `npm run format:check`. Run `npm run format` before completing a task; [`.prettierignore`](.prettierignore) excludes generated output (build directories, the lockfile, `CHANGELOG.md`, `.opencode/`).

Locally, E2E runs against the full Chromium build with GPU rendering (the default; `--use-angle=metal` on macOS). Run the full suite with `--workers=4` — fast and stable: seconds to a few minutes per test subset, with the screenshot matrix dominating. Prefer targeted single-spec runs while developing. SwiftShader is the CI renderer; set `E2E_SWIFTSHADER=1` to reproduce it locally (much slower). On a fresh machine, `npx playwright install chromium` installs the full build required by the local GPU mode. See `docs/9.testing.md` for rendering-mode and permission details.

When running E2E tests with a shell tool, use `mode="sync"` with `initial_wait` set to at least **180** for a single spec and **600** for the full suite. You will be automatically notified when the command completes — **do not poll repeatedly with short waits**. Wait for the completion notification, then read the output once.

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

### Default Coordinates

Use the following coordinates in all examples and documentation:

```
lat: 50.6539, lng: -128.0094   // Scarlet Ibis Pub, Holberg, British Columbia, Canada
```

In MapLibre `center` arrays (which are `[lng, lat]`):

```js
center: [-128.0094, 50.6539];
```

### Features

Features are plain objects with an `install(ctx)` method. A feature lives in `src/features/{name}/` and is registered in `src/main.js`. See `docs/10.features.md` for the full pattern.

---

## Adding a New Feature

1. Create `src/features/{name}/index.js` with `install(ctx)` method
2. Create `src/features/{name}/{Name}Button.vue` and `{Name}Panel.vue` as needed
3. Register in `src/main.js`: `MyFeature.install(featureCtx)`
4. Create `tests/e2e/features/{name}.spec.js`
5. Run `npm run test:e2e -- tests/e2e/features/{name}.spec.js` during development; run the full local E2E suite (`npm run test:e2e -- --workers=4`) as final verification

See `docs/10.features.md` for the full feature pattern.

---

## MCP

A Playwright MCP server is configured in `.github/mcp.json`. Agents with MCP support can use it to navigate the app and inspect the DOM directly.
