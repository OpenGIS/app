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
 *
 * Poll with an interval rather than the default `raf`: under a full 4-worker
 * run Chromium throttles `requestAnimationFrame` in a backgrounded page, so a
 * `raf` poller can stop re-evaluating while a transition finishes — the
 * predicate is then satisfiable but never re-checked, and the wait times out
 * with the page already settled (`waitForMapQuiet` uses interval polling for
 * the same reason).
 *
 * On timeout the offending animations are dumped in the thrown error. An
 * infinite-iteration or paused animation never reaches `"finished"`, so without
 * this evidence the failure is a bare "waitForFunction timed out" with nothing
 * naming what is stuck. The 300 s ceiling (raised from 30 s) covers the
 * single-threaded SwiftShader capture pin, where the heavyweight record-active
 * reload can leave the main thread busy on one long synchronous render for over
 * a minute; the interval poll is only re-evaluated once that render yields.
 */
export const waitForAnimationsSettled = async (page) => {
  try {
    await page.waitForFunction(
      () => {
        const root = document.querySelector(".ogis-root");
        if (!root) return false;
        return !root
          .getAnimations({ subtree: true })
          .some((animation) => animation.playState !== "finished");
      },
      null,
      { timeout: 300000, polling: 100 },
    );
  } catch (error) {
    const details = await page
      .evaluate(() => {
        const root = document.querySelector(".ogis-root");
        if (!root) return { root: false, animations: [] };
        const selectorOf = (target) => {
          if (!target) return null;
          const tag = target.tagName ? target.tagName.toLowerCase() : "?";
          const id = target.id ? `#${target.id}` : "";
          const classes =
            target.classList && target.classList.length
              ? `.${[...target.classList].join(".")}`
              : "";
          return `${tag}${id}${classes}`;
        };
        const animations = root
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState !== "finished")
          .map((animation) => {
            const effect = animation.effect;
            const timing = effect?.getComputedTiming?.() ?? null;
            const keyframes =
              effect?.getKeyframes?.().map((frame) => frame.composite) ?? null;
            return {
              selector: selectorOf(effect?.target),
              transitionProperty: animation.transitionProperty ?? null,
              animationName: animation.animationName ?? null,
              playState: animation.playState,
              currentTime: animation.currentTime,
              iterations: timing?.iterations ?? null,
              duration: timing?.duration ?? null,
              delay: timing?.delay ?? null,
              endTime: timing?.endTime ?? null,
              fill: timing?.fill ?? null,
              progress: timing?.progress ?? null,
              keyframeCount: keyframes ? keyframes.length : null,
            };
          });
        return { root: true, animations };
      })
      .catch((evaluateError) => ({
        root: null,
        animations: null,
        evaluateError: String(evaluateError),
      }));
    error.message = `waitForAnimationsSettled timed out after 300000ms. Stuck animations: ${JSON.stringify(
      details,
    )}`;
    throw error;
  }
};

/**
 * Wait until MapLibre's canvas drawing buffer matches its container.
 *
 * MapLibre resizes its canvas through its own ResizeObserver, one render behind
 * the CSS transition that moves `.ogis-map` (a 0.3 s `left`/`width` change).
 * A fixed timeout therefore sometimes captures a mid-transition frame (a
 * ~340 px horizontal shift). A ResizeObserver on both the container and the
 * canvas resolves exactly when the canvas' content-box matches the container's,
 * then holds one animation frame for the resize render to land. Observing the
 * canvas as well as the container matters: once the container reaches its final
 * width its own observer stops firing, so a still-lagging canvas would otherwise
 * only be caught by the next container resize. The timeout is the ceiling the
 * old three-rAF hold lacked — under rAF starvation that hold could hang to the
 * 15-minute file timeout.
 */
export const waitForCanvasResize = (page, { timeout = 30000 } = {}) =>
  page.evaluate(
    (waitTimeout) =>
      new Promise((resolve) => {
        const container = document.querySelector(".ogis-map");
        const canvas = container?.querySelector(".maplibregl-canvas");
        if (!container || !canvas) return resolve();

        let settled = false;
        let timer = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          clearTimeout(timer);
          resolve();
        };
        const matches = () =>
          canvas.clientWidth === container.clientWidth &&
          canvas.clientHeight === container.clientHeight;
        const check = () => {
          if (settled || !matches()) return;
          // Match confirmed: stop watching, then present one frame so the
          // resize render lands. The timer still covers a starved rAF.
          observer.disconnect();
          requestAnimationFrame(finish);
        };
        const observer = new ResizeObserver(check);
        observer.observe(container);
        observer.observe(canvas);
        timer = setTimeout(finish, waitTimeout);
        check();
      }),
    timeout,
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
  await waitForMapPainted(page, testInfo);
};

