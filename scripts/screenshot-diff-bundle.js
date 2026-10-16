import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  decodePng,
  encodePng,
  compareFile,
  walkPngs,
} from "./verify-matrix.js";

// Build a reviewable diff bundle from a committed baseline tree and a freshly
// captured tree. Compares the two trees pixel-wise (via verify-matrix.js) and,
// for every file that needs attention, writes a before/after pair and — for a
// changed file — a highlight diff. Alongside the images it writes a
// self-contained `index.html` (opens straight from disk), a `summary.md`
// markdown table suitable for `$GITHUB_STEP_SUMMARY`, and a machine-readable
// `report.json`. Dependency-free — Node builtins only, reusing the PNG codec
// in verify-matrix.js rather than any image library.

const DEFAULTS = {
  maxDelta: 1,
  maxPixels: 64,
};

// Which categories the bundle includes. `ok` (identical) and `drift` (within
// tolerance) are counted in the totals but not written out: they are not
// reviewable differences.
const STATUS_ORDER = ["fail", "added", "removed"];

const STATUS_TITLES = {
  fail: "Failed",
  added: "Added",
  removed: "Removed",
};

const HELP = `Build a screenshot diff bundle from a committed and a captured tree.

Compares the two trees pixel-wise and writes per-file before/after/diff images
plus an HTML index, a markdown summary and a JSON report.

Usage:
  node scripts/screenshot-diff-bundle.js \\
    --committed <dir> --captured <dir> --out <dir> [options]

Options:
  --committed <dir>    committed baseline tree (required)
  --captured <dir>     freshly captured tree (required)
  --out <dir>          bundle output directory (required)
  --json <file>        also write the machine-readable file list to this path
                       ([{ rel, status, diffPixels, maxDelta }])
  --run-id <id>        workflow run id, shown in the bundle metadata
  --pr <n>             pull request number, shown in the bundle metadata
  --help               show this help

Exit codes:
  0  bundle written
  1  a tree was missing or invalid
  2  usage error`;

