import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  compareFile,
  decodePng,
  encodePng,
  walkPngs,
} from "../../scripts/verify-matrix.js";
import {
  buildBundle,
  buildDiffPng,
  compareTrees,
} from "../../scripts/screenshot-diff-bundle.js";

// All scratch artefacts live under the project temp directory.
const ROOT = path.join(
  process.cwd(),
  ".opencode",
  "tmp",
  "screenshot-diff-bundle-test",
);

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const makePixels = (width, height, channels, fn) => {
  const px = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        px[(y * width + x) * channels + c] = fn(x, y, c) & 0xff;
      }
    }
  }
  return px;
};

const writePng = (absPath, buffer) => {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, buffer);
};

const solid = (channels, value) => (x, y, c) =>
  Array.isArray(value) ? value[c] : value;

beforeAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("encodePng / decodePng round-trip", () => {
  for (const channels of [1, 2, 3, 4]) {
    it(`round-trips a ${channels}-channel image`, () => {
      const width = 5;
      const height = 3;
      const pixels = makePixels(
        width,
        height,
        channels,
        (x, y, c) => x * 17 + y * 23 + c * 11,
      );

      const encoded = encodePng(width, height, channels, pixels);
      expect(encoded.subarray(0, 8).equals(PNG_HEADER)).toBe(true);

      const decoded = decodePng(encoded);
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(decoded.channels).toBe(channels);
      expect(Buffer.from(decoded.pixels)).toEqual(Buffer.from(pixels));
    });
  }

  it("rejects an unsupported channel count", () => {
    expect(() => encodePng(1, 1, 5, new Uint8Array(5))).toThrow(
      /unsupported channel count/,
    );
  });
});

describe("compareFile", () => {
  const compare = (beforeBuf, afterBuf) => {
    const beforeAbs = path.join(ROOT, "compare", "before.png");
    const afterAbs = path.join(ROOT, "compare", "after.png");
    writePng(beforeAbs, beforeBuf);
    writePng(afterAbs, afterBuf);
    return compareFile("scene.png", beforeAbs, afterAbs, {
      maxDelta: 1,
      maxPixels: 64,
    });
  };

  it("reports identical images as ok", () => {
    const buf = encodePng(4, 4, 3, makePixels(4, 4, 3, solid(3, [10, 20, 30])));
    expect(compare(buf, buf)).toEqual({
      rel: "scene.png",
      status: "ok",
      diffPixels: 0,
      maxDelta: 0,
    });
  });

  it("reports a small in-tolerance change as drift", () => {
    const before = makePixels(4, 4, 3, solid(3, [10, 20, 30]));
    const after = Uint8Array.from(before);
    after[0] = 11;

    const result = compare(
      encodePng(4, 4, 3, before),
      encodePng(4, 4, 3, after),
    );
    expect(result).toEqual({
      rel: "scene.png",
      status: "drift",
      diffPixels: 1,
      maxDelta: 1,
    });
  });

  it("reports an over-tolerance change as fail with exact counts", () => {
    const before = makePixels(4, 4, 3, solid(3, [10, 20, 30]));
    const after = Uint8Array.from(before);
    for (const pixel of [0, 5]) {
      for (let c = 0; c < 3; c++) after[pixel * 3 + c] += 40;
    }

    const result = compare(
      encodePng(4, 4, 3, before),
      encodePng(4, 4, 3, after),
    );
    expect(result).toEqual({
      rel: "scene.png",
      status: "fail",
      diffPixels: 2,
      maxDelta: 40,
    });
  });

  it("reports a dimension mismatch as fail", () => {
    const result = compare(
      encodePng(4, 4, 3, makePixels(4, 4, 3, solid(3, 0))),
      encodePng(5, 4, 3, makePixels(5, 4, 3, solid(3, 0))),
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/dimension mismatch/);
  });
});

describe("buildDiffPng", () => {
  it("highlights differing pixels magenta over a dimmed greyscale after", () => {
    const width = 4;
    const height = 2;
    const before = makePixels(width, height, 3, solid(3, [10, 20, 30]));
    const after = Uint8Array.from(before);
    after[0] = 50;

    const diff = decodePng(
      buildDiffPng(
        encodePng(width, height, 3, before),
        encodePng(width, height, 3, after),
      ),
    );

    expect(diff.width).toBe(width);
    expect(diff.height).toBe(height);
    expect(diff.channels).toBe(3);

    // The changed pixel is opaque magenta.
    expect([...diff.pixels.subarray(0, 3)]).toEqual([255, 0, 255]);

    // An unchanged pixel is dimmed greyscale (equal channels, darker than the
    // source colour's luminance).
    const px = diff.pixels[3];
    expect(diff.pixels[4]).toBe(px);
    expect(diff.pixels[5]).toBe(px);
    expect(px).toBeGreaterThan(0);
    expect(px).toBeLessThan(20);
  });

  it("returns null when an image cannot be decoded", () => {
    const good = encodePng(2, 2, 3, makePixels(2, 2, 3, solid(3, 0)));
    expect(buildDiffPng(Buffer.from("not a png"), good)).toBeNull();
  });
});

