import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Translation source fingerprints. A sidecar stamp records the SHA-256 of each
// exact English message at the moment its translation was last reviewed. When
// an English message changes afterwards, its hash no longer matches and the
// completeness gate reports the translation as stale — a faithful translation
// of a superseded English string is drift the structural checks cannot see.
// Dependency-free — Node builtins only.

export const ALGORITHM = "sha256-16";

export const hashMessage = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);

export const computeSources = (messages) => {
  const sources = {};
  for (const key of Object.keys(messages).sort()) {
    sources[key] = hashMessage(messages[key]);
  }
  return { algorithm: ALGORITHM, sources };
};

export const findStaleSources = (messages, stamp) => {
  if (stamp.algorithm !== ALGORITHM) {
    throw new Error(
      `Locale source stamp uses algorithm ${JSON.stringify(stamp.algorithm)}; expected ${JSON.stringify(ALGORITHM)}. Run npm run locales:stamp to re-stamp with the current algorithm.`,
    );
  }

  const sources = stamp.sources ?? {};
  const stale = [];
  const missing = [];
  const orphaned = [];

  for (const [key, value] of Object.entries(messages)) {
    if (!Object.prototype.hasOwnProperty.call(sources, key)) {
      missing.push(key);
    } else if (sources[key] !== hashMessage(value)) {
      stale.push(key);
    }
  }

  for (const key of Object.keys(sources)) {
    if (!Object.prototype.hasOwnProperty.call(messages, key)) {
      orphaned.push(key);
    }
  }

  return { stale, missing, orphaned };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGLISH_FILE = join(ROOT, "src", "locales", "en.json");
const STAMP_FILE = join(ROOT, "tests", "fixtures", "locale-sources.json");

const scriptPath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";

if (scriptPath === invokedPath) {
  const messages = JSON.parse(readFileSync(ENGLISH_FILE, "utf8"));
  const stamp = computeSources(messages);
  writeFileSync(STAMP_FILE, `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`Stamped ${Object.keys(stamp.sources).length} English messages.`);
}
