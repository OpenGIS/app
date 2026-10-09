import { resolve } from "node:path";

/**
 * Absolute path of the committed screenshot matrix in the repo.
 *
 * Playwright runs from the repo root, which is also the cwd used when the
 * matrix is written in place on the intentional re-baseline path
 * (`E2E_SCREENSHOTS_COMMIT=1`).
 */
export const COMMITTED_SCREENSHOTS_ROOT = resolve("screenshots");

/**
 * Refuse an in-place write into the committed screenshot matrix unless it is an
 * intentional, headless re-baseline.
 *
 * The committed PNGs are byte-reproducible only under the headless
 * SwiftShader pipeline, so the write is allowed only when the run is both
 * headless and explicitly opted in with `E2E_SCREENSHOTS_COMMIT=1`. A headed
 * capture composites the corner-control chips (`backdrop-filter`/`box-shadow`
 * GPU layers) and window chrome differently, producing non-reproducible output
 * that has previously clobbered the committed matrix. Every other output root
 * (the default gitignored temp dir, an `E2E_SCREENSHOTS_DIR` override) is
 * allowed from either mode.
 *
 * `outputRoot` is the resolved capture directory root; `headless` is the
 * effective headless flag.
 */
export const assertSafeOutputRoot = (
  outputRoot,
  headless,
  committedRoot = COMMITTED_SCREENSHOTS_ROOT,
) => {
  const writingCommitted = resolve(outputRoot) === resolve(committedRoot);
  const rebaselining = process.env.E2E_SCREENSHOTS_COMMIT === "1" && headless;
  if (writingCommitted && !rebaselining) {
    throw new Error(
      `Refusing to write into the committed screenshot matrix ` +
        `(${resolve(committedRoot)}). An in-place write requires a headless ` +
        `run and the intentional re-baseline flag E2E_SCREENSHOTS_COMMIT=1: ` +
        `a headed or accidental capture composites the corner-control chips ` +
        `non-reproducibly and has previously clobbered the committed PNGs. ` +
        `For an exploratory or headed capture set E2E_SCREENSHOTS_DIR to a ` +
        `temp directory outside the repo ` +
        `(e.g. E2E_SCREENSHOTS_DIR="$TMPDIR/ogis-shots").`,
    );
  }
};
