import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  installGlobalErrorHandlers,
  installVueErrorHandler,
  reportError,
} from "@/resilience/errors.js";

const createTarget = () => {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: vi.fn((type, handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    }),
  };
};

describe("reportError", () => {
  it("normalises strings into Error instances", () => {
    const error = reportError("plain failure", { source: "test" });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("plain failure");
  });

  it("keeps an existing Error intact", () => {
    const original = new Error("original");
    expect(reportError(original, { source: "test" })).toBe(original);
  });

  it("uses message and name from error-like objects", () => {
    const error = reportError(
      { name: "CustomError", message: "object failure" },
      { source: "test" },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CustomError");
    expect(error.message).toBe("object failure");
  });

  it("never throws for circular values", () => {
    const circular = {};
    circular.self = circular;

    expect(() => reportError(circular, { source: "test" })).not.toThrow();
    expect(reportError(circular, { source: "test" })).toBeInstanceOf(Error);
  });

  it("never throws when reporting itself fails", () => {
    const context = {};
    Object.defineProperty(context, "source", {
      enumerable: true,
      get() {
        throw new Error("getter boom");
      },
    });

    expect(() => reportError(new Error("boom"), context)).not.toThrow();
  });
});

describe("installGlobalErrorHandlers", () => {
  it("is idempotent per target", () => {
    const target = createTarget();
    const report = vi.fn();

    expect(installGlobalErrorHandlers(target, { report })).toBe(true);
    expect(installGlobalErrorHandlers(target, { report })).toBe(false);

    expect(target.addEventListener).toHaveBeenCalledTimes(2);
    expect(target.listeners.get("error")).toHaveLength(1);
    expect(target.listeners.get("unhandledrejection")).toHaveLength(1);
  });

  it("ignores targets without addEventListener", () => {
    const report = vi.fn();

    expect(installGlobalErrorHandlers(null, { report })).toBe(false);
    expect(installGlobalErrorHandlers({}, { report })).toBe(false);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports script errors", () => {
    const target = createTarget();
    const report = vi.fn();
    installGlobalErrorHandlers(target, { report });

    const handler = target.listeners.get("error")[0];
    handler({
      error: new Error("script boom"),
      message: "Uncaught Error: script boom",
      filename: "/src/app.js",
      lineno: 4,
      colno: 2,
    });

    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        source: "window",
        event: "error",
        filename: "/src/app.js",
        lineno: 4,
        colno: 2,
      }),
    );
  });

  it("reports an ErrorEvent message without an error value", () => {
    const target = createTarget();
    const report = vi.fn();
    installGlobalErrorHandlers(target, { report });

    target.listeners.get("error")[0]({
      error: null,
      message: "Script error.",
    });

    expect(report).toHaveBeenCalledWith(
      "Script error.",
      expect.objectContaining({ source: "window", event: "error" }),
    );
  });

  it("ignores ordinary resource-load errors", () => {
    const target = createTarget();
    const report = vi.fn();
    installGlobalErrorHandlers(target, { report });

    const handler = target.listeners.get("error")[0];
    handler({ error: null, message: "", target: { tagName: "IMG" } });
    handler({ error: null, message: "" });

    expect(report).not.toHaveBeenCalled();
  });

  it("reports unhandled rejections without preventing defaults", () => {
    const target = createTarget();
    const report = vi.fn();
    const preventDefault = vi.fn();
    installGlobalErrorHandlers(target, { report });

    target.listeners.get("unhandledrejection")[0]({
      reason: "rejection boom",
      preventDefault,
    });

    expect(report).toHaveBeenCalledWith("rejection boom", {
      source: "window",
      event: "unhandledrejection",
    });
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("installVueErrorHandler", () => {
  it("reports component errors through the injected reporter", () => {
    const app = { config: {} };
    const report = vi.fn();
    installVueErrorHandler(app, { report });

    const error = new Error("vue boom");
    app.config.errorHandler(error, {}, "render");

    expect(report).toHaveBeenCalledWith(error, {
      source: "vue",
      info: "render",
    });
  });

  it("does not throw for non-Error values", () => {
    const app = { config: {} };
    const report = vi.fn();
    installVueErrorHandler(app, { report });

    expect(() => app.config.errorHandler("nope", {}, "setup")).not.toThrow();
    expect(report).toHaveBeenCalledWith("nope", {
      source: "vue",
      info: "setup",
    });
  });

  it("is safe without a Vue config", () => {
    expect(() => installVueErrorHandler(null)).not.toThrow();
  });
});

describe("installVueErrorHandler boot signalling", () => {
  let originalBoot;

  beforeEach(() => {
    originalBoot = window.__ogisBoot;
  });

  afterEach(() => {
    if (originalBoot === undefined) {
      delete window.__ogisBoot;
    } else {
      window.__ogisBoot = originalBoot;
    }
  });

  const install = (report = vi.fn()) => {
    const app = { config: {} };
    installVueErrorHandler(app, { report });
    return { app, report };
  };

  const rootInstance = () => {
    const root = { $root: null, parent: null };
    root.$root = root;
    return root;
  };

  it("signals boot failure for a root-instance error", () => {
    const fail = vi.fn();
    window.__ogisBoot = { fail };
    const { app, report } = install();

    const error = new Error("root boom");
    const root = rootInstance();
    app.config.errorHandler(error, root, "setup");

    expect(report).toHaveBeenCalledWith(error, {
      source: "vue",
      info: "setup",
    });
    expect(fail).toHaveBeenCalledWith(error);
  });

  it("does not signal boot failure for a child-instance error", () => {
    const fail = vi.fn();
    window.__ogisBoot = { fail };
    const { app } = install();

    const root = rootInstance();
    const child = { $root: root, parent: root };
    app.config.errorHandler(new Error("child boom"), child, "render");

    expect(fail).not.toHaveBeenCalled();
  });

  it("signals boot failure when no instance is available", () => {
    const fail = vi.fn();
    window.__ogisBoot = { fail };
    const { app } = install();

    app.config.errorHandler(new Error("no instance"), null, "setup");

    expect(fail).toHaveBeenCalledTimes(1);
  });

  it("still signals boot failure when the reporter throws", () => {
    const fail = vi.fn();
    window.__ogisBoot = { fail };
    const report = vi.fn(() => {
      throw new Error("report boom");
    });
    const { app } = install(report);

    expect(() =>
      app.config.errorHandler(new Error("root boom"), rootInstance(), "setup"),
    ).not.toThrow();
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it("does not let a throwing fail escape", () => {
    window.__ogisBoot = {
      fail: vi.fn(() => {
        throw new Error("fail boom");
      }),
    };
    const { app } = install();

    expect(() =>
      app.config.errorHandler(new Error("root boom"), rootInstance(), "setup"),
    ).not.toThrow();
  });
});
