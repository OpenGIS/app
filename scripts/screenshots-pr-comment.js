import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Post or update the sticky pull-request comment that presents a screenshot
// diff bundle. The comment carries a hidden `<!-- screenshots-diff -->` marker,
// so the same comment is edited in place on every push instead of piling up.
// Its body is built from the bundle's `report.json` and references the images
// the companion helper (`publish-diff-branch.sh`) pushed to the
// `screenshots-diff` branch, which renders inline via raw.githubusercontent.com
// on public repositories. Dependency-free — Node builtins plus the `gh` CLI.

export const MARKER = "<!-- screenshots-diff -->";

// The host of every inline image, matching the branch the publish helper
// maintains.
const RAW_HOST = "https://raw.githubusercontent.com";
const BRANCH = "screenshots-diff";

// How many bundle files get inline images before the comment just links the
// full run artefact. Bounded to keep the comment skimmable.
export const HIGHLIGHT_LIMIT = 4;

const HELP = `Post or update the sticky screenshot diff comment on a pull request.

Usage:
  node scripts/screenshots-pr-comment.js \\
    --pr <n> --repo <owner/repo> --bundle <dir> [options]

Options:
  --pr <n>             pull request number (required)
  --repo <owner/repo>  repository slug (required)
  --bundle <dir>       diff bundle directory holding report.json (required)
  --run-id <id>        workflow run id, used in the image paths
  --run-url <url>      workflow run URL, linked for the full bundle
  --limit <n>          files to show inline (default: ${HIGHLIGHT_LIMIT})
  --help               show this help

Exits 0 without commenting when the bundle has no reviewable differences or
the token is read-only (fork pull requests) — the caller guards those too.`;

