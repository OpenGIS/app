import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// Verify a freshly captured screenshot tree against the committed matrix using
// a strict pixel tolerance rather than a byte-exact hash. The deterministic
// capture pipeline has an irreducible sub-level flake: consecutive CI runs can
// differ by a handful of pixels, each by ±1 in a single colour channel, so
// byte-exactness across runs is not achievable. A file passes when every
// differing channel is within `--max-delta` (default 1) AND the whole file
// differs in at most `--max-pixels` pixels (default 64). A real change — many
// pixels, or a larger per-channel delta — still fails. Dependency-free: the
// PNG decoder is a little zlib-inflate-plus-unfilter, Node builtins only.

const DEFAULTS = {
  maxDelta: 1,
  maxPixels: 64,
  mode: "shard",
};

const MODES = ["shard", "full"];

const HELP = `Verify a captured screenshot tree against the committed matrix.

Compares pixels, not bytes: a file passes when every differing channel is
within --max-delta and it differs in at most --max-pixels pixels. Identical
files are OK; files within tolerance are reported as drift but still pass.

Usage:
  node scripts/verify-matrix.js --committed <dir> --captured <dir> [options]

Options:
  --committed <dir>    committed capture tree (required)
  --captured <dir>     freshly captured tree (required)
  --max-delta <n>      maximum per-channel byte delta (default: ${DEFAULTS.maxDelta})
  --max-pixels <n>     maximum differing pixels per file (default: ${DEFAULTS.maxPixels})
  --mode <shard|full>  shard: verify captured files only, ignoring committed
                       files this shard did not capture (default)
                       full: additionally require a captured counterpart for
                       every committed PNG and reject extra captures
  --report <file>      write the plain-text report to this path
  --help               show this help

Exit codes:
  0  every checked file passed
  1  at least one failure
  2  usage error`;

function parseArgs(argv) {
  const options = {
    committed: null,
    captured: null,
    maxDelta: DEFAULTS.maxDelta,
    maxPixels: DEFAULTS.maxPixels,
    mode: DEFAULTS.mode,
    report: null,
    help: false,
  };

  const valueOf = (arg, i) => {
    if (arg.includes("=")) return { value: arg.slice(arg.indexOf("=") + 1), i };
    return { value: argv[i + 1], i: i + 1 };
  };

  const integerOf = (name, raw) => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      return { error: `${name} needs a non-negative integer` };
    }
    return { value };
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
    } else if (arg === "--max-delta" || arg.startsWith("--max-delta=")) {
      const { value, i: next } = valueOf(arg, i);
      if (value === undefined) return { error: `${arg} needs a number` };
      const parsed = integerOf(arg, value);
      if (parsed.error) return { error: parsed.error };
      options.maxDelta = parsed.value;
      i = next;
    } else if (arg === "--max-pixels" || arg.startsWith("--max-pixels=")) {
      const { value, i: next } = valueOf(arg, i);
      if (value === undefined) return { error: `${arg} needs a number` };
      const parsed = integerOf(arg, value);
      if (parsed.error) return { error: parsed.error };
      options.maxPixels = parsed.value;
      i = next;
    } else if (arg === "--mode" || arg.startsWith("--mode=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!MODES.includes(value)) {
        return { error: `--mode must be one of: ${MODES.join(", ")}` };
      }
      options.mode = value;
      i = next;
    } else if (arg === "--report" || arg.startsWith("--report=")) {
      const { value, i: next } = valueOf(arg, i);
      if (!value) return { error: `${arg} needs a file path` };
      options.report = value;
      i = next;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  if (options.help) return { options };
  if (!options.committed) return { error: "--committed is required" };
  if (!options.captured) return { error: "--captured is required" };

  return { options };
}

function isDirectory(target) {
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

// Recursive walk returning a Map of forward-slash relative path -> absolute
// path. Any `diag/` subtree is skipped: it holds per-capture diagnostics
// written beside the images, never part of the visual comparison.
function walkPngs(root) {
  const files = new Map();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "diag") continue;
        visit(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        files.set(path.relative(root, abs).split(path.sep).join("/"), abs);
      }
    }
  };
  if (isDirectory(root)) visit(root);
  return files;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// Colour type -> channel count. Palette (3) is deliberately unsupported: the
