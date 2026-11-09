import { describe, expect, it } from "vitest";

import {
  isConventional,
  partition,
  resolveRange,
} from "../../.github/scripts/checkCommits.mjs";

const SHA = "a".repeat(40);

describe("resolveRange", () => {
  const cases = [
    {
      name: "uses the tip alone when there is no before SHA",
      before: "",
      after: "abc",
      hasCommit: () => true,
      expected: { range: "abc", tipOnly: true },
    },
    {
      name: "uses the range when the before SHA is present",
      before: SHA,
      after: "abc",
      hasCommit: () => true,
      expected: { range: `${SHA}..abc`, tipOnly: false },
    },
    {
      name: "falls back to the tip when the before SHA is missing (force-push)",
      before: SHA,
      after: "abc",
      hasCommit: () => false,
      expected: { range: "abc", tipOnly: true },
    },
  ];

  for (const { name, before, after, hasCommit, expected } of cases) {
    it(name, () => {
      expect(resolveRange(before, after, hasCommit)).toEqual(expected);
    });
  }
});

describe("isConventional", () => {
  const cases = [
    ["feat(ui): add routes panel", true],
    ["fix: handle missing tile cache", true],
    ["chore!: drop legacy endpoint", true],
    ["docs: update testing guide", true],
    ["unknown: not an allowed type", false],
    ["Feat: uppercase type", false],
    ["feat:missing space", false],
    ["no conventional prefix", false],
  ];

  for (const [subject, expected] of cases) {
    it(`${JSON.stringify(subject)} → ${expected}`, () => {
      expect(isConventional(subject)).toBe(expected);
    });
  }
});

describe("partition", () => {
  it("exempts merge commits and git-native reverts", () => {
    const commits = [
      { sha: "1", parents: ["p1"], subject: "feat: valid" },
      { sha: "2", parents: ["p1", "p2"], subject: "not conventional" },
      { sha: "3", parents: ["p1"], subject: 'Revert "feat: valid"' },
    ];

    const { validating, exempt } = partition(commits);

    expect(validating.map((commit) => commit.sha)).toEqual(["1"]);
    expect(exempt.map((commit) => commit.sha)).toEqual(["2", "3"]);
  });
});
