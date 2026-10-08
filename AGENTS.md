# AGENTS.md — ogis.app

Context for agentic coding tools. Read this before making any changes to the codebase.

---

## Git Policy

**Do not** stage (`git add`) or commit (`git commit`) changes. The developer manages all git operations manually. Git may be used in read-only mode for context (e.g. `git diff`, `git log`, `git status`).

---

## Commit Messages — Conventional Commits

All commits — by the developer or agents (when explicitly asked to commit) — must follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification. CI's semantic-release job derives versions, changelogs and GitHub releases from commit messages, so a message that does not parse is invisible to the release process.

Format: `<type>(optional scope): <description>`, e.g. `fix(offline): purge stale tile URLs`.

| Type       | Use for                                              |
| ---------- | ---------------------------------------------------- |
| `feat`     | A new feature (minor release)                        |
| `fix`      | A bug fix (patch release)                            |
| `perf`     | A performance improvement (patch release)            |
| `refactor` | A change that neither fixes a bug nor adds a feature |
| `docs`     | Documentation only                                   |
| `test`     | Tests only                                           |
| `ci`       | CI configuration and scripts                         |
| `chore`    | Maintenance that does not fit the above              |
| `build`    | Build system or dependencies                         |

Breaking changes use `!` after the type/scope (`feat(api)!: …`) or a `BREAKING CHANGE:` footer, and trigger a major release. See `docs/13.ci.md` for the full release flow.

---

## What is this project?

