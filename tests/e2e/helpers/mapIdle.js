import { expect } from "@playwright/test";

/**
 * Wait for the app's `data-map-idle` settle signal, attaching triage evidence
 * when the wait times out.
 *
 * The signal is predicate-driven: the app publishes `data-map-idle="true"` once
 * `!map.isMoving() && map.areTilesLoaded()` holds. A stalled live raster or
 * TileJSON request keeps that predicate false, and MapLibre has no per-request
 * timeout — so a flaky origin shows up as a bare "attribute did not become
 * true" failure with nothing pointing at the culprit.
 * `waitForMapIdle` wraps the assertion and, on failure, attaches the in-flight
 * and failed requests to the test report before rethrowing the original error.
 *
 * Usage: `await waitForMapIdle(page, testInfo)`. The pending-request tracker
 * must be installed before navigation, which the `page` fixture in
 * `helpers/test.js` guarantees.
 */

/** Pending-request state per page. A WeakMap keeps listeners unreachable once a page is gone. */
const trackers = new WeakMap();

/**
 * Install once per page: record each in-flight request and clear it when it
 * finishes or fails. Playwright emits the same Request object across a request's
 * lifecycle, so a Map keyed by that object pairs request/response reliably.
 */
export const trackPendingRequests = (page) => {
  if (trackers.has(page)) return;
  const pending = new Map();
  trackers.set(page, pending);

  page.on("request", (request) => {
    pending.set(request, {
      url: request.url(),
      resourceType: request.resourceType(),
      startedAt: Date.now(),
    });
  });
  const clear = (request) => pending.delete(request);
  page.on("requestfinished", clear);
  page.on("requestfailed", clear);
};

/** Cap the diagnostics so a pathological run cannot attach an unbounded blob. */
const MAX_PENDING = 30;
const MAX_FAILED = 15;

/**
 * Gather triage evidence for a map-idle timeout. Best-effort: any probe that
 * throws is skipped, never propagated.
 */
const collectDiagnostics = async (page) => {
  const lines = ["map-idle timeout diagnostics", ""];

  // Page state.
  let url = "(unavailable)";
  let online = "(unavailable)";
  let ready = "(unavailable)";
  let idle = "(unavailable)";
  try {
    url = page.url();
  } catch {
    // Page may already be closed; keep the placeholder.
  }
  try {
    const snapshot = await page.evaluate(() => {
      const map = document.querySelector(".ogis-map");
      return {
        online: navigator.onLine,
        ready: map ? (map.dataset.mapReady ?? "(unset)") : "(no .ogis-map)",
        idle: map ? (map.dataset.mapIdle ?? "(unset)") : "(no .ogis-map)",
      };
    });
    online = String(snapshot.online);
    ready = snapshot.ready;
    idle = snapshot.idle;
  } catch {
    // Evaluation can fail if the page navigated away mid-timeout.
  }
  lines.push("page state");
  lines.push(`  url: ${url}`);
  lines.push(`  navigator.onLine: ${online}`);
  lines.push(`  .ogis-map: data-map-ready="${ready}" data-map-idle="${idle}"`);
  lines.push("");

  // Primary signal: requests Playwright has seen started but not yet finished.
  lines.push("pending requests (tracker)");
  const pending = trackers.get(page);
  if (!pending) {
    lines.push(
      "  no tracker registered for this page — install trackPendingRequests before navigation",
    );
  } else if (pending.size === 0) {
    lines.push("  none — all tracked requests have finished");
  } else {
    const entries = [...pending.values()];
    for (const entry of entries.slice(0, MAX_PENDING)) {
      const elapsed = Date.now() - entry.startedAt;
      lines.push(`  [${elapsed} ms] ${entry.resourceType} ${entry.url}`);
    }
    if (entries.length > MAX_PENDING) {
      lines.push(`  …and ${entries.length - MAX_PENDING} more`);
    }
  }
  lines.push("");

  // Secondary signal: resource-timing entries that never completed. Note that a
  // stalled in-flight fetch may not appear here at all (resource timing only
  // records a completed responseEnd), which is why the tracker above is primary.
  lines.push("failed/aborted resources (performance resource timing)");
  try {
    const failed = await page.evaluate((max) => {
      const all = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.responseEnd === 0 && entry.startTime > 0);
      return {
        total: all.length,
        entries: all.slice(0, max).map((e) => e.name),
      };
    }, MAX_FAILED);
    if (failed.total === 0) {
      lines.push("  none");
    } else {
      for (const name of failed.entries) {
        lines.push(`  ${name}`);
      }
      if (failed.total > failed.entries.length) {
        lines.push(`  …and ${failed.total - failed.entries.length} more`);
      }
    }
  } catch {
    lines.push("  (unavailable — page may have navigated away)");
  }

  return lines.join("\n");
};

