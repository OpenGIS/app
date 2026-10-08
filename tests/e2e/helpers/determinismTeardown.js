import { rmSync } from "node:fs";
import { join } from "node:path";
import { pinApplies } from "./determinismSetup.js";

/**
 * Remove the `SwiftShader.ini` pin written by `determinismSetup.js`.
 *
 * Mirrors the setup's condition so a functional-only CI run (which never
 * writes the file) does not remove another process's pin.
 */
export default async function globalTeardown() {
  if (process.env.CI && !pinApplies()) return;
  rmSync(join(process.cwd(), "SwiftShader.ini"), { force: true });
}
