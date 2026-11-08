<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

// Falling green characters behind the side panel content, for the Matrix theme.
// Purely decorative: it sits under the panel content, ignores the pointer and
// is hidden from assistive technology. It only animates while the panel is
// open and the page is visible, at a gentle frame rate, and shows a still
// pattern instead when the device asks for reduced motion.

const props = defineProps({
  running: { type: Boolean, default: true },
});

const canvas = ref(null);

const GLYPHS = "0123456789ZXEVKQ:.=*+-<>|";
const CELL = 14; // px per character
const FRAME_MS = 70; // ~14 frames a second is plenty for rain

let ctx = null;
let drops = [];
let width = 0;
let height = 0;
let raf = 0;
let last = 0;
let resizeObserver = null;

const reducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

const resize = () => {
  const el = canvas.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = Math.max(1, Math.round(rect.width));
  height = Math.max(1, Math.round(rect.height));
  el.width = width * dpr;
  el.height = height * dpr;
  ctx = el.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `${CELL}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  const columns = Math.ceil(width / CELL);
  drops = Array.from({ length: columns }, () =>
    Math.floor((Math.random() * -height) / CELL),
  );
  if (reducedMotion) paintStill();
};

// One step: fade what is there, then draw the next character of each column.
const step = () => {
  if (!ctx) return;
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0, 0, 0, 0.09)";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < drops.length; i++) {
    const y = drops[i] * CELL;
    if (y >= 0) {
      // The leading character is pale, the trail behind it fades to green.
      ctx.fillStyle = "#d6ffdc";
      ctx.fillText(glyph(), i * CELL, y);
      if (y >= CELL) {
        ctx.fillStyle = "#00ff41";
        ctx.fillText(glyph(), i * CELL, y - CELL);
      }
    }
    drops[i] += 1;
    if (y > height && Math.random() > 0.96) {
      drops[i] = Math.floor(Math.random() * -12);
    }
  }
};

// Reduced motion: run the rain forward off-screen once and keep that frame.
const paintStill = () => {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const steps = Math.ceil(height / CELL) + 20;
  for (let i = 0; i < steps; i++) step();
};

const loop = (time) => {
  raf = requestAnimationFrame(loop);
  if (time - last < FRAME_MS) return;
  last = time;
  step();
};

const shouldRun = () =>
  props.running &&
  !reducedMotion &&
  typeof document !== "undefined" &&
  document.visibilityState !== "hidden";

const sync = () => {
  if (shouldRun()) {
    if (!raf) raf = requestAnimationFrame(loop);
  } else if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
};

watch(() => props.running, sync);

onMounted(() => {
  resize();
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.value);
  }
  document.addEventListener("visibilitychange", sync);
  sync();
});

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  resizeObserver?.disconnect();
  document.removeEventListener("visibilitychange", sync);
});
</script>

<template>
  <canvas ref="canvas" class="ogis-matrix-rain" aria-hidden="true"></canvas>
</template>
