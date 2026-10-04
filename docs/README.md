---
git_hash: "3b10786b88575968a0e74f870cfe886fdf286b1b"
modified: "2026-10-03"
---

# ogis.app — Docs

Developer documentation for the ogis.app codebase.

> [!NOTE]
> The app is currently in **SPA front-end only mode** — the account, maps and collections features (which require a backend) are disabled in the UI.

---

## Contents

| Doc                                  | Purpose                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| [1. Terminology](./1.terminology.md) | Shared project language: demo area, fixture set, core terms                                  |
| [2. Setup](./2.setup.md)             | Dev server, build, URL parameters, iframe isolation                                          |
| [3. Instances](./3.instances.md)     | Instance ID, localStorage key format, iframe use case                                        |
| [4. Map](./4.map.md)                 | `useMap` API: lifecycle, readiness signals, view persistence, URL hash, globe, country focus |
| [5. UI](./5.ui.md)                   | `useUI` API: responsive breakpoints, panel, corner controls                                  |
| [6. GeoJSON](./6.geojson.md)         | `useGeoJSON` API: rendering features with styles                                             |
| [7. Locale](./7.locale.md)           | `useLocale` API: translations, language resolution                                           |
| [8. Theme](./8.theme.md)             | Bootstrap SCSS theme architecture and green palette                                          |
| [9. Testing](./9.testing.md)         | Unit and E2E testing conventions                                                             |
| [10. Features](./10.features.md)     | Adding a core feature (internal plugin pattern)                                              |
| [11. Routes](./11.routes.md)         | GPX import, route rendering, offline navigation                                              |
| [12. Offline](./12.offline.md)       | Offline region download: service worker, tile enumeration, storage                           |
| [13. CI](./13.ci.md)                 | GitHub Actions: jobs, artefacts, conventional commits, semantic-release, Pages deploy        |
