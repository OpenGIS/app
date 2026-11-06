import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Guards the single-source icon policy: every UI icon must come from the
// committed sprite (src/icons/ogis-icons.svg) or the PNG pipeline in
// src/icons/png/. The scan deliberately ignores src/icons/ itself.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src");
const ICONS_DIR = join(SRC, "icons");
const SASS_DIR = join(SRC, "assets", "sass");

const sprite = readFileSync(join(ICONS_DIR, "ogis-icons.svg"), "utf8");
const spriteIds = new Set(
  [...sprite.matchAll(/<symbol[^>]*\bid="([^"]+)"/g)].map((match) => match[1]),
);

const DRAWING_ELEMENTS = [
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "text",
  "image",
  "g",
];

// The only files allowed to contain inline SVG markup, each with a narrow
// check that still proves the SVG is a sprite reference or a data connector.
const VUE_SVG_ALLOWLIST = {
  "src/components/ui/icon.vue": {
    reason: "the generic sprite icon renderer",
    check(text) {
      const issues = [];
      const segments = svgSegments(text);

      if (!segments.length) {
        issues.push({
          index: 0,
          message: "allowlisted icon renderer must contain an <svg> element",
        });
      }

      for (const segment of segments) {
        if (!/<use\b/.test(segment.text)) {
          issues.push({
            index: segment.index,
            message: "icon.vue <svg> must reference the sprite with <use>",
          });
        }
        for (const element of drawingElements(segment.text)) {
          issues.push({
            index: segment.index,
            message: `icon.vue <svg> must not draw <${element}>`,
          });
        }
      }

      return issues;
    },
  },
  "src/features/routes/NavigationControl.vue": {
    reason: "the screen-space route connector line, not an icon",
    check(text) {
      const issues = [];
      const segments = svgSegments(text);

      if (!segments.length) {
        issues.push({
          index: 0,
          message: "the route connector must contain an <svg> element",
        });
      }

      for (const segment of segments) {
        if (!/class="ogis-nav-connector"/.test(segment.text)) {
          issues.push({
            index: segment.index,
            message:
              'the route connector <svg> must carry class="ogis-nav-connector"',
          });
        }
        if (!/<polyline\b/.test(segment.text)) {
          issues.push({
            index: segment.index,
            message: "the route connector must draw a <polyline>",
          });
        }
        for (const element of drawingElements(segment.text, ["polyline"])) {
          issues.push({
            index: segment.index,
            message: `the route connector must not draw <${element}>`,
          });
        }
      }

      return issues;
    },
  },
};

const JS_SVG_ALLOWLIST = {
  "src/utils/iconImage.js": {
    reason:
      "builds an <svg> wrapper so the authored direction arrow can be rasterised",
    check(text) {
      const issues = [];

      if (!/from\s+["']@\/icons\/svg\/[^"']+\.svg\?raw["']/.test(text)) {
        issues.push({
          index: 0,
          message:
            "iconImage.js must import its source from @/icons/svg/ with ?raw",
        });
      }

      for (const element of drawingElements(text)) {
        issues.push({
          index: 0,
          message: `iconImage.js must not draw <${element}>; it only wraps the authored SVG`,
        });
      }

      return issues;
    },
  },
};

