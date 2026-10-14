import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

// Fetch the capture shards produced by the `Screenshots` GitHub workflow and
// assemble them into the full matrix tree. CI reproduces the committed matrix
// byte-for-byte on macOS, so its captures are the trusted source for refreshing
// `screenshots/` when a local machine's rendering has drifted. Dependency-free —
// Node builtins plus the `gh` CLI.
//
// The workflow runs six matrix shards on macOS. Each shard captures its slice
// of the matrix with the all-SwiftShader `screenshots` Playwright project into
// the gitignored `.opencode/tmp/screenshots/` tree and uploads it as the
// `screenshots-shard-<n>` artifact (with `if: always()`, so a failing shard's
// captures are still present). Assembly therefore unions the six
// `.opencode/tmp/screenshots/` subtrees back into one matrix keyed by
// committed-relative path, e.g. `desktop/landscape/closed.png`.
//
// Read-only by default: it downloads, assembles, validates and compares, then
// reports. Pass `--write` to copy the assembled set into the committed
// `screenshots/` tree; silent baseline deletions are never performed unless
// `--allow-removals` is also given.

const COMMITTED_ROOT = "screenshots";
const CAPTURE_SUBPATH = [".opencode", "tmp", "screenshots"];
const SHARD_PREFIX = "screenshots-shard-";
const SHARD_COUNT = 6;
const OUT_ROOT = path.join(".opencode", "tmp", "ci-screenshots");
const LIST_LIMIT = 10;
const REPORT_NAME = "report.txt";
const CONSOLE_CAP = 50;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const HELP = `Fetch and assemble the Screenshots workflow matrix.

Usage:
  node scripts/fetch-screenshots.js [options]

Options:
  --run <id>         fetch a specific Screenshots workflow run id
  --branch <name>    fetch the latest completed Screenshots run for a branch
  --out <dir>        scratch/output root
                     (default: .opencode/tmp/ci-screenshots/<run-id>)
  --write            copy the assembled matrix into ${COMMITTED_ROOT}/
                     (default: read-only — download, assemble, compare, report)
  --allow-removals   let --write delete committed files that the assembled set
                     does not contain (default: refuse, listing them)
  --help             show this help

With neither --run nor --branch the script lists the most recent Screenshots
runs and exits without fetching.`;

