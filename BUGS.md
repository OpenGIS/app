# Bugs

1/ There is a bug with Chrome desktop for mac (macOS only, is fine on Windows) where the map is not zoomable using the mouse scroll wheel. The app works correctly everywhere else tested, including Chrome mobile. Instead of zooming the map, the entire app gets "pulled" up and down, indicating that the browser is treating the map gesture as a scroll instead of a zoom. Diagnose this issue and implement a fix.

2/ @src/components/ui/top/locate.vue contains an element with id locate-button. However because Navigator support multiple instances, this should be either scoped to the instance or use a class instead of an id. Find and replace all uses of HTML id attributes.

4/ The GPX export function works on Desktop but does not work on mobile. When the export button is clicked on mobile, the loading indicator is displayed but the page hangs.

5/ The E2E suite fetches live sprites and fonts from https://www.ogis.org, and under load (the --workers=4 @screenshots matrix, repeated runs) the host returns HTTP 429 without an Access-Control-Allow-Origin header — the browser logs CORS errors and every expectNoConsoleErrors assertion fails in tests/e2e/screenshots/ui-states.spec.js and tests/e2e/sw.spec.js (11 failures on a re-run whose identical predecessor passed 100/100; curl confirmed 429 on /basemap/sprite.json). Fix direction: stub the external style/sprite host in E2E, or tolerate its 429/CORS console noise.
