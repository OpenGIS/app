import { writeFileSync } from "node:fs";
import { join } from "node:path";

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
 * The pin applies wherever the committed matrix is rendered, CI included: a
 * GitHub macOS identity run (`npx playwright test --project=screenshots ...`)
 * must reproduce the committed bytes, so the ini is written there too. It is
 * deliberately **not** written for the normal CI functional job
 * (`--grep-invert @screenshots`): that job also renders with SwiftShader
 * (because `CI=1`), but it captures no committed pixels, and serialising so
 * many software-rendered functional specs would blow its time budget. `pinApplies`
 * decides; locally every run writes the ini, preserving the previous behaviour.
 *
 * The cost is a much slower software renderer: a matrix-only run takes ~30 min
 * (vs ~9 min) and the heavyweight record-active reload can hold the renderer
 * main thread for over a minute, which is why the settle ceilings in
 * `helpers/layout.js` / `helpers/mapIdle.js` are raised.
 */

/**
 * True when this Playwright invocation will render the committed screenshot
 * matrix (the `screenshots` project) and so needs SwiftShader serialised.
 *
 * `E2E_SWIFTSHADER_PIN=1` forces the pin regardless — an explicit opt-in for a
 * workflow that invokes the matrix without `--project=screenshots` (e.g. a
 * `--grep @screenshots` filter).
 *
 * With no explicit project filter a run includes the matrix unless the matrix
 * is grep-inverted away — the functional-only CI invocation
 * `--grep-invert @screenshots`.
 */
export const pinApplies = () => {
  if (process.env.E2E_SWIFTSHADER_PIN === "1") return true;

  const args = process.argv.slice(2);
  const valueOf = (name) => {
    const withEquals = args.find((arg) => arg.startsWith(`${name}=`));
    if (withEquals !== undefined) return withEquals.slice(name.length + 1);
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };

  const project = valueOf("--project");
  if (project !== undefined) {
    return project.split(",").some((name) => name.trim() === "screenshots");
  }

  const grepInvert = valueOf("--grep-invert");
  return grepInvert === undefined || !grepInvert.includes("@screenshots");
};

export default async function globalSetup() {
  // Locally every run writes the pin (unchanged behaviour). In CI only a run
  // that renders the matrix does, so the functional shards stay unpinned.
  if (process.env.CI && !pinApplies()) return;
  writeFileSync(
    join(process.cwd(), "SwiftShader.ini"),
    "[Processor]\nThreadCount=1\n",
  );
}
