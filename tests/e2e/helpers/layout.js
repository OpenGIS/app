import {
  waitForMapIdle,
  waitForMapPainted,
  waitForGlyphsLoaded,
} from "./mapIdle.js";

/**
 * Deterministic layout settle for screenshot captures.
 *
 * Panel open/close toggles move `.ogis-map` via a 0.3 s `left`/`width` CSS
 * transition (desktop) and slide the offcanvas panel via a 0.25 s `transform`
 * transition. MapLibre resizes its canvas through a ResizeObserver, one render
 * behind layout. A fixed `waitForTimeout` therefore sometimes captures a
 * mid-transition frame (a ~340 px horizontal shift). These helpers replace the
 * timing guess with real signals.
 */

/**
 * Wait until every CSS transition/animation inside the app root has finished.
 * `getAnimations({ subtree: true })` is exact — it returns running and pending
 * transitions, so an empty (all-finished) set means the layout is at rest.
 */
export const waitForAnimationsSettled = (page) =>
  page.waitForFunction(
    () => {
      const root = document.querySelector(".ogis-root");
      if (!root) return false;
      return !root
        .getAnimations({ subtree: true })
        .some((animation) => animation.playState !== "finished");
    },
    null,
    { timeout: 30000 },
  );

/**
 * Wait until MapLibre's canvas drawing buffer matches its container and the
 * geometry is stable across three consecutive animation frames. Canvas and
 * container briefly agree on every intermediate ResizeObserver tick, so the
 * multi-frame hold after the CSS transition ends is what rules out a
 * mid-resize frame.
 */
export const waitForCanvasResize = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const container = document.querySelector(".ogis-map");
        const canvas = container?.querySelector(".maplibregl-canvas");
        if (!container || !canvas) return resolve();

        let stable = 0;
        let lastSignature = "";
        const tick = () => {
          const signature = [
            container.clientWidth,
            container.clientHeight,
            canvas.clientWidth,
            canvas.clientHeight,
          ].join("x");
          const matches =
            canvas.clientWidth === container.clientWidth &&
            canvas.clientHeight === container.clientHeight;
          if (matches && signature === lastSignature) stable++;
          else stable = 0;
          lastSignature = signature;
          if (stable >= 3) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

/**
 * Full deterministic settle after a panel toggle or map interaction: layout
 * transitions finished, canvas resized to match, the app's own map-idle signal
 * (which also covers drag inertia), then a real paint-settle window.
 *
 * The paint-settle window closes the gap `data-map-idle` leaves for a late
 * symbol placement — a label whose glyph arrives after placement ran pops in
 * afterwards, so a capture taken on the attribute alone records it absent.
 */
export const waitForLayoutSettled = async (page, testInfo) => {
  await waitForAnimationsSettled(page);
  await waitForCanvasResize(page);
  await waitForMapIdle(page, testInfo);
  // Tiles read as loaded before their glyph ranges do; wait for the fetches to
  // quiesce so the paint settle below re-places with every glyph cached.
  await waitForGlyphsLoaded(page);
  await waitForMapPainted(page);
};
