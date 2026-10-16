import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Translation completeness gate.
 *
 * Locale files are flat dotted-key JSON; `en.json` is the source of truth and
 * every other `src/locales/*.json` is a translation. These tests fail on the
 * drift that would otherwise leak raw keys or untranslated strings into the
 * UI: keys added on one side only, empty values, values left in English, and
 * `t()` calls whose keys are missing, misspelled, or unverifiable.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const LOCALES_DIR = join(ROOT, "src", "locales");
const SRC_DIR = join(ROOT, "src");
const DEFAULT_LOCALE = "en";

/**
 * Deliberate, reviewed exceptions to the "no untranslated values" rule:
 * cognates and loanwords whose accepted form in the target language is the
 * same string as the English original. Adding an entry here is a conscious
 * choice made on review — never a shortcut for a key still awaiting
 * translation.
 */
const UNTRANSLATED_ALLOWLIST = {
  "nav.menu": ["fr"],
  "menu.collections": ["fr"],
  "panel.account.resourcesCollections": ["fr"],
  "panel.account.resourcesCollectionLabel": ["fr"],
  "panel.maps.fieldSlug": ["fr"],
  "panel.maps.fieldDescription": ["fr"],
  "panel.maps.fieldCollections": ["fr"],
  "panel.collections.title": ["fr"],
  "panel.collections.fieldSlug": ["fr"],
  "panel.collections.fieldDescription": ["fr"],
};

/**
 * Locale codes discovered from the files in `src/locales/`. */
const localeCodes = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => entry.name.replace(/\.json$/, ""))
  .sort();

const translatedLocaleCodes = localeCodes.filter(
  (code) => code !== DEFAULT_LOCALE,
);

const parsedLocales = new Map();

/** Parse one locale file; any parse error names the file. */
const loadLocale = (code) => {
  if (!parsedLocales.has(code)) {
    const file = `src/locales/${code}.json`;
    try {
      parsedLocales.set(
        code,
        JSON.parse(readFileSync(join(ROOT, file), "utf8")),
      );
    } catch (error) {
      throw new Error(`${file} does not parse as JSON: ${error.message}`);
    }
  }
  return parsedLocales.get(code);
};

/** Every `.vue` or `.js` file under `src/`, relative to the repo root. */
const sourceFiles = () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(vue|js)$/.test(entry.name)) {
        found.push(relative(ROOT, full).split(sep).join("/"));
      }
    }
  };
  walk(SRC_DIR);
  return found;
};

/** First non-whitespace index at or after `start`. */
const skipWhitespace = (source, start) => {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
};

/** Whether the argument that ends at `index` is followed by `,` or `)`. */
const argumentEndsAt = (source, index) => {
  const next = source[skipWhitespace(source, index)];
  return next === "," || next === ")";
};

/** Read a single- or double-quoted string; `start` is the opening quote. */
const readQuotedString = (source, start, quote) => {
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      value += source[index + 1] ?? "";
      index += 2;
    } else if (source[index] === quote) {
      return { value, end: index + 1 };
    } else {
      value += source[index];
      index += 1;
    }
  }
  return { value, end: index };
};

/** Read a template literal; `start` is the opening backtick. */
const readTemplateLiteral = (source, start) => {
  let value = "";
  let interpolated = false;
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      value += source[index + 1] ?? "";
      index += 2;
    } else if (source[index] === "`") {
      return { value, interpolated, end: index + 1 };
    } else {
      if (source[index] === "$" && source[index + 1] === "{") {
        interpolated = true;
      }
      value += source[index];
      index += 1;
    }
  }
  return { value, interpolated, end: index };
};

/** 1-based line number of `index` within `source`. */
const lineAt = (source, index) => source.slice(0, index).split("\n").length;

/** A short single-line preview of a dynamic first argument, for messages. */
const previewArgument = (source, start) => {
  let end = start;
  while (end < source.length && !/[,)\n]/.test(source[end])) end += 1;
  const text = source.slice(start, end).trim().replace(/\s+/g, " ");
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