/**
 * Wait until no glyph-range request is in flight.
 *
 * MapLibre fetches glyph ranges from its worker after the tile that needs them.
 * A symbol placement that runs before the glyph arrives skips the label; when
 * the glyph lands MapLibre reloads the affected tiles and re-places (see
 * `Style._updateTilesForChangedGlyphs`), but that reload races the capture and
 * produced the run-to-run route/label diffs on the phone viewports. Waiting for
 * the glyph fetches to quiesce first makes the follow-up placement
 * deterministic. Glyph URLs are the only `/fonts/` request the map makes; the
 * pending-request tracker is installed per page before navigation
 * (`helpers/test.js`).
 */
export const waitForGlyphsLoaded = async (page, { timeout = 30000 } = {}) => {
  const startedAt = Date.now();
  for (;;) {
    const pending = trackers.get(page);
    const inFlight = pending
      ? [...pending.values()].some((entry) => entry.url.includes("/fonts/"))
      : false;
    if (!inFlight || Date.now() - startedAt > timeout) return;
    await page.waitForTimeout(100);
  }
};

/**
 * Wait for a sustained gap in glyph fetches.
 *
 * `waitForGlyphsLoaded` returns the moment no glyph request is in flight, but a
 * late tile parse can still discover a missing range a moment later. A
 * placement that runs before that glyph lands skips the affected symbols, and
 * the follow-up re-placement is not guaranteed a render — so hold until no
 * glyph fetch has started for `quietMs` before the final render.
 */
export const waitForGlyphsQuiesce = async (
  page,
  { quietMs = 500, timeout = 30000 } = {},
) => {
  const startedAt = Date.now();
  let quietSince = null;
  for (;;) {
    const pending = trackers.get(page);
    const inFlight = pending
      ? [...pending.values()].some((entry) => entry.url.includes("/fonts/"))
      : false;
    if (inFlight) {
      quietSince = null;
    } else if (quietSince === null) {
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= quietMs) {
      return;
    }
    if (Date.now() - startedAt > timeout) return;
    await page.waitForTimeout(50);
  }
};

/**
 * Let the map run to a true paint settle after `data-map-idle`.
 *
 * `data-map-idle` is published by MapLibre only when placement is complete and
 * symbol fades have finished (`Map._render` schedules another frame while
 * `_placementDirty`/`_sourcesDirty`/`_styleDirty` hold and fires `idle` only
 * when none do). A stale frame can nevertheless reach the compositor: the map
 * canvas is presented asynchronously, and a screenshot taken in the gap records
 * the previous frame — for the record-active state, the previous frame is the
 * one where a late symbol re-placement had not yet committed, so labels are
 * missing. `waitForMapQuiet` waits for the renderer's own state to hold still,
 * drives a sustained render window so any late placement finishes its fade, and
 * then presents one more composited frame; `capture()`'s render-then-compare loop is
 * the final confirmation.
 */
export const waitForMapPainted = async (page) => {
  await page.waitForTimeout(500);
  await waitForMapQuiet(page);
  // A late tile parse can still discover a missing glyph range after the quiet
  // window: the symbols it needs are skipped by the current placement, and the
  // follow-up re-placement is not guaranteed a render. Hold for a sustained
  // glyph-fetch gap, then commit any late re-placement with one more burst.
  await waitForGlyphsQuiesce(page);
  await renderBurst(page, 300);
};

/**
 * Resolve (and cache) the running map handle from the page's own module graph.
 *
 * The settle helpers share `window.__ogisMap`; this makes the lookup idempotent
 * for callers that need the map before `waitForMapQuiet` has run.
 */
export const ensureMapHandle = async (page) => {
  await page
    .evaluate(async () => {
      if (window.__ogisMap) return;
      const mod = await import("/src/composables/useMap.js");
      window.__ogisMap = mod.getMapInstance("app");
    })
    .catch(() => {});
};

/**
 * Drive MapLibre renders for a fixed window (`triggerRepaint` each frame).
 *
 * A placement that lands after the last natural render does not necessarily
 * schedule another frame — `Style._updatePlacement` reports no change once a
 * committed placement has no transitions left — and a screenshot never triggers
 * a MapLibre render, so the canvas can keep the previous placement. Rendering
 * for a window commits any pending placement and presents the completed frame.
 */
