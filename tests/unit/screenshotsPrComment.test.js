import { describe, expect, it } from "vitest";

import {
  MARKER,
  buildCommentBody,
  findExistingComment,
  highlightBlock,
  imageUrl,
} from "../../scripts/screenshots-pr-comment.js";

const REPO = "OpenGIS/app";
const PR = "17";
const RUN_ID = "4242";
const RUN_URL = "https://github.com/OpenGIS/app/actions/runs/4242";

const failFile = {
  rel: "desktop/landscape/closed.png",
  status: "fail",
  diffPixels: 2,
  maxDelta: 40,
};
const addedFile = {
  rel: "desktop/landscape/open.png",
  status: "added",
  diffPixels: null,
  maxDelta: null,
};
const removedFile = {
  rel: "mobile/portrait/menu.png",
  status: "removed",
  diffPixels: null,
  maxDelta: null,
};

const report = {
  runId: RUN_ID,
  pr: PR,
  totals: { checked: 5, ok: 1, drift: 0, fail: 2, added: 1, removed: 1 },
  files: [
    failFile,
    addedFile,
    removedFile,
    {
      rel: "desktop/landscape/extra.png",
      status: "fail",
      diffPixels: 9,
      maxDelta: 5,
    },
  ],
};

describe("imageUrl", () => {
  it("builds a raw URL under the run subdirectory", () => {
    expect(imageUrl(REPO, PR, RUN_ID, failFile.rel, "diff")).toBe(
      `${"https://raw.githubusercontent.com"}/${REPO}/screenshots-diff/pr-${PR}/${RUN_ID}/desktop/landscape/closed.png/diff.png`,
    );
  });

  it("encodes each path segment", () => {
    expect(imageUrl(REPO, PR, RUN_ID, "scene/a b.png", "before")).toBe(
      `${"https://raw.githubusercontent.com"}/${REPO}/screenshots-diff/pr-${PR}/${RUN_ID}/scene/a%20b.png/before.png`,
    );
  });
});

describe("highlightBlock", () => {
  const context = { repo: REPO, pr: PR, runId: RUN_ID };

  it("shows before, after and diff for a fail", () => {
    const block = highlightBlock(failFile, context);
    expect(block).toContain(
      "**desktop/landscape/closed.png** — fail (2 px, max Δ40)",
    );
    expect(block).toMatch(/\| before \| after \| diff \|/);
    expect(block).toContain("/closed.png/before.png");
    expect(block).toContain("/closed.png/after.png");
    expect(block).toContain("/closed.png/diff.png");
  });

  it("shows after only for an added file", () => {
    const block = highlightBlock(addedFile, context);
    expect(block).toMatch(/\| after \|/);
    expect(block).not.toContain("before.png");
    expect(block).not.toContain("diff.png");
  });

  it("shows before only for a removed file", () => {
    const block = highlightBlock(removedFile, context);
    expect(block).toMatch(/\| before \|/);
    expect(block).not.toContain("after.png");
    expect(block).not.toContain("diff.png");
  });
});

describe("buildCommentBody", () => {
  const context = {
    report,
    repo: REPO,
    pr: PR,
    runId: RUN_ID,
    runUrl: RUN_URL,
  };

  it("starts with the sticky marker and a heading", () => {
    const body = buildCommentBody({ ...context, limit: 4 });
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain("## Screenshot matrix moved");
  });

  it("renders the totals line", () => {
    const body = buildCommentBody(context);
    expect(body).toContain(
      "**Totals:** 5 checked — 1 ok, 0 drift, 2 fail, 1 added, 1 removed.",
    );
  });

  it("renders every file in the summary table", () => {
    const body = buildCommentBody(context);
    expect(body).toContain("| File | Status | Δ px | Max Δ |");
    expect(body).toContain("| desktop/landscape/closed.png | fail | 2 | 40 |");
    expect(body).toContain("| desktop/landscape/open.png | added |  |  |");
    expect(body).toContain("| mobile/portrait/menu.png | removed |  |  |");
    expect(body).toContain("| desktop/landscape/extra.png | fail | 9 | 5 |");
  });

  it("caps the highlight blocks at the limit and says so", () => {
    const body = buildCommentBody({ ...context, limit: 2 });
    expect(body).toContain("### Highlights");
    expect(body).toContain("_Showing 2 of 4 changed files._");
    expect(body).not.toContain("/extra.png/diff.png");
  });

  it("omits the highlight section when there are no files", () => {
    const body = buildCommentBody({
      ...context,
      report: { ...report, files: [] },
    });
    expect(body).not.toContain("### Highlights");
  });

  it("links the workflow run when a URL is given", () => {
    const body = buildCommentBody(context);
    expect(body).toContain(`[this workflow run](${RUN_URL})`);
  });

  it("omits the run link when none is given", () => {
    const body = buildCommentBody({ ...context, runUrl: null });
    expect(body).not.toContain("this workflow run");
  });
});

describe("findExistingComment", () => {
  it("finds the comment carrying the marker", () => {
    const comments = [
      { id: 1, body: "unrelated" },
      { id: 2, body: `${MARKER}\nold body` },
    ];
    expect(findExistingComment(comments)).toEqual(comments[1]);
  });

  it("returns null when no comment carries the marker", () => {
    expect(findExistingComment([{ id: 1, body: "unrelated" }])).toBeNull();
  });

  it("returns null for a non-array or malformed input", () => {
    expect(findExistingComment(null)).toBeNull();
    expect(findExistingComment([{ id: 1 }, { id: 2, body: null }])).toBeNull();
  });
});