/**
 * Pin the terrain depth framebuffer to "no occlusion" for one capture.
 *
 * MapLibre multiplies every symbol's alpha by `calculate_visibility()`, which
 * samples the terrain depth framebuffer (see the `TERRAIN3D` branch of the
 * symbol vertex shaders). That framebuffer is redrawn only when the camera
 * matrix changes or the renderable tile set changes — not when a raster-dem
 * tile's *data* finishes loading (`TerrainTileManager.anyTilesAfterTime`
 * compares a `now()` timestamp against the painter's `Date.now()`, so it never
 * fires). A symbol that sits on the terrain surface can therefore be sampled
 * once as "in front" and once, after an unrelated camera change, as "slightly
 * behind" — a sub-pixel alpha difference (observed on the demo's food POI in
 * `feature-offline`, and on phone/landscape labels). Clearing the depth buffer
 * to the far plane and freezing the depth pass makes the factor exactly 1 for
 * every symbol, matching the committed capture. Applied per-capture (a page
 * reload builds a fresh painter, so the freeze does not survive it).
 *
 * Best-effort: a missing map/terrain leaves the capture untouched.
 */
export const pinTerrainDepthFar = (page) =>
  page.evaluate(async () => {
    const mod = await import("/src/composables/useMap.js");
    const map = mod.getMapInstance("app");
    const terrain = map?.terrain;
    const painter = map?.painter;
    if (!terrain || !painter) return false;
    const fbo = terrain.getFramebuffer("depth");
    const gl = painter.context.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!painter.__depthFrozen) {
      painter.maybeDrawDepth = () => {};
      painter.__depthFrozen = true;
    }
    map.triggerRepaint();
    return true;
  });

/**
 * Force the ScaleControl to recompute its inline width from the settled
 * container and camera.
 *
 * `ScaleControl` computes its inline width only when the map fires a `move`
 * event (or on `onAdd`/`setUnit`); `updateScale()` derives it from
 * `map._container.clientWidth/clientHeight`, the camera transform and the globe
 * projection at that instant. A container resize (panel open/close) does not
 * fire `move`, so the width can stay pinned to a container size from before the
 * resize — or from a transient width sampled mid-transition — and the value
 * then varies run to run for an otherwise identical final state. The public
 * `setUnit()` (there is no public `refresh()`) forces a fresh `updateScale()`
 * at the current container and camera, making the rendered bar reproducible.
 *
 * `map.unproject()` ray-casts against the terrain when a terrain source is
 * active, so the bar's width also inherits the route-fit DEM tile load state —
 * a ~0.2 % run-to-run variance. Detaching `map.terrain` for the synchronous
 * `setUnit()` call (restored immediately, before any render) makes the
 * recompute a pure function of the settled camera and container.
 *
 * Reached via the map's own control list; best-effort if the control is absent.
 */
export const refreshScaleControl = (page) =>
  page.evaluate(async () => {
    const mod = await import("/src/composables/useMap.js");
    const map = mod.getMapInstance("app");
    const el = document.querySelector(".maplibregl-ctrl-scale");
    const control = (map?._controls ?? []).find((c) => c?._container === el);
    if (!control || typeof control.setUnit !== "function") return false;
    const terrain = map.terrain;
    try {
      map.terrain = null;
      control.setUnit(control.options?.unit ?? "metric");
    } finally {
      map.terrain = terrain;
    }
    return true;
  });

/**
 * Normalise the capture state immediately before a screenshot: the caller's
 * settle plus the two capture-time pins (terrain depth and scale width). Call
 * this — rather than `waitForLayoutSettled` alone — before every `capture()`,
 * so every committed PNG is generated from the same normalised state.
 */
export const normaliseCaptureState = async (page, testInfo) => {
  await waitForLayoutSettled(page, testInfo);
  // Refresh the scale *before* the terrain-depth pin: the pin clears the
  // terrain depth framebuffer and freezes the depth pass, which leaves the
  // terrain ray-cast used by `map.unproject()` (and therefore by
  // `ScaleControl.updateScale()`) in an inconsistent state until the next
  // render. Reading the scale first keeps its inputs valid.
  await refreshScaleControl(page);
  await pinTerrainDepthFar(page);
};
