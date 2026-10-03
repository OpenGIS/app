import { expect } from "@playwright/test";

/**
 * Wait for MapLibre's `data-map-idle` settle, attaching triage evidence when the
 * wait times out.
 *
 * A stalled live raster or TileJSON request blocks MapLibre's `idle` event, and
 * MapLibre has no per-request timeout — so a flaky origin shows up as a bare
 * "attribute did not become true" failure with nothing pointing at the culprit.
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
