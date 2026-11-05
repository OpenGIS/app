/**
 * Expect options for "gone after closing" checks.
 *
 * Closing plays a short animation (the side panel slides out, pop-ups and the
 * phone backdrop fade out) and the closed content is removed once it has run.
 * Under SwiftShader a single map frame can take several seconds, so the
 * default 5 s expect timeout can expire first. The wait still ends as soon as
 * the element is gone.
 */
export const AFTER_CLOSE = { timeout: 30000 };
