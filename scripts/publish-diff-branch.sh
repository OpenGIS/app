#!/usr/bin/env bash
#
# Publish a generated screenshot diff bundle to the `screenshots-diff` orphan
# branch, so its images render inline in the sticky pull-request comment via
# raw.githubusercontent.com. The branch keeps only the newest run per pull
# request: everything under `pr-<n>/` is replaced on each push, and the run id
# is a path segment so camo's URL cache is busted on every run. Each publish is
# squashed to a single commit, so the branch never accumulates history.
#
# Usage:
#   scripts/publish-diff-branch.sh \
#     --bundle <dir> --pr <n> --run-id <id> --repo <owner/repo>
#
# Requires an authenticated git client (GH_TOKEN builds the push URL) and a
# bundle directory holding the diff bundle (index.html, summary.md, report.json
# and the per-file before/after/diff images).

set -euo pipefail

BUNDLE=""
PR=""
RUN_ID=""
REPO="${GITHUB_REPOSITORY:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bundle)
      BUNDLE="${2:-}"
      shift 2
      ;;
    --pr)
      PR="${2:-}"
      shift 2
      ;;
    --run-id)
      RUN_ID="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$BUNDLE" ] || [ ! -d "$BUNDLE" ]; then
  echo "Bundle directory not found: ${BUNDLE:-<unset>}" >&2
  exit 1
fi
if [ -z "$PR" ]; then
  echo "--pr is required" >&2
  exit 2
fi
if [ -z "$RUN_ID" ]; then
  echo "--run-id is required" >&2
  exit 2
fi
if [ -z "$REPO" ]; then
  echo "--repo (or GITHUB_REPOSITORY) is required" >&2
  exit 2
fi
if [ -z "${GH_TOKEN:-}" ]; then
  echo "GH_TOKEN is required to push" >&2
  exit 2
fi

BRANCH="screenshots-diff"
REMOTE="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
DEST="pr-${PR}/${RUN_ID}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Start from the existing branch when there is one, so previously published
# pull requests survive; otherwise start an orphan branch with no history.
# Probe the remote first: a clone failure for any other reason (network) must
# not be mistaken for "branch absent" and silently drop the other directories.
if git ls-remote --exit-code --heads "$REMOTE" "refs/heads/${BRANCH}" >/dev/null 2>&1; then
  git clone --quiet --branch "$BRANCH" "$REMOTE" "$WORK"
else
  git init --quiet "$WORK"
  git -C "$WORK" remote add origin "$REMOTE"
  git -C "$WORK" checkout --quiet --orphan "$BRANCH"
fi

# Replace this pull request's directory, keeping only the newest run.
rm -rf "$WORK/pr-${PR}"
mkdir -p "$WORK/$DEST"
cp -R "$BUNDLE/." "$WORK/$DEST/"

# Squash to a single commit: checkout an orphan, restage everything, commit,
# then rename over the branch and force-push. The branch holds one commit only.
git -C "$WORK" checkout --quiet --orphan "__publish"
git -C "$WORK" add -A
git -C "$WORK" -c user.name="github-actions[bot]" \
  -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit --quiet -m "docs(screenshots): publish diff bundle for PR #${PR} (run ${RUN_ID})"
git -C "$WORK" branch --quiet -M "$BRANCH"
git -C "$WORK" push --quiet --force origin "HEAD:refs/heads/${BRANCH}"

echo "Published ${DEST} to the ${BRANCH} branch."
