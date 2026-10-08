import { resolve } from "node:path";

/**
 * Absolute path of the committed screenshot matrix in the repo.
 *
 * Playwright runs from the repo root, which is also the cwd used when the
 * spec's default `OUT_ROOT` (`"screenshots"`) is written in-place.
 */
export const COMMITTED_SCREENSHOTS_ROOT = resolve("screenshots");

/**
 * Refuse a headed write into the committed screenshot matrix.
 *
 * The committed PNGs are byte-reproducible only under the headless
 * SwiftShader pipeline. A headed capture composites the corner-control chips
 * (`backdrop-filter`/`box-shadow` GPU layers) and window chrome differently,
 * producing non-reproducible output that has previously clobbered the
 * committed matrix. Writes to a temp `E2E_SCREENSHOTS_DIR` are always allowed
 * — only an in-place write into the repo's `screenshots/` from a non-headless
 * run is blocked.
 *
 * `outputRoot` is the resolved capture directory root (`E2E_SCREENSHOTS_DIR`,
 * or `"screenshots"`); `headless` is the effective headless flag.
 */
export const assertSafeOutputRoot = (
  outputRoot,
  headless,
  committedRoot = COMMITTED_SCREENSHOTS_ROOT,
) => {
  if (resolve(outputRoot) === resolve(committedRoot) && !headless) {
    throw new Error(
      `Refusing to write headed captures into the committed screenshot matrix ` +
        `(${resolve(committedRoot)}). Headed rendering composites the ` +
        `corner-control chips non-reproducibly and has previously clobbered ` +
        `the committed PNGs. Set E2E_SCREENSHOTS_DIR to a temp directory ` +
        `outside the repo (e.g. E2E_SCREENSHOTS_DIR="$TMPDIR/ogis-shots") or ` +
        `run headless.`,
    );
  }
};