// captures are truecolour (type 2) and a palette image would need PLTE lookup.
const CHANNELS_BY_COLOUR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterRow(type, src, out, prev, bpp) {
  for (let i = 0; i < src.length; i++) {
    const raw = src[i];
    const a = i >= bpp ? out[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let value;
    switch (type) {
      case 0:
        value = raw;
        break;
      case 1:
        value = raw + a;
        break;
      case 2:
        value = raw + b;
        break;
      case 3:
        value = raw + ((a + b) >> 1);
        break;
      case 4:
        value = raw + paeth(a, b, c);
        break;
      default:
        throw new Error(`unsupported scanline filter type ${type}`);
    }
    out[i] = value & 0xff;
  }
}

// Decode an 8-bit, non-interlaced PNG into unfiltered sample bytes. Supports
// grayscale (0), RGB (2), grayscale+alpha (4) and RGBA (6); everything else is
// rejected with a clear message rather than a wrong comparison.
function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG (bad signature)");
  }

  let offset = 8;
  let header = null;
  const idat = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error("truncated PNG chunk");

    if (type === "IHDR") {
      header = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colourType: buffer[dataStart + 9],
        compression: buffer[dataStart + 10],
        filter: buffer[dataStart + 11],
        interlace: buffer[dataStart + 12],
      };
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!header) throw new Error("missing IHDR chunk");
  if (header.bitDepth !== 8) {
    throw new Error(
      `unsupported bit depth ${header.bitDepth} (only 8-bit is supported)`,
    );
  }
  const channels = CHANNELS_BY_COLOUR_TYPE[header.colourType];
  if (!channels) {
    throw new Error(
      `unsupported colour type ${header.colourType} ` +
        "(supported: 0 grayscale, 2 RGB, 4 gray+alpha, 6 RGBA)",
    );
  }
  if (header.compression !== 0) {
    throw new Error(`unsupported compression method ${header.compression}`);
  }
  if (header.filter !== 0) {
    throw new Error(`unsupported filter method ${header.filter}`);
  }
  if (header.interlace !== 0)
    throw new Error("interlaced PNGs are not supported");
  if (idat.length === 0) throw new Error("no IDAT image data");

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch (err) {
    throw new Error(`could not inflate image data: ${err.message}`);
  }

  const { width, height } = header;
  const rowBytes = width * channels;
  const expected = (rowBytes + 1) * height;
  if (raw.length < expected) {
    throw new Error(
      `image data too short (${raw.length} bytes, expected ${expected})`,
    );
  }

  const pixels = new Uint8Array(rowBytes * height);
  let prev = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const base = y * (rowBytes + 1);
    const type = raw[base];
    const src = raw.subarray(base + 1, base + 1 + rowBytes);
    const row = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
    unfilterRow(type, src, row, prev, channels);
    prev = row;
  }

  return { width, height, channels, pixels };
}

function compareImages(committed, captured) {
  const channels = committed.channels;
  const a = committed.pixels;
  const b = captured.pixels;
  const pixelCount = committed.width * committed.height;

  let diffPixels = 0;
  let maxDelta = 0;

  for (let p = 0; p < pixelCount; p++) {
    const base = p * channels;
    let differs = false;
    for (let c = 0; c < channels; c++) {
      const delta = Math.abs(a[base + c] - b[base + c]);
      if (delta > 0) {
        differs = true;
        if (delta > maxDelta) maxDelta = delta;
      }
    }
    if (differs) diffPixels += 1;
  }

  return { diffPixels, maxDelta };
}

function failure(rel, detail) {
  return { rel, status: "fail", detail };
}