// A word boundary keeps identifiers ending in `t` (`format(`, `concat(`) from
// matching; `.t(` member calls still match because `.` is a non-word character.
const TRANSLATION_CALL = /\bt\s*\(/g;

/**
 * Every `t(` / `.t(` call in a source string. Each record carries either a
 * `key` (literal first argument) or a `dynamic` preview (first argument the
 * gate cannot verify).
 */
const scanTranslationCalls = (source) => {
  const calls = [];
  TRANSLATION_CALL.lastIndex = 0;
  let match;
  while ((match = TRANSLATION_CALL.exec(source)) !== null) {
    const start = skipWhitespace(source, match.index + match[0].length);
    const line = lineAt(source, match.index);
    const char = source[start];
    let key = null;
    let dynamic = null;

    if (char === '"' || char === "'") {
      const read = readQuotedString(source, start, char);
      if (argumentEndsAt(source, read.end)) key = read.value;
      else dynamic = previewArgument(source, start);
    } else if (char === "`") {
      const read = readTemplateLiteral(source, start);
      if (!read.interpolated && argumentEndsAt(source, read.end)) {
        key = read.value;
      } else {
        dynamic = previewArgument(source, start);
      }
    } else {
      dynamic = char === ")" ? "(no argument)" : previewArgument(source, start);
    }

    calls.push({ line, key, dynamic });
  }
  return calls;
};

/** All translation calls under `src/`, with repo-relative file and line. */
const scanSourceTree = () => {
  const calls = [];
  for (const file of sourceFiles()) {
    const source = readFileSync(join(ROOT, file), "utf8");
    for (const call of scanTranslationCalls(source)) {
      calls.push({ file, ...call });
    }
  }
  return calls;
};

describe("locale files", () => {
  it("keeps key parity with en.json in both directions", () => {
    const enKeys = new Set(Object.keys(loadLocale(DEFAULT_LOCALE)));
    const problems = [];
    for (const code of translatedLocaleCodes) {
      const keys = Object.keys(loadLocale(code));
      const localeKeys = new Set(keys);
      const missing = [...enKeys].filter((key) => !localeKeys.has(key));
      const extra = keys.filter((key) => !enKeys.has(key));
      if (missing.length) {
        problems.push(
          `${code}.json is missing ${missing.length} key(s) present in en.json: ${missing.join(", ")}`,
        );
      }
      if (extra.length) {
        problems.push(
          `${code}.json has ${extra.length} key(s) not present in en.json (dead or misspelled): ${extra.join(", ")}`,
        );
      }
    }
    expect(
      problems,
      "Each locale must define exactly the keys en.json defines — add missing keys and remove dead or misspelled ones.",
    ).toEqual([]);
  });

  it("has no empty or whitespace-only values", () => {
    const problems = [];
    for (const code of localeCodes) {
      for (const [key, value] of Object.entries(loadLocale(code))) {
        if (typeof value === "string" && value.trim() === "") {
          problems.push(`${code}.json → "${key}" is empty`);
        }
      }
    }
    expect(
      problems,
      "Every key must have a non-empty translation — an empty string renders as blank UI.",
    ).toEqual([]);
  });

  it("leaves no value untranslated from English", () => {
    const en = loadLocale(DEFAULT_LOCALE);
    const problems = [];
    for (const code of translatedLocaleCodes) {
      for (const [key, value] of Object.entries(loadLocale(code))) {
        if (value !== en[key]) continue;
        const allowed = UNTRANSLATED_ALLOWLIST[key]?.includes(code) ?? false;
        if (!allowed) {
          problems.push(
            `${code}.json → "${key}" still matches the English value ${JSON.stringify(value)}`,
          );
        }
      }
    }
    expect(
      problems,
      "Translate each value, or add a reviewed cognate entry to UNTRANSLATED_ALLOWLIST.",
    ).toEqual([]);
  });

  it("parses every locale file and holds only string values", () => {
    const problems = [];
    for (const code of localeCodes) {
      let messages;
      try {
        messages = loadLocale(code);
      } catch (error) {
        problems.push(error.message);
        continue;
      }
      for (const [key, value] of Object.entries(messages)) {
        if (typeof value !== "string") {
          problems.push(`${code}.json → "${key}" is not a string`);
        }
      }
    }
    expect(
      problems,
      "Every src/locales/*.json file must parse as a flat object of string values.",
    ).toEqual([]);
  });
});

describe("translation call sites", () => {
  it("references only t() keys that exist in en.json", () => {
    const en = loadLocale(DEFAULT_LOCALE);
    const problems = scanSourceTree()
      .filter(
        (call) =>
          call.key !== null &&
          !Object.prototype.hasOwnProperty.call(en, call.key),
      )
      .map(
        (call) =>
          `${call.file}:${call.line} → "${call.key}" is not present in en.json`,
      );
    expect(
      problems,
      "Every literal t() key must exist in en.json, or the raw key renders in the UI.",
    ).toEqual([]);
  });

  it("uses literal keys only in t() calls", () => {
    const problems = scanSourceTree()
      .filter((call) => call.key === null)
      .map(
        (call) =>
          `${call.file}:${call.line} → t(${call.dynamic}): the completeness gate cannot verify dynamic keys; use a literal key`,
      );
    expect(
      problems,
      "The completeness gate cannot verify dynamic keys; use a literal key.",
    ).toEqual([]);
  });
});
