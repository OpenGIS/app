# Screenshot matrix — design overview

> [!NOTE]
> This is a design document, not an implementation plan. It records the goal,
> the current verified state, the gap, and the options for a future iteration so
> the work can be picked up deliberately. The retired `matrix-identity.yml`
> validation job is preserved verbatim in the [appendix](#appendix--matrix-identityyml-retired).

## Goal

One tight screenshot matrix serving two uses:

1. **Rapid local development** — regenerate the committed visual-evidence set
   quickly and deterministically, without a slow, all-or-nothing full run.
2. **PR tooling** — show **before/after** screenshots of the files a PR changed.
   On GitHub, an example pair (not every capture — most will be unchanged) is
   enough: one representative sample each of mobile, tablet and desktop for the
   changed states.

The two uses pull in opposite directions: local development wants the whole
matrix to be cheap and reproducible, while PR tooling wants to answer "what did
this change look like?" and nothing more.

## Current state (verified)

> [!IMPORTANT]
> Every claim below was checked against the files named in the section before
> being written down. Re-verify if the referenced code moves.

### The matrix

- **46 committed PNGs** under `screenshots/<device>/<orientation>/<state>.png`:
  `6 viewports × 7 UI states` (`42`) plus `4 feature states` at the desktop
  landscape viewport (`46`).
- **6 viewports** (`VIEWPORTS` in
  [`tests/e2e/screenshots/ui-states.spec.js`](tests/e2e/screenshots/ui-states.spec.js)):
  phone portrait/landscape, tablet portrait/landscape, desktop
  portrait/landscape.
- **7 UI states**: `closed`, `menu-open`, `info-open`, `drag-collapsed`,
  `scale-collapsed`, `locate-active`, `record-active`.
- **4 feature states**: `feature-routes`, `feature-route-navigating`,
  `feature-offline`, `feature-recordings`.
- Captures are lossless PNG. The capture gate compares frames byte-for-byte, and
  JPEG's DCT smeared a sub-level sub-pixel flip across a whole 8×8 block,
  disguising a one-level change as a larger block difference; PNG makes a genuine
  flip show as the real pixel change. The specs **snapshot rather than compare**
  (an explicit project decision): they are evidence, not pixel-diff baselines.

### Regenerating

```bash
# matrix project only
npm run test:e2e -- --project=screenshots tests/e2e/screenshots/ui-states.spec.js

# write to a throwaway directory without touching the committed tree
E2E_SCREENSHOTS_DIR="$TMPDIR/ogis-shots" npm run test:e2e -- --project=screenshots tests/e2e/screenshots/ui-states.spec.js

# full local final-verification run (includes the matrix)
npm run test:e2e
```

`ui-states.spec.js` writes to `process.env.E2E_SCREENSHOTS_DIR || "screenshots"`,
so the environment variable redirects output without dirtying the committed
PNGs.

### Concurrency, headless and write safety

- **One worker by default.** `playwright.config.js` pins `workers: 1` for every
  run, so all documented commands — including a bare
  `npx playwright test --project=screenshots tests/e2e/screenshots/ui-states.spec.js`
  — use a single worker. The matrix is contention-sensitive: under four
  concurrent SwiftShader workers the page's main thread is starved, so
  `waitForAnimationsSettled`'s 100 ms interval poller stops running and the wait
  times out with `Stuck animations: {"root":true,"animations":[]}` — nothing is
  actually stuck, it is starvation (reproduced in 2 of 9 matrix tests at 4
  workers). One worker is flake-free. Do not pass `--workers=N`: an explicit flag
  overrides the config default and reintroduces the flake.
- **Measured wall-clock** (all headless; every run produced the matrix
  byte-identical to the committed 46/46): under the single-thread SwiftShader pin
  matrix-only ≈ 28 min, functional-only ≈ 2 min (GPU, unaffected by the pin), and
  the full suite ≈ 30 min. The pre-pin figures — matrix-only 399 s at 4 workers
  (clean) and 635 s (2 flakes), 562 s at 1 worker; full suite 486 s at 4 workers
  and 612 s at 1 — are historical, from before the pin and the lossless-PNG
  switch. One worker is what keeps the run flake-free.
- **Headless only.** The `screenshots` project pins `headless: true`, but
  `--headed` overrides it. A headed capture composites the corner-control chips
  (`backdrop-filter`/`box-shadow` GPU layers) and window chrome differently and
  is not byte-reproducible — it previously clobbered the committed PNGs.
- **In-place write guard.** `assertSafeOutputRoot()` in
  [`tests/e2e/helpers/screenshotsGuard.js`](tests/e2e/helpers/screenshotsGuard.js)
  is the first statement of `capture()` in `ui-states.spec.js`. It refuses to
  write into the committed `screenshots/` directory when the effective run is
  not headless; writes to a temp `E2E_SCREENSHOTS_DIR` are always allowed.

### Rendering projects

Defined in [`playwright.config.js`](playwright.config.js):

| Project       | Scope                                                  | Renderer                                                                 |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `chromium`    | Functional specs + README heroes (`ui-states` ignored) | Local GPU path (`channel: "chromium"`, `--use-angle=metal` on macOS)     |
| `screenshots` | `tests/e2e/screenshots/**/*.spec.js` except the heroes | **Always SwiftShader** (bundled Chromium, no `channel`), any environment |

The `screenshots` project is byte-reproducible precisely because it never uses
the GPU path: ANGLE/Metal rasterisation drifts sub-perceptually across browser
launches. The README heroes are intentionally non-deterministic live captures
and stay on the GPU project.

### Determinism machinery

- [`normaliseCaptureState(page, testInfo)`](tests/e2e/helpers/layout.js) runs
  before **every** `capture()`: `waitForLayoutSettled` (animations settled →
  canvas resized → map idle → glyph requests drained → painted) →
  `refreshScaleControl` → `pinTerrainDepthFar`. The scale refresh runs **before**
  the terrain pin by design.
- Settle uses render-completion signals, not fixed sleeps: `renderOnce` (one
  synchronous `map.redraw()` plus a `render` listener, 2 s fallback) and
  `presentFrames` (two `requestAnimationFrame`s), with `waitForCanvasResize` a
  `ResizeObserver` plus one frame and a 30 s ceiling. These replace the former
  fixed 600/800/300 ms bursts and 250 ms present waits (≈3 s of guaranteed sleep
  per painted settle, across ~61 settles per matrix run), which cut the matrix
  wall-clock from 928 s to ~414–431 s at 4 workers with byte-identical output
  (historical, pre-pin).
- A **freshness probe** inside `capture()` toggles a full-viewport overlay; the
  shot is accepted only when a forced repaint is reflected and **three**
  consecutive lossless render-completion frames are byte-identical. If no
  three-frame fixed point is reached within `MAX_ROUNDS = 12`, `capture()` throws
  instead of writing the last frame.
- `playwright.config.js` pins `timezoneId: "America/St_Johns"` and
  `locale: "en-CA"` for the `screenshots` project, plus
  `--force-color-profile=srgb --disable-lcd-text --font-render-hinting=none
--disable-gpu-rasterization --disable-partial-raster --num-raster-threads=1`.
- [`useMap`](src/composables/useMap.js) passes MapLibre `fadeDuration: 0` when
  `VITE_E2E_FIXTURES === "1"` (test-only; production output is unchanged).
- `assertE2eFixturesActive()` (called from `waitForMapIdle`) fails fast when the
  running map's resolved `_fadeDuration !== 0`, catching a stale dev server
  reused without `VITE_E2E_FIXTURES=1` (which would compile MapLibre's default
  300 ms fade and make every capture timing-dependent).
- The spec also seeds `Math.random`, pins clock-derived values, and suppresses
  GPU-composited `backdrop-filter`/`box-shadow` at capture time.
- The `screenshots` project's SwiftShader worker pool is pinned to one thread:
  [`determinismSetup.js`](tests/e2e/helpers/determinismSetup.js) writes
  `[Processor] ThreadCount=1` to a `SwiftShader.ini` in the browser's working
  directory before any browser launches (and `determinismTeardown.js` removes
  it). SwiftShader's parallel rasterisation is order-nondeterministic for
  overlapping antialiased line fragments, flipping two pixels at Δ1 in ~1 in 6
  desktop-landscape captures; one worker serialises it and reproduces the
  committed bytes (48/48 pinned launches with zero drift — 1200/1200 shots
  identical to the committed `desktop/landscape/closed.png` — against an unpinned
  baseline of ~1 in 6). The pin applies wherever the matrix is rendered — local
  runs and CI's identity job (`--project=screenshots`) — but **not** the
  functional-only CI job (`--grep-invert @screenshots`). Cost: matrix-only
  ~28 min under the pin vs ~9 min.

### Proven identity

The retired validation job recorded that, on commit `d7a8f16`, **two macOS-15 CI
runs each reproduced all 46 then-committed captures byte-for-byte.** Linux
(`ubuntu-latest`) does **not**: Linux font substitution changes DOM text metrics
(panel copy wraps) and canvas rasterisation differs. The exact artefact hashes live in the job's
workflow-run history. This is mechanism-backed evidence, not a proof of
universal determinism — the normalisations pin the inputs known to vary, not
every conceivable raster difference.

### CI today

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs unit tests, the
Prettier format gate, and the **functional** E2E suite only. The `@screenshots`
matrix is excluded
(`--grep-invert @screenshots --shard=N/3`); it runs locally as the final
verification. See [`docs/13.ci.md`](docs/13.ci.md).

## The gap

- A PR currently gets **no automatic visual evidence**. Reviewers must check out
  the branch and run the matrix locally.
- The matrix is **all-or-nothing**: 46 captures, ~28 min at the default single
  worker (under the single-thread SwiftShader pin). There is no cheap way to
  regenerate or compare only the captures a change touched.
- The capture and comparison halves are separate concerns today. Nothing detects
  _which_ captures changed, and nothing presents a before/after view.

## Design options & open questions

Laid out for a later decision — with trade-offs, deliberately undecided.

### Detecting changed captures

- **Diff the committed files.** `git diff --name-only <base>...<head> -- screenshots/`
  gives the exact set of changed PNGs after a matrix regeneration. Simple and
  precise, but only reflects what the matrix actually rewrote.
- **Derive from the change.** Map changed source files to the states/viewports
  they can affect, and regenerate only those. Cheaper, but the mapping is
  heuristic and can miss a cross-cutting change (theme, shared composable).
- **Open question:** is the changed-file set authoritative, or merely a hint that
  should widen to a safe superset?

### Presenting before/after

Joe's sketch: one sample each of mobile / tablet / desktop for the changed
states, not all of them. Candidate mechanisms:

- **A composed comparison image** (before | after, or a difference view), posted
  as a PR comment or uploaded as an artefact. Self-contained and reviewable in
  place; needs an image-composition step.
- **A PR comment** with inline images and a short summary ("3 of 46 captures
  changed"). Lightweight; image hosting/links and bots need consideration.
- **Uploaded artefacts** (before/after directories), linked from a comment.
  Zero composition work, but reviewers must download and eyeball.
- **Open question:** is the goal a quick "did the UI move?" signal, or a
  precise pixel diff? The former tolerates a sample; the latter needs a proper
  diff image.

### Choosing the sample

- **First changed state per device**, in a stable order.
- **A fixed representative state** (e.g. one that exercises the chrome), always
  the same three viewports.
- **Most-changed captures**, ranked by pixel difference.
- **Open question:** how to keep the sample stable and meaningful across PRs
  without cherry-picking that hides regressions.

### Cost & where it runs

- A SwiftShader capture costs **≈50–60 s on GitHub runners** versus **≈15 s
  locally**; the full matrix would need ~60–75 min of runner CPU (per
  [`docs/13.ci.md`](docs/13.ci.md)).
- Options: sharded **macOS** runners (the only environment proven byte-identical
  to the committed matrix; `ubuntu-latest` is not); a partial matrix limited to
  changed captures; or local pre-computation committed by the author.
- **Artefact retention** (the retired job used 14 days) and runner-minute cost
  both need a budget.
- **Open question:** is byte-identity with the committed matrix required for a
  comparison job, or is `macos-15` only needed for _regeneration_ while a
  Linux job could compare looser?

### Gating

- **Required check** vs **advisory comment**. A required visual check risks
  flakiness blocking merges; an advisory one risks being ignored.
- **Re-baselining churn:** any non-cosmetic UI change rewrites committed PNGs.
  How does the job distinguish an intended change (re-baseline) from a
  regression? A human ack, a label, a PR comment command?
- **Open question:** who owns the baseline — the PR author, or a maintainer?

### Determinism requirements

Any new job must respect everything in
[Determinism machinery](#determinism-machinery): the `screenshots` project and
its pinned flags, `normaliseCaptureState` before each capture, the freshness
probe, the pinned timezone/locale, `fadeDuration: 0` under
`VITE_E2E_FIXTURES`, and the fixture-backed map assets. A comparison job that
bypasses these will compare renderer noise, not the change. The macOS-only
identity result is the strongest known constraint.

## Appendix — `matrix-identity.yml` (retired)

The file was a throwaway, `workflow_dispatch`-only validation job answering one
question: can a GitHub-hosted runner reproduce the committed macOS screenshot
matrix byte-for-byte? Its history remains in git; this copy is its new home.

```yaml
name: Matrix identity check

# Throwaway validation (workflow_dispatch only).
#
# Question: can a GitHub-hosted runner — in the always-SwiftShader `screenshots`
# Playwright project — reproduce the committed macOS screenshot matrix
# byte-for-byte?
#
# Linux (ubuntu-latest) does NOT: Linux font substitution changes DOM text
# metrics (panel copy wraps) and canvas rasterisation differs. This pass runs
# on macos-15 (arm64) to test the macOS-VM hypothesis.
#
# Captures into `ci-capture/`, writes a sha256 manifest per shard, and uploads
# both. Compare the downloaded artefacts with the local `screenshots/` tree;
# delete this workflow once the answer is recorded.

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  capture:
    name: capture (shard ${{ matrix.shard }}/6)
    runs-on: macos-15
    timeout-minutes: 180
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4, 5, 6]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "npm"
      - run: npm ci
      - name: Install Playwright browsers
        run: |
          if [ "$RUNNER_OS" = "Linux" ]; then
            npx playwright install --with-deps chromium
          else
            npx playwright install chromium
          fi
      - name: Record versions
        run: |
          node --version
          npx playwright --version
      - name: Capture matrix shard
        env:
          CI: "1"
          E2E_SCREENSHOTS_DIR: ci-capture
        run: npx playwright test --project=screenshots --shard=${{ matrix.shard }}/6
      - name: Write sha256 manifest
        if: always()
        run: |
          if [ -d ci-capture ]; then
            if command -v sha256sum > /dev/null; then SUMS="sha256sum"; else SUMS="shasum -a 256"; fi
            (cd ci-capture && find . -name "*.jpg" | sort | xargs $SUMS) > "ci-capture-shard-${{ matrix.shard }}.sha"
            wc -l "ci-capture-shard-${{ matrix.shard }}.sha"
          else
            echo "no ci-capture output" > "ci-capture-shard-${{ matrix.shard }}.sha"
          fi
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: ci-capture-shard-${{ matrix.shard }}
          path: |
            ci-capture/
            ci-capture-shard-${{ matrix.shard }}.sha
          if-no-files-found: ignore
          retention-days: 14
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: matrix-identity-report-shard-${{ matrix.shard }}
          path: playwright-report/
          if-no-files-found: ignore
          retention-days: 14
```
