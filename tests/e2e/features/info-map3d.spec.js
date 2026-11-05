import { test, expect } from "../helpers/test.js";
import {
  trackConsoleErrors,
  expectNoConsoleErrors,
} from "../helpers/console.js";
import { waitForMapReady } from "../helpers/panel";

/**
 * The Info pane's "This map is 3D" card: the zoom, turn and tilt gestures,
 * placed above the privacy bar.
 */

test.beforeEach(({ page }) => trackConsoleErrors(page));
test.afterEach(({ page }) => expectNoConsoleErrors(page));

test.describe("Info / This map is 3D card", () => {
  test("lists the gestures above the privacy bar", async ({ page }) => {
    await page.goto("/");
    await waitForMapReady(page);

    // Desktop boots with the Info pane open.
    const card = page.locator(".ogis-map3d-card");
    await expect(card).toContainText("This map is 3D");
    await expect(card.locator("li")).toHaveCount(3);
    await expect(card).toContainText("tilt the view");

    const cardBox = await card.boundingBox();
    const privacyBox = await page
      .locator(".ogis-privacy-section")
      .boundingBox();
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(privacyBox.y);
  });
});