const ALLOWED_CONTENT =
  /^(?:none|normal|""|''|counter\s*\(|attr\s*\(|map-get\s*\()/;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

const blankOut = (match) => match.replace(/[^\n]/g, " ");

/** Replace comments with spaces so line numbers stay stable. */
const stripComments = (source) =>
  source
    .replace(/<!--[\s\S]*?-->/g, blankOut)
    .replace(/\/\*[\s\S]*?\*\//g, blankOut)
    .replace(/(?<!:)\/\/[^\n]*/g, blankOut);

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

const toRelative = (file) => relative(ROOT, file).split(sep).join("/");

const sourceFiles = () => {
  const files = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (full === ICONS_DIR) continue;
        walk(full);
        continue;
      }

      if (entry.name.endsWith(".vue") || entry.name.endsWith(".js")) {
        files.push(full);
      } else if (
        entry.name.endsWith(".scss") &&
        full.startsWith(`${SASS_DIR}${sep}`)
      ) {
        files.push(full);
      }
    }
  };

  walk(SRC);
  return files.sort();
};

/** Each literal <svg> segment, bounded by its closing tag or end of line. */
const svgSegments = (text) => {
  const segments = [];
  const pattern = /<svg\b/g;
  let match;

  while ((match = pattern.exec(text))) {
    const start = match.index;
    const close = text.indexOf("</svg>", start);
    let end;

    if (close !== -1) {
      end = close + "</svg>".length;
    } else {
      const newline = text.indexOf("\n", start);
      end = newline === -1 ? text.length : newline;
    }

    segments.push({ index: start, text: text.slice(start, end) });
    pattern.lastIndex = end;
  }

  return segments;
};

const drawingElements = (text, allowed = []) => {
  const found = [];

  for (const element of DRAWING_ELEMENTS) {
    if (allowed.includes(element)) continue;

    const pattern = new RegExp(`<${element}\\b`, "g");
    if (pattern.test(text)) found.push(element);
  }

  return found;
};

const blocks = (text, tag) => {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const found = [];
  let match;

  while ((match = pattern.exec(text))) {
    found.push({
      index: match.index + match[0].indexOf(">") + 1,
      text: match[1],
    });
  }

  return found;
};

const isInsideIcons = (specifier, file) => {
  const clean = specifier.split("?")[0];
  let resolved;

  if (clean.startsWith("@/")) {
    resolved = join(SRC, clean.slice(2));
  } else if (clean.startsWith(".")) {
    resolved = resolve(dirname(file), clean);
  } else {
    return false;
  }

  return resolved === ICONS_DIR || resolved.startsWith(`${ICONS_DIR}${sep}`);
};

const collectViolations = () => {
  const violations = [];

  const add = (file, text, index, message) => {
    violations.push(`${toRelative(file)}:${lineAt(text, index)} — ${message}`);
  };

  for (const file of sourceFiles()) {
    const relativePath = toRelative(file);
    const raw = readFileSync(file, "utf8");
    const text = stripComments(raw);

    const isVue = file.endsWith(".vue");
    const isJs = file.endsWith(".js");
    const isScss = file.endsWith(".scss");

    // 1. No literal <img> in components or scripts.
    if (isVue || isJs) {
      for (const match of text.matchAll(/<img\b/gi)) {
        add(
          file,
          text,
          match.index,
          "literal <img> is not allowed; use a pipeline icon",
        );
      }
    }

    // 2. Bootstrap's close button is not an app icon.
    if (isVue || isScss) {
      for (const match of text.matchAll(/btn-close/g)) {
        add(
          file,
          text,
          match.index,
          "Bootstrap .btn-close is not allowed; use the sprite x icon",
        );
      }
    }

    // 3. Inline SVG in Vue is limited to the two allowlisted files.
    if (isVue) {
      const allowlist = VUE_SVG_ALLOWLIST[relativePath];

      if (allowlist) {
        for (const issue of allowlist.check(text)) {
          add(file, text, issue.index, issue.message);
        }
      } else {
        for (const segment of svgSegments(text)) {
          add(
            file,
            text,
            segment.index,
            "literal <svg> is not allowed in components; use the sprite",
          );
        }
      }
    }

    // 4. Inline SVG strings in JavaScript must only reference the sprite.
    if (isJs) {
      const allowlist = JS_SVG_ALLOWLIST[relativePath];

      if (allowlist) {
        for (const issue of allowlist.check(text)) {
          add(file, text, issue.index, issue.message);
        }
      } else {
        for (const segment of svgSegments(text)) {
          if (!/<use\s+href\s*=\s*["']#[^"']+["']/.test(segment.text)) {
            add(
              file,
              text,
              segment.index,
              'inline SVG strings must reference the sprite with <use href="#id">',
            );
          }
          for (const element of drawingElements(segment.text)) {
            add(
              file,
              text,
              segment.index,
              `inline SVG strings must not draw <${element}>`,
            );
          }
        }
      }
    }

    // 5. No CSS-generated glyphs or background images.
    const cssBlocks = isScss
      ? [{ index: 0, text }]
      : isVue
        ? blocks(text, "style")
        : [];

    for (const block of cssBlocks) {
      for (const match of block.text.matchAll(/\bcontent\s*:\s*([^;}\n]+)/g)) {
        const value = match[1].trim().replace(/\s*!important$/i, "");

        if (ALLOWED_CONTENT.test(value)) continue;
        if (/["'][^"']*[^\s"'][^"']*["']/.test(value)) {
          add(
            file,
            text,
            block.index + match.index,
            "CSS content glyphs are not allowed; use the sprite",
          );
        }
      }

      for (const match of block.text.matchAll(
        /background-image\s*:\s*[^;}\n]*\burl\s*\(/g,
      )) {
        add(
          file,
          text,
          block.index + match.index,
          "CSS background-image url() is not allowed; use the sprite",
        );
      }
    }

    // 6. No canvas 2D drawing in JavaScript.
    if (isJs) {
      const canvasPatterns = [
        [
          /createElement\s*\(\s*["']canvas["']\s*\)/g,
          "canvas createElement is not allowed; use pipeline icons",
        ],
        [
          /getContext\s*\(\s*["']2d["']\s*\)/g,
          "canvas 2D context is not allowed; use pipeline icons",
        ],
        [/\bmoveTo\s*\(/g, "canvas path drawing (moveTo) is not allowed"],
        [/\blineTo\s*\(/g, "canvas path drawing (lineTo) is not allowed"],
        [
          /\bbezierCurveTo\s*\(/g,
          "canvas path drawing (bezierCurveTo) is not allowed",
        ],
        [
          /\bquadraticCurveTo\s*\(/g,
          "canvas path drawing (quadraticCurveTo) is not allowed",
        ],
        [/\barc\s*\(/g, "canvas path drawing (arc) is not allowed"],
        [/\bPath2D\b/g, "canvas Path2D is not allowed; use pipeline icons"],
        [
          /\bdrawImage\s*\(/g,
          "canvas drawImage is not allowed; use pipeline icons",
        ],
      ];

      for (const [pattern, message] of canvasPatterns) {
        for (const match of text.matchAll(pattern)) {
          add(file, text, match.index, message);
        }
      }
    }

    // 7. Image imports must use the SVG pipeline inside src/icons/.
    if (isVue || isJs) {
      for (const match of text.matchAll(
        /\bimport\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
      )) {
        const specifier = match[1];
        const clean = specifier.split("?")[0];
        const extension = clean.slice(clean.lastIndexOf(".") + 1).toLowerCase();

        if (IMAGE_EXTENSIONS.has(extension)) {
          add(
            file,
            text,
            match.index,
            `image import "${specifier}" is not allowed; use the pipeline sprite`,
          );
          continue;
        }

        if (extension !== "svg") continue;

        if (!/[?&](raw|url)\b/.test(specifier)) {
          add(
            file,
            text,
            match.index,
            `SVG import "${specifier}" must use ?raw or ?url`,
          );
        } else if (!isInsideIcons(specifier, file)) {
          add(
            file,
            text,
            match.index,
            `SVG import "${specifier}" must come from src/icons/`,
          );
        }
      }
    }

    // 8. No emoji or pictographs in markup, scripts or styles.
    for (const match of text.matchAll(/\p{Extended_Pictographic}/gu)) {
      add(
        file,
        text,
        match.index,
        "emoji and pictographic characters are not allowed; use the sprite",
      );
    }

    // 9. No glyph-only text nodes in Vue templates.
    if (isVue) {
      for (const block of blocks(text, "template")) {
        for (const match of block.text.matchAll(/>\s*[+\-−×✕✖→←↑↓]\s*</g)) {
          add(
            file,
            text,
            block.index + match.index,
            "glyph-only text nodes are not allowed; use the sprite",
          );
        }
      }
    }

    // 10. App.vue must inline the committed sprite.
    if (relativePath === "src/App.vue") {
      if (
        !/import\s+iconSprite\s+from\s+["']@\/icons\/ogis-icons\.svg\?raw["']/.test(
          text,
        )
      ) {
        add(
          file,
          text,
          0,
          "App.vue must import the committed sprite from @/icons/ogis-icons.svg?raw",
        );
      }

      if (!/v-html\s*=\s*["']iconSprite["']/.test(text)) {
        add(
          file,
          text,
          0,
          'App.vue must inline the sprite with v-html="iconSprite"',
        );
      }
    }

    // 11. Static sprite references must resolve to a real symbol.
    if (isVue || isJs) {
      for (const match of text.matchAll(
        /(?<!:)href\s*=\s*["']#([^"']+)["']/g,
      )) {
        if (!spriteIds.has(match[1])) {
          add(
            file,
            text,
            match.index,
            `href="#${match[1]}" does not match a sprite symbol`,
          );
        }
      }

      for (const match of text.matchAll(/<Icon\b[^>]*>/g)) {
        for (const attribute of match[0].matchAll(
          /(?<![:\w-])name\s*=\s*["']([^"']+)["']/g,
        )) {
          if (!spriteIds.has(attribute[1])) {
            add(
              file,
              text,
              match.index,
              `<Icon name="${attribute[1]}"> does not match a sprite symbol`,
            );
          }
        }
      }

      for (const match of text.matchAll(/<IconButton\b[^>]*>/g)) {
        for (const attribute of match[0].matchAll(
          /(?<![:\w-])icon\s*=\s*["']([^"']+)["']/g,
        )) {
          if (!spriteIds.has(attribute[1])) {
            add(
              file,
              text,
              match.index,
              `<IconButton icon="${attribute[1]}"> does not match a sprite symbol`,
            );
          }
        }
      }
    }
  }

  return violations;
};

describe("single-source icon policy", () => {
  it("has no icon-policy violations under src/", () => {
    const violations = collectViolations();

    expect(
      violations,
      `Icon policy violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("limits the inline-SVG allowlist to the three documented exceptions", () => {
    expect(Object.keys(VUE_SVG_ALLOWLIST).sort()).toEqual([
      "src/components/ui/icon.vue",
      "src/features/routes/NavigationControl.vue",
    ]);
    expect(Object.keys(JS_SVG_ALLOWLIST)).toEqual(["src/utils/iconImage.js"]);
  });
});