function parseArgs(argv) {
  const options = {
    run: null,
    branch: null,
    out: null,
    write: false,
    allowRemovals: false,
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
    } else if (arg === "--run" || arg.startsWith("--run=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: `${arg} needs a run id` };
      options.run = value;
      i = next;
    } else if (arg === "--branch" || arg.startsWith("--branch=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: `${arg} needs a branch name` };
      options.branch = value;
      i = next;
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: `${arg} needs a directory` };
      options.out = value;
      i = next;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--allow-removals") {
      options.allowRemovals = true;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (options.run && options.branch) {
    return { error: "Pass either --run or --branch, not both." };
  }

  return { options };
}

// Run the `gh` CLI. Captured invocations return stdout (for JSON); otherwise
// the child inherits this process's stdio so progress is visible.
function gh(args, { capture = false } = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error("the GitHub CLI (gh) is not installed or not on PATH");
    }
    throw new Error(`could not run gh: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = capture ? (result.stderr || "").trim() : "";
    throw new Error(
      `gh ${args.join(" ")} failed (exit ${result.status})` +
        (detail ? `: ${detail}` : ""),
    );
  }

  return result.stdout || "";
}

const RUN_FIELDS =
  "databaseId,status,conclusion,createdAt,headBranch,event,workflowName,url";

function listRuns({ branch = null, limit = LIST_LIMIT } = {}) {
  const args = [
    "run",
    "list",
    "--workflow=Screenshots",
    "--limit",
    String(limit),
    "--json",
    RUN_FIELDS,
  ];
  if (branch) args.push("--branch", branch);
  return JSON.parse(gh(args, { capture: true }));
}

function describeRun(run) {
  const outcome = run.conclusion || run.status || "unknown";
  return `${run.databaseId}  ${outcome}  ${run.headBranch}  ${run.createdAt}  ${run.event}`;
}

function printRecentRuns() {
  let runs;
  try {
    runs = listRuns();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (runs.length === 0) {
    console.log("No Screenshots workflow runs found.");
  } else {
    console.log("Most recent Screenshots workflow runs:");
    for (const run of runs) console.log(`  ${describeRun(run)}`);
  }

  console.log("");
  console.log("Pass --run <id> or --branch <name> to fetch captures.");
  process.exit(1);
}

function resolveRunId(options) {
  if (options.run) return options.run;

  let runs;
  try {
    runs = listRuns({ branch: options.branch, limit: 20 });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const completed = runs.find((run) => run.status === "completed");
  if (!completed) {
    console.error(
      `No completed Screenshots run found for branch '${options.branch}'.`,
    );
    if (runs.length > 0) {
      console.error("Most recent runs for this branch:");
      for (const run of runs) console.error(`  ${describeRun(run)}`);
    }
    process.exit(1);
  }

  return completed.databaseId;
}

function isDirectory(target) {
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

// Recursive walk returning a Map of forward-slash relative path -> absolute
// path. `diag/` subtrees are skipped and reported separately: they hold
// per-capture diagnostics written beside the images, never part of the matrix.
function walkPngs(root) {
  const files = new Map();
  const diag = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "diag") {
          diag.push(path.relative(root, abs).split(path.sep).join("/"));
          continue;
        }
        visit(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        files.set(path.relative(root, abs).split(path.sep).join("/"), abs);
      }
    }
  };
  if (isDirectory(root)) visit(root);
  return { files, diag };
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

function isPng(absPath) {
  const size = fs.statSync(absPath).size;
  if (size === 0) return { ok: false, reason: "empty file" };
  const fd = fs.openSync(absPath, "r");
  const head = Buffer.alloc(PNG_SIGNATURE.length);
  try {
    fs.readSync(fd, head, 0, head.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!head.equals(PNG_SIGNATURE)) return { ok: false, reason: "not a PNG" };
  return { ok: true };
}

function downloadRun(runId, rawDir) {
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  gh([
    "run",
    "download",
    String(runId),
    "--dir",
    rawDir,
    "--pattern",
    `${SHARD_PREFIX}*`,
  ]);
}

// Copy every shard's capture subtree into one assembled matrix. Duplicate
// relative paths are permitted only when byte-identical (identical captures),
// so overlapping shards cannot silently pick a winner.
function assemble(rawDir, assembledDir) {
  fs.rmSync(assembledDir, { recursive: true, force: true });
  fs.mkdirSync(assembledDir, { recursive: true });

  const sources = new Map();
  const providedBy = new Map();
  const missingShards = [];
  const emptyShards = [];
  const diagSeen = [];

  for (let shard = 1; shard <= SHARD_COUNT; shard++) {
    const name = `${SHARD_PREFIX}${shard}`;
    const artifactDir = path.join(rawDir, name);
    if (!isDirectory(artifactDir)) {
      missingShards.push(name);
      continue;
    }

    const captureRoot = path.join(artifactDir, ...CAPTURE_SUBPATH);
    const { files, diag } = walkPngs(captureRoot);
    for (const entry of diag) diagSeen.push(path.join(name, entry));
    if (files.size === 0) {
      emptyShards.push(name);
      continue;
    }

    for (const [rel, abs] of files) {
      if (sources.has(rel)) {
        const existing = hashFile(sources.get(rel));
        if (existing !== hashFile(abs)) {
          throw new Error(
            `shards disagree on '${rel}': ${providedBy.get(rel)} and ${name} ` +
              "produced different bytes",
          );
        }
        continue;
      }
      sources.set(rel, abs);
      providedBy.set(rel, name);
    }
  }

  for (const [rel, abs] of sources) {
    const target = path.join(assembledDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(abs, target);
  }

  return { count: sources.size, missingShards, emptyShards, diagSeen };
}

function copyIntoCommitted(assembledFiles) {
  let added = 0;
  let changed = 0;
  for (const [rel, abs] of assembledFiles) {
    const target = path.join(COMMITTED_ROOT, rel);
    const fresh = !fs.existsSync(target);
    if (!fresh && hashFile(target) === hashFile(abs)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(abs, target);
    if (fresh) added++;
    else changed++;
  }
  return { added, changed };
}

function removeMissing(missing) {
  for (const rel of missing) {
    fs.rmSync(path.join(COMMITTED_ROOT, rel), { force: true });
  }
}

function printList(title, entries, format) {
  console.log(`${title} (${entries.length}):`);
  if (entries.length === 0) {
    console.log("  none");
    return;
  }
  const shown = entries.slice(0, CONSOLE_CAP);
  for (const entry of shown) console.log(format(entry));
  if (entries.length > shown.length) {
    console.log(`  … and ${entries.length - shown.length} more`);
  }
}

function buildReport({
  runId,
  committed,
  assembled,
  added,
  changed,
  unchanged,
  missing,
}) {
  const lines = [];
  lines.push("Screenshot matrix fetch report");
  lines.push(`run id:          ${runId}`);
  lines.push(`committed root:  ${COMMITTED_ROOT}`);
  lines.push(`assembled root:  ${assembled.root}`);
  lines.push("");
  lines.push(`committed PNGs:        ${committed.size}`);
  lines.push(`assembled PNGs:        ${assembled.count}`);
  lines.push(`added:                 ${added.length}`);
  lines.push(`changed:               ${changed.length}`);
  lines.push(`unchanged:             ${unchanged.length}`);
  lines.push(`missing-from-assembled: ${missing.length}`);
  lines.push("");

  const groups = [
    ["Added", added, (entry) => `  ${entry}`],
    [
      "Changed",
      changed,
      (entry) =>
        `  ${entry.rel}  ${shortHash(entry.committed)} → ${shortHash(entry.assembled)}`,
    ],
    ["Unchanged", unchanged, (entry) => `  ${entry}`],
    ["Missing from assembled", missing, (entry) => `  ${entry}`],
  ];

  for (const [title, entries, format] of groups) {
    lines.push(`${title} (${entries.length}):`);
    if (entries.length === 0) lines.push("  none");
    else for (const entry of entries) lines.push(format(entry));
    lines.push("");
  }

  return lines.join("\n");
}

function compare(committedFiles, assembledFiles) {
  const added = [];
  const changed = [];
  const unchanged = [];
  const missing = [];

  for (const [rel, abs] of assembledFiles) {
    const committedAbs = committedFiles.get(rel);
    if (!committedAbs) {
      added.push(rel);
      continue;
    }
    const assembledHash = hashFile(abs);
    const committedHash = hashFile(committedAbs);
    if (assembledHash === committedHash) unchanged.push(rel);
    else
      changed.push({ rel, assembled: assembledHash, committed: committedHash });
  }

  for (const rel of committedFiles.keys()) {
    if (!assembledFiles.has(rel)) missing.push(rel);
  }

  added.sort();
  changed.sort((a, b) => a.rel.localeCompare(b.rel));
  unchanged.sort();
  missing.sort();

  return { added, changed, unchanged, missing };
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

  if (!options.run && !options.branch) printRecentRuns();

  const runId = resolveRunId(options);
  const outDir = options.out
    ? path.resolve(options.out)
    : path.join(OUT_ROOT, String(runId));
  const rawDir = path.join(outDir, "raw");
  const assembledDir = path.join(outDir, "assembled");
  const reportPath = path.join(outDir, REPORT_NAME);

  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Screenshot matrix fetch — run ${runId}`);
  console.log(`  work dir:  ${outDir}`);
  console.log(`  write:     ${options.write ? "yes" : "no (read-only)"}`);
  console.log("");

  console.log("Downloading shard artifacts …");
  downloadRun(runId, rawDir);

  console.log("Assembling matrix …");
  const assembly = assemble(rawDir, assembledDir);

  const committed = walkPngs(COMMITTED_ROOT);
  const assembled = walkPngs(assembledDir);

  const failures = [];

  for (const name of assembly.missingShards) {
    failures.push(`missing shard artifact '${name}' (expected six shards)`);
  }
  for (const name of assembly.emptyShards) {
    failures.push(`shard artifact '${name}' contains no captures`);
  }
  if (assembled.files.size === 0) {
    failures.push("assembled matrix contains no PNGs");
  }
  if (assembly.diagSeen.length > 0) {
    console.log(
      `Skipped ${assembly.diagSeen.length} diag/ subtree(s): ` +
        `${assembly.diagSeen.join(", ")}`,
    );
  }
  if (assembled.diag.length > 0) {
    failures.push(
      `diagnostics leaked into the assembled matrix: ${assembled.diag.join(", ")}`,
    );
  }
  if (committed.files.size === 0) {
    failures.push(`no committed PNGs found under ${COMMITTED_ROOT}/`);
  }

  const assembledFiles = assembled.files;
  const committedFiles = committed.files;

  for (const [rel, abs] of assembledFiles) {
    const check = isPng(abs);
    if (!check.ok) failures.push(`invalid capture '${rel}': ${check.reason}`);
  }

  const misplaced = [...assembledFiles.keys()].filter((rel) =>
    rel.split("/").includes("diag"),
  );
  if (misplaced.length > 0) {
    failures.push(
      `diag entries present in assembled tree: ${misplaced.join(", ")}`,
    );
  }

  const missingFromAssembled = [...committedFiles.keys()].filter(
    (rel) => !assembledFiles.has(rel),
  );
  if (missingFromAssembled.length > 0 && !options.allowRemovals) {
    failures.push(
      `assembled set is missing ${missingFromAssembled.length} committed ` +
        `file(s); re-run with --allow-removals to permit removing them`,
    );
  }

  if (failures.length > 0) {
    console.error("");
    console.error("Validation failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    if (missingFromAssembled.length > 0) {
      console.error("");
      console.error("Missing from assembled:");
      for (const rel of missingFromAssembled.sort()) console.error(`  ${rel}`);
    }
    process.exit(1);
  }

  console.log(
    `Assembled ${assembled.files.size} PNG(s) from ${SHARD_COUNT} shard(s).`,
  );

  const { added, changed, unchanged, missing } = compare(
    committedFiles,
    assembledFiles,
  );

  const report = buildReport({
    runId,
    committed: committedFiles,
    assembled: { root: assembledDir, count: assembled.files.size },
    added,
    changed,
    unchanged,
    missing,
  });
  fs.writeFileSync(reportPath, `${report}\n`);

  console.log("");
  console.log(
    `Committing-relative comparison (sha256) against ${COMMITTED_ROOT}/`,
  );
  printList("Added", added, (rel) => `  ${rel}`);
  printList(
    "Changed",
    changed,
    (entry) =>
      `  ${entry.rel}  ${shortHash(entry.committed)} → ${shortHash(entry.assembled)}`,
  );
  printList("Unchanged", unchanged, (rel) => `  ${rel}`);
  printList("Missing from assembled", missing, (rel) => `  ${rel}`);
  console.log("");
  console.log(
    `Summary: ${added.length} added, ${changed.length} changed, ` +
      `${unchanged.length} unchanged, ${missing.length} missing`,
  );
  console.log(`Report: ${reportPath}`);

  if (!options.write) {
    console.log("");
    console.log("Read-only run — nothing written to " + COMMITTED_ROOT + "/.");
    return;
  }

  console.log("");
  console.log(`Writing assembled matrix into ${COMMITTED_ROOT}/ …`);
  const written = copyIntoCommitted(assembledFiles);

  let removed = 0;
  if (missing.length > 0) {
    removeMissing(missing);
    removed = missing.length;
  }

  console.log("");
  console.log(
    `Write complete: ${written.added} added, ${written.changed} changed, ` +
      `${removed} removed, ${unchanged.length} already current.`,
  );
}

try {
  run();
} catch (err) {
  console.error("");
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
