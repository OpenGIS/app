# Bugs

1/ There is a bug with Chrome desktop for mac (macOS only, is fine on Windows) where the map is not zoomable using the mouse scroll wheel. The app works correctly everywhere else tested, including Chrome mobile. Instead of zooming the map, the entire app gets "pulled" up and down, indicating that the browser is treating the map gesture as a scroll instead of a zoom. Diagnose this issue and implement a fix.

2/ @src/components/ui/top/locate.vue contains an element with id locate-button. However because Navigator support multiple instances, this should be either scoped to the instance or use a class instead of an id. Find and replace all uses of HTML id attributes.

3/ The GPX export function works on Desktop but does not work on mobile. When the export button is clicked on mobile, the loading indicator is displayed but the page hangs.

4/ The offline-region size estimate counts tiles only and ignores the glyph prefetch. The download prefetches every glyph range for every fontstack (≈3,072 URLs with the current style), so the "Est. size" figure (observed: 14 tiles / 710 KB) understates the actual work — the observed download progress denominator was 3,082 requests.

5/ as shown in the info-open screenshots, when the info panel is shown by default, the maplibre attribution is expanded and the the attribution is duplicated. instead, when the info panel is shown, the maplibre attribution should be collapsed, no need for drag end in this instance.

6/ On live loads, a glyph that arrives after MapLibre's symbol-placement pass can leave its label missing until the next interaction — MapLibre does not re-place symbols when a glyph becomes available. The E2E harness works around this by holding for a sustained glyph-fetch gap, then driving renders to commit any late re-placement before capture (`waitForGlyphsQuiesce` and `renderBurst` in `tests/e2e/helpers/mapIdle.js`, via `waitForMapPainted`). An app-side fix — re-place symbols on glyph load — is a possible future improvement.

7/ **[FIXED]** E2E capture residual: `screenshots/desktop/landscape/closed.jpg` alternated between two byte variants across runs — 84 sub-perceptual pixels differing (max channel Δ5), all anti-aliasing in the attribution-chip text; the other 45 matrix captures were byte-stable. Fixed by rendering the screenshot matrix in the dedicated, always-SwiftShader `screenshots` Playwright project plus the settle hardening (`fadeDuration: 0` test gate, active render-then-compare capture loop, glyph/quiet waits); all 46 captures now reproduce byte-identically across seven consecutive full runs. Test-capture artefact only, no app-code impact. See `docs/9.testing.md` (Screenshot determinism).
