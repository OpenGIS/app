import { createDebug } from "@/debug.js";

const debug = createDebug("service-worker");

/**
 * Service worker lifecycle for the app shell.
 *
 * The app-shell service worker is only registered in production builds, or in
 * dev when explicitly opted in with `VITE_SW=1`. Registering in dev is harmful:
 * the worker is cache-first for same-origin requests, so it ends up caching
 * Vite's dev module graph and `/@vite/client` (which hardcodes a per-server-
 * instance HMR token), causing refused HMR sockets and a corrupted Vue mount.
 *
 * In dev the worker instead self-heals: any legacy registration is unregistered
 * and every cache for the origin is deleted, so poisoned long-lived browser
 * profiles recover on their next visit.
 *
 * All browser globals are injectable so the behaviour can be unit tested.
 *
 * @param {Object} [options]
 * @param {ImportMetaEnv} [options.env] - Build env, defaults to import.meta.env
 * @param {Navigator} [options.nav] - Navigator, defaults to globalThis.navigator
 * @param {CacheStorage} [options.cacheStorage] - Cache storage, defaults to globalThis.caches
 * @returns {Promise<{registered: boolean, cleanedRegistrations: number, cleanedCaches: number}>}
 */
export const setupServiceWorker = async ({
  env = import.meta.env,
  nav = globalThis.navigator,
  cacheStorage = globalThis.caches,
} = {}) => {
  const summary = {
    registered: false,
    cleanedRegistrations: 0,
    cleanedCaches: 0,
  };

  if (!nav || !("serviceWorker" in nav)) return summary;

  const enabled = Boolean(env.PROD) || env.VITE_SW === "1";

  if (enabled) {
    try {
      await nav.serviceWorker.register("/sw.js");
      summary.registered = true;
    } catch (error) {
      console.error("Service worker registration failed:", error);
    }
    return summary;
  }

  try {
    const registrations = await nav.serviceWorker.getRegistrations();
    const results = await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
    summary.cleanedRegistrations = results.filter(Boolean).length;
  } catch (error) {
    debug.warn("service worker unregister failed", error);
  }

  if (cacheStorage) {
    try {
      const keys = await cacheStorage.keys();
      const results = await Promise.all(
        keys.map((key) => cacheStorage.delete(key)),
      );
      summary.cleanedCaches = results.filter(Boolean).length;
    } catch (error) {
      debug.warn("cache purge failed", error);
    }
  }

  return summary;
};
