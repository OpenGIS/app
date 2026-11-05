// Validate commit subjects against Conventional Commits.
//
// Used by the `commits` CI job to gate the release: a subject that does not
// parse is invisible to semantic-release, so it must fail loudly here. Runs on
// Node 24 (matching the workflow) and depends only on `git` plus the standard
// library. See the type table in docs/13.ci.md for the allowed types.

import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Allowed types (see docs/13.ci.md), plus `revert` from the Conventional Commits spec.
export const ALLOWED_TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "test",
  "revert",
];

// `type(scope)?!?: description` — lowercase type and scope, non-empty description.
const CONVENTIONAL_PATTERN = /^([a-z]+)(?:\(([a-z0-9._/-]+)\))?(!)?: (.+)$/;

// Record/field separators keep subjects containing spaces or quotes intact.
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

/** True when `subject` is a valid Conventional Commits subject line. */
export const isConventional = (subject) => {
  const match = CONVENTIONAL_PATTERN.exec(String(subject).trim());
  if (!match) return false;
  return ALLOWED_TYPES.includes(match[1]);
};

/** True for git-native reverts, which carry a `Revert "…"` subject. */
export const isRevert = (subject) => String(subject).startsWith('Revert "');

/** True when a commit has two or more parents (a merge commit). */
export const isMerge = (commit) => commit.parents.length >= 2;

/** A SHA of all zeros means "no previous commit" — treat it as empty. */
const isEmptySha = (sha) => !sha || /^0+$/.test(sha);

/** True when `sha` names a commit object present in this clone. */
const objectExists = (sha) => {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Decide the `git log` range. Fall back to the tip commit when there is no
 * before SHA, or when it is unreachable (e.g. the old tip after a force-push
 * and therefore absent from a shallow-ish clone).
 */
export const resolveRange = (before, after, hasCommit = objectExists) => {
  const tipOnly = isEmptySha(before) || !hasCommit(before);
  return { range: tipOnly ? after : `${before}..${after}`, tipOnly };
};

/** Parse `git log` output produced with RECORD_SEP/FIELD_SEP. */
export const parseLog = (output) =>
  output
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, parents, subject] = record.split(FIELD_SEP);
      return {
        sha,
        parents: (parents ?? "").split(/\s+/).filter(Boolean),
        subject: (subject ?? "").trim(),
      };
    });

/** Read commits for the range, or just the tip when there is no before SHA. */
const readCommits = (before, after) => {
  const { range, tipOnly } = resolveRange(before, after);
  const args = ["log"];
  if (tipOnly) args.push("-1");
  args.push(range, `--format=%H${FIELD_SEP}%P${FIELD_SEP}%s${RECORD_SEP}`);
  const output = execFileSync("git", args, { encoding: "utf8" });
  return parseLog(output);
};

/** Split commits into those to validate and those exempt (merge/revert). */
export const partition = (commits) => {
  const validating = [];
  const exempt = [];
  for (const commit of commits) {
    if (isMerge(commit) || isRevert(commit.subject)) exempt.push(commit);
    else validating.push(commit);
  }
  return { validating, exempt };
};

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const main = () => {
  const before = process.env.BEFORE ?? "";
  const after = process.env.AFTER || "HEAD";

  if (!isEmptySha(before) && resolveRange(before, after).tipOnly) {
    console.error(
      `BEFORE ${before} is not present in this clone (force-push?); validating the head commit only.`,
    );
  }

  let commits;
  try {
    commits = readCommits(before, after);
  } catch (error) {
    fail(`Could not read commits with git: ${error.message}`);
  }

  const { validating } = partition(commits);
  const invalid = validating.filter(
    (commit) => !isConventional(commit.subject),
  );

  if (invalid.length > 0) {
    const lines = invalid.map(
      (commit) => `  ${commit.sha.slice(0, 7)} ${commit.subject}`,
    );
    console.error(
      [
        `Invalid commit message${invalid.length > 1 ? "s" : ""} found:`,
        ...lines,
        "",
        "Subjects must follow Conventional Commits, e.g. `feat(ui): add offline panel`.",
        `Allowed types (see docs/13.ci.md): ${ALLOWED_TYPES.join(", ")}.`,
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(`Validated ${validating.length} commit message(s).`);
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
