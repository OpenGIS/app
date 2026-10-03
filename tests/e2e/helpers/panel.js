import { expect } from "@playwright/test";

/**
 * Wait for the app to be ready: the chrome is mounted, the map's style is
 * loaded and its instance published (`data-map-ready`), and the side panel's
 * show transition has settled. All cheap, deterministic conditions — no
 * network wait and no map render settle.
 */
export const waitForMapReady = async (page) => {
  await page.locator("#menu-button").waitFor({ state: "visible" });
  // `data-map-ready` is set by useMap when the style has loaded and the map
  // instance is published (the app's own `map:ready` point), so features are
  // wired up and the map is usable. Unlike MapLibre's render-bound `load`
  // event (~26 s under SwiftShader) or the full `data-map-idle` settle, this
  // is cheap and deterministic.
  await expect(page.locator(".ogis-map")).toHaveAttribute(
    "data-map-ready",
    "true",
    { timeout: 30000 },
  );
  // The Bootstrap JS bundle has been removed, so the offcanvas `showing`/
  // `hiding` transitional classes should never appear — this remains a
  // defensive guard that the panel has settled before interaction.
  await expect(page.locator(".ogis-panel")).not.toHaveClass(/showing|hiding/, {
    timeout: 30000,
  });
};

/**
 * Wait for the offcanvas slide transition to finish. The panel gains `show`
 * immediately on open, while its CSS `transform` animates to `none` over
 * 0.25 s — geometry must be measured only after that settle. Also guards
 * against the transitional `showing`/`hiding` classes.
 */
export const waitForPanelSettled = (page) =>
  page.waitForFunction(
    () => {
      const panel = document.querySelector(".ogis-panel");
      return (
        panel &&
        !panel.classList.contains("showing") &&
        !panel.classList.contains("hiding") &&
        getComputedStyle(panel).transform === "none"
      );
    },
    null,
    { timeout: 30000 },
  );

/** Open the menu pane via the hamburger and wait for the slide-in to settle. */
export const openMenuPanel = async (page) => {
  await page.locator("#menu-button").click();
  await expect(page.locator(".ogis-panel")).toHaveClass(/show/);
  await waitForPanelSettled(page);
};