function compareFile(rel, committedAbs, capturedAbs, options) {
  let committedBytes;
  let capturedBytes;
  try {
    committedBytes = fs.readFileSync(committedAbs);
    capturedBytes = fs.readFileSync(capturedAbs);
  } catch (err) {
    return failure(rel, `could not read file: ${err.message}`);
  }

  // Byte-identical files are trivially OK — skip the decode entirely.
  if (committedBytes.equals(capturedBytes)) {
    return { rel, status: "ok", diffPixels: 0, maxDelta: 0 };
  }

  let committedImage;
  let capturedImage;
  try {
    committedImage = decodePng(committedBytes);
  } catch (err) {
    return failure(rel, `committed PNG could not be decoded: ${err.message}`);
  }
  try {
    capturedImage = decodePng(capturedBytes);
  } catch (err) {
    return failure(rel, `captured PNG could not be decoded: ${err.message}`);
  }

  if (
    committedImage.width !== capturedImage.width ||
    committedImage.height !== capturedImage.height
  ) {
    return failure(
      rel,
      `dimension mismatch (committed ${committedImage.width}x${committedImage.height}, ` +
        `captured ${capturedImage.width}x${capturedImage.height})`,
    );
  }
  if (committedImage.channels !== capturedImage.channels) {
    return failure(
      rel,
      `colour type mismatch (committed ${committedImage.channels}-channel, ` +
        `captured ${capturedImage.channels}-channel)`,
    );
  }

  const { diffPixels, maxDelta } = compareImages(committedImage, capturedImage);

  if (diffPixels === 0) {
    return { rel, status: "ok", diffPixels, maxDelta };
  }
  if (maxDelta <= options.maxDelta && diffPixels <= options.maxPixels) {
    return { rel, status: "drift", diffPixels, maxDelta };
  }
  return { rel, status: "fail", diffPixels, maxDelta };
}

function buildResults(options) {
  const committedFiles = walkPngs(options.committed);
  const capturedFiles = walkPngs(options.captured);

  if (!isDirectory(options.captured)) {
    return [
      failure(
        "(captured tree)",
        `captured directory not found: ${options.captured}`,
      ),
    ];
  }
  if (capturedFiles.size === 0) {
    return [
      failure("(captured tree)", "no PNG captures found — nothing to verify"),
    ];
  }

  const results = [];

  for (const [rel, capturedAbs] of capturedFiles) {
    const committedAbs = committedFiles.get(rel);
    if (!committedAbs) {
      const detail =
        options.mode === "full"
          ? "captured but not committed (extra)"
          : `missing committed counterpart under ${options.committed}/`;
      results.push(failure(rel, detail));
      continue;
    }
    results.push(compareFile(rel, committedAbs, capturedAbs, options));
  }

  if (options.mode === "full") {
    for (const rel of committedFiles.keys()) {
      if (!capturedFiles.has(rel)) {
        results.push(failure(rel, "committed but never captured (missing)"));
      }
    }
  }

  results.sort((a, b) => a.rel.localeCompare(b.rel));
  return results;
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

  const lines = [];
  const emit = (line) => {
    lines.push(line);
    console.log(line);
  };

  emit(`Screenshot matrix verification (${options.mode})`);
  emit(`  committed: ${options.committed}`);
  emit(`  captured:  ${options.captured}`);
  emit(
    `  tolerance: max Δ${options.maxDelta} per channel, ` +
      `max ${options.maxPixels} differing px per file`,
  );
  emit("");

  if (!isDirectory(options.committed)) {
    emit(`FAIL: committed directory not found: ${options.committed}`);
    emit("");
    emit("Summary: 1 checked — 0 ok, 0 drift, 1 fail");
    process.exit(1);
  }

  const results = buildResults(options);

  for (const result of results) {
    if (result.status === "drift") {
      emit(
        `drift: ${result.rel} — ${result.diffPixels} px, max Δ${result.maxDelta}`,
      );
    } else if (result.status === "fail") {
      emit(
        result.detail
          ? `FAIL: ${result.rel} — ${result.detail}`
          : `FAIL: ${result.rel} — ${result.diffPixels} px, max Δ${result.maxDelta}`,
      );
    }
  }

  const ok = results.filter((result) => result.status === "ok").length;
  const drift = results.filter((result) => result.status === "drift").length;
  const fail = results.filter((result) => result.status === "fail").length;
  const checked = results.length;

  emit("");
  if (fail > 0) {
    emit(
      "Refresh the committed matrix from the workflow's captured artifacts with",
    );
    emit("'npm run screenshots:fetch -- --run <run-id> --write'.");
    emit("");
  }
  emit(`Summary: ${checked} checked — ${ok} ok, ${drift} drift, ${fail} fail`);

  if (options.report) {
    fs.mkdirSync(path.dirname(options.report), { recursive: true });
    fs.writeFileSync(options.report, `${lines.join("\n")}\n`);
  }

  if (fail > 0) process.exit(1);
}

run();