ogis.app is a standalone mapping PWA. It wraps [MapLibre GL JS](https://maplibre.org/) and [Vue 3](https://vuejs.org/) into a full-screen map app with GPS locate, route recording, and a green-themed UI. The app entry point is `src/main.js` and it is built as a standard Vite app (not a library).

The app is a fully installable PWA. It includes a Web App Manifest (`public/manifest.json`), PWA icons (`public/icon-*.png`), and viewport meta tags that disable page-level zoom so MapLibre handles all zooming.

---

## Commands

```bash
npm run dev          # start Vite dev server (app at http://localhost:5174)
npm run build        # build the app for distribution
npm run test:unit    # run vitest unit tests (<10 s)
npm run test:e2e -- tests/e2e/{spec}.spec.js   # run only the relevant E2E spec (development)
npm run test:e2e                            # full E2E suite incl. screenshots — local final verification
npm run test:e2e -- --project=screenshots tests/e2e/screenshots/ui-states.spec.js  # screenshot matrix only
npm test             # run unit tests only (rapid development)
npm run format:check # Prettier format gate (the same check CI runs)
npm run format       # rewrite files with Prettier
```

### Running tests — timing guidance

`npm test` runs the unit suite (Vitest) only: 327 tests across 24 files, completing in under 10 seconds. Use it, plus targeted single-spec E2E runs, during rapid development. **Unit tests need Node 24** (CI uses Node 24); on Node 22.18 six `tests/unit/countries.test.js` tests fail because `countryCodeFromTimeZone` deliberately returns null when `Intl.Locale.prototype.getTimeZones` is unavailable.

CI is a quick gate: unit tests, Prettier, and the **functional** E2E suite only — the screenshot matrix is excluded (`--grep-invert @screenshots`) and sharded three ways. Functional shards are expected to finish in single-digit minutes (measured at ~8 min before the screenshot exclusion). See `docs/13.ci.md`.

**Final verification before declaring a task complete is the full local E2E run** (`npm run test:e2e`). It includes the `@screenshots` matrix — which runs in a dedicated, always-SwiftShader `screenshots` Playwright project with SwiftShader pinned to a single raster thread so the regenerated 46 PNGs are byte-reproducible — plus the functional specs on the local GPU path. Visual verification belongs on the development machine: GitHub runners render with SwiftShader, where a capture costs ~50–60 s versus ~15 s locally, and the full matrix would need ~60–75 minutes of runner CPU.

Formatting is gated by Prettier: CI's `unit` job runs `npm run format:check`. Run `npm run format` before completing a task. The `format`/`format:check` scripts pass [`.gitignore`](.gitignore), [`.prettierignore`](.prettierignore) and a global `~/.config/prettier/ignore` explicitly via `--ignore-path` — Prettier has no native global ignore, and `--ignore-path` overrides its defaults rather than adding to them, so every ignore file is named on the command line. [`.prettierignore`](.prettierignore) excludes generated and vendored output (build directories, `tests/fixtures/`, the lockfile, `CHANGELOG.md`); the global file excludes tooling scratch space.

Locally, functional E2E specs run against the full Chromium build with GPU rendering (the default; `--use-angle=metal` on macOS); CI and `E2E_SWIFTSHADER=1` swap them to SwiftShader. The `screenshots` project is **always** SwiftShader-rendered regardless of environment and pins SwiftShader to a single raster thread, so the committed matrix regenerates deterministically. Run the full suite with the default single worker — the `screenshots` matrix is contention-sensitive, so concurrent SwiftShader workers starve the page's main thread and the animation-settle poller times out with nothing actually stuck; one worker is flake-free and measured ≈ 30 min for the full suite (matrix-only ≈ 28 min under the pin; functional-only ≈ 2 min). Do not pass `--workers=N`: an explicit flag overrides the default and reintroduces the flake. Prefer targeted single-spec runs while developing; run just the matrix with `npm run test:e2e -- --project=screenshots tests/e2e/screenshots/ui-states.spec.js`, and set `E2E_SCREENSHOTS_DIR="$TMPDIR/ogis-shots"` to capture it to a throwaway directory without touching the committed PNGs. On a fresh machine, `npx playwright install chromium` installs the full build required by the local GPU mode. See `docs/9.testing.md` for rendering-mode and permission details.

When running E2E tests with a shell tool, use `mode="sync"` with `initial_wait` set to at least **180** for a single spec and **1800** for the full suite (one worker runs ~30 min under the single-thread SwiftShader pin). You will be automatically notified when the command completes — **do not poll repeatedly with short waits**. Wait for the completion notification, then read the output once.

---

## Source Structure

```
src/
  main.js               # app entry point — reads URL params, creates Vue app, installs features, mounts
  emitter.js            # module-level EventEmitter singleton
  App.vue               # root Vue component
  composables/
    useStorage.js       # localStorage wrapper, instance-scoped
    useUrlHash.js       # URL hash read/write helpers (#map=zoom/lat/lng/pitch/bearing)
    useMap.js           # MapLibre lifecycle, globe projection, cold-start country focus, view persistence
    useUI.js            # UI state: breakpoints, panel
    useAttribution.js   # reactive style attribution (corner chip + Info panel)
    useLocale.js        # i18n: language resolution, translations
    useSettings.js      # OS-derived prefs: units + theme follow the device
    useWakeLock.js      # screen wake lock: acquire on interaction, re-acquire on visibility
    useLocate.js        # GPS locate feature
    useGeoJSON.js       # GeoJSON rendering: points, lines, polygons
  defaults/
    maplibre.js         # MapLibre defaults: style, attributionControl disabled, globe, scale width
  features/
    recordings/
      index.js          # Recordings feature — GPS track recording, GPX export
      RecordButton.vue  # corner control chip (bottom-right)
      RecordingsPanel.vue # side panel
    routes/
      index.js          # Routes feature — GPX import, route rendering, offline navigation
      gpx.js            # pure GPX parser (DOMParser, no dependencies)
      RoutesPanel.vue   # side panel
    offline/
      index.js          # Offline Maps feature — region download orchestration
      tiles.js          # tile maths (lon/lat → tile, bounds → range)
      download.js       # region URL building
      OfflinePanel.vue  # side panel
  utils/
    geo.js              # shared geo helpers: haversine, totalDistance, formatDuration, formatDistance
    countries.js        # country bounds + timezone/locale → region, antimeridian overrides (cold-start country focus)
    attribution.js      # builds the attribution string from a style's sources
    serviceWorker.js    # app-shell SW registration: prod/VITE_SW opt-in, dev self-heal
  components/
    modals/
      modal.vue         # generic modal shell
      locate-confirm.vue # locate permission confirmation
      locate-error.vue  # locate error dialog
    panels/
      info.vue          # Info panel: Map View + About + Privacy + Attribution
    ui/
      controls.vue      # corner-controls overlay: menu, locate, feature chips, attribution
      controls/
        locate.vue      # Locate chip (top-right)
        attribution.vue # Attribution chip (bottom-left)
      icon-button.vue   # IconButton (default + chip variants)
      icon.vue          # sprite icon
      panels.vue        # Bootstrap offcanvas side panel + tab strip
```

---

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

## Docs

| Doc                     | Purpose                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `docs/1.terminology.md` | Shared project language: demo area, fixture set, core terms                              |
| `docs/2.setup.md`       | Dev server, build, URL params, iframe isolation                                          |
| `docs/3.instances.md`   | Instance ID, localStorage key format                                                     |
| `docs/4.map.md`         | `useMap` API: lifecycle, readiness signals, view persistence, URL hash, globe            |
| `docs/5.ui.md`          | `useUI` API: breakpoints, panel, corner controls, wake lock                              |
| `docs/6.geojson.md`     | `useGeoJSON` API: rendering features with styles                                         |
| `docs/7.locale.md`      | `useLocale` API: translations, language resolution                                       |
| `docs/8.theme.md`       | Bootstrap SCSS theme, green palette                                                      |
| `docs/9.testing.md`     | Unit and E2E testing conventions                                                         |
| `docs/10.features.md`   | Adding a core feature (internal plugin pattern)                                          |
| `docs/11.routes.md`     | GPX routes: import, rendering, offline navigation                                        |
| `docs/12.offline.md`    | Offline region download: service worker, tile enumeration, storage                       |
| `docs/13.ci.md`         | CI: GitHub Actions jobs, artefacts, conventional commits, semantic-release, Pages deploy |

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

---

## Further Reading

- `README.md` — app overview, development commands
- `docs/README.md` — docs index
- `docs/1.terminology.md` — shared project language
- `docs/10.features.md` — how to build a feature
