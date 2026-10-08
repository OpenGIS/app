# ogis.app

A navigation and mapping tool for everyone, right in the browser.

No API keys, no registration, no app stores and no invasions of privacy. Just open the app and get where you are going.

Built with the [OpenStreetMap](https://www.openstreetmap.org/) ecosystem. Special thanks to [OpenFreeMap](https://openfreemap.org/) for tile hosting.

> [!NOTE]
> The app is currently in **SPA front-end only mode** — the account, maps and collections features (which require a backend) are disabled in the UI.

## Screenshots

![ogis.app — dark theme](DARK.jpg)

![ogis.app — light theme](LIGHT.jpg)

## Features

- Detailed, free global map — no install, no account
- Globe view on first load
- Corner controls for menu, locate and record, plus a merged Info panel (share links, app info, privacy)
- GPS locate with compass heading
- Record GPS tracks and export as GPX
- Import GPX routes and navigate offline
- Download map regions for offline use (via a service worker)
- Multilingual — follows your device language
- Shareable map links
- Map view persisted between sessions
- Light and dark mode, following your device setting
- Works on any device

> [!NOTE]
> **Offline maps** — drag a region on the map to download its tiles and glyphs for offline use. A hand-rolled service worker (`public/sw.js`) caches the app shell and map resources; see [docs/12.offline.md](docs/12.offline.md).

## Planned Changes

- Worldwide language support
- Search ([Nominatim](https://nominatim.org/) integration)
- Better handling of denied location permissions
- Dark map style

## Drawbacks and Limitations

- Location permissions are required for GPS/Compass features. Some users have a deny-all approach to browser permissions and changing them varies between browsers and devices.
- The app does not work in the background or when the device is locked — a common limitation of web apps.
- Depending on a single tile provider ([OpenFreeMap](https://openfreemap.org/)) creates a single point of failure. Self-hosting is an option worth pursuing.
- The app requires an initial connection to load assets and map tiles, even though it works offline thereafter.

## Thanks Open Source!

| Component          | Source                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Map Data**       | &copy; [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)                                      |
| **Tile Hosting**   | [OpenFreeMap](https://openfreemap.org)                                                                            |
| **Rendering**      | [MapLibre GL JS](https://maplibre.org/)                                                                           |
| **Tile Schema**    | [OpenMapTiles](https://www.openmaptiles.org/) / [OSM Bright](https://github.com/openmaptiles/osm-bright-gl-style) |
| **User Interface** | [Vue JS](https://vuejs.org/) / [Bootstrap](https://getbootstrap.com/)                                             |

## Development

### Install

```bash
npm install
```

### Run

Set the backend API origin for cross-subdomain auth/API calls:

> [!NOTE]
> Only needed when the auth/backend features are re-enabled — the app currently runs in SPA front-end only mode.

```bash
echo "VITE_API_BASE_URL=https://api.example.com" > .env.local
```

```bash
npm run dev
```

### Test

```bash
npm test                                          # unit tests (vitest, < 10 s; needs Node 24)
npm run test:e2e -- tests/e2e/{spec}.spec.js      # single E2E spec during development
npm run test:e2e                                 # full E2E suite incl. screenshots — local final verification
npm run test:e2e -- --project=screenshots tests/e2e/screenshots/ui-states.spec.js  # screenshot matrix only
```

Screenshot captures run in a dedicated, always-SwiftShader Playwright project with SwiftShader pinned to a single raster thread, so the committed PNG matrix regenerates byte-for-byte; set `E2E_SCREENSHOTS_DIR` to write captures to a temporary directory instead. The `DARK.jpg`/`LIGHT.jpg` heroes are the deliberate exception — intentionally non-deterministic live captures that a full-suite run refreshes in place every time. See [docs/9.testing.md](docs/9.testing.md) for the testing strategy.

### Continuous integration

CI runs the Vitest suite (including a Prettier format check) and the functional Playwright suite (screenshot specs excluded) in parallel on every push to `master` and every pull request, and uploads the Playwright report as a build artefact. The screenshot matrix runs only in the full local E2E suite — the final verification before declaring a task complete. Releases are automated from [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) — semantic-release bumps the version, updates the changelog, and deploys to GitHub Pages on `master`. See [docs/13.ci.md](docs/13.ci.md).

### Build

```bash
npm run build
```

## Docs

See [docs/README.md](docs/README.md) for the full developer documentation.
