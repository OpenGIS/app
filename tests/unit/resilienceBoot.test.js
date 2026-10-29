import { describe, it, expect, vi } from "vitest";
import { installFeature } from "@/resilience/boot.js";

const createBaseContext = () => {
  const buttons = [];
  const panels = [];
  const listeners = new Map();
  const mapReady = new Set();
  const cleanups = [];

  const addTo = (array) => (config) => {
    array.push(config);
    return () => {
      const index = array.indexOf(config);
      if (index !== -1) array.splice(index, 1);
    };
  };

  const on = (event, fn) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  };

  const registerMapReady = (fn) => {
    mapReady.add(fn);
    return () => mapReady.delete(fn);
  };

  const registerCleanup = (fn) => {
    if (typeof fn !== "function") {
      throw new TypeError("onCleanup() requires a function");
    }
    const entry = { fn, active: true };
    cleanups.push(entry);
    return () => {
      if (!entry.active) return;
      entry.active = false;
      const index = cleanups.indexOf(entry);
      if (index !== -1) cleanups.splice(index, 1);
    };
  };

  const ctx = {
    app: {},
    instanceId: "test",
    map: {},
    emitter: {},
    useStorage: vi.fn(() => ({ state: {} })),
    useSettings: vi.fn(() => ({ isMetric: true })),
    useLocale: vi.fn(() => ({ t: (key) => key })),
    getMap: vi.fn(() => null),
    provide: vi.fn(),
    emit: vi.fn(),
    addButton: vi.fn(addTo(buttons)),
    addPanel: vi.fn(addTo(panels)),
    on: vi.fn(on),
    once: vi.fn(on),
    off: vi.fn(),
    onMapReady: vi.fn(registerMapReady),
    onCleanup: vi.fn(registerCleanup),
  };

  return {
    ctx,
    registries: { buttons, panels, listeners, mapReady, cleanups },
  };
};