export const renderBurst = async (page, ms = 300) => {
  await ensureMapHandle(page);
  await page
    .evaluate(
      (burstMs) =>
        new Promise((resolve) => {
          const map = window.__ogisMap;
          if (!map) return resolve();
          const startedAt = performance.now();
          const tick = () => {
            map.triggerRepaint();
            if (performance.now() - startedAt < burstMs) {
              requestAnimationFrame(tick);
            } else {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              );
            }
          };
          requestAnimationFrame(tick);
        }),
      ms,
    )
    .catch(() => {});
};

/**
 * Wait until MapLibre has *committed* the current symbol placement *and*
 * finished its fade, not merely emitted an `idle`.
 *
 * A glyph-triggered tile reload can re-start placement after the app's
 * `data-map-idle` signal; because `PauseablePlacement` splits a large placement
 * across frames, under SwiftShader the run can span dozens of slow frames. The
 * byte-identical `capture()` loop then races: two screenshots taken 100 ms apart
 * can land on the same slow frame and look "stable" while placement is still
 * mid-flight, committing a frame whose labels are not yet drawn.
 *
 * This waits for the map's own composite state to hold still — placement and
 * style/source updates idle, no pending layer/source work, for a sustained
 * window — then drives the renderer for a fixed window so any placement that
 * committed along the way completes its fade, then waits for quiet once more
 * and presents a final composited frame. It reads MapLibre internals (there is
 * no public "placement committed" event) but that is the exact state the
 * renderer uses to decide whether another frame is required (`Map._render`
 * schedules a repaint while `_placementDirty`/`_sourcesDirty`/`_styleDirty`
 * hold, and only fires `idle` when none do). Best-effort: a timeout leaves the
 * existing waits in charge.
 */
export const waitForMapQuiet = async (page, { timeout = 30000 } = {}) => {
  await ensureMapHandle(page);

  const waitForQuiet = (requiredMs, waitTimeout) =>
    page
      .waitForFunction(
        (ms) => {
          const map = window.__ogisMap;
          const style = map && map.style;
          if (!style) return false;
          const clean =
            !map.isMoving() &&
            map.loaded() &&
            !style._placementDirty &&
            !style._changed &&
            !map._sourcesDirty &&
            !map._styleDirty &&
            Object.keys(style._updatedSources ?? {}).length === 0 &&
            Object.keys(style._updatedLayers ?? {}).length === 0;
          if (!clean) {
            window.__ogisQuietSince = 0;
            return false;
          }
          if (!window.__ogisQuietSince) {
            window.__ogisQuietSince = performance.now();
            return false;
          }
          return performance.now() - window.__ogisQuietSince >= ms;
        },
        requiredMs,
        { timeout: waitTimeout, polling: 100 },
      )
      .catch(() => {});

  await waitForQuiet(600, timeout);

  // Drive the renderer for a sustained window. Symbol fades are time-based
  // (`symbolFadeChange(t) = (t - commitTime) / fadeDuration`) and the shader
  // culls symbols below 0.1 opacity, so a placement that commits after the
  // quiet window leaves the compositor holding a mid-fade frame whose labels
  // are invisible — and a screenshot never triggers the render that would
  // finish it. Rendering for longer than a full fade lets any late placement
  // commit and fade in.
  await renderBurst(page, 800);

  // The burst can kick loose a follow-up placement; require a shorter clean
  // window again before presenting the final frame.
  await waitForQuiet(300, 10000);

  // Force one more full render and hold for a presented frame. The WebGL canvas
  // is presented asynchronously, so a screenshot taken in the gap after the
  // final render can read the previous surface; and DOM layers composited
  // during that gap (the corner chips) can rasterise at a different sub-pixel
  // phase. Triggering a repaint and waiting a presented frame makes both the
  // canvas and the composited DOM deterministic.
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const map = window.__ogisMap;
          if (!map) return resolve();
          let done = false;
          const settle = () => {
            if (done) return;
            done = true;
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          };
          map.once("render", settle);
          map.triggerRepaint();
          setTimeout(settle, 2000);
        }),
    )
    .catch(() => {});
};

/**
 * Assert the map has settled, or attach diagnostics and rethrow. The whole
 * diagnostics/attach path is guarded so it can never mask the original failure.
 */
export const waitForMapIdle = async (
  page,
  testInfo,
  { timeout = 60000 } = {},
) => {
  try {
    await expect(page.locator(".ogis-map")).toHaveAttribute(
      "data-map-idle",
      "true",
      { timeout },
    );
  } catch (error) {
    try {
      const body = await collectDiagnostics(page);
      await testInfo.attach("map-idle-diagnostics", {
        body,
        contentType: "text/plain",
      });
      error.message += " (map-idle diagnostics attached)";
    } catch {
      // Diagnostics are best-effort: never mask the original failure.
    }
    throw error;
  }
};
