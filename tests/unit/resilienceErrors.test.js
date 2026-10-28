import { describe, it, expect, vi } from "vitest";
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
