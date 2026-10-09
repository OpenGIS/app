import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeterministicRun } from "./determinism.js";

/**
 * Pin the SwiftShader software rasteriser to a single worker.
 *
 * The committed screenshot matrix is rasterised with SwiftShader (see the
 * `screenshots` project in `playwright.config.js`). With SwiftShader's default
 * worker pool (one per logical CPU) the parallel rasterisation of antialiased
 * vector geometry is not bit-reproducible: across browser launches a sub-level
 * pixel flip appears in ~1 in 6 desktop-landscape captures (two pixels at Δ1 on
 * basemap line edges). It is stable within a launch, so the capture's
 * three-frame fixed-point gate accepts it, but the committed PNGs then differ
 * run to run.
 *
 * SwiftShader reads its configuration from a `SwiftShader.ini` file relative to
 * the GPU process working directory — which is this process's working
 * directory, the same one Playwright launches the browser from. Pinning
 * `Processor.ThreadCount=1` serialises rasterisation and removes the race; the
 * rendered pixels match the committed matrix byte-for-byte. Two workers only
 * reduce the drift rate (measured 1/24 vs 1/6), so one worker is required for a
 * true pin.
 *
 * The pin applies only on the deterministic path — `isDeterministicRun()` in
 * `helpers/determinism.js`: any CI run (`CI` set), a local opt-in
 * (`E2E_SWIFTSHADER_PIN=1`), or an intentional in-place re-baseline
 * (`E2E_SCREENSHOTS_COMMIT=1`, which implies the whole deterministic path). A
 * plain local run renders the full GPU-capable Chromium build and does not
 * write the ini, so it is not serialised and stays fast. CI is the
 * deterministic environment: the matrix identity job reproduces the committed
 * bytes there, and the functional job already renders SwiftShader because
 * `CI=1`. The explicit local flags force the pin for a run that needs
 * byte-reproducible output.
 *
 * The cost is a much slower software renderer: a matrix-only run takes ~30 min
 * (vs ~9 min) and the heavyweight record-active reload can hold the renderer
 * main thread for over a minute, which is why the settle ceilings in
 * `helpers/layout.js` / `helpers/mapIdle.js` are raised.
 */

export default async function globalSetup() {
  if (!isDeterministicRun()) return;
  writeFileSync(
    join(process.cwd(), "SwiftShader.ini"),
    "[Processor]\nThreadCount=1\n",
  );
}
