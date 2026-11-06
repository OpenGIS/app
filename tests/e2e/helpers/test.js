import { test as base, expect } from "@playwright/test";

import { installMapAssetStubs } from "./mapAssets.js";
import { trackPendingRequests } from "./mapIdle.js";

export { expect };
export const test = base.extend({
  context: async ({ context }, use) => {
    await installMapAssetStubs(context);
    // Keep the once-only onboarding hints (useLocateHints) out of functional
    // assertions and the screenshot matrix; a hint spec can opt back in by
    // clearing the flag in its own init script.
    await context.addInitScript(() => {
      window.__ogisDisableHints = true;
    });
    await use(context);
  },
  // Track every page's in-flight requests before the test navigates, so a
  // map-idle timeout can report what was still outstanding.
  page: async ({ page }, use) => {
    trackPendingRequests(page);
    await use(page);
  },
});
