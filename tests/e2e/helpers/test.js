import { test as base, expect } from "@playwright/test";

import { installMapAssetStubs } from "./mapAssets.js";

export { expect };
export const test = base.extend({
  context: async ({ context }, use) => {
    await installMapAssetStubs(context);
    await use(context);
  },
});
