import { defineConfig, devices } from "@playwright/test";
import { isDeterministicRun } from "./tests/e2e/helpers/determinism.js";

// Rendering mode is env-gated. CI must keep the deterministic SwiftShader
// software renderer used on GitHub runners, while local runs prefer the full
// Chromium build with real GPU acceleration — on macOS via ANGLE/Metal, which
// cuts post-network render settle from ~3 s to ~0.5 s (≈6×).
const useSwiftShader = !!process.env.CI || process.env.E2E_SWIFTSHADER === "1";

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./tests/e2e",
  /* Pin SwiftShader to a single raster worker on the deterministic path only —
     `isDeterministicRun()` (CI, E2E_SWIFTSHADER_PIN=1, or the
     E2E_SCREENSHOTS_COMMIT=1 re-baseline) — so the committed pixels are
     byte-reproducible. A plain local run renders the GPU-capable Chromium
     build and is left unpinned. See tests/e2e/helpers/determinism.js. */
  globalSetup: "./tests/e2e/helpers/determinismSetup.js",
  globalTeardown: "./tests/e2e/helpers/determinismTeardown.js",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* One worker only on the deterministic path (`isDeterministicRun()`: CI,
     E2E_SWIFTSHADER_PIN=1, or E2E_SCREENSHOTS_COMMIT=1). SwiftShader is
     contention-sensitive: concurrent workers starve the screenshot matrix's
     `waitForAnimationsSettled` poller, which intermittently times out even
     though no animation is actually stuck. That matters only for the
     byte-reproducible committed render, so the pin is scoped to it. A plain
     local run leaves `workers` undefined and uses Playwright's default
     parallelism (fast). `--workers=N` still overrides either way. */
  workers: isDeterministicRun() ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [["html", { open: "never" }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: "http://localhost:5184",

    /* Dark is the default scheme for tests/screenshots. The app follows the
       OS/browser prefers-color-scheme setting (no in-app toggle), so light mode
       is verified explicitly by a dedicated ui-states spec test rather than by
       defaulting the whole suite to it. */
    colorScheme: "dark",

    /* Pin the browser locale so units/date formatting is deterministic across
       machines and matches the Canadian demo. Previously it followed the system
       locale — Playwright's Chromium defaulted to en-US, which made a units
       assertion pass only by accident. */
    locale: "en-CA",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      // Functional specs plus the README heroes. The heroes are intentionally
      // non-deterministic (random-country cold start, live tiles) and have
      // always run on this GPU path — keep them out of the SwiftShader matrix
      // project below. The committed matrix spec has its own dedicated project
      // so this one never collects (and thus never writes) the screenshot
      // artefacts — otherwise both projects would capture the same files twice.
      testIgnore: ["**/screenshots/ui-states.spec.js"],
      use: {
        ...devices["Desktop Chrome"],
        // Force full animations: with prefers-reduced-motion MapLibre degrades
        // flyTo/easeTo to an instant jumpTo, which changes the #map hash timing.
        reducedMotion: "no-preference",
        // GPU mode uses the full Chromium build via Playwright's `chromium`
        // channel; SwiftShader mode leaves the channel unset (bundled build),
        // exactly as CI has always run.
        ...(useSwiftShader ? {} : { channel: "chromium" }),
        launchOptions: {
          // Two rendering modes:
          //  - SwiftShader (CI, or E2E_SWIFTSHADER=1): the original, fully
          //    deterministic software renderer.
          //  - GPU (local default): real GPU acceleration; on macOS this adds
          //    ANGLE's Metal backend. Other platforms use the default backend.
          //
          // `--deny-permission-prompts` is added in BOTH modes. In headed mode
          // an unspecified permission (e.g. geolocation) would otherwise raise
          // an interactive prompt that never resolves, hanging tests. Denying
          // it up front makes headed behave like headless (denied). Specs that
          // need a position call context.grantPermissions()/setGeolocation();
          // the CDP grant overrides this switch.
          args: [
            ...(useSwiftShader
              ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
              : process.platform === "darwin"
                ? ["--use-angle=metal"]
                : []),
            "--deny-permission-prompts",
          ],
        },
      },
    },
    {
      // The committed screenshot matrix (`screenshots/**` + README heroes).
      // Always software-rendered: SwiftShader is byte-reproducible across
      // browser launches, whereas the local GPU backends (ANGLE/Metal) leave
      // sub-perceptual anti-aliasing drift that dirties the committed PNGs on
      // every run. Runs regardless of CI/E2E_SWIFTSHADER, and always uses the
      // bundled Chromium build (no `channel`).
      name: "screenshots",
      testMatch: ["**/screenshots/**/*.spec.js"],
      // The README heroes are out of scope for the deterministic matrix: they
      // cold-start on a random country against live tiles by design, and belong
      // to the GPU `chromium` project above.
      testIgnore: ["**/screenshots/readme.spec.js"],
      use: {
        ...devices["Desktop Chrome"],
        reducedMotion: "no-preference",
        // Headless is the required default for the committed matrix: a headed
        // capture composites the corner-control chips (backdrop-filter/box-shadow
        // GPU layers) and window chrome differently, producing non-reproducible
        // captures that previously clobbered the committed files. This pin only
        // sets the default — `--headed` still overrides it (verified), so the
        // real protection against an in-place headed write is the
        // screenshotsGuard in ui-states.spec.js.
        headless: true,
        // Pin the capture timezone to the demo area's zone (Newfoundland):
        // panels format timestamps with the machine's local zone, so captures
        // render in the demo's zone and any runner (e.g. a UTC CI box)
        // reproduces them.
        timezoneId: "America/St_Johns",
        launchOptions: {
          args: [
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--deny-permission-prompts",
            // Pin the colour pipeline and text rasterisation so the same
            // pixels are produced on every machine.
            "--force-color-profile=srgb",
            "--disable-lcd-text",
            "--font-render-hinting=none",
            "--disable-gpu-rasterization",
            "--disable-partial-raster",
            "--num-raster-threads=1",
          ],
        },
      },
    },
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  /* Uses port 5184 to avoid conflicting with the dev server on port 5173/4/5 */
  webServer: {
    command: "npm run dev -- --port 5184",
    url: "http://localhost:5184",
    // Opt the E2E dev server into the app-shell service worker (closest to
    // production) and into the committed map fixtures (same-origin, zero live
    // external requests). Spread process.env so PATH and friends are preserved.
    env: { ...process.env, VITE_SW: "1", VITE_E2E_FIXTURES: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
