/**
 * Decode a raw persisted-state string into its stored value.
 *
 * The state store writes a versioned envelope; older values were stored bare.
 * Empty or unparseable input returns `null`.
 *
 * @param {string|null|undefined} raw
 * @returns {*}
 */
export const readStoredState = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.__ogisState === 1 ? parsed.data : parsed;
  } catch {
    return null;
  }
};

/**
 * Write a versioned persisted-state envelope directly into localStorage.
 *
 * Use from a peer page in the same browser context to drive the `storage`
 * event another page receives.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} key - Instance-scoped storage key, e.g. `ogis_routes_app`.
 * @param {number} version - Store schema version.
 * @param {*} data - Envelope data.
 */
export const writeStoredEnvelope = (page, key, version, data) =>
  page.evaluate(
    ({ key, version, data }) => {
      localStorage.setItem(
        key,
        JSON.stringify({ __ogisState: 1, version, data }),
      );
    },
    { key, version, data },
  );

/**
 * Open a same-origin peer page without waiting for the app to finish booting.
 *
 * The peer shares the context's localStorage, so writes it makes reach the
 * observing page as `storage` events. A same-context page is required because
 * separate contexts do not share storage.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<import('@playwright/test').Page>}
 */
export const openPeerPage = async (context) => {
  const peer = await context.newPage();
  await peer.goto("/", { waitUntil: "domcontentloaded" });
  return peer;
};
