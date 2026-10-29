# [3.18.0](https://github.com/OpenGIS/app/compare/v3.17.0...v3.18.0) (2026-10-29)


### Bug Fixes

* **locate:** restore following on Apple WebKit ([bceaa35](https://github.com/OpenGIS/app/commit/bceaa35d7d8208e662699fe27511b8a6348616e9))


### Features

* **resilience:** harden sessions and shared state ([e0cddbb](https://github.com/OpenGIS/app/commit/e0cddbb976b39a2c47f6dc9b887fd5e4da4771f4))

# [3.17.0](https://github.com/OpenGIS/app/compare/v3.16.0...v3.17.0) (2026-10-28)


### Bug Fixes

* **preview:** build first and pin the preview port ([02cb70d](https://github.com/OpenGIS/app/commit/02cb70d82bf0584a5e370bdc28db76f0a131b835))


### Features

* **resilience:** add crash-safe state and recovery ([fbe8de6](https://github.com/OpenGIS/app/commit/fbe8de6e856e80bd691084b335104ea08788ddec))

# [3.16.0](https://github.com/OpenGIS/app/compare/v3.15.1...v3.16.0) (2026-10-22)


### Bug Fixes

* **attribution:** collapse chip while the info pane is open ([360e73f](https://github.com/OpenGIS/app/commit/360e73f31ba071e3f924962e25e4778c776ce9e1))
* **map:** end follow mode before map actions ([39b8c3d](https://github.com/OpenGIS/app/commit/39b8c3d53104cc2a7ea6336789553c6074fcfa80))


### Features

* **actions:** add map actions and modes ([8e1081f](https://github.com/OpenGIS/app/commit/8e1081f42a7ba53935ed3ac64038adc1ba4cfd23))
* **routes:** add track model and follow-mode navigation ([e13ee04](https://github.com/OpenGIS/app/commit/e13ee04b7b8a9e3952506ef8e375cec57d60f83c))

## [3.15.1](https://github.com/OpenGIS/app/compare/v3.15.0...v3.15.1) (2026-10-18)


### Bug Fixes

* **ci:** deploy and refresh heroes after a skipped e2e [skip e2e] ([c41dfdd](https://github.com/OpenGIS/app/commit/c41dfdd46f1a341d9f67c0e0f80e9295222d7810))

# [3.15.0](https://github.com/OpenGIS/app/compare/v3.14.0...v3.15.0) (2026-10-18)


### Bug Fixes

* **locate:** stabilise and tune the follow camera ([d33b5d8](https://github.com/OpenGIS/app/commit/d33b5d8b4d4fa65124659919dccad2a51740222c))


### Features

* **i18n:** localise dates, metadata and errors ([c5e6931](https://github.com/OpenGIS/app/commit/c5e6931941cfc4b9ee53919b1fc46947da6546ad))
* **i18n:** refresh locate and privacy copy ([11ae81d](https://github.com/OpenGIS/app/commit/11ae81db520453d2ef68367ed2784a1fef5aab33))
* **locate:** add locked and unlocked chip icons ([9ac3e5a](https://github.com/OpenGIS/app/commit/9ac3e5a4beedc90dc754e21432664c8255cdeaa3))
* **locate:** add speed-adaptive follow camera ([9aa1eff](https://github.com/OpenGIS/app/commit/9aa1eff292d822692e18bb4173a2b976d44f2bd4))
* **locate:** suspend follow camera on user interaction ([98a7dfa](https://github.com/OpenGIS/app/commit/98a7dfa8851335804c30e7ea52864cc38d152bed))

# [3.14.0](https://github.com/OpenGIS/app/compare/v3.13.0...v3.14.0) (2026-10-17)


### Features

* add flat 2D north-up view orientation ([c55f5f4](https://github.com/OpenGIS/app/commit/c55f5f4d5b9e69c4e6763335b1db4b1a95814f6a))
* **i18n:** localise feature panels, core strings and formatting ([71d11ac](https://github.com/OpenGIS/app/commit/71d11acf17667ad65f59739cf665728e145083e7))
* **map:** keep the globe except while drawing an offline region ([165e7bb](https://github.com/OpenGIS/app/commit/165e7bb260d5c209957c32b8d4a2914ca110d969))

# [3.13.0](https://github.com/OpenGIS/app/compare/v3.12.2...v3.13.0) (2026-10-17)


### Features

* **ui:** rework corner buttons into fitted circles ([c8cb318](https://github.com/OpenGIS/app/commit/c8cb3184440e8adbc1f692f866ceb4a3279bbd37))

## [3.12.2](https://github.com/OpenGIS/app/compare/v3.12.1...v3.12.2) (2026-10-16)


### Bug Fixes

* **ui:** fit a random country in-app from the info panel ([71d231c](https://github.com/OpenGIS/app/commit/71d231c8ea744f022fb00755519c43d12a38f55f))

## [3.12.1](https://github.com/OpenGIS/app/compare/v3.12.0...v3.12.1) (2026-10-16)


### Bug Fixes

* **map:** cap zoom-out at the full-globe view ([069d62f](https://github.com/OpenGIS/app/commit/069d62f10b470be194cd38e4c86f04501e585217))

# [3.12.0](https://github.com/OpenGIS/app/compare/v3.11.0...v3.12.0) (2026-10-16)


### Features

* **i18n:** enforce complete locale coverage ([bee7a6a](https://github.com/OpenGIS/app/commit/bee7a6a9697415933c54cd06fdb7d142305dd790))

# [3.11.0](https://github.com/OpenGIS/app/compare/v3.10.2...v3.11.0) (2026-10-16)


### Bug Fixes

* **ui:** stop buttons latching hover styling ([e234061](https://github.com/OpenGIS/app/commit/e234061c354bb8507a1d8634d2805365816963dc))


### Features

* **ui:** rework the info panel actions ([5997dfe](https://github.com/OpenGIS/app/commit/5997dfe65f7a54721f402ba69d969d8dfc75e57a))

## [3.10.2](https://github.com/OpenGIS/app/compare/v3.10.1...v3.10.2) (2026-10-16)


### Bug Fixes

* **recordings:** list saved recordings newest first ([f05793a](https://github.com/OpenGIS/app/commit/f05793aec7bed3af15fe7613afccb72ccfa8bac1))

## [3.10.1](https://github.com/OpenGIS/app/compare/v3.10.0...v3.10.1) (2026-10-15)


### Bug Fixes

* **ui:** let the attribution chip span the full width ([f628eca](https://github.com/OpenGIS/app/commit/f628ecafad63d700bc97230c62b53385341af94f))

# [3.10.0](https://github.com/OpenGIS/app/compare/v3.9.0...v3.10.0) (2026-10-14)


### Features

* **recordings:** move record control into the panel ([07e1f94](https://github.com/OpenGIS/app/commit/07e1f942e87fd2aade32d5da4a7b7fdada86f130))

# [3.9.0](https://github.com/OpenGIS/app/compare/v3.8.0...v3.9.0) (2026-10-08)


### Features

* **e2e:** crack screenshot determinism ([5fc875f](https://github.com/OpenGIS/app/commit/5fc875fe67254b31394481438469380094dee80f))

# [3.8.0](https://github.com/OpenGIS/app/compare/v3.7.2...v3.8.0) (2026-10-07)


### Features

* **icons:** vendor icon set as first-party ([a6925eb](https://github.com/OpenGIS/app/commit/a6925ebd91eca27c35615764a3e17f95f3b73e54))

## [3.7.2](https://github.com/OpenGIS/app/compare/v3.7.1...v3.7.2) (2026-10-05)


### Bug Fixes

* **mobile:** drop viewport-fit=cover and restore h-100 ([5d452bd](https://github.com/OpenGIS/app/commit/5d452bde92d94cd4e6be0cbfb98021dfcf6e95b0))

## [3.7.1](https://github.com/OpenGIS/app/compare/v3.7.0...v3.7.1) (2026-10-04)


### Bug Fixes

* **mobile:** fill viewport in installed iOS PWAs ([59caa97](https://github.com/OpenGIS/app/commit/59caa9751d1b2a7681b16bbb3404f1b39433c9b1))

# [3.7.0](https://github.com/OpenGIS/app/compare/v3.6.1...v3.7.0) (2026-10-04)


### Features

* **map:** focus home country on cold start ([6b2cd42](https://github.com/OpenGIS/app/commit/6b2cd4257afba75d9fd2ddf046787634977b7042))

## [3.6.1](https://github.com/OpenGIS/app/compare/v3.6.0...v3.6.1) (2026-10-03)


### Bug Fixes

* **theme:** apply data-bs-theme on <html> for modals ([39862bc](https://github.com/OpenGIS/app/commit/39862bc27518a95fcb3173b1b4e1d5165fb5bad2))

# [3.6.0](https://github.com/OpenGIS/app/compare/v3.5.0...v3.6.0) (2026-10-03)


### Bug Fixes

* **mobile:** honour safe areas, cap panel width ([726ebd2](https://github.com/OpenGIS/app/commit/726ebd2e0187c46c3ad06a50aad12ec1bd6cc667))
* **panel:** eliminate Bootstrap offcanvas race ([db35f92](https://github.com/OpenGIS/app/commit/db35f92f90c91a9557ecc5b0f72fd5e173516073))


### Features

* **info:** rebrand About with tagline and OGIS logo ([bb6e5e5](https://github.com/OpenGIS/app/commit/bb6e5e50b38b1e764e7500dfdd3def26c6e160c8))
* rebrand onrte to ogis.app ([460ee19](https://github.com/OpenGIS/app/commit/460ee1989ec794b202c90b5fd9321ebda46363c5))

# [3.5.0](https://github.com/OpenGIS/onrte-app/compare/v3.4.0...v3.5.0) (2026-10-02)


### Features

* **info:** sticky attribution and summary toggle ([9748ac4](https://github.com/OpenGIS/onrte-app/commit/9748ac4a12fcc3809a55c106de34c5d8bf0259a4))

# [3.4.0](https://github.com/OpenGIS/onrte-app/compare/v3.3.0...v3.4.0) (2026-10-02)


### Features

* dev-safe service worker, screenshot matrix, sharded CI and releases ([9f5b199](https://github.com/OpenGIS/onrte-app/commit/9f5b199c443b5bde937a2d21df9ced3b23efd295))
