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

/**
 * Per-page request state. `pending` pairs each in-flight Request object with its
 * metadata until it finishes or fails; `assetStarts` counts every map-asset
 * request that has begun, so quiescence can detect a short-lived request that
 * started and finished between two polls (the pending map alone would miss it,
 * and the fixture middleware answers tiles/glyphs instantly). A WeakMap keeps
 * listeners unreachable once a page is gone.
 */
const trackers = new WeakMap();

/**
 * Pages whose E2E fixture environment has already been verified. The check is
 * cheap but runs on a call path used many times per test, so it is cached per
 * page.
 */
const fixturesVerified = new WeakSet();

/** Map-asset URLs: vector/raster tiles, glyph ranges and sprites. */
const MAP_ASSET_PATTERN = /__e2e_map__|\/fonts\/|\/sprite/;
const isMapAssetRequest = (url) => MAP_ASSET_PATTERN.test(url);

/**
 * Install once per page: record each in-flight request and clear it when it
 * finishes or fails. Playwright emits the same Request object across a request's
 * lifecycle, so a Map keyed by that object pairs request/response reliably.
 */
export const trackPendingRequests = (page) => {
  if (trackers.has(page)) return;
  const state = { pending: new Map(), assetStarts: 0 };
  trackers.set(page, state);

  page.on("request", (request) => {
    const url = request.url();
    state.pending.set(request, {
      url,
      resourceType: request.resourceType(),
      startedAt: Date.now(),
    });
    if (isMapAssetRequest(url)) state.assetStarts++;
  });
  const clear = (request) => state.pending.delete(request);
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
  const pending = trackers.get(page)?.pending;
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
 * Wait until no map-asset request (tile, glyph range or sprite) is in flight.
 *
 * MapLibre fetches glyph ranges from its worker after the tile that needs them,
 * and tiles/sprites load alongside. A symbol placement that runs before the
 * glyph arrives skips the label; when the glyph lands MapLibre reloads the
 * affected tiles and re-places (see `Style._updateTilesForChangedGlyphs`), but
 * that reload races the capture and produced the run-to-run route/label diffs
 * on the phone viewports. Waiting for the asset fetches to drain first makes the
 * follow-up placement deterministic. The pending-request tracker is installed
 * per page before navigation (`helpers/test.js`).
 */
export const waitForGlyphsLoaded = async (page, { timeout = 30000 } = {}) => {
  const startedAt = Date.now();
  for (;;) {
    const state = trackers.get(page);
    const inFlight = state
      ? [...state.pending.values()].some((entry) =>
          isMapAssetRequest(entry.url),
        )
      : false;
    if (!inFlight || Date.now() - startedAt > timeout) return;
    await page.waitForTimeout(100);
  }
};

/**
 * Wait for map-asset requests to reach quiescence.
 *
 * `waitForGlyphsLoaded` returns the moment no asset request is in flight, but a
 * late tile parse can still discover a missing range a moment later. A request
 * answered instantly by the same-origin fixture middleware can also start and
 * finish inside a single poll, so "nothing in flight" alone can miss it. Hold
 * until no asset request is in flight AND no new asset request has started
 * since the previous poll, for two consecutive polls — the tracker's
 * `assetStarts` counter catches the short-lived request the pending map does
 * not.
 */
export const waitForGlyphsQuiesce = async (
  page,
  { timeout = 30000, pollMs = 50 } = {},
) => {
  const startedAt = Date.now();
  let lastAssetStarts = trackers.get(page)?.assetStarts ?? 0;
  let cleanPolls = 0;
  for (;;) {
    const state = trackers.get(page);
    const inFlight = state
      ? [...state.pending.values()].some((entry) =>
          isMapAssetRequest(entry.url),
        )
      : false;
    const assetStarts = state?.assetStarts ?? 0;
    const noNewStarts = assetStarts === lastAssetStarts;
    lastAssetStarts = assetStarts;
    if (!inFlight && noNewStarts) {
      cleanPolls++;
      if (cleanPolls >= 2) return;
    } else {
      cleanPolls = 0;
    }
    if (Date.now() - startedAt > timeout) return;
    await page.waitForTimeout(pollMs);
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
 * missing. Compose the app's idle signal, the renderer-state quiet check (which
 * forces two renders and confirms the clean predicate after each), and one final
 * presented frame; `capture()`'s render-then-compare loop is the final
 * confirmation.
 */
export const waitForMapPainted = async (page, testInfo) => {
  await waitForMapIdle(page, testInfo);
  await waitForMapQuiet(page);
  await renderOnce(page);
  await presentFrames(page);
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
 * Fail fast when the running dev server was started without
 * `VITE_E2E_FIXTURES=1`.
 *
 * `playwright.config.js` sets `reuseExistingServer: !process.env.CI`, so a dev
 * server left running on the test port is silently reused. If that server was
 * started without `VITE_E2E_FIXTURES=1`, the fixture middleware is absent and
 * the app compiles without `fadeDuration: 0` — the style falls back to
 * MapLibre's 300 ms symbol fade, making every capture timing-dependent. The
 * map's resolved `_fadeDuration` is the cheapest direct signal of the flag: it
 * is 0 only when the server that compiled the bundle had it set. Verified once
 * per page.
 */
export const assertE2eFixturesActive = async (page) => {
  if (fixturesVerified.has(page)) return;
  await ensureMapHandle(page);
  const fadeDuration = await page
    .evaluate(() => window.__ogisMap?._fadeDuration ?? null)
    .catch(() => null);
  if (fadeDuration !== 0) {
    throw new Error(
      `E2E fixture environment is not active (map fadeDuration=${fadeDuration}, expected 0). ` +
        `A stale dev server started without VITE_E2E_FIXTURES=1 is probably being reused on the test port. ` +
        `Stop that dev server and re-run, or set CI=1 to disable reuseExistingServer.`,
    );
  }
  fixturesVerified.add(page);
};

/**
 * Force one synchronous MapLibre render and resolve once it has committed.
 *
 * A placement that lands after the last natural render does not necessarily
 * schedule another frame — `Style._updatePlacement` reports no change once a
 * committed placement has no transitions left — and a screenshot never triggers
 * a MapLibre render, so the canvas can keep the previous placement.
 * `map.redraw()` runs `Map._render` synchronously (aborting any scheduled
 * frame), committing any pending placement and firing `render` in the same
 * turn; the listener is registered first, and the timeout guards a style-less
 * map where `redraw()` is a no-op.
 */
export const renderOnce = async (page) => {
  await ensureMapHandle(page);
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const map = window.__ogisMap;
          if (!map) return resolve();
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          map.once("render", finish);
          map.redraw();
          setTimeout(finish, 2000);
        }),
    )
    .catch(() => {});
};

