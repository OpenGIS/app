import { defineConfig, devices } from "@playwright/test";

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
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* CI runs a single worker: SwiftShader is contention-sensitive, and 2 workers
     produced screenshot stalls without speeding the long shard. Local runs keep
     Playwright's default. */
  workers: process.env.CI ? 1 : undefined,
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

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
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
