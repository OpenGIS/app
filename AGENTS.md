# AGENTS.md — On Route App

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

Breaking changes use `!` after the type/scope (`feat(api)!: …`) or a `BREAKING CHANGE:` footer, and trigger a major release. See `docs/11.ci.md` for the full release flow.

---

## What is this project?

On Route App is a standalone mapping PWA. It wraps [MapLibre GL JS](https://maplibre.org/) and [Vue 3](https://vuejs.org/) into a full-screen map app with GPS locate, route recording, and a green-themed UI. The app entry point is `src/main.js` and it is built as a standard Vite app (not a library).

The app is a fully installable PWA. It includes a Web App Manifest (`public/manifest.json`), PWA icons (`public/icon-*.png`), and viewport meta tags that disable page-level zoom so MapLibre handles all zooming.

---

## Commands

```bash
npm run dev          # start Vite dev server (app at http://localhost:5173)
npm run build        # build the app for distribution
npm run test:unit    # run vitest unit tests (<10 s)
npm run test:e2e -- tests/e2e/{spec}.spec.js   # run only the relevant E2E spec (development)
npm run test:e2e -- --workers=4                # full E2E suite incl. screenshots — local final verification
npm test             # run unit tests only (rapid development)
npm run format:check # Prettier format gate (the same check CI runs)
npm run format       # rewrite files with Prettier
```

### Running tests — timing guidance

`npm test` runs the unit suite (Vitest) only: ~230 tests, completing in under 10 seconds. Use it, plus targeted single-spec E2E runs, during rapid development.

CI is a quick gate: unit tests, Prettier, and the **functional** E2E suite only — the screenshot matrix is excluded (`--grep-invert @screenshots`) and sharded three ways. Functional shards are expected to finish in single-digit minutes (measured at ~8 min before the screenshot exclusion). See `docs/11.ci.md`.

**Final verification before declaring a task complete is the full local E2E run** (`npm run test:e2e -- --workers=4`). It includes the `@screenshots` matrix and regenerates the committed `screenshots/` artefacts. Visual verification belongs on the development machine: GitHub runners render with SwiftShader, where a capture costs ~50–60 s versus ~15 s locally, and the full matrix would need ~60–75 minutes of runner CPU.

Formatting is gated by Prettier: CI's `unit` job runs `npm run format:check`. Run `npm run format` before completing a task; [`.prettierignore`](.prettierignore) excludes generated output (build directories, the lockfile, `CHANGELOG.md`, `.opencode/`).

Locally, E2E runs against the full Chromium build with GPU rendering (the default; `--use-angle=metal` on macOS). Run the full suite with `--workers=4` — fast and stable: seconds to a few minutes per test subset, with the screenshot matrix dominating. Prefer targeted single-spec runs while developing. SwiftShader is the CI renderer; set `E2E_SWIFTSHADER=1` to reproduce it locally (much slower). On a fresh machine, `npx playwright install chromium` installs the full build required by the local GPU mode. See `docs/8.testing.md` for rendering-mode and permission details.

When running E2E tests with a shell tool, use `mode="sync"` with `initial_wait` set to at least **180** for a single spec and **600** for the full suite. You will be automatically notified when the command completes — **do not poll repeatedly with short waits**. Wait for the completion notification, then read the output once.

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
    useMap.js           # MapLibre lifecycle, globe projection, view persistence
    useUI.js            # UI state: breakpoints, panel, first-load
    useAttribution.js   # reactive style attribution (corner chip + Info panel)
    useLocale.js        # i18n: language resolution, translations
    useSettings.js      # OS-derived prefs: units + theme follow the device
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
    attribution.js      # builds the attribution string from a style's sources
    serviceWorker.js    # app-shell SW registration: prod/VITE_SW opt-in, dev self-heal
  components/
    modals/
      modal.vue         # generic modal shell
      welcome.vue       # first-load welcome modal (About content)
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

The `instanceId` is read from the `?id=` URL param (default `'app'`) and passed via `app.provide('onrteAppId', instanceId)`. Composables that persist state call `inject('onrteAppId', 'app')` to scope their localStorage keys; `useLocale` scopes a per-instance in-memory cache the same way, and `useSettings` is storage-free (OS-derived). This supports iframe isolation — each iframe gets its own `?id=` and its own storage namespace.

### localStorage key format

```
onrte_{namespace}_{instanceId}
```

Examples: `onrte_view_app`, `onrte_recordings_app`. The instance id is always last — this makes keys easy to read in browser DevTools.

### Composable pattern

Logic lives in composables, not components. Per-instance state is cached in a module-level `Map` keyed by `instanceId`. Example pattern:

```js
const cache = new Map();

export const useMyFeature = () => {
  const instanceId = inject("onrteAppId", "app");

  if (!cache.has(instanceId)) {
    cache.set(instanceId, {
      state: useStorage("my-feature", {/* defaults */}),
    });
  }

  return cache.get(instanceId);
};
```

### CSS selectors

Core elements use `.onrte-*` classes:

- `.onrte-map` — MapLibre container
- `.onrte-controls` — corner-controls overlay (`.onrte-corner--tl/tr/br/bl` clusters)
- `.onrte-attribution-chip` — bottom-left attribution chip
- `.onrte-panel` — Bootstrap offcanvas side panel
- `--onrte-panel-width` — CSS custom property for panel width

### GeoJSON property keys

GeoJSON features use `onrte.*` properties for styles: `onrte.color`, `onrte.width`, `onrte.opacity`, `onrte.radius`, `onrte.fillOpacity`. These are used in MapLibre layer expressions and in feature data.

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

Features are plain objects with an `install(ctx)` method. A feature lives in `src/features/{name}/` and is registered in `src/main.js`. See `docs/9.features.md` for the full pattern.

---

## Docs

| Doc                   | Purpose                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `docs/1.setup.md`     | Dev server, build, URL params, iframe isolation                                          |
| `docs/2.instances.md` | Instance ID, localStorage key format                                                     |
| `docs/3.map.md`       | `useMap` API: lifecycle, view persistence, URL hash, globe                               |
| `docs/4.ui.md`        | `useUI` API: breakpoints, panel, corner controls                                         |
| `docs/5.geojson.md`   | `useGeoJSON` API: rendering features with styles                                         |
| `docs/6.locale.md`    | `useLocale` API: translations, language resolution                                       |
| `docs/7.theme.md`     | Bootstrap SCSS theme, green palette                                                      |
| `docs/8.testing.md`   | Unit and E2E testing conventions                                                         |
| `docs/9.features.md`  | Adding a core feature (internal plugin pattern)                                          |
| `docs/10.routes.md`   | GPX routes: import, rendering, offline navigation                                        |
| `docs/10.offline.md`  | Offline region download: service worker, tile enumeration, storage                       |
| `docs/11.ci.md`       | CI: GitHub Actions jobs, artefacts, conventional commits, semantic-release, Pages deploy |

---

## Adding a New Feature

1. Create `src/features/{name}/index.js` with `install(ctx)` method
2. Create `src/features/{name}/{Name}Button.vue` and `{Name}Panel.vue` as needed
3. Register in `src/main.js`: `MyFeature.install(featureCtx)`
4. Create `tests/e2e/features/{name}.spec.js`
5. Run `npm run test:e2e -- tests/e2e/features/{name}.spec.js` during development; run the full local E2E suite (`npm run test:e2e -- --workers=4`) as final verification

---

## MCP

A Playwright MCP server is configured in `.github/mcp.json`. Agents with MCP support can use it to navigate the app and inspect the DOM directly.

---

## Further Reading

- `README.md` — app overview, development commands
- `docs/README.md` — docs index
- `docs/9.features.md` — how to build a feature
