const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Normalise stored route navigation state.
 *
 * A non-object top level throws so the primitive quarantines the value and
 * falls back to defaults. The route id is trimmed and only kept when it is a
 * non-empty string; the visible list keeps trimmed, unique string ids in
 * first-seen order. A route that is being navigated is always added to the
 * visible list, and `followOwned` only survives alongside a route. The owner id
 * is kept only as a non-empty string alongside a route.
 *
 * @param {*} data - Raw decoded state, at any stored version.
 * @returns {{ routeId: string|null, visible: string[], followOwned: boolean, ownerId: string|null }}
 */
export function hydrateNavigation(data) {
  if (!isPlainObject(data)) {
    throw new TypeError("navigation state must be an object");
  }

  let routeId = null;
  if (typeof data.routeId === "string") {
    const trimmed = data.routeId.trim();
    if (trimmed) routeId = trimmed;
  }

  const visible = [];
  const seen = new Set();

  if (Array.isArray(data.visible)) {
    for (const value of data.visible) {
      if (typeof value !== "string") continue;
      const id = value.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      visible.push(id);
    }
  }

  if (routeId !== null && !seen.has(routeId)) visible.push(routeId);

  const ownerId =
    routeId !== null &&
    typeof data.ownerId === "string" &&
    data.ownerId.trim() !== ""
      ? data.ownerId
      : null;

  return {
    routeId,
    visible,
    followOwned: routeId !== null && data.followOwned === true,
    ownerId,
  };
}
