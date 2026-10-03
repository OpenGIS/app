# Bugs

1/ There is a bug with Chrome desktop for mac (macOS only, is fine on Windows) where the map is not zoomable using the mouse scroll wheel. The app works correctly everywhere else tested, including Chrome mobile. Instead of zooming the map, the entire app gets "pulled" up and down, indicating that the browser is treating the map gesture as a scroll instead of a zoom. Diagnose this issue and implement a fix.

2/ @src/components/ui/top/locate.vue contains an element with id locate-button. However because Navigator support multiple instances, this should be either scoped to the instance or use a class instead of an id. Find and replace all uses of HTML id attributes.

3/ Modals @src/modals/\*.md do not respect the dark theme and display with a white background and black text. Update the modal styles to be compatible with both light and dark themes.

4/ The GPX export function works on Desktop but does not work on mobile. When the export button is clicked on mobile, the loading indicator is displayed but the page hangs.