function parseArgs(argv) {
  const options = {
    pr: null,
    repo: null,
    bundle: null,
    runId: null,
    runUrl: null,
    limit: HIGHLIGHT_LIMIT,
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
    } else if (arg === "--pr" || arg.startsWith("--pr=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: "--pr needs a number" };
      options.pr = value;
      i = next;
    } else if (arg === "--repo" || arg.startsWith("--repo=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: "--repo needs an owner/repo slug" };
      options.repo = value;
      i = next;
    } else if (arg === "--bundle" || arg.startsWith("--bundle=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: "--bundle needs a directory" };
      options.bundle = value;
      i = next;
    } else if (arg === "--run-id" || arg.startsWith("--run-id=")) {
      const { value, i: next } = valueOf(arg, i);
      if (value === undefined) return { error: "--run-id needs an id" };
      options.runId = value || null;
      i = next;
    } else if (arg === "--run-url" || arg.startsWith("--run-url=")) {
      const { value, i: next } = valueOf(arg, i);
      if (value === undefined) return { error: "--run-url needs a URL" };
      options.runUrl = value || null;
      i = next;
    } else if (arg === "--limit" || arg.startsWith("--limit=")) {
      const { value, i: next } = valueOf(arg, i);
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return { error: "--limit needs a positive integer" };
      }
      options.limit = parsed;
      i = next;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (options.help) return { options };
  if (!options.pr) return { error: "--pr is required" };
  if (!options.repo) return { error: "--repo is required" };
  if (!options.bundle) return { error: "--bundle is required" };

  return { options };
}

// Absolute raw.githubusercontent.com URL for one image in a published bundle.
export function imageUrl(repo, pr, runId, rel, name) {
  const encoded = String(rel)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${RAW_HOST}/${repo}/${BRANCH}/pr-${pr}/${runId}/${encoded}/${name}.png`;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

// One file's inline image table: fail shows before/after/diff, added shows
// after only, removed shows before only.
export function highlightBlock(file, context) {
  const { repo, pr, runId } = context;
  const labels = [];
  const cells = [];

  if (file.status === "fail" || file.status === "removed") {
    labels.push("before");
    cells.push(`![before](${imageUrl(repo, pr, runId, file.rel, "before")})`);
  }
  if (file.status === "fail" || file.status === "added") {
    labels.push("after");
    cells.push(`![after](${imageUrl(repo, pr, runId, file.rel, "after")})`);
  }
  if (file.status === "fail") {
    labels.push("diff");
    cells.push(`![diff](${imageUrl(repo, pr, runId, file.rel, "diff")})`);
  }

  const meta =
    file.diffPixels === null || file.diffPixels === undefined
      ? file.status
      : `${file.status} (${file.diffPixels} px, max Δ${file.maxDelta})`;

  return [
    `**${file.rel}** — ${meta}`,
    "",
    `| ${labels.join(" | ")} |`,
    `| ${labels.map(() => "---").join(" | ")} |`,
    `| ${cells.join(" | ")} |`,
  ].join("\n");
}

// Build the full comment body. Pure: everything it needs comes from `context`,
// so the markdown can be unit-tested without a network or a bundle on disk.
export function buildCommentBody(context) {
  const { report, repo, pr, runId, runUrl, limit = HIGHLIGHT_LIMIT } = context;
  const files = Array.isArray(report?.files) ? report.files : [];
  const totals = report?.totals ?? {};

  const lines = [];
  lines.push(MARKER);
  lines.push("## Screenshot matrix moved");
  lines.push("");
  lines.push(
    "This pull request moves the committed screenshot matrix. Confirm the " +
      "differences below are intended.",
  );
  lines.push("");
  lines.push(
    `**Totals:** ${totals.checked ?? files.length} checked — ` +
      `${totals.ok ?? 0} ok, ${totals.drift ?? 0} drift, ${totals.fail ?? 0} fail, ` +
      `${totals.added ?? 0} added, ${totals.removed ?? 0} removed.`,
  );
  lines.push("");
  lines.push("| File | Status | Δ px | Max Δ |");
  lines.push("| --- | --- | ---: | ---: |");
  for (const file of files) {
    const px =
      file.diffPixels === null || file.diffPixels === undefined
        ? ""
        : String(file.diffPixels);
    const delta =
      file.maxDelta === null || file.maxDelta === undefined
        ? ""
        : String(file.maxDelta);
    lines.push(
      `| ${escapeCell(file.rel)} | ${file.status} | ${px} | ${delta} |`,
    );
  }
  lines.push("");

  const highlights = files.slice(0, limit);
  if (highlights.length > 0) {
    lines.push("### Highlights");
    lines.push("");
    for (const file of highlights) {
      lines.push(highlightBlock(file, { repo, pr, runId }));
      lines.push("");
    }
    if (files.length > highlights.length) {
      lines.push(
        `_Showing ${highlights.length} of ${files.length} changed files._`,
      );
      lines.push("");
    }
  }

  if (runUrl) {
    lines.push(
      `The full bundle — HTML index, summary and every image — is attached ` +
        `to [this workflow run](${runUrl}).`,
    );
    lines.push("");
  }

  return lines.join("\n");
}

// The sticky comment is identified by its marker rather than by author, so a
// bot rename cannot orphan it.
export function findExistingComment(comments, marker = MARKER) {
  if (!Array.isArray(comments)) return null;
  return (
    comments.find(
      (comment) =>
        typeof comment?.body === "string" && comment.body.includes(marker),
    ) ?? null
  );
}

// Run `gh`. Captured invocations return stdout; failures throw so the caller
// can decide whether they are benign (read-only token) or fatal.
function gh(args, { input } = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error("the GitHub CLI (gh) is not installed or not on PATH");
    }
    throw new Error(`could not run gh: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || "").trim();
    throw new Error(
      `gh ${args.join(" ")} failed (exit ${result.status})` +
        (detail ? `: ${detail}` : ""),
    );
  }

  return result.stdout || "";
}

function listComments(repo, pr) {
  const raw = gh([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/issues/${pr}/comments`,
  ]);
  const pages = JSON.parse(raw);
  return Array.isArray(pages) ? pages.flat() : [];
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

  const reportPath = path.join(options.bundle, "report.json");
  if (!fs.existsSync(reportPath)) {
    console.error(`No bundle report at ${reportPath}; nothing to comment.`);
    return;
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (err) {
    console.error(`Could not read ${reportPath}: ${err.message}`);
    return;
  }

  if (!Array.isArray(report.files) || report.files.length === 0) {
    console.error(
      "No reviewable differences in the bundle; skipping the comment.",
    );
    return;
  }

  const body = buildCommentBody({
    report,
    repo: options.repo,
    pr: options.pr,
    runId: options.runId,
    runUrl: options.runUrl,
    limit: options.limit,
  });

  let comments;
  try {
    comments = listComments(options.repo, options.pr);
  } catch (err) {
    console.error(
      `Could not read pull request comments (read-only token?): ${err.message}`,
    );
    return;
  }

  const existing = findExistingComment(comments);
  const endpoint = existing
    ? `repos/${options.repo}/issues/comments/${existing.id}`
    : `repos/${options.repo}/issues/${options.pr}/comments`;
  const method = existing ? "PATCH" : "POST";

  try {
    gh(["api", "--method", method, endpoint, "--input", "-"], {
      input: JSON.stringify({ body }),
    });
  } catch (err) {
    console.error(`Could not publish the comment: ${err.message}`);
    return;
  }

  console.log(
    existing
      ? `Updated the sticky comment on #${options.pr}.`
      : `Posted the sticky comment on #${options.pr}.`,
  );
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) run();
