import { onBeforeUnmount, watch } from "vue";

// How far (as a share of the panel width) a swipe must travel to close it,
// and the flick speed (px per ms) that closes it regardless of distance.
const CLOSE_FRACTION = 0.3;
const FLICK_SPEED = 0.5;
// Movement before the gesture is decided as a horizontal swipe or a scroll.
const SLOP = 10;

// Controls where a sideways drag means something else (sliders, text fields).
const IGNORE = "input, textarea, select, [contenteditable], [data-no-swipe]";

/**
 * Let a touch swipe toward the panel's closed side (left) drag it closed.
 *
 * The panel follows the finger while dragging; on release it either closes
 * (far or fast enough) or springs back. Vertical drags are left alone so the
 * panel content keeps scrolling normally.
 *
 * @param {import('vue').Ref<HTMLElement|null>} elRef  the panel element
 * @param {{ isOpen: import('vue').Ref<boolean>, close: () => void }} options
 */
export function useSwipeToClose(elRef, { isOpen, close }) {
  let start = null; // { x, y, t }
  let dragging = false;
  let dx = 0;

  const setOffset = (el, px) => {
    if (px === null) {
      el.style.transform = "";
      el.style.transition = "";
    } else {
      el.style.transition = "none";
      el.style.transform = `translateX(${px}px)`;
    }
  };

  const onStart = (e) => {
    if (!isOpen.value || e.touches.length !== 1) return;
    if (e.target.closest?.(IGNORE)) return;
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, t: performance.now() };
    dragging = false;
    dx = 0;
  };

  const onMove = (e) => {
    if (!start) return;
    const t = e.touches[0];
    const mx = t.clientX - start.x;
    const my = t.clientY - start.y;
    if (!dragging) {
      if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return;
      // A mostly vertical move is a scroll: stop tracking this touch.
      if (Math.abs(my) >= Math.abs(mx) || mx > 0) {
        start = null;
        return;
      }
      dragging = true;
    }
    dx = Math.min(0, mx);
    if (e.cancelable) e.preventDefault();
    setOffset(elRef.value, dx);
  };

  const onEnd = () => {
    if (!start) return;
    const el = elRef.value;
    const elapsed = Math.max(1, performance.now() - start.t);
    const wasDragging = dragging;
    start = null;
    dragging = false;
    if (!wasDragging || !el) return;

    const shouldClose =
      -dx > el.offsetWidth * CLOSE_FRACTION || -dx / elapsed > FLICK_SPEED;
    // Hand the position back to the stylesheet: the panel then animates from
    // where the finger left it, either closed or back open.
    setOffset(el, null);
    if (shouldClose) close();
  };

  const events = [
    ["touchstart", onStart, { passive: true }],
    ["touchmove", onMove, { passive: false }],
    ["touchend", onEnd, { passive: true }],
    ["touchcancel", onEnd, { passive: true }],
  ];

  watch(
    elRef,
    (el, prev) => {
      for (const [name, fn] of events) prev?.removeEventListener(name, fn);
      for (const [name, fn, opts] of events)
        el?.addEventListener(name, fn, opts);
    },
    { immediate: true, flush: "post" },
  );

  onBeforeUnmount(() => {
    for (const [name, fn] of events) elRef.value?.removeEventListener(name, fn);
  });
}