/**
 * Resolve after two animation frames — one for the renderer to produce the
 * frame, one for the compositor to present it. A screenshot never triggers a
 * render, so presenting explicitly keeps the composited surface in step with
 * the DOM before a capture reads it.
 *
 * The 2 s timer is an escape hatch, not the success path: success still
 * resolves on the second frame. It bounds a starved main thread (Chromium
 * throttles rAF in backgrounded pages) so this hold cannot ride the 15-minute
 * per-file timeout.
 */
export const presentFrames = (page, { timeout = 2000 } = {}) =>
  page
    .evaluate(
      (waitTimeout) =>
        new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(finish, waitTimeout);
          requestAnimationFrame(() => requestAnimationFrame(finish));
        }),
      timeout,
    )
    .catch(() => {});

/**
 * Wait until MapLibre has *committed* the current symbol placement on a clean
 * renderer, not merely emitted an `idle`.
 *
 * A glyph-triggered tile reload can re-start placement after the app's
 * `data-map-idle` signal; because `PauseablePlacement` splits a large placement
 * across frames, under SwiftShader the run can span dozens of slow frames. The
 * byte-identical `capture()` loop then races: two screenshots taken apart can
 * land on the same slow frame and look "stable" while placement is still
 * mid-flight, committing a frame whose labels are not yet drawn.
 *
 * Requiring the exact clean predicate (placement and style/source updates idle,
 * no pending layer/source work) is necessary but not sufficient on its own:
 * `Style._updatePlacement` reports "no change" once a committed placement has no
 * transitions left, so a late placement can land without scheduling another
 * frame. So: wait for the clean predicate, force a render (`map.redraw()`, which
 * commits any pending placement synchronously), require the predicate clean
 * again, force a second render, require it clean again, then present two frames
 * for the compositor. In E2E `fadeDuration` is 0, so there is no time-based fade
 * to bound. It reads MapLibre internals (there is no public "placement
 * committed" event) but that is exactly the state the renderer uses to decide
 * whether another frame is required (`Map._render` schedules a repaint while
 * `_placementDirty`/`_sourcesDirty`/`_styleDirty` hold, and only fires `idle`
 * when none do). Best-effort: a timeout leaves the existing waits in charge, and
 * each clean check has its own ceiling so the whole helper cannot hang.
 */
export const waitForMapQuiet = async (page, { timeout = 30000 } = {}) => {
  await ensureMapHandle(page);

  const waitForClean = (waitTimeout) =>
    page
      .waitForFunction(
        () => {
          const map = window.__ogisMap;
          const style = map && map.style;
          if (!style) return false;
          return (
            !map.isMoving() &&
            map.loaded() &&
            !style._placementDirty &&
            !style._changed &&
            !map._sourcesDirty &&
            !map._styleDirty &&
            Object.keys(style._updatedSources ?? {}).length === 0 &&
            Object.keys(style._updatedLayers ?? {}).length === 0
          );
        },
        null,
        { timeout: waitTimeout, polling: 100 },
      )
      .catch(() => {});

  await waitForClean(timeout);
  // Force a render so any placement that landed without scheduling a frame is
  // committed, then confirm the renderer is still clean.
  await renderOnce(page);
  await waitForClean(timeout);
  await renderOnce(page);
  await waitForClean(timeout);
  // Present the committed frame to the compositor.
  await presentFrames(page);
};

/**
 * Assert the map has settled, or attach diagnostics and rethrow. The whole
 * diagnostics/attach path is guarded so it can never mask the original failure.
 */
export const waitForMapIdle = async (
  page,
  testInfo,
  { timeout = 180000 } = {},
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
  // Outside the diagnostics catch: a stale server must fail fast with its own
  // actionable message, not be annotated as a map-idle timeout.
  await assertE2eFixturesActive(page);
};
