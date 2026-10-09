/**
 * Whether the current run is on the deterministic SwiftShader path.
 *
 * The committed screenshot matrix is byte-reproducible only under the pinned,
 * single-worker software pipeline: SwiftShader's default multi-threaded
 * rasterisation of antialiased vector geometry is not bit-reproducible across
 * browser launches, and concurrent workers starve the matrix's
 * `waitForAnimationsSettled` poller. Both effects are removed together, so a
 * single predicate drives both gates:
 *
 *   - `CI`                — the deterministic environment (functional and
 *                           matrix-identity jobs).
 *   - `E2E_SWIFTSHADER_PIN=1` — an explicit local opt-in for a run that needs
 *                           byte-reproducible output.
 *   - `E2E_SCREENSHOTS_COMMIT=1` — an intentional in-place re-baseline of the
 *                           committed matrix; it implies the whole deterministic
 *                           path so the user need not also set the pin flag.
 *
 * Used by `determinismSetup.js` / `determinismTeardown.js` (write/remove
 * `SwiftShader.ini`) and `playwright.config.js` (`workers`).
 */
export const isDeterministicRun = () =>
  !!process.env.CI ||
  process.env.E2E_SWIFTSHADER_PIN === "1" ||
  process.env.E2E_SCREENSHOTS_COMMIT === "1";
