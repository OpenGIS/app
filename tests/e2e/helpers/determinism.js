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
 *   - `E2E_SWIFTSHADER_PIN=1` — an explicit local opt-in that reproduces the
 *                           deterministic pipeline's captured output.
 *   - `E2E_SCREENSHOTS_COMMIT=1` — an explicit in-place write of the local
 *                           capture set into the committed matrix; it implies
 *                           the whole deterministic path so the user need not
 *                           also set the pin flag. Committed baselines are
 *                           normally sourced from the Screenshots workflow's
 *                           captured artifacts (`npm run screenshots:fetch`)
 *                           instead, and local captures are for relative /
 *                           visual comparison.
 *
 * Used by `determinismSetup.js` / `determinismTeardown.js` (write/remove
 * `SwiftShader.ini`) and `playwright.config.js` (`workers`).
 */
export const isDeterministicRun = () =>
  !!process.env.CI ||
  process.env.E2E_SWIFTSHADER_PIN === "1" ||
  process.env.E2E_SCREENSHOTS_COMMIT === "1";

/**
 * Whether the current run renders with SwiftShader.
 *
 * Mirrors the `useSwiftShader` condition in `playwright.config.js` exactly:
 * any CI run, or an explicit `E2E_SWIFTSHADER=1` opt-in. Keep the two in sync.
 * It selects the software rasteriser, whose multi-second frames need much
 * larger interaction budgets than the local GPU path.
 */
export const isSwiftShaderRun = () =>
  !!process.env.CI || process.env.E2E_SWIFTSHADER === "1";
