import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { useSwipeToClose } from "@/composables/useSwipeToClose";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let current = null;

/**
 * Mount a 300px-wide panel wired to useSwipeToClose, with an input inside it.
 * happy-dom has no layout, so offsetWidth is stubbed.
 */
async function mountPanel({ open = true } = {}) {
  const panelRef = ref(null);
  const isOpen = ref(open);
  const close = vi.fn(() => (isOpen.value = false));

  const app = createApp({
    setup() {
      useSwipeToClose(panelRef, { isOpen, close });
      return () => h("div", { ref: panelRef }, [h("input")]);
    },
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  app.mount(root);
  await nextTick();

  const panel = panelRef.value;
  Object.defineProperty(panel, "offsetWidth", { get: () => 300 });

  current = {
    panel,
    input: panel.querySelector("input"),
    isOpen,
    close,
    unmount: () => {
      app.unmount();
      root.remove();
    },
  };
  return current;
}

const touch = (target, type, x = 0, y = 0) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y };
  event.touches = type === "touchend" || type === "touchcancel" ? [] : [point];
  target.dispatchEvent(event);
  return event;
};

// A fake clock for the swipe speed: each swipe starts at 0 ms.
let now = 0;

/**
 * Drag from (startX, y) through each x in `xs`, then lift the finger `ms`
 * after the first touch.
 */
const swipe = (target, startX, xs, { ys, ms = 1000 } = {}) => {
  now = 0;
  touch(target, "touchstart", startX, 100);
  xs.forEach((x, i) => touch(target, "touchmove", x, ys?.[i] ?? 100));
  now = ms;
  touch(target, "touchend");
};

beforeEach(() => {
  vi.stubGlobal("performance", { now: () => now });
});

afterEach(() => {
  current?.unmount();
  current = null;
  vi.unstubAllGlobals();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useSwipeToClose", () => {
  it("follows the finger while dragging left", async () => {
    const { panel } = await mountPanel();
    touch(panel, "touchstart", 250, 100);
    const move = touch(panel, "touchmove", 200, 100);

    expect(panel.style.transform).toBe("translateX(-50px)");
    expect(panel.style.transition).toBe("none");
    expect(move.defaultPrevented).toBe(true);
  });

  it("closes after a long enough swipe and hands motion back to CSS", async () => {
    const { panel, close } = await mountPanel();
    swipe(panel, 280, [260, 150]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(panel.style.transform).toBe("");
    expect(panel.style.transition).toBe("");
  });

  it("springs back after a short, slow swipe", async () => {
    const { panel, close } = await mountPanel();
    swipe(panel, 280, [265, 240]);

    expect(close).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  it("closes after a short but fast flick", async () => {
    const { panel, close } = await mountPanel();
    swipe(panel, 280, [265, 240], { ms: 50 });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("leaves vertical scrolling alone", async () => {
    const { panel, close } = await mountPanel();
    swipe(panel, 200, [195, 120], { ys: [130, 300] });

    expect(close).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  it("ignores rightward drags", async () => {
    const { panel, close } = await mountPanel();
    swipe(panel, 100, [130, 250]);

    expect(close).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  it("ignores touches that start on a form field", async () => {
    const { input, panel, close } = await mountPanel();
    swipe(input, 280, [260, 100]);

    expect(close).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  it("does nothing while the panel is closed", async () => {
    const { panel, close } = await mountPanel({ open: false });
    swipe(panel, 280, [260, 100]);

    expect(close).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });
});
