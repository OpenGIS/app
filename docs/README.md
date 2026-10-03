# ogis.app — Docs

Developer documentation for the ogis.app codebase.

> [!NOTE]
> The app is currently in **SPA front-end only mode** — the account, maps and collections features (which require a backend) are disabled in the UI.

---

## Contents

| Doc                              | Purpose                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| [1. Setup](./1.setup.md)         | Dev server, build, URL parameters, iframe isolation                                             |
| [2. Instances](./2.instances.md) | Instance ID, localStorage key format, iframe use case                                           |
| [3. Map](./3.map.md)             | `useMap` API: lifecycle, view persistence, URL hash, globe projection, cold-start country focus |
| [4. UI](./4.ui.md)               | `useUI` API: responsive breakpoints, panel, corner controls                                     |
| [5. GeoJSON](./5.geojson.md)     | `useGeoJSON` API: rendering features with styles                                                |
| [6. Locale](./6.locale.md)       | `useLocale` API: translations, language resolution                                              |
| [7. Theme](./7.theme.md)         | Bootstrap SCSS theme architecture and green palette                                             |
| [8. Testing](./8.testing.md)     | Unit and E2E testing conventions                                                                |
| [9. Features](./9.features.md)   | Adding a core feature (internal plugin pattern)                                                 |
| [10. Routes](./10.routes.md)     | GPX import, route rendering, offline navigation                                                 |
| [10. Offline](./10.offline.md)   | Offline region download: service worker, tile enumeration, storage                              |
| [11. CI](./11.ci.md)             | GitHub Actions: jobs, artefacts, conventional commits, semantic-release, Pages deploy           |
