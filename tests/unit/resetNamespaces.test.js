import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { INSTANCE_NAMESPACES } from "@/resilience/persistedState";

/**
 * Reset namespace parity gate.
 *
 * The instance-reset namespace list exists twice on purpose: the module list
 * in `src/resilience/persistedState.js`, and the dependency-free copy in the
 * boot fallback inside `index.html`, which must keep working when the app
 * bundle fails. The copies are maintained by hand, so this test fails whenever
 * one side gains, loses or renames a namespace.
 */

// Aliasing Node's URL keeps the bundler from rewriting the literal as an
// asset reference, so the test resolves the repository file directly.
const INDEX_HTML = readFileSync(
  new NodeURL("../../index.html", import.meta.url),
  "utf8",
);

/**
 * Extract the quoted values from the boot fallback's namespace array.
 *
 * Matching the `var namespaces = [...]` block rather than the first array in
 * the file keeps this anchored to the reset handler. The non-greedy body
 * tolerates any line breaks, indentation, quoting style or trailing comma,
 * and stops at the closing bracket, so unrelated later code is not consumed.
 *
 * @param {string} html
 * @returns {string[] | null} Extracted values, or null when the block is gone.
 */
const extractBootFallbackNamespaces = (html) => {
  const block = html.match(/var\s+namespaces\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (!block) return null;
  return Array.from(
    block[1].matchAll(/["']([^"']+)["']/g),
    (match) => match[1],
  );
};

const sorted = (values) => [...values].sort();

describe("reset namespaces", () => {
  it("finds a non-empty namespace list in the boot fallback", () => {
    // Guards against a refactor renaming the variable or reshaping the array,
    // which would otherwise make the parity assertions vacuously pass.
    const namespaces = extractBootFallbackNamespaces(INDEX_HTML);
    expect(namespaces).not.toBeNull();
    expect(namespaces.length).toBeGreaterThan(0);
  });

  it("keeps the boot fallback and module reset lists in sync", () => {
    const namespaces = extractBootFallbackNamespaces(INDEX_HTML);
    expect(sorted(namespaces)).toEqual(sorted(INSTANCE_NAMESPACES));
  });

  it("has no duplicate namespaces on either side", () => {
    const namespaces = extractBootFallbackNamespaces(INDEX_HTML);
    expect(new Set(namespaces).size).toBe(namespaces.length);
    expect(new Set(INSTANCE_NAMESPACES).size).toBe(INSTANCE_NAMESPACES.length);
  });
});
