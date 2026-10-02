import { describe, it, expect, vi, afterEach } from "vitest";
import { setupServiceWorker } from "@/utils/serviceWorker";

/**
 * Build an injectable navigator-like object. When `supported` is false the
 * serviceWorker property is omitted entirely, mimicking a browser without the
 * API (or a non-browser context).
 */
const createNav = ({ supported = true, register, registrations } = {}) => {
  const nav = {};
  if (supported) {
    nav.serviceWorker = {
      register: register ?? vi.fn().mockResolvedValue({ scope: "/" }),
      getRegistrations: registrations ?? vi.fn().mockResolvedValue([]),
    };
  }
  return nav;
};

/** Build an injectable CacheStorage-like object. */
const createCacheStorage = (keys = []) => ({
  keys: vi.fn().mockResolvedValue(keys),
  delete: vi.fn().mockResolvedValue(true),
});

describe("setupServiceWorker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no-ops without throwing when the serviceWorker API is absent", async () => {
    const nav = createNav({ supported: false });
    const cacheStorage = createCacheStorage(["ogis-shell-v1"]);

    const summary = await setupServiceWorker({ env: {}, nav, cacheStorage });

    expect(summary).toEqual({
      registered: false,
      cleanedRegistrations: 0,
      cleanedCaches: 0,
    });
    expect(cacheStorage.keys).not.toHaveBeenCalled();
  });

  it("does not throw when cacheStorage is undefined during dev cleanup", async () => {
    const nav = createNav({
      registrations: vi
        .fn()
        .mockResolvedValue([{ unregister: vi.fn().mockResolvedValue(true) }]),
    });

    await expect(
      setupServiceWorker({ env: {}, nav, cacheStorage: undefined }),
    ).resolves.toMatchObject({ registered: false, cleanedRegistrations: 1 });
  });

  it("in dev, unregisters every registration and deletes every cache key instead of registering", async () => {
    const register = vi.fn().mockResolvedValue({ scope: "/" });
    const registrations = [
      { unregister: vi.fn().mockResolvedValue(true) },
      { unregister: vi.fn().mockResolvedValue(true) },
    ];
    const getRegistrations = vi.fn().mockResolvedValue(registrations);
    const nav = createNav({ register, registrations: getRegistrations });
    const cacheStorage = createCacheStorage(["ogis-shell-v1", "ogis-map-v1"]);

    const summary = await setupServiceWorker({ env: {}, nav, cacheStorage });

    expect(register).not.toHaveBeenCalled();
    expect(getRegistrations).toHaveBeenCalledTimes(1);
    for (const registration of registrations) {
      expect(registration.unregister).toHaveBeenCalledTimes(1);
    }
    expect(cacheStorage.keys).toHaveBeenCalledTimes(1);
    expect(cacheStorage.delete).toHaveBeenCalledTimes(2);
    expect(cacheStorage.delete).toHaveBeenCalledWith("ogis-shell-v1");
    expect(cacheStorage.delete).toHaveBeenCalledWith("ogis-map-v1");
    expect(summary).toEqual({
      registered: false,
      cleanedRegistrations: 2,
      cleanedCaches: 2,
    });
  });

  it("registers in dev when explicitly opted in via VITE_SW=1", async () => {
    const register = vi.fn().mockResolvedValue({ scope: "/" });
    const getRegistrations = vi.fn().mockResolvedValue([]);
    const nav = createNav({ register, registrations: getRegistrations });
    const cacheStorage = createCacheStorage(["ogis-shell-v1"]);

    const summary = await setupServiceWorker({
      env: { VITE_SW: "1" },
      nav,
      cacheStorage,
    });

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(getRegistrations).not.toHaveBeenCalled();
    expect(cacheStorage.keys).not.toHaveBeenCalled();
    expect(summary).toEqual({
      registered: true,
      cleanedRegistrations: 0,
      cleanedCaches: 0,
    });
  });

  it("registers in production (env.PROD) without cleanup", async () => {
    const register = vi.fn().mockResolvedValue({ scope: "/" });
    const getRegistrations = vi.fn().mockResolvedValue([]);
    const nav = createNav({ register, registrations: getRegistrations });
    const cacheStorage = createCacheStorage(["ogis-shell-v1"]);

    const summary = await setupServiceWorker({
      env: { PROD: true },
      nav,
      cacheStorage,
    });

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(getRegistrations).not.toHaveBeenCalled();
    expect(cacheStorage.keys).not.toHaveBeenCalled();
    expect(summary.registered).toBe(true);
  });

  it("catches a registration rejection, logs it, and resolves", async () => {
    const error = new Error("registration boom");
    const register = vi.fn().mockRejectedValue(error);
    const nav = createNav({ register });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      setupServiceWorker({
        env: { PROD: true },
        nav,
        cacheStorage: createCacheStorage(),
      }),
    ).resolves.toMatchObject({ registered: false });

    expect(consoleError).toHaveBeenCalledWith(
      "Service worker registration failed:",
      error,
    );
  });

  it("swallows cleanup failures without an unhandled rejection or console.error noise", async () => {
    const getRegistrations = vi
      .fn()
      .mockRejectedValue(new Error("cleanup boom"));
    const nav = createNav({ registrations: getRegistrations });
    const cacheStorage = createCacheStorage(["ogis-shell-v1"]);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      setupServiceWorker({ env: {}, nav, cacheStorage }),
    ).resolves.toBeDefined();

    // Cache purge still runs after an unregister failure so profiles self-heal.
    expect(cacheStorage.keys).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalled();
  });
});
