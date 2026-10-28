---
git_hash: "02cb70d82bf0584a5e370bdc28db76f0a131b835"
modified: "2026-10-28"
---

# ogis.app — Docs

Developer documentation for the ogis.app codebase.

> [!NOTE]
> The app is currently in **SPA front-end only mode** — the account, maps and collections features (which require a backend) are disabled in the UI.

---

## Contents

| Doc                                                      | Purpose                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [1. Terminology](./1.terminology.md)                     | Shared project language: demo area, fixture set, core and CI terms                                                               |
| [2. Setup](./2.setup.md)                                 | Dev server, production preview, build, URL parameters, iframe isolation                                                          |
| [3. Instances](./3.instances.md)                         | Instance ID, localStorage key format, iframe use case                                                                            |
| [4. Map](./4.map.md)                                     | `useMap` API: lifecycle, readiness signals, view persistence, URL hash, globe, country focus, view orientation and follow camera |
| [5. UI](./5.ui.md)                                       | `useUI` and `useActions` APIs: responsive breakpoints, panel, corner controls, actions and map modes, wake lock                  |
| [6. GeoJSON](./6.geojson.md)                             | `useGeoJSON` API: rendering features with styles and direction chevrons                                                          |
| [7. Locale](./7.locale.md)                               | `useLocale` API: translations, language resolution                                                                               |
| [8. Theme](./8.theme.md)                                 | Bootstrap SCSS theme architecture and green palette                                                                              |
| [9. Testing](./9.testing.md)                             | Unit and E2E strategy, rendering modes, fixtures, screenshot matrix                                                              |
| [10. Features](./10.features.md)                         | Adding a core feature (internal plugin pattern)                                                                                  |
| [11. Routes](./11.routes.md)                             | GPX/GeoJSON import, route and waypoint rendering, visibility, follow-mode navigation                                             |
| [12. Offline](./12.offline.md)                           | Offline region download: service worker, tile enumeration, storage                                                               |
| [13. CI](./13.ci.md)                                     | GitHub Actions: jobs, artefacts, screenshot-matrix verification, conventional commits, release, deploy                           |
| [14. Icons](./14.icons.md)                               | End-to-end icon pipeline: sources, generated bundle, `icons:build`, codepoints                                                   |
| [15. Tracks](./15.tracks.md)                             | Canonical v2 track model: segments, waypoints, import/export, migration, caveats                                                 |
| [16. State and resilience](./16.state-and-resilience.md) | Persisted state, hydration, crash containment, locate and navigation restore, map recovery, deliberate exclusions                |
