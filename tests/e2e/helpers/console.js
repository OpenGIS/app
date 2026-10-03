import { expect } from "@playwright/test";

/** Start collecting console/page errors; assert empty via expectNoConsoleErrors. */
export const trackConsoleErrors = (page) => {
  page.__consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // Ignore external tile-provider 404s: the Mapterhorn raster overlay has no
    // tiles at some zoom/areas, so camera moves 404 expected network noise.
    const url = msg.location()?.url ?? "";
    if (url.includes("tiles.mapterhorn.com")) return;
    page.__consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    page.__consoleErrors.push(err?.message ?? String(err));
  });
};

/** Assert no console/page errors were collected during the test. */
export const expectNoConsoleErrors = (page) => {
  const errors = page.__consoleErrors ?? [];
  expect(errors, `Console errors: ${errors.join(" | ")}`).toEqual([]);
};
