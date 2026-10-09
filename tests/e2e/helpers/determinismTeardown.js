import { rmSync } from "node:fs";
import { join } from "node:path";
import { isDeterministicRun } from "./determinism.js";

/**
 * Remove the `SwiftShader.ini` pin written by `determinismSetup.js`.
 *
 * Mirrors the setup's condition (`isDeterministicRun()`) so a plain local run
 * — which never writes the file — does not remove another process's pin.
 */
export default async function globalTeardown() {
  if (!isDeterministicRun()) return;
  rmSync(join(process.cwd(), "SwiftShader.ini"), { force: true });
}
