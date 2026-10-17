/**
 * Live read of the running map's configured projection type.
 *
 * MapLibre GL JS 5.24's `Map#getProjection()` returns the stylesheet
 * projection specification — a plain JSON object such as `{ type: "globe" }`
 * or `{ type: "mercator" }` (undefined before the style has loaded). The app
 * applies the globe projection on `style.load`; the orient facility switches
 * it to mercator. Read through the page's own module graph so the assertion
 * follows the real map instance.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<'globe'|'mercator'|null>}
 */
export const projectionType = (page) =>
  page.evaluate(async () => {
    const { getMapInstance } = await import("/src/composables/useMap.js");
    return getMapInstance("app").getProjection()?.type ?? null;
  });
