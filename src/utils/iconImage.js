import directionArrowSvg from "@/icons/svg/direction-arrow.svg?raw";

const RASTER_SIZE = 64;

let cachedPromise = null;

function buildDirectionArrowDataUrl() {
  const sizedSvg = directionArrowSvg.replace(
    /<svg\b/,
    `<svg width="${RASTER_SIZE}" height="${RASTER_SIZE}"`,
  );
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sizedSvg)}`;
}

/**
 * Load the authored direction arrow as an image, rasterised at 64×64 so it can
 * be registered on the map with `pixelRatio: 2`.
 *
 * The promise is cached at module level, so each map instance reuses the same
 * decoded image. A failed load clears the cache so a later retry can succeed.
 *
 * @returns {Promise<HTMLImageElement|null>}
 */
export const loadDirectionArrowImage = () => {
  if (cachedPromise) return cachedPromise;

  if (typeof Image === "undefined") return Promise.resolve(null);

  cachedPromise = new Promise((resolve) => {
    try {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = buildDirectionArrowDataUrl();
    } catch {
      resolve(null);
    }
  }).then((image) => {
    if (!image) cachedPromise = null;
    return image;
  });

  return cachedPromise;
};
