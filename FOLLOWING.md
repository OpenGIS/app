# Following — locate-following knowledge capture

A briefing on the **locate-following** behaviour: the map camera that tracks the user's GPS position. It maps how the feature behaves today and where it is coupled, ahead of an overhaul that aims to leave it better separated.

> [!NOTE]
> This describes the code as it stands, as raw material for the overhaul — not a target design. "Following" means the locate feature's follow state (the `following` mode of the Locate chip). The Routes feature's "Navigate" mode is a separate, second GPS-following flow; it is covered under [Entanglements](#entanglements-to-separate).

---

## At a glance

| Concern                                                                   | Where it lives today                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| State machine, geolocation watch, follow camera, markers, compass heading | [`src/composables/useLocate.js`](src/composables/useLocate.js)                                                                                                                                         |
| Locate chip (labels, icon, cycle)                                         | [`src/components/ui/controls/locate.vue`](src/components/ui/controls/locate.vue)                                                                                                                       |
| Permission confirmation modal                                             | [`src/components/modals/locate-confirm.vue`](src/components/modals/locate-confirm.vue), rendered app-globally from [`src/App.vue`](src/App.vue)                                                        |
| Error modal                                                               | [`src/components/modals/locate-error.vue`](src/components/modals/locate-error.vue)                                                                                                                     |
| One-shot orientation flight facility                                      | [`src/composables/useOrientView.js`](src/composables/useOrientView.js), [`src/utils/orient.js`](src/utils/orient.js), `orientCameraDefaults` in [`src/defaults/maplibre.js`](src/defaults/maplibre.js) |
| Map lifecycle, `moveend` persistence, `map:ready`                         | [`src/composables/useMap.js`](src/composables/useMap.js)                                                                                                                                               |
| Screen wake lock (app-global, not locate-specific)                        | [`src/composables/useWakeLock.js`](src/composables/useWakeLock.js)                                                                                                                                     |
| Recordings permission reuse                                               | `requestPermission` in [`src/features/recordings/index.js`](src/features/recordings/index.js)                                                                                                          |
| Routes "Navigate" second GPS flow                                         | `startNavigation` in [`src/features/routes/index.js`](src/features/routes/index.js)                                                                                                                    |

---

## Current behaviour

### Chip states and labels

- `mode` is `null | 'active' | 'following' | 'error'` (`useLocate.js`), and the chip maps it to labels and visuals ([`locate.vue`](src/components/ui/controls/locate.vue)):
  - **Locate** (`null`) — inactive, default colour.
  - **Located** (`active`) — tracking, not following. Primary colour, `aria-pressed="true"`. The mode flips on activation, so the label reads "Located" **before any fix arrives**.
  - **Following** (`following`) — primary colour, `position-locked` icon.
  - **Error** (`error`) — danger colour, not pressed.
- Labels resolve through `locate.button.*` keys in [`src/locales/en.json`](src/locales/en.json) / `fr.json`.
- The chip uses `IconButton`'s chip variant and carries the fitted-label levers (`iconSize`, `labelTarget`); its colour reflects follow mode alone — there is deliberately no `:hover` colour change (pinned by E2E on pointer and touch).

### Starting, cycling and stopping

- `cycle()` is the chip's whole state machine:
  - `error` → re-opens the error modal.
  - `null` → runs the permission gate, then `startWatching()`.
  - `active` → sets `following` and, if a fix exists, eases the camera to it.
  - `following` → `stop()`.
- There is no direct **active → stop**: a session ends by cycling through following or by an error.
- `stop()` bumps a generation counter (discarding in-flight callbacks), clears any pending orient retry, stops the watcher and the orientation listener, removes both markers, and clears `mode`/`position`. It does **not** move the camera.

### Permission flow

- A stored grant lives at `ogis_locate_{instanceId}` (`useStorage("locate", { permissionGranted: false })`).
- First activation with no stored grant opens the confirmation modal; `confirmLocate()` stores the grant and runs the pending callback. Any successful fix also sets the grant.
- Geolocation error code 1 (`PERMISSION_DENIED`) switches the chip to Error and opens the error modal (re-enable steps plus Retry). `retryPosition()` hides the modal, clears the error, and restarts the watch, bypassing the confirmation modal.
- Closing the error modal leaves the Error state; clicking the chip re-opens it. In Error mode the chip shows `locate-btn--error`, but no stylesheet rule targets that class — the colour comes from the inline icon colour.

### Watching and fixes

- `startWatching()`: if `navigator.geolocation` is absent, `mode` goes straight to `error`; otherwise it sets `active`, arms the orientation flag, requests DeviceOrientation permission (iOS), then starts `navigator.geolocation.watchPosition` with `{ enableHighAccuracy: true }` — no `timeout` or `maximumAge`.
- `onPosition()` ignores stale generations and post-stop callbacks, stores a [`Position`](src/classes/Position.js) (`lat`, `lng`, `heading`, `accuracy`, `speed`), refreshes the magnetic declination, applies the one-shot orientation flight, syncs markers, and — only while `following` — recentres the camera.
- `Position.heading` and `.speed` are captured but unused anywhere downstream.
- `onError()` stops everything, removes markers, sets `error`, and opens the modal **only** for permission denial. Other errors (unavailable position, etc.) leave an Error chip with no automatic modal; clicking the chip still opens the permission-denied copy.

### The follow camera

- While following, every accepted fix calls `map.easeTo({ center: [lng, lat] })` — **centre only**. Zoom and bearing stay as the user had them; there is no zoom-follow and no bearing-follow.
- **Panning away does not stop following.** There is no `movestart`/`dragstart`/user-interaction listener anywhere in the feature: a user pan or zoom is allowed, and the next fix recentres. Only the chip cycle (or an error) ends following.
- The second click also uses `easeTo`, so clicking during the first-fix orientation flight interrupts that flight.
- Because `useMap` persists every `moveend` (programmatic moves bypass the gesture throttle), each follow recentre rewrites the `#map=` hash and `ogis_view_{instanceId}`. Stopping leaves the camera — and the saved view — at the last followed position.
- Following never touches the projection. `orientView` is projection-neutral and `switchProjection` is a scoped facility whose only call site is offline region selection ([`OfflinePanel.vue`](src/features/offline/OfflinePanel.vue) `startDraw`), so following keeps the globe.

### One-shot orientation flight

- On activation, `needsInitialOrient` is set; `applyOrientFlight()` consumes it on the first fix once the map exists and `orientView({ target })` returns `true` (the camera in map state, the flag in locate state).
- At activation, `armOrientRetry()` registers a one-shot `map:ready` listener when no map instance exists yet, so a fix that lands before map init is retained; if the canvas has no usable size yet, the flag stays armed and later fixes retry.
- The flight: `flyTo` the user, zoomed to fit the line-of-sight horizon disc (1.83 m eye height), padded by 8 % of the smaller viewport axis, with bearing and pitch reset to 0. Duration blends a distance curve with a bearing-rotation floor (`src/utils/orient.js`). Flights never set `essential` or `maxDuration`, so MapLibre zeroes the duration for reduced-motion users.
- It fires again on every activation after a stop (covered by E2E).

### Markers

- Two mutually exclusive MapLibre `Marker`s: `.ogis-locate-position` (`#position` sprite) with no compass heading, `.ogis-locate-heading` (`#position-heading`) once a heading exists, with `rotationAlignment: 'map'` and rotation set to the rounded smoothed heading.
- Markers are never created or resurrected in `null`/`error` mode, and both are removed on stop and on error. They are plain MapLibre markers — locate does not use `useGeoJSON`.

### Compass heading

- `deviceorientationabsolute` is preferred, falling back to `deviceorientation`; relative events without `webkitCompassHeading` are ignored.
- iOS: `webkitCompassHeading` plus the position-derived magnetic declination (`magvar`), corrected to true north. Android absolute events: `(360 - alpha) % 360`.
- Readings are low-pass smoothed (`HEADING_SMOOTH = 0.15`, `smoothAngle()`), then rounded.
- A watchdog runs only **after the first valid heading event** (so compass-less devices never alert): roughly 8 s without events sets `headingLost` and clears the heading, dropping the marker back to position-only.
- `headingLost` and `retryOrientation` are exposed on the composable, but **no component reads them** — there is no compass-loss UI and no in-app re-request path, even though `retryOrientation()` implements one.

---

## Code map

- **State**: a module-level `locateCache` `Map` keyed by `instanceId` — one shared state per app/iframe instance. The cache is created on first use and never removed.
- **Actions** (`cycle`, `requestPermission`, `confirmLocate`, `stop`, `retryOrientation`, `retryPosition`) and **internals** (`startWatching`, `stopWatcher`, `onPosition`, `onError`, `applyOrientFlight`, `armOrientRetry`, `clearOrientRetry`, `startOrientationWatching`, `stopOrientationWatching`, `syncMarkers`, `removeMarkers`) all live in `useLocate.js`.
- **Generation guard**: `startWatching`, `stop` and `onError` bump `generation`; callbacks capture it and bail when stale — the mechanism that lets a stop, a restart, or an error race-safely supersede in-flight work.
- **Orientation-flight lifecycle**: the flag, `map:ready` retry and consumption stay in `useLocate.js`; only the flight maths/application is delegated to `useOrientView`.
- **Instance scoping**: the composable resolves `inject("ogisAppId", "app")`, or takes an explicit `instanceId` (Recordings passes its own). Storage key: `ogis_locate_{instanceId}`, instance id from the `?id=` URL param (default `app`) — see [Instances](docs/3.instances.md).
- **Map interaction**: `getMapInstance(instanceId)` from `useMap.js`; `map:ready` is emitted from `style.load`. `useMap` owns view persistence (`moveend` → hash + `ogis_view_{instanceId}`; programmatic moves persist un-throttled, gestures throttled) and the `data-map-ready`/`data-map-idle` test signals.
- **Wake lock**: `useWakeLock` is initialised in `App.vue`, acquired on the first click anywhere and re-acquired on visibility. It has no connection to locate/follow state.

---

## Entanglements to separate

1. **One composable, many concerns.** Permission gating, watch lifecycle, follow-camera behaviour, orientation flight lifecycle, marker rendering and compass-heading sourcing all share one cache object and one public API. `mode` is the only coordination point.
2. **The permission gate is shared with Recordings.** Recording start calls `useLocate(...).requestPermission(doStart)`, so the same confirmation modal and `permissionGranted` flag gate both features. A single `pendingCallback` slot is overwritten by a later request, and `confirmLocate()` runs whichever callback happens to be stored.
3. **Routes "Navigate" is an independent second GPS-following flow.** `startNavigation()` runs its own `watchPosition` (`enableHighAccuracy: true, maximumAge: 2000`), with a `null` error callback (errors are swallowed), a `useGeoJSON` point marker, and no camera follow, no heading, no permission gate and no shared state with locate. It stops on an explicit Stop, on route deletion, or on app destroy. It shares only the concept, not the code.
4. **The follow camera rides on `useMap`'s view persistence.** Every fix's `easeTo` is a programmatic move, so it persists un-throttled to the hash and localStorage. Follow behaviour and "what the saved view means" are therefore entangled.
5. **Orientation flight: partly separated.** The flight facility (`orientView`/`switchProjection` + pure helpers) is already carved out; the one-shot flag, `map:ready` retry and generation interaction remain in `useLocate`. `switchProjection` is **not** part of following — offline region selection is its only call site.
6. **Wake lock is app-global.** It engages on any click, regardless of whether locate is active, let alone following.
7. **UI split across three components.** The chip owns `cycle()` (view decides transitions), the confirmation modal is rendered app-globally in `App.vue` because Recordings shares it, and the error modal is mounted by the chip component.
8. **Instance scoping is per call site.** Components inject the instance; Recordings passes it explicitly; storage and cache keys follow the common pattern from [`useStorage`](src/composables/useStorage.js) and [Instances](docs/3.instances.md).

---

## Known quirks and limitations

- **"Located" before a fix.** `mode` becomes `active` as soon as watching starts — before the browser prompt resolves and before any position fix. A hung permission prompt leaves a "Located" chip with no marker and no timeout.
- **Panning away keeps following.** Unspecified but currently unguarded: any fix recentres the camera. Zoom and bearing are never restored.
- **Following overwrites the saved view continuously** (hash + localStorage), as described above.
- **No stop from active.** Stopping requires active → following → stop.
- **Interrupted flight.** The second click's `easeTo` interrupts an in-progress orientation flight; the E2E and screenshot suites deliberately wait for the flight's settled hash before the second click.
- **Heading loss is invisible.** `headingLost`/`retryOrientation` have no consumers; the watchdog only arms after a first valid event, so devices without a compass stay quiet.
- **Error copy is permission-specific.** Any error state shows the permission-denied modal on chip click, even for non-denial causes.
- **Vestigial class.** `locate-btn--error` is applied but not styled anywhere.
- **Captured-but-unused data.** `Position.heading`/`.speed` and the `permissionGranted` computed are never consumed outside the composable.
- **BUGS.md status.** No open entry touches locate or following; the projection fix recorded there (#8) is offline region selection and unrelated.
- **Stale doc reference.** The locate E2E spec header still points at `docs/guide/features/locate.md`, a path that no longer exists; the docs index is [`docs/README.md`](docs/README.md).
- **Test coupling to the hash.** Locate's camera-settle checks read the `moveend`-written URL hash; a change to view persistence would ripple into the locate and screenshot suites.

---

## Test coverage

- **E2E — [`tests/e2e/features/locate.spec.js`](tests/e2e/features/locate.spec.js)**, by `describe` block:
  - **Button** — visibility, label, pressed state.
  - **Hover capability** (pointer and touch) — the inactive chip's colour does not change on hover.
  - **Confirmation modal** — first-use modal, body copy, cancel, confirm starts tracking, no modal when granted, close-control hover.
  - **Recordings integration** — recording start shares the confirmation modal; cancel leaves the recording stopped.
  - **Active and Following states** — `Located` label, second click advances to `Following`, third returns to `Locate`, marker appears and is removed on stop.
  - **Orientation reset** — first fix flies to the horizon-fitted, north-up view; the flight keeps the globe (projection asserted live); the flight fires again on re-activation after a stop (seeded z10 view proves the refit); a user-rotated boot (pitch/bearing) is reset to north-up.
  - **Error state** — Error label plus modal on denial, re-enable instructions, close keeps the state, chip re-opens the modal.
  - **Heading marker** — iOS `webkitCompassHeading` path and absolute `alpha` fallback, both asserting the marker's rendered rotation.
  - **Error modal retry** — retry after granting permission clears the error.
  - **French locale** — confirmation and error modals render French strings and accessible labels.
- **Screenshot matrix — [`tests/e2e/screenshots/ui-states.spec.js`](tests/e2e/screenshots/ui-states.spec.js)**: `locate-active` at every device/orientation; `locate-following` and `locate-error` at desktop landscape; `locate-confirm-modal` and `locate-error-modal` at every device/orientation. Captures are committed and verified pixel-tolerantly by the `Screenshots` workflow (see [Testing](docs/9.testing.md)).
- **Unit**: [`tests/unit/orient.test.js`](tests/unit/orient.test.js) covers the pure orient helpers (`horizonDistanceMetres`, `fitZoomForDisc`, `shortestBearingDelta`, `orientFlightDurationMs`); [`tests/unit/useOrientView.test.js`](tests/unit/useOrientView.test.js) covers `orientView` (projection-neutral camera and location targets) and the scoped `switchProjection`.
- **Adjacent coverage**: [`settings.spec.js`](tests/e2e/features/settings.spec.js) checks the locate chip's French label, runtime language switching, and the teleported confirmation modal's theme inheritance; the routes and recordings specs seed `ogis_locate_app` permission to skip the modal.

### Gaps

- No unit tests for `useLocate.js` — the state machine, generation guard, permission gate, marker lifecycle, and smoothing maths have no direct coverage (`smoothAngle` is not exported).
- No E2E moves the mocked fix **while following** and asserts the camera recentres; following is covered by the chip label, marker removal and a matrix capture only.
- Pan/zoom semantics during following (the unspecified behaviour above) have no test.
- `headingLost` and `retryOrientation` are untested, as are non-denial geolocation errors.
- No E2E exercises a non-default `?id=` instance for locate, so per-instance isolation is evidenced by unit patterns rather than a browser test.
- The `map:ready` retry (a fix landing before map init) is not directly tested.

---

## Separation opportunities

Observations only — the seams that the current design already suggests, not a proposed design.

- **The natural splits** run between: permission gate; watch-session lifecycle (generation, watcher, errors); follow camera (mode transitions + `easeTo` policy); heading source (events, smoothing, loss watchdog); markers; and the one-shot orientation-flight lifecycle. Today all six share one cache object, so any split must decide who owns `mode` and `generation`.
- **Three `watchPosition` call sites** exist (locate, recordings, routes) with different error policies — locate surfaces denial, recordings passes through silently, routes swallows with a `null` callback. A single position source is the obvious seam, but the lifecycles and options differ today.
- **Follow-camera semantics are undefined rather than implemented.** Whether interaction suspends following, whether zoom/bearing should track, and what happens on error are open questions the overhaul must settle before extracting the camera.
- **View persistence is coupled to following.** Deciding whether programmatic follow moves should overwrite the user's saved view changes both `useMap` and locate.
- **Orientation is already half-separated.** `orientView`/`switchProjection` and the pure helpers are a working precedent for the target shape; `switchProjection` belongs to offline selection only.
- **Heading loss and retry are dead API.** Wiring them to UI, or removing them, is a small standalone decision that de-tangles the heading source.
- **The wake lock's owner is ambiguous.** It is app-global today; tying it to active tracking (rather than any click) would be a cross-feature decision.
- **The chip's `cycle()` encodes transitions in the view.** A future split would likely keep the view dumb and move the machine into the owning module.
- **The confirm modal is a shared service** (locate + recordings) rendered globally from `App.vue`; a permission concern that knows nothing about locate would fit the existing shape.
- **The test gaps above sit on the seams.** The follow-camera, heading and permission boundaries are the least-covered areas, and they are the same boundaries a separation would move.

---

## Related documentation

- [Map — view orientation, projection and view persistence](docs/4.map.md#view-orientation)
- [UI — corner controls](docs/5.ui.md#corner-controls) and [screen wake lock](docs/5.ui.md#screen-wake-lock--usewakelock)
- [Testing — E2E structure](docs/9.testing.md#e2e-structure), [map waits](docs/9.testing.md#waiting-for-the-map) and [screenshots](docs/9.testing.md#screenshots)
- [Routes — navigation](docs/11.routes.md#navigation)
- [Offline — the scoped projection switch](docs/12.offline.md#region-selection)
- [Icons — marker sprites](docs/14.icons.md)
- [Locale — locate message keys](docs/7.locale.md)

Root-level working files (`BUGS.md`, `TODOS.md`, `SPA.md`) are kept standalone and are not linked from the docs index; this file follows that convention, so nothing else in the repository links to it.
