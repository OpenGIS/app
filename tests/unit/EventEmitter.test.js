import { describe, it, expect, vi, beforeEach } from "vitest";
import EventEmitter from "@/classes/EventEmitter.js";

describe("EventEmitter", () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  describe("on / emit", () => {
    it("calls a registered listener when the event is emitted", () => {
      const fn = vi.fn();
      emitter.on("test", fn);
      emitter.emit("test", "a", "b");
      expect(fn).toHaveBeenCalledWith("a", "b");
    });

    it("supports multiple listeners for the same event", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      emitter.on("test", fn1);
      emitter.on("test", fn2);
      emitter.emit("test");
      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
    });

    it("does not call listeners for other events", () => {
      const fn = vi.fn();
      emitter.on("a", fn);
      emitter.emit("b");
      expect(fn).not.toHaveBeenCalled();
    });

    it("ignores non-function listeners", () => {
      expect(() => emitter.on("test", null)).not.toThrow();
      expect(() => emitter.on("test", "string")).not.toThrow();
      expect(() => emitter.emit("test")).not.toThrow();
    });

    it("returns the emitter for chaining", () => {
      const result = emitter.on("test", () => {});
      expect(result).toBe(emitter);
    });
  });

  describe("off", () => {
    it("removes a specific listener", () => {
      const fn = vi.fn();
      emitter.on("test", fn);
      emitter.off("test", fn);
      emitter.emit("test");
      expect(fn).not.toHaveBeenCalled();
    });

    it("removes all listeners for an event when no fn is given", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      emitter.on("test", fn1);
      emitter.on("test", fn2);
      emitter.off("test");
      emitter.emit("test");
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
    });

    it("is a no-op for unknown events", () => {
      expect(() => emitter.off("unknown", () => {})).not.toThrow();
    });

    it("returns the emitter for chaining", () => {
      const result = emitter.off("test");
      expect(result).toBe(emitter);
    });
  });

  describe("once", () => {
    it("fires the listener only once", () => {
      const fn = vi.fn();
      emitter.once("test", fn);
      emitter.emit("test");
      emitter.emit("test");
      expect(fn).toHaveBeenCalledOnce();
    });

    it("passes arguments to the listener", () => {
      const fn = vi.fn();
      emitter.once("test", fn);
      emitter.emit("test", 42, "hello");
      expect(fn).toHaveBeenCalledWith(42, "hello");
    });

    it("can be removed with off before it fires", () => {
      const fn = vi.fn();
      emitter.once("test", fn);
      emitter.off("test", fn);
      emitter.emit("test");
      expect(fn).not.toHaveBeenCalled();
    });

    it("ignores non-function listeners", () => {
      expect(() => emitter.once("test", null)).not.toThrow();
    });
  });

  describe("emit", () => {
    it("is safe to emit with no listeners", () => {
      expect(() => emitter.emit("nope")).not.toThrow();
    });

    it("returns the emitter for chaining", () => {
      const result = emitter.emit("test");
      expect(result).toBe(emitter);
    });

    it("handles a listener that removes itself during emit", () => {
      const fn = vi.fn(() => emitter.off("test", fn));
      emitter.on("test", fn);
      expect(() => emitter.emit("test")).not.toThrow();
      expect(fn).toHaveBeenCalledOnce();
    });
  });
});