describe("bundle generation", () => {
  const committedRoot = path.join(ROOT, "committed");
  const capturedRoot = path.join(ROOT, "captured");
  const outRoot = path.join(ROOT, "bundle");

  const base = makePixels(4, 4, 3, solid(3, [10, 20, 30]));

  const changedAfter = () => {
    const after = Uint8Array.from(base);
    for (const pixel of [0, 5]) {
      for (let c = 0; c < 3; c++) after[pixel * 3 + c] += 40;
    }
    return after;
  };

  const driftAfter = () => {
    const after = Uint8Array.from(base);
    after[1] = 21;
    return after;
  };

  let report;

  beforeAll(() => {
    fs.rmSync(outRoot, { recursive: true, force: true });

    // committed: a=unchanged, b=fail, c=removed, e=drift
    writePng(
      path.join(committedRoot, "scene", "a.png"),
      encodePng(4, 4, 3, base),
    );
    writePng(
      path.join(committedRoot, "scene", "b.png"),
      encodePng(4, 4, 3, base),
    );
    writePng(
      path.join(committedRoot, "scene", "c.png"),
      encodePng(4, 4, 3, base),
    );
    writePng(
      path.join(committedRoot, "scene", "e.png"),
      encodePng(4, 4, 3, base),
    );

    // captured: a=unchanged, b=changed, d=added, e=drift
    writePng(
      path.join(capturedRoot, "scene", "a.png"),
      encodePng(4, 4, 3, base),
    );
    writePng(
      path.join(capturedRoot, "scene", "b.png"),
      encodePng(4, 4, 3, changedAfter()),
    );
    writePng(
      path.join(capturedRoot, "scene", "d.png"),
      encodePng(4, 4, 3, base),
    );
    writePng(
      path.join(capturedRoot, "scene", "e.png"),
      encodePng(4, 4, 3, driftAfter()),
    );

    report = buildBundle({
      committed: committedRoot,
      captured: capturedRoot,
      out: outRoot,
      runId: "4242",
      pr: "17",
    });
  });

  it("classifies every paired file", () => {
    const results = compareTrees({
      committed: committedRoot,
      captured: capturedRoot,
      maxDelta: 1,
      maxPixels: 64,
    });
    const byRel = Object.fromEntries(results.map((r) => [r.rel, r.status]));
    expect(byRel).toEqual({
      "scene/a.png": "ok",
      "scene/b.png": "fail",
      "scene/c.png": "removed",
      "scene/d.png": "added",
      "scene/e.png": "drift",
    });
  });

  it("writes before/after/diff for a failed file", () => {
    const dir = path.join(outRoot, "scene", "b.png");
    expect(fs.existsSync(path.join(dir, "before.png"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "after.png"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "diff.png"))).toBe(true);

    const diff = decodePng(fs.readFileSync(path.join(dir, "diff.png")));
    expect([...diff.pixels.subarray(0, 3)]).toEqual([255, 0, 255]);
  });

  it("writes only after.png for an added file", () => {
    const dir = path.join(outRoot, "scene", "d.png");
    expect(fs.existsSync(path.join(dir, "after.png"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "before.png"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "diff.png"))).toBe(false);
  });

  it("writes only before.png for a removed file", () => {
    const dir = path.join(outRoot, "scene", "c.png");
    expect(fs.existsSync(path.join(dir, "before.png"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "after.png"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "diff.png"))).toBe(false);
  });

  it("writes no directory for ok or drift files", () => {
    expect(fs.existsSync(path.join(outRoot, "scene", "a.png"))).toBe(false);
    expect(fs.existsSync(path.join(outRoot, "scene", "e.png"))).toBe(false);
  });

  it("writes an index, a summary and a report", () => {
    const index = fs.readFileSync(path.join(outRoot, "index.html"), "utf8");
    const summary = fs.readFileSync(path.join(outRoot, "summary.md"), "utf8");
    const json = JSON.parse(
      fs.readFileSync(path.join(outRoot, "report.json"), "utf8"),
    );

    expect(index).toContain("run: 4242");
    expect(index).toContain("pull request: 17");
    expect(index).toContain('<img src="scene/b.png/diff.png"');

    expect(summary).toContain("| scene/b.png | fail | 2 | 40 |");
    expect(summary).toContain("| scene/c.png | removed |  |  |");
    expect(summary).toContain("| scene/d.png | added |  |  |");

    expect(json.runId).toBe("4242");
    expect(json.pr).toBe("17");
    expect(json.totals).toEqual({
      checked: 5,
      ok: 1,
      drift: 1,
      fail: 1,
      added: 1,
      removed: 1,
    });
    expect(json.files).toEqual([
      { rel: "scene/b.png", status: "fail", diffPixels: 2, maxDelta: 40 },
      {
        rel: "scene/c.png",
        status: "removed",
        diffPixels: null,
        maxDelta: null,
      },
      { rel: "scene/d.png", status: "added", diffPixels: null, maxDelta: null },
    ]);
  });

  it("returns the same report it writes", () => {
    expect(report.files).toHaveLength(3);
    expect(walkPngs(outRoot).size).toBe(5);
  });
});
