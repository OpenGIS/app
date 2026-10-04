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
 * Let the map run to a true paint settle after `data-map-idle`.
 *
 * `data-map-idle` can be published while MapLibre is still finishing a symbol
 * placement: a text label pops in after the tile set reads as loaded, and the
 * glyph that placement needs arrives from the worker asynchronously. At the
 * scheduled demo area that late placement writes a road/river name label, so a
 * capture taken too early records it absent — the run-to-run matrix diff. A
 * real, main-thread-idle window longer than the measured worst-case placement
 * latency lets the placement complete and commit before the caller captures;
 * screenshotting during the wait would starve the main thread it needs. A
 * re-placement follows, so a glyph that only arrived after the original
 * placement is still committed.
 */
export const waitForMapPainted = async (page) => {
  // Give a late placement real, main-thread-idle time: a label whose glyph
  // arrives after placement ran, and MapLibre does not re-place symbols when a
  // glyph becomes available. Measured worst-case post-idle latency reached
  // multiple seconds under 4-worker GPU contention.
  await page.waitForTimeout(2500);
  // Re-run symbol placement, then repeat once more after the first has settled,
  // so a placement always runs with every glyph already cached. Setting a
  // symbol layer's `text-field` to its current value marks the style dirty and
  // re-places.
  for (let round = 0; round < 2; round++) {
    const armed = await page
      .evaluate(() => {
        window.__ogisReplaceIdle = false;
        return import("/src/composables/useMap.js")
          .then((mod) => {
            const map = mod.getMapInstance("app");
            if (!map || typeof map.once !== "function") return false;
            map.once("idle", () => {
              window.__ogisReplaceIdle = true;
            });
            const layers = map.getStyle()?.layers ?? [];
            for (const layer of layers) {
              if (layer.type !== "symbol") continue;
              const textField = map.getLayoutProperty(layer.id, "text-field");
              if (textField === undefined) continue;
              map.setLayoutProperty(layer.id, "text-field", textField);
            }
            return true;
          })
          .catch(() => false);
      })
      .catch(() => false);
    if (!armed) return;
    await page
      .waitForFunction(() => window.__ogisReplaceIdle === true, null, {
        timeout: 3000,
      })
      .catch(() => {});
  }
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
