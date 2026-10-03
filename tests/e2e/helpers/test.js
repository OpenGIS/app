import { test as base, expect } from "@playwright/test";

import { installMapAssetStubs } from "./mapAssets.js";
import { trackPendingRequests } from "./mapIdle.js";

export { expect };
export const test = base.extend({
  liveGlyphRelay: [false, { option: true }],
  context: async ({ context, liveGlyphRelay }, use) => {
    await installMapAssetStubs(context, { liveGlyphRelay });
    await use(context);
  },
  // Track every page's in-flight requests before the test navigates, so a
  // map-idle timeout can report what was still outstanding.
  page: async ({ page }, use) => {
    trackPendingRequests(page);
    await use(page);
  },
});
