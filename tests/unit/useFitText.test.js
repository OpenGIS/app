import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { useFitText } from "@/composables/useFitText";

// The composable's fallback levers, matching the chip CSS.
const FALLBACK = { min: 8, max: 11, target: 0.62, width: 72 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

let chip = null;

/**
 * Mount a minimal chip: a button wrapping a single label span, wired to
 * useFitText exactly like the real call sites (getter text, enabled gate).
 *
 * happy-dom reports no layout, so offsetWidth is stubbed on both elements:
 *  - button — a fixed pixel width (default 72, the composable's fallback);
 *  - label — text length × the inline font-size (1px advance per character),
 *    so setting a font-size then measuring reproduces browser behaviour.
 *
 * getComputedStyle is stubbed from `styles` (a property → value map); omitted
 * properties read back as "", so the composable's fallbacks apply.
 */
function mountChip({
  text = "Hi",
  enabled = true,
  buttonWidth = 72,
  styles = {},
} = {}) {
  const buttonRef = ref(null);
  const labelRef = ref(null);
  const textRef = ref(text);
  const state = { enabled, buttonWidth };
  let fit;

  const app = createApp({
    setup() {
      ({ fit } = useFitText(buttonRef, labelRef, () => textRef.value, {
        enabled: () => state.enabled,
      }));
      return () =>
        h("button", { ref: buttonRef }, [
          h("span", { ref: labelRef }, textRef.value),
        ]);
    },
  });

  const root = document.createElement("div");
  document.body.appendChild(root);
  app.mount(root);

  const button = buttonRef.value;
  const label = labelRef.value;
  let mounted = true;

  Object.defineProperty(button, "offsetWidth", {
    configurable: true,
    get: () => state.buttonWidth,
  });
  Object.defineProperty(label, "offsetWidth", {
    configurable: true,
    get: () => {
      const size = parseFloat(label.style.fontSize) || 0;
      return String(textRef.value).length * size;
    },
  });

  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (prop) => styles[prop] ?? "",
  }));

  return {
    button,
    label,
    textRef,
    state,
    fit: () => fit(),
    unmount: () => {
      if (mounted) {
        mounted = false;
        app.unmount();
        root.remove();
      }
    },
  };
}

const fontSize = (label) => parseFloat(label.style.fontSize);

afterEach(() => {
  chip?.unmount();
  chip = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useFitText", () => {
  it("clamps short labels to the maximum font size", () => {
    chip = mountChip({ text: "Hi" });

    chip.fit();

    // Measured at max: 2 × 11 = 22px, below the 72 × 0.62 = 44.64px target.
    expect(fontSize(chip.label)).toBe(FALLBACK.max);
  });

  it("scales long labels towards the target fraction of the button width", () => {
    chip = mountChip({ text: "Hello" });

    chip.fit();

    // Measured at max: 5 × 11 = 55px; scale = 44.64 / 55 → 8.928px.
    const expected =
      FALLBACK.max * ((FALLBACK.width * FALLBACK.target) / (5 * FALLBACK.max));
    expect(fontSize(chip.label)).toBeCloseTo(expected, 2);
    expect(fontSize(chip.label)).toBeGreaterThan(FALLBACK.min);
    expect(fontSize(chip.label)).toBeLessThan(FALLBACK.max);

    // The rendered label now aims at the target width.
    expect(chip.label.offsetWidth).toBeCloseTo(
      FALLBACK.width * FALLBACK.target,
      1,
    );
  });

  it("floors very long labels at the minimum font size", () => {
    chip = mountChip({ text: "x".repeat(30) });

    chip.fit();

    // Measured at max: 30 × 11 = 330px → 1.49px, below the 8px floor.
    expect(fontSize(chip.label)).toBe(FALLBACK.min);
  });

  it("does not touch the label while disabled", () => {
    chip = mountChip({ text: "Hi", enabled: false });

    chip.fit();
    expect(chip.label.style.fontSize).toBe("");

    // The same fit mutates once the enabled getter flips.
    chip.state.enabled = true;
    chip.fit();
    expect(fontSize(chip.label)).toBe(FALLBACK.max);
  });

  it("re-fits when the label text changes", async () => {
    chip = mountChip({ text: "Hi" });
    chip.fit();
    expect(fontSize(chip.label)).toBe(FALLBACK.max);

    chip.textRef.value = "x".repeat(30);
    await nextTick();

    expect(fontSize(chip.label)).toBe(FALLBACK.min);
  });

  it("falls back to DEFAULTS when the custom properties are unavailable", () => {
    // Width 0 forces the fallback button width; empty styles force the
    // fallback min/max/target — the DEFAULTS outcome: 55px measured at max,
    // 44.64px target → 8.928px.
    chip = mountChip({ text: "Hello", buttonWidth: 0 });

    chip.fit();

    const expected =
      FALLBACK.max * ((FALLBACK.width * FALLBACK.target) / (5 * FALLBACK.max));
    expect(fontSize(chip.label)).toBeCloseTo(expected, 2);
    expect(fontSize(chip.label)).toBeGreaterThan(FALLBACK.min);
    expect(fontSize(chip.label)).toBeLessThan(FALLBACK.max);
  });

  it("reads the chip levers from inherited CSS custom properties", () => {
    chip = mountChip({
      text: "Hello",
      buttonWidth: 100,
      styles: {
        "--ogis-chip-label-min": "6px",
        "--ogis-chip-label-max": "20px",
        "--ogis-chip-label-target": "50%",
      },
    });

    chip.fit();

    // Measured at 20px: 5 × 20 = 100px; target 100 × 0.5 = 50px;
    // scale 0.5 → 10px, inside the [6, 20] clamp.
    expect(chip.label.style.fontSize).toBe("10px");
  });

  it("re-fits on button resize and disconnects the observer on unmount", () => {
    const observers = [];

    class FakeResizeObserver {
      constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        observers.push(this);
      }
    }

    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    chip = mountChip({ text: "ABCDEFGHI", buttonWidth: 72 });
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(chip.button);

    // 9 chars at max 11 measure 99px; on a 144px button the target is
    // 89.28px, so the fitted size is 11 × (89.28 / 99) = 9.92px.
    chip.state.buttonWidth = 144;
    observers[0].callback();

    expect(fontSize(chip.label)).toBeCloseTo(9.92, 2);

    chip.unmount();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
