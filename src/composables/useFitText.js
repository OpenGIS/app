import { onBeforeUnmount, onMounted, watch } from "vue";

// Fallbacks used when the chip's custom properties are unavailable
// (e.g. a non-browser test environment). The CSS on `.icon-btn--chip`
// is the source of truth in the app.
const DEFAULTS = { min: 8, max: 11, target: 0.62, width: 72 };

const readPx = (styles, prop, fallback) => {
  const value = parseFloat(styles.getPropertyValue(prop));
  return Number.isFinite(value) ? value : fallback;
};

const readTarget = (styles, prop, fallback) => {
  const raw = styles.getPropertyValue(prop).trim();
  if (!raw) return fallback;
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith("%") ? value / 100 : value;
};

/**
 * Fit a single-line label to its button by scaling its font-size.
 *
 * The label is measured at the maximum size, then scaled so the rendered
 * width aims at `target` × button width, clamped between `min` and `max`.
 * Levers are read from CSS custom properties on the button (inherited by
 * the label) so they can be tuned in one place. Only the label's inline
 * font-size is touched — its text content and DOM stay untouched.
 *
 * Re-fits when the label text changes and whenever the button resizes.
 * The ResizeObserver is disconnected on unmount.
 *
 * @param {import("vue").Ref<HTMLElement|null>} buttonRef
 * @param {import("vue").Ref<HTMLElement|null>} labelRef
 * @param {import("vue").Ref<string>|(() => string)} text
 * @param {{ min?: number, max?: number, target?: number, enabled?: () => boolean }} [options]
 */
export function useFitText(buttonRef, labelRef, text, options = {}) {
  const enabled = options.enabled ?? (() => true);
  let observer = null;

  const fit = () => {
    const label = labelRef.value;
    if (!label || !enabled() || typeof getComputedStyle !== "function") return;

    const styles = getComputedStyle(label);
    const min = readPx(
      styles,
      "--ogis-chip-label-min",
      options.min ?? DEFAULTS.min,
    );
    const max = readPx(
      styles,
      "--ogis-chip-label-max",
      options.max ?? DEFAULTS.max,
    );
    const target = readTarget(
      styles,
      "--ogis-chip-label-target",
      options.target ?? DEFAULTS.target,
    );

    const width = buttonRef.value?.offsetWidth || DEFAULTS.width;
    const targetWidth = width * target;

    // Measure at the maximum size, then scale to the target width.
    label.style.fontSize = `${max}px`;
    const measured = label.offsetWidth;
    const scale = measured > 0 ? targetWidth / measured : 1;
    const size = Math.min(max, Math.max(min, max * scale));
    label.style.fontSize = `${size}px`;
  };

  onMounted(() => {
    fit();
    if (typeof ResizeObserver !== "undefined" && buttonRef.value) {
      observer = new ResizeObserver(fit);
      observer.observe(buttonRef.value);
    }
  });

  onBeforeUnmount(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });

  watch(text, fit, { flush: "post" });

  return { fit };
}