function parseArgs(argv) {
  const options = {
    committed: null,
    captured: null,
    out: null,
    json: null,
    runId: null,
    pr: null,
    maxDelta: DEFAULTS.maxDelta,
    maxPixels: DEFAULTS.maxPixels,
    help: false,
  };

  const valueOf = (arg, i) => {
    if (arg.includes("=")) return { value: arg.slice(arg.indexOf("=") + 1), i };
    return { value: argv[i + 1], i: i + 1 };
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--committed" || arg.startsWith("--committed=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: `${arg} needs a directory` };
      options.committed = value;
      i = next;
    } else if (arg === "--captured" || arg.startsWith("--captured=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: `${arg} needs a directory` };
      options.captured = value;
      i = next;
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: `${arg} needs a directory` };
      options.out = value;
      i = next;
    } else if (arg === "--json" || arg.startsWith("--json=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: `${arg} needs a file path` };
      options.json = value;
      i = next;
    } else if (arg === "--run-id" || arg.startsWith("--run-id=")) {
      const { value, i: next } = valueOf(arg, i);
      if (value === undefined) return { error: `${arg} needs an id` };
      options.runId = value || null;
      i = next;
    } else if (arg === "--pr" || arg.startsWith("--pr=")) {
      const { value, i: next } = valueOf(arg, i);
      if (value === undefined) return { error: `${arg} needs a number` };
      options.pr = value || null;
      i = next;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (options.help) return { options };
  if (!options.committed) return { error: "--committed is required" };
  if (!options.captured) return { error: "--captured is required" };
  if (!options.out) return { error: "--out is required" };

  return { options };
}

function isDirectory(target) {
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

// Compare the two trees, pairing each committed PNG with its captured
// counterpart. Files present on only one side are `added` (captured only) or
// `removed` (committed only); paired files carry the verify-matrix.js status
// (`ok`, `drift` or `fail`).
export function compareTrees(options) {
  const committed = walkPngs(options.committed);
  const captured = walkPngs(options.captured);
  const rels = [...new Set([...committed.keys(), ...captured.keys()])].sort();

  const results = [];
  for (const rel of rels) {
    const beforeAbs = committed.get(rel);
    const afterAbs = captured.get(rel);

    if (beforeAbs && afterAbs) {
      const compared = compareFile(rel, beforeAbs, afterAbs, {
        maxDelta: options.maxDelta ?? DEFAULTS.maxDelta,
        maxPixels: options.maxPixels ?? DEFAULTS.maxPixels,
      });
      results.push({
        rel,
        status: compared.status,
        diffPixels: compared.diffPixels ?? null,
        maxDelta: compared.maxDelta ?? null,
        detail: compared.detail ?? null,
      });
    } else if (afterAbs) {
      results.push({
        rel,
        status: "added",
        diffPixels: null,
        maxDelta: null,
        detail: null,
      });
    } else {
      results.push({
        rel,
        status: "removed",
        diffPixels: null,
        maxDelta: null,
        detail: null,
      });
    }
  }

  return results;
}

function channelsToRgb(channels, base, pixels) {
  if (channels === 1 || channels === 2) {
    const value = pixels[base];
    return [value, value, value];
  }
  return [pixels[base], pixels[base + 1], pixels[base + 2]];
}

// Render a diff image: the `after` capture as dimmed greyscale with every
// differing pixel highlighted opaque magenta. Returns a 3-channel RGB PNG
// buffer, or null when either image cannot be decoded.
export function buildDiffPng(beforeBuffer, afterBuffer) {
  let before;
  let after;
  try {
    before = decodePng(beforeBuffer);
    after = decodePng(afterBuffer);
  } catch {
    return null;
  }

  const { width, height, channels, pixels } = after;
  const comparable =
    before.width === width &&
    before.height === height &&
    before.channels === channels;

  const out = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    const base = p * channels;
    let differs = false;
    if (comparable) {
      for (let c = 0; c < channels; c++) {
        if (before.pixels[base + c] !== pixels[base + c]) {
          differs = true;
          break;
        }
      }
    }

    const o = p * 3;
    if (differs) {
      out[o] = 255;
      out[o + 1] = 0;
      out[o + 2] = 255;
    } else {
      const [r, g, b] = channelsToRgb(channels, base, pixels);
      const grey = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      const dim = Math.round(grey * 0.45);
      out[o] = dim;
      out[o + 1] = dim;
      out[o + 2] = dim;
    }
  }

  return encodePng(width, height, 3, out);
}

function writeImage(sourceAbs, targetAbs) {
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  fs.copyFileSync(sourceAbs, targetAbs);
}

// Write the per-file images for one bundle entry and return the paths written.
function writeEntryImages(entry, committedRoot, capturedRoot, outRoot) {
  const dir = path.join(outRoot, entry.rel);
  const written = {};

  if (entry.status === "fail" || entry.status === "removed") {
    const before = path.join(committedRoot, entry.rel);
    const target = path.join(dir, "before.png");
    writeImage(before, target);
    written.before = target;
  }
  if (entry.status === "fail" || entry.status === "added") {
    const after = path.join(capturedRoot, entry.rel);
    const target = path.join(dir, "after.png");
    writeImage(after, target);
    written.after = target;
  }
  if (entry.status === "fail") {
    const before = fs.readFileSync(path.join(committedRoot, entry.rel));
    const after = fs.readFileSync(path.join(capturedRoot, entry.rel));
    const diff = buildDiffPng(before, after);
    if (diff) {
      const target = path.join(dir, "diff.png");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, diff);
      written.diff = target;
    }
  }

  return written;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Relative URL from the directory the HTML file lives in to a target file, so
// the bundle renders straight from file://.
function relativeUrl(fromDir, target) {
  return encodeURI(path.relative(fromDir, target).split(path.sep).join("/"));
}

function entryMeta(entry) {
  if (entry.diffPixels !== null && entry.diffPixels !== undefined) {
    return `${entry.diffPixels} px · max Δ${entry.maxDelta}`;
  }
  return entry.detail || "";
}

function figure(absPath, htmlDir, label) {
  if (!absPath || !fs.existsSync(absPath)) return "";
  return `          <figure>
            <img src="${escapeHtml(relativeUrl(htmlDir, absPath))}" alt="${escapeHtml(label)}" loading="lazy">
            <figcaption>${escapeHtml(label)}</figcaption>
          </figure>`;
}

function renderEntry(entry, htmlDir) {
  const figures = [
    figure(entry.images.before, htmlDir, "before"),
    figure(entry.images.after, htmlDir, "after"),
    figure(entry.images.diff, htmlDir, "diff"),
  ]
    .filter(Boolean)
    .join("\n");

  const meta = entryMeta(entry);
  const metaLine = meta
    ? `          <p class="meta">${escapeHtml(meta)}</p>`
    : "";

  return `        <article class="entry">
          <h3>${escapeHtml(entry.rel)}</h3>
${metaLine}
          <div class="pair">
${figures}
          </div>
        </article>`;
}

function renderSection(status, entries, htmlDir) {
  const body = entries.map((entry) => renderEntry(entry, htmlDir)).join("\n");
  return `      <section>
        <h2>${escapeHtml(STATUS_TITLES[status])} (${entries.length})</h2>
        ${entries.length ? body : "<p>none</p>"}
      </section>`;
}

function buildHtml(entries, context, htmlDir) {
  const grouped = STATUS_ORDER.map((status) => [
    status,
    entries.filter((entry) => entry.status === status),
  ]);

  const totalsLine =
    `${context.report.totals.checked} checked — ` +
    `${context.report.totals.ok} ok, ${context.report.totals.drift} drift, ` +
    `${context.report.totals.fail} fail, ${context.report.totals.added} added, ` +
    `${context.report.totals.removed} removed`;

  const sections = grouped
    .map(([status, list]) => renderSection(status, list, htmlDir))
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Screenshot diff bundle</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0 auto; padding: 1.5rem; max-width: 1400px; font-family: system-ui, sans-serif; line-height: 1.4; }
      h1 { margin-top: 0; }
      h2 { margin-top: 2rem; border-bottom: 1px solid currentColor; padding-bottom: 0.25rem; }
      h3 { margin: 0 0 0.5rem; font-size: 1rem; font-family: ui-monospace, monospace; }
      .meta { font-family: ui-monospace, monospace; font-size: 0.85rem; margin: 0 0 0.75rem; }
      .entry { margin: 1.5rem 0; padding: 1rem; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 6px; }
      .pair { display: flex; flex-wrap: wrap; gap: 1rem; }
      figure { margin: 0; flex: 1 1 360px; }
      img { display: block; width: 100%; height: auto; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 4px; background: color-mix(in srgb, currentColor 8%, transparent); }
      figcaption { margin-top: 0.35rem; font-family: ui-monospace, monospace; font-size: 0.8rem; opacity: 0.75; }
      footer { margin-top: 3rem; font-size: 0.8rem; opacity: 0.7; }
    </style>
  </head>
  <body>
    <h1>Screenshot diff bundle</h1>
    <p class="meta">run: ${escapeHtml(context.runId ?? "—")}<br>pull request: ${escapeHtml(context.pr ?? "—")}<br>generated: ${escapeHtml(context.generatedAt)}</p>
    <p>${escapeHtml(totalsLine)}</p>
${sections}
    <footer>Generated by scripts/screenshot-diff-bundle.js — open directly from the filesystem.</footer>
  </body>
</html>
`;
}

function buildSummaryMd(context) {
  const { totals, files } = context.report;
  const lines = [];
  lines.push("# Screenshot diff bundle");
  lines.push("");
  lines.push(`- Run: ${context.runId ?? "—"}`);
  lines.push(`- Pull request: ${context.pr ?? "—"}`);
  lines.push(`- Generated: ${context.generatedAt}`);
  lines.push("");
  lines.push("| File | Status | Diff px | Max Δ |");
  lines.push("| --- | --- | ---: | ---: |");
  for (const file of files) {
    const px = file.diffPixels === null ? "" : String(file.diffPixels);
    const delta = file.maxDelta === null ? "" : String(file.maxDelta);
    lines.push(`| ${file.rel} | ${file.status} | ${px} | ${delta} |`);
  }
  lines.push("");
  lines.push(
    `**Totals:** ${totals.checked} checked — ${totals.ok} ok, ` +
      `${totals.drift} drift, ${totals.fail} fail, ${totals.added} added, ` +
      `${totals.removed} removed.`,
  );
  lines.push("");
  return `${lines.join("\n")}`;
}

function buildReport(results, options, generatedAt) {
  const totals = {
    checked: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    drift: results.filter((r) => r.status === "drift").length,
    fail: results.filter((r) => r.status === "fail").length,
    added: results.filter((r) => r.status === "added").length,
    removed: results.filter((r) => r.status === "removed").length,
  };

  const files = results
    .filter((result) => STATUS_ORDER.includes(result.status))
    .map((result) => ({
      rel: result.rel,
      status: result.status,
      diffPixels: result.diffPixels,
      maxDelta: result.maxDelta,
    }));

  return {
    runId: options.runId ?? null,
    pr: options.pr ?? null,
    generatedAt,
    totals,
    files,
  };
}

// Build the whole bundle: compare the trees, write per-file images and the
// index/summary/report. Returns the report object that was written.
export function buildBundle(options) {
  const outRoot = options.out;
  fs.mkdirSync(outRoot, { recursive: true });

  const generatedAt = new Date().toISOString();
  const results = compareTrees(options);

  const entries = results
    .filter((result) => STATUS_ORDER.includes(result.status))
    .map((entry) => {
      const images = writeEntryImages(
        entry,
        options.committed,
        options.captured,
        outRoot,
      );
      return { ...entry, images };
    });

  const report = buildReport(results, options, generatedAt);
  const context = {
    runId: report.runId,
    pr: report.pr,
    generatedAt,
    report,
  };

  fs.writeFileSync(
    path.join(outRoot, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(outRoot, "summary.md"), buildSummaryMd(context));
  fs.writeFileSync(
    path.join(outRoot, "index.html"),
    buildHtml(entries, context, outRoot),
  );

  if (options.json) {
    fs.mkdirSync(path.dirname(options.json), { recursive: true });
    fs.writeFileSync(
      options.json,
      `${JSON.stringify(report.files, null, 2)}\n`,
    );
  }

  return report;
}

function run() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(parsed.error);
    console.error("");
    console.error(HELP);
    process.exit(2);
  }

  const options = parsed.options;
  if (options.help) {
    console.log(HELP);
    return;
  }

  if (!isDirectory(options.committed)) {
    console.error(`Committed directory not found: ${options.committed}`);
    process.exit(1);
  }
  if (!isDirectory(options.captured)) {
    console.error(`Captured directory not found: ${options.captured}`);
    process.exit(1);
  }

  const report = buildBundle(options);

  console.log("Screenshot diff bundle");
  console.log(`  committed: ${options.committed}`);
  console.log(`  captured:  ${options.captured}`);
  console.log(`  out:       ${options.out}`);
  console.log("");
  console.log(
    `Summary: ${report.totals.checked} checked — ${report.totals.ok} ok, ` +
      `${report.totals.drift} drift, ${report.totals.fail} fail, ` +
      `${report.totals.added} added, ${report.totals.removed} removed`,
  );
  console.log(`Index:   ${path.join(options.out, "index.html")}`);
  console.log(`Summary: ${path.join(options.out, "summary.md")}`);
  console.log(`Report:  ${path.join(options.out, "report.json")}`);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) run();