describe("installFeature", () => {
  it("rolls back every registration when a feature install throws", () => {
    const { ctx, registries } = createBaseContext();
    const onError = vi.fn();
    const ready = vi.fn();
    const button = { id: "broken-button" };
    const panel = { id: "broken-panel" };

    const feature = {
      install(context) {
        context.addButton(button);
        context.addPanel(panel);
        context.on("tick", ready);
        context.once("ping", ready);
        context.onMapReady(ready);
        throw new Error("install boom");
      },
    };

    expect(installFeature("broken", feature, ctx, { onError })).toBe(false);

    expect(registries.buttons).toEqual([]);
    expect(registries.panels).toEqual([]);
    expect(registries.listeners.get("tick")?.size ?? 0).toBe(0);
    expect(registries.listeners.get("ping")?.size ?? 0).toBe(0);
    expect(registries.mapReady.size).toBe(0);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      source: "feature-install",
      feature: "broken",
    });
  });

  it("lets a later feature install after an earlier one failed", () => {
    const { ctx, registries } = createBaseContext();
    const onError = vi.fn();
    const goodPanel = { id: "good-panel" };

    installFeature(
      "broken",
      {
        install(context) {
          context.addPanel({ id: "broken-panel" });
          throw new Error("install boom");
        },
      },
      ctx,
      { onError },
    );

    const installed = installFeature(
      "good",
      {
        install(context) {
          context.addPanel(goodPanel);
        },
      },
      ctx,
      { onError },
    );

    expect(installed).toBe(true);
    expect(registries.panels).toEqual([goodPanel]);
  });

  it("continues rollback when a disposer throws", () => {
    const { ctx } = createBaseContext();
    const onError = vi.fn();
    const removeButton = vi.fn();

    ctx.addButton = vi.fn(() => removeButton);
    ctx.onMapReady = vi.fn(() => () => {
      throw new Error("dispose boom");
    });

    const installed = installFeature(
      "broken",
      {
        install(context) {
          context.addButton({ id: "broken-button" });
          context.onMapReady(() => {});
          throw new Error("install boom");
        },
      },
      ctx,
      { onError },
    );

    expect(installed).toBe(false);
    expect(removeButton).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(1, expect.any(Error), {
      source: "feature-install-dispose",
      feature: "broken",
    });
    expect(onError).toHaveBeenNthCalledWith(2, expect.any(Error), {
      source: "feature-install",
      feature: "broken",
    });
  });

  it("keeps registrations and passes services through on success", () => {
    const { ctx, registries } = createBaseContext();
    const onError = vi.fn();
    const button = { id: "good-button" };
    const panel = { id: "good-panel" };
    const listener = vi.fn();
    let seenStorage = null;
    let seenSettings = null;
    let seenLocale = null;
    let seenMap = null;

    const installed = installFeature(
      "good",
      {
        install(context) {
          seenStorage = context.useStorage("demo", {});
          seenSettings = context.useSettings();
          seenLocale = context.useLocale();
          seenMap = context.getMap();
          context.provide("demo", { ok: true });
          context.emit("demo:ready");
          context.addButton(button);
          context.addPanel(panel);
          context.on("tick", listener);
          context.onMapReady(listener);
        },
      },
      ctx,
      { onError },
    );

    expect(installed).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(registries.buttons).toEqual([button]);
    expect(registries.panels).toEqual([panel]);
    expect(registries.listeners.get("tick")?.has(listener)).toBe(true);
    expect(registries.mapReady.has(listener)).toBe(true);
    expect(seenStorage).toEqual({ state: {} });
    expect(seenSettings).toEqual({ isMetric: true });
    expect(seenLocale.t("demo")).toBe("demo");
    expect(seenMap).toBeNull();
    expect(ctx.provide).toHaveBeenCalledWith("demo", { ok: true });
    expect(ctx.emit).toHaveBeenCalledWith("demo:ready");
  });

  it("reports a feature without an install method", () => {
    const { ctx } = createBaseContext();
    const onError = vi.fn();

    expect(installFeature("bad", {}, ctx, { onError })).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), {
      source: "feature-install",
      feature: "bad",
    });
  });

  it("keeps a successful install's cleanup registered without running it", () => {
    const { ctx, registries } = createBaseContext();
    const onError = vi.fn();
    const cleanup = vi.fn();

    const installed = installFeature(
      "good",
      {
        install(context) {
          context.onCleanup(cleanup);
        },
      },
      ctx,
      { onError },
    );

    expect(installed).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(registries.cleanups).toHaveLength(1);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("registers a returned teardown without running it during install", () => {
    const { ctx, registries } = createBaseContext();
    const onError = vi.fn();
    const teardown = vi.fn();

    const installed = installFeature("good", { install: () => teardown }, ctx, {
      onError,
    });

    expect(installed).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
    expect(registries.cleanups).toHaveLength(1);
    expect(registries.cleanups[0].fn).toBe(teardown);

    for (const entry of [...registries.cleanups].reverse()) {
      if (!entry.active) continue;
      entry.active = false;
      entry.fn();
    }

    expect(teardown).toHaveBeenCalledOnce();
  });

  it("keeps a successful install when the base context has no onCleanup", () => {
    const { ctx } = createBaseContext();
    const teardown = vi.fn();
    delete ctx.onCleanup;

    const installed = installFeature("good", { install: () => teardown }, ctx);

    expect(installed).toBe(true);
    expect(teardown).not.toHaveBeenCalled();
  });

  it("runs failed install's cleanups in reverse order and removes them", () => {
    const { ctx, registries } = createBaseContext();
    const onError = vi.fn();
    const order = [];

    const installed = installFeature(
      "broken",
      {
        install(context) {
          context.onCleanup(() => order.push("first"));
          context.onCleanup(() => order.push("second"));
          throw new Error("install boom");
        },
      },
      ctx,
      { onError },
    );

    expect(installed).toBe(false);
    expect(order).toEqual(["second", "first"]);
    expect(registries.cleanups).toHaveLength(0);
  });

  it("reports a throwing cleanup and still runs the remaining cleanups", () => {
    const { ctx, registries } = createBaseContext();
    const onError = vi.fn();
    const remaining = vi.fn();

    const installed = installFeature(
      "broken",
      {
        install(context) {
          context.onCleanup(remaining);
          context.onCleanup(() => {
            throw new Error("cleanup boom");
          });
          throw new Error("install boom");
        },
      },
      ctx,
      { onError },
    );

    expect(installed).toBe(false);
    expect(remaining).toHaveBeenCalledOnce();
    expect(registries.cleanups).toHaveLength(0);
    expect(onError).toHaveBeenNthCalledWith(1, expect.any(Error), {
      source: "feature-install-dispose",
      feature: "broken",
    });
    expect(onError).toHaveBeenNthCalledWith(2, expect.any(Error), {
      source: "feature-install",
      feature: "broken",
    });
  });

  it("treats an invalid onCleanup argument as an install failure", () => {
    const { ctx, registries } = createBaseContext();
    const onError = vi.fn();

    const installed = installFeature(
      "bad-cleanup",
      {
        install(context) {
          context.onCleanup("not a function");
        },
      },
      ctx,
      { onError },
    );

    expect(installed).toBe(false);
    expect(registries.cleanups).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), {
      source: "feature-install",
      feature: "bad-cleanup",
    });
  });
});
