import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Compare two capture trees byte-for-byte by sha256. The committed matrix
// (`screenshots/`) is the baseline; a fresh capture — normally written to the
// gitignored temp tree by a local run — is the candidate. The comparison is a
// relative audit, not a machine-level byte-reproducibility proof: local
// captures are checked relatively / visually, and the committed baselines are
// sourced from the Screenshots workflow's captured artifacts. Dependency-free —
// Node builtins only.

const DEFAULTS = {
  baseline: "screenshots",
  candidate: path.join(".opencode", "tmp", "screenshots"),
  html: path.join(".opencode", "tmp", "screenshot-diff", "index.html"),
};

const HELP = `Compare two capture trees by sha256.

Usage:
  node scripts/screenshot-diff.js [options]

Options:
  --baseline <dir>    committed capture tree (default: screenshots)
  --candidate <dir>   freshly captured tree (default: .opencode/tmp/screenshots)
  --fail-on-diff      exit 1 when any file differs (default: report only)
  --html              write a side-by-side viewer to
                      .opencode/tmp/screenshot-diff/index.html
  --help              show this help
`;

function parseArgs(argv) {
  const options = {
    baseline: DEFAULTS.baseline,
    candidate: DEFAULTS.candidate,
    htmlPath: DEFAULTS.html,
    failOnDiff: false,
    html: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--baseline" || arg.startsWith("--baseline=")) {
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : argv[++i];
      if (!value) return { error: `${arg} needs a directory` };
      options.baseline = value;
    } else if (arg === "--candidate" || arg.startsWith("--candidate=")) {
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : argv[++i];
      if (!value) return { error: `${arg} needs a directory` };
      options.candidate = value;
    } else if (arg === "--fail-on-diff") {
      options.failOnDiff = true;
    } else if (arg === "--html") {
      options.html = true;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  return { options };
}

function isDirectory(target) {
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

// Recursive walk returning a Map of forward-slash relative path -> absolute
// path. Any `diag/` directory is skipped: it holds per-capture diagnostics
// written beside the images, not part of the visual comparison.
function walk(root) {
  const files = new Map();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "diag") continue;
        visit(abs);
      } else if (entry.isFile()) {
        files.set(path.relative(root, abs).split(path.sep).join("/"), abs);
      }
    }
  };
  visit(root);
  return files;
}

function hashFile(absPath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(absPath))
    .digest("hex");
}

function shortHash(hash) {
  return hash ? hash.slice(0, 8) : "";
}

function compare(baselineFiles, candidateFiles) {
  const keys = [
    ...new Set([...baselineFiles.keys(), ...candidateFiles.keys()]),
  ];
  keys.sort();

  const diffs = [];
  for (const key of keys) {
    const baseline = baselineFiles.get(key);
    const candidate = candidateFiles.get(key);

    if (baseline && candidate) {
      const baselineHash = hashFile(baseline);
      const candidateHash = hashFile(candidate);
      if (baselineHash !== candidateHash) {
        diffs.push({
          key,
          kind: "changed",
          baseline,
          candidate,
          baselineHash,
          candidateHash,
        });
      }
    } else if (baseline) {
      diffs.push({
        key,
        kind: "only-baseline",
        baseline,
        baselineHash: hashFile(baseline),
      });
    } else {
      diffs.push({
        key,
        kind: "only-candidate",
        candidate,
        candidateHash: hashFile(candidate),
      });
    }
  }

  return diffs;
}

function printGroup(title, entries, line) {
  console.log(`${title} (${entries.length}):`);
  if (entries.length === 0) {
    console.log("  none");
    return;
  }
  for (const entry of entries) console.log(line(entry));
}

function report(diffs, baselineRoot, candidateRoot) {
  const changed = diffs.filter((diff) => diff.kind === "changed");
  const onlyBaseline = diffs.filter((diff) => diff.kind === "only-baseline");
  const onlyCandidate = diffs.filter((diff) => diff.kind === "only-candidate");

  console.log("Screenshot diff");
  console.log(`  baseline:  ${baselineRoot}`);
  console.log(`  candidate: ${candidateRoot}`);
  console.log("");

  printGroup(
    "Changed",
    changed,
    (diff) =>
      `  ${diff.key}  ${shortHash(diff.baselineHash)} → ${shortHash(diff.candidateHash)}`,
  );
  printGroup(
    "Only in baseline",
    onlyBaseline,
    (diff) => `  ${diff.key}  ${shortHash(diff.baselineHash)}`,
  );
  printGroup(
    "Only in candidate",
    onlyCandidate,
    (diff) => `  ${diff.key}  ${shortHash(diff.candidateHash)}`,
  );

  console.log("");
  if (diffs.length === 0) {
    console.log("Summary: no differences — the two trees are identical.");
  } else {
    console.log(
      `Summary: ${diffs.length} difference(s) — ${changed.length} changed, ` +
        `${onlyBaseline.length} only in baseline, ` +
        `${onlyCandidate.length} only in candidate`,
    );
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Relative URL from the directory the HTML file lives in to a target file, so
// the report renders straight from file://.
function relativeUrl(fromDir, target) {
  return encodeURI(path.relative(fromDir, target).split(path.sep).join("/"));
}

function figure(absPath, htmlDir, label, hash) {
  if (!absPath) return "";
  return `        <figure>
          <img src="${escapeHtml(relativeUrl(htmlDir, absPath))}" alt="${escapeHtml(label)}" loading="lazy">
          <figcaption>${escapeHtml(label)} · ${shortHash(hash)}</figcaption>
        </figure>`;
}

function renderEntry(diff, htmlDir) {
  const figures = [
    figure(diff.baseline, htmlDir, "baseline", diff.baselineHash),
    figure(diff.candidate, htmlDir, "candidate", diff.candidateHash),
  ]
    .filter(Boolean)
    .join("\n");

  return `      <article class="entry">
        <h3>${escapeHtml(diff.key)}</h3>
        <div class="pair">
${figures}
        </div>
      </article>`;
}

function renderSection(title, entries, htmlDir) {
  const body = entries.map((entry) => renderEntry(entry, htmlDir)).join("\n");
  return `    <section>
      <h2>${escapeHtml(title)} (${entries.length})</h2>
      ${entries.length ? body : "<p>none</p>"}
    </section>`;
}

function buildHtml(diffs, baselineRoot, candidateRoot, htmlDir) {
  const changed = diffs.filter((diff) => diff.kind === "changed");
  const onlyBaseline = diffs.filter((diff) => diff.kind === "only-baseline");
  const onlyCandidate = diffs.filter((diff) => diff.kind === "only-candidate");

  const summary =
    diffs.length === 0
      ? "No differences — the two trees are identical."
      : `${diffs.length} difference(s) — ${changed.length} changed, ` +
        `${onlyBaseline.length} only in baseline, ` +
        `${onlyCandidate.length} only in candidate`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Screenshot diff</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0 auto; padding: 1.5rem; max-width: 1400px; font-family: system-ui, sans-serif; line-height: 1.4; }
      h1 { margin-top: 0; }
      h2 { margin-top: 2rem; border-bottom: 1px solid currentColor; padding-bottom: 0.25rem; }
      h3 { margin: 0 0 0.5rem; font-size: 1rem; font-family: ui-monospace, monospace; }
      .meta { font-family: ui-monospace, monospace; font-size: 0.85rem; }
      .entry { margin: 1.5rem 0; padding: 1rem; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 6px; }
      .pair { display: flex; flex-wrap: wrap; gap: 1rem; }
      figure { margin: 0; flex: 1 1 420px; }
      img { display: block; width: 100%; height: auto; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 4px; background: color-mix(in srgb, currentColor 8%, transparent); }
      figcaption { margin-top: 0.35rem; font-family: ui-monospace, monospace; font-size: 0.8rem; opacity: 0.75; }
      footer { margin-top: 3rem; font-size: 0.8rem; opacity: 0.7; }
    </style>
  </head>
  <body>
    <h1>Screenshot diff</h1>
    <p class="meta">baseline: ${escapeHtml(baselineRoot)}<br>candidate: ${escapeHtml(candidateRoot)}</p>
    <p>${escapeHtml(summary)}</p>
${renderSection("Changed", changed, htmlDir)}
${renderSection("Only in baseline", onlyBaseline, htmlDir)}
${renderSection("Only in candidate", onlyCandidate, htmlDir)}
    <footer>Generated locally by scripts/screenshot-diff.js — open directly from the filesystem.</footer>
  </body>
</html>
`;
}

function writeHtml(diffs, baselineRoot, candidateRoot, htmlPath) {
  const htmlDir = path.dirname(htmlPath);
  fs.mkdirSync(htmlDir, { recursive: true });
  fs.writeFileSync(
    htmlPath,
    buildHtml(diffs, baselineRoot, candidateRoot, htmlDir),
  );
  console.log("");
  console.log(`HTML report: ${htmlPath}`);
}

async function run() {
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

  if (!isDirectory(options.baseline)) {
    console.error(`Baseline directory not found: ${options.baseline}`);
    process.exit(1);
  }

  if (!isDirectory(options.candidate)) {
    console.log(`Candidate directory not found: ${options.candidate}`);
    console.log("Run a capture first, for example:");
    console.log("  E2E_SWIFTSHADER_PIN=1 npm run test:matrix");
    process.exit(options.failOnDiff ? 1 : 0);
  }

  const baselineFiles = walk(options.baseline);
  const candidateFiles = walk(options.candidate);
  const diffs = compare(baselineFiles, candidateFiles);

  report(diffs, options.baseline, options.candidate);

  if (options.html) {
    writeHtml(diffs, options.baseline, options.candidate, options.htmlPath);
  }

  if (options.failOnDiff && diffs.length > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
