import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { emitter } from "@/emitter.js";
import {
  usePersistedState,
  resetInstanceState,
  migrateLocalToSession,
  migrateSessionToLocal,
  __resetPersistedStateForTests,
} from "@/resilience/persistedState";

const settle = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

const envelope = (data, version = 1) =>
  JSON.stringify({ __ogisState: 1, version, data });

const readEnvelope = (key) => JSON.parse(localStorage.getItem(key));

describe("usePersistedState", () => {
  beforeEach(() => {
    __resetPersistedStateForTests();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetPersistedStateForTests();
  });

  describe("keys and registry", () => {
    it("uses ogis_{namespace}_{instanceId} keys and isolates instances", () => {
      const a = usePersistedState(
        "view",
        { defaults: { zoom: 0 }, debounce: 5 },
        "inst-a",
      );
      const b = usePersistedState(
        "view",
        { defaults: { zoom: 0 }, debounce: 5 },
        "inst-b",
      );

      a.state.zoom = 4;
      b.state.zoom = 9;
      a.flush();
      b.flush();

      expect(localStorage.getItem("ogis_view_inst-a")).not.toBeNull();
      expect(localStorage.getItem("ogis_view_inst-b")).not.toBeNull();
      expect(readEnvelope("ogis_view_inst-a").data.zoom).toBe(4);
      expect(readEnvelope("ogis_view_inst-b").data.zoom).toBe(9);
    });

    it("returns the same store for repeated calls", () => {
      const first = usePersistedState(
        "same",
        { defaults: { count: 0 } },
        "shared",
      );
      const second = usePersistedState(
        "same",
        { defaults: { count: 99 } },
        "shared",
      );

      expect(second).toBe(first);
      expect(second.state).toBe(first.state);
      expect(second.state.count).toBe(0);
    });
  });

  describe("hydration", () => {
    it("uses defaults when storage is empty", () => {
      const store = usePersistedState(
        "empty",
        { defaults: { count: 1, nested: { label: "a" } } },
        "empty-id",
      );

      expect(store.state).toEqual({ count: 1, nested: { label: "a" } });
    });

    it("reads a bare legacy value at version 0 without writing an envelope", () => {
      const raw = JSON.stringify({ count: 7 });
      localStorage.setItem("ogis_legacy_legacy-id", raw);
      const hydrate = vi.fn((data) => ({ count: data.count }));

      const store = usePersistedState(
        "legacy",
        { defaults: { count: 0 }, hydrate, debounce: 5 },
        "legacy-id",
      );

      expect(store.state.count).toBe(7);
      expect(hydrate).toHaveBeenCalledWith(
        { count: 7 },
        {
          version: 0,
          namespace: "legacy",
          instanceId: "legacy-id",
        },
      );
      expect(localStorage.getItem("ogis_legacy_legacy-id")).toBe(raw);

      store.state.count = 8;
      store.flush();

      expect(readEnvelope("ogis_legacy_legacy-id")).toMatchObject({
        __ogisState: 1,
        version: 1,
        data: { count: 8 },
      });
    });

    it("reads an envelope at the current version", () => {
      localStorage.setItem(
        "ogis_current_current-id",
        envelope({ count: 12 }, 1),
      );
      const hydrate = vi.fn((data) => data);

      const store = usePersistedState(
        "current",
        { version: 1, defaults: { count: 0 }, hydrate },
        "current-id",
      );

      expect(store.state.count).toBe(12);
      expect(hydrate).toHaveBeenCalledWith(
        { count: 12 },
        expect.objectContaining({ version: 1 }),
      );
    });

    it("passes a lower stored version through to the hydrator", () => {
      localStorage.setItem("ogis_lower_lower-id", envelope({ count: 3 }, 0));
      const hydrate = vi.fn((data) => data);

      usePersistedState(
        "lower",
        { version: 2, defaults: { count: 0 }, hydrate },
        "lower-id",
      );

      expect(hydrate).toHaveBeenCalledWith(
        { count: 3 },
        expect.objectContaining({ version: 0 }),
      );
    });

    it("falls back to defaults and quarantines when hydration throws", () => {
      const raw = JSON.stringify({ bad: true });
      localStorage.setItem("ogis_throwing_throwing-id", raw);

      const store = usePersistedState(
        "throwing",
        {
          defaults: { count: 1 },
          hydrate() {
            throw new Error("nope");
          },
        },
        "throwing-id",
      );

      expect(store.state).toEqual({ count: 1 });
      expect(localStorage.getItem("ogis_quarantine_throwing_throwing-id")).toBe(
        raw,
      );
    });

    it("falls back to defaults and quarantines corrupt JSON", () => {
      localStorage.setItem("ogis_corrupt_corrupt-id", "not-json");

      const store = usePersistedState(
        "corrupt",
        { defaults: { count: 1 } },
        "corrupt-id",
      );

      expect(store.state).toEqual({ count: 1 });
      expect(localStorage.getItem("ogis_quarantine_corrupt_corrupt-id")).toBe(
        "not-json",
      );
    });

    it("rejects a future envelope version and quarantines it", () => {
      const raw = envelope({ count: 9 }, 99);
      localStorage.setItem("ogis_future_future-id", raw);
      const hydrate = vi.fn();

      const store = usePersistedState(
        "future",
        { version: 1, defaults: { count: 1 }, hydrate },
        "future-id",
      );

      expect(store.state).toEqual({ count: 1 });
      expect(hydrate).not.toHaveBeenCalled();
      expect(localStorage.getItem("ogis_quarantine_future_future-id")).toBe(
        raw,
      );
    });

    it("rejects a container mismatch when no hydrator is supplied", () => {
      const raw = JSON.stringify([1, 2]);
      localStorage.setItem("ogis_shape_shape-id", raw);

      const store = usePersistedState(
        "shape",
        { defaults: { count: 1 } },
        "shape-id",
      );

      expect(store.state).toEqual({ count: 1 });
      expect(localStorage.getItem("ogis_quarantine_shape_shape-id")).toBe(raw);
    });

    it("accepts a matching container when no hydrator is supplied", () => {
      localStorage.setItem(
        "ogis_shape-ok_shape-ok-id",
        JSON.stringify({ count: 5 }),
      );

      const store = usePersistedState(
        "shape-ok",
        { defaults: { count: 1 } },
        "shape-ok-id",
      );

      expect(store.state).toEqual({ count: 5 });
    });
  });

  describe("writing", () => {
    it("coalesces writes through the debounce and writes an envelope", async () => {
      const store = usePersistedState(
        "debounced",
        { defaults: { count: 0 }, debounce: 5 },
        "debounced-id",
      );

      store.state.count = 1;
      store.state.count = 2;
      expect(localStorage.getItem("ogis_debounced_debounced-id")).toBeNull();

      await settle();

      expect(readEnvelope("ogis_debounced_debounced-id")).toMatchObject({
        __ogisState: 1,
        version: 1,
        data: { count: 2 },
      });
    });

    it("flush writes immediately and clears the timer", async () => {
      const store = usePersistedState(
        "flushed",
        { defaults: { count: 0 }, debounce: 5000 },
        "flushed-id",
      );

      store.state.count = 3;
      store.flush();

      expect(readEnvelope("ogis_flushed_flushed-id").data.count).toBe(3);

      store.state.count = 4;
      await settle();
      expect(readEnvelope("ogis_flushed_flushed-id").data.count).toBe(3);
    });

    it("flushes on pagehide", () => {
      const store = usePersistedState(
        "pagehide",
        { defaults: { count: 0 }, debounce: 5000 },
        "pagehide-id",
      );

      store.state.count = 6;
      window.dispatchEvent(new Event("pagehide"));

      expect(readEnvelope("ogis_pagehide_pagehide-id").data.count).toBe(6);
    });

    it("flushes when the document becomes hidden", () => {
      const store = usePersistedState(
        "hidden",
        { defaults: { count: 0 }, debounce: 5000 },
        "hidden-id",
      );

      const visibility = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");

      store.state.count = 7;
      document.dispatchEvent(new Event("visibilitychange"));

      expect(readEnvelope("ogis_hidden_hidden-id").data.count).toBe(7);
      visibility.mockRestore();
    });

    it("keeps state in memory when writing fails", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const setItem = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("QuotaExceededError");
        });

      const store = usePersistedState(
        "quota",
        { defaults: { count: 0 }, debounce: 5 },
        "quota-id",
      );

      store.state.count = 5;

      expect(() => store.flush()).not.toThrow();
      expect(store.state.count).toBe(5);
      expect(error).not.toHaveBeenCalled();

      setItem.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    });
  });

  describe("reset", () => {
    it("removes only the store key and restores defaults", () => {
      localStorage.setItem(
        "ogis_quarantine_reset_reset-id",
        JSON.stringify({ stale: true }),
      );

      const store = usePersistedState(
        "reset",
        { defaults: { count: 1 }, debounce: 5 },
        "reset-id",
      );

      store.state.count = 9;
      store.flush();
      expect(localStorage.getItem("ogis_reset_reset-id")).not.toBeNull();

      store.reset();

      expect(localStorage.getItem("ogis_reset_reset-id")).toBeNull();
      expect(store.state).toEqual({ count: 1 });
      expect(
        localStorage.getItem("ogis_quarantine_reset_reset-id"),
      ).not.toBeNull();
    });

    it("resetInstanceState removes the instance's own keys and quarantine from both storages", () => {
      const removed = [
        "ogis_view_app",
        "ogis_locate_app",
        "ogis_quarantine_view_app",
      ];
      const kept = ["ogis_view_trip_app", "ogis_locate_trip_app"];

      for (const key of [...removed, ...kept]) {
        localStorage.setItem(key, "x");
        sessionStorage.setItem(key, "x");
      }

      resetInstanceState("app");

      for (const key of removed) {
        expect(localStorage.getItem(key)).toBeNull();
        expect(sessionStorage.getItem(key)).toBeNull();
      }
      for (const key of kept) {
        expect(localStorage.getItem(key)).toBe("x");
        expect(sessionStorage.getItem(key)).toBe("x");
      }
    });

    it("resetInstanceState does not over-match an instance id suffix", () => {
      localStorage.setItem("ogis_view_trip_app", "x");
      localStorage.setItem("ogis_locate_trip_app", "x");
      sessionStorage.setItem("ogis_view_trip_app", "x");
      sessionStorage.setItem("ogis_locate_trip_app", "x");

      resetInstanceState("app");

      expect(localStorage.getItem("ogis_view_trip_app")).toBe("x");
      expect(localStorage.getItem("ogis_locate_trip_app")).toBe("x");
      expect(sessionStorage.getItem("ogis_view_trip_app")).toBe("x");
      expect(sessionStorage.getItem("ogis_locate_trip_app")).toBe("x");
    });

    it("resetInstanceState handles an instance id containing an underscore", () => {
      localStorage.setItem("ogis_view_trip_app", "x");
      localStorage.setItem("ogis_view_app", "y");
      sessionStorage.setItem("ogis_view_trip_app", "x");
      sessionStorage.setItem("ogis_view_app", "y");

      resetInstanceState("trip_app");

      expect(localStorage.getItem("ogis_view_trip_app")).toBeNull();
      expect(sessionStorage.getItem("ogis_view_trip_app")).toBeNull();
      expect(localStorage.getItem("ogis_view_app")).toBe("y");
      expect(sessionStorage.getItem("ogis_view_app")).toBe("y");
    });

    it("resetInstanceState only removes known store namespaces", () => {
      localStorage.setItem("ogis_other_app", "x");
      sessionStorage.setItem("ogis_other_app", "x");

      resetInstanceState("app");

      expect(localStorage.getItem("ogis_other_app")).toBe("x");
      expect(sessionStorage.getItem("ogis_other_app")).toBe("x");
    });

    it("matches instance ids containing special characters exactly", () => {
      localStorage.setItem("ogis_view_a+b", "x");
      localStorage.setItem("ogis_view_aaab", "y");

      resetInstanceState("a+b");

      expect(localStorage.getItem("ogis_view_a+b")).toBeNull();
      expect(localStorage.getItem("ogis_view_aaab")).toBe("y");
    });
  });

  describe("cross-tab sync", () => {
    const dispatchStorage = (key, newValue) => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          oldValue: null,
          newValue,
          storageArea: localStorage,
        }),
      );
    };

    it("applies an external write, runs onSync and emits state:sync", async () => {
      const onSync = vi.fn();
      const onStateSync = vi.fn();
      emitter.once("state:sync", onStateSync);

      const store = usePersistedState(
        "sync",
        {
          defaults: { count: 0 },
          crossTab: true,
          debounce: 5,
          onSync,
        },
        "sync-id",
      );
      const stateIdentity = store.state;
      const incoming = envelope({ count: 42 });

      dispatchStorage("ogis_sync_sync-id", incoming);
      await nextTick();

      expect(store.state).toBe(stateIdentity);
      expect(store.state.count).toBe(42);
      expect(onSync).toHaveBeenCalledWith(store.state, {
        namespace: "sync",
        instanceId: "sync-id",
        source: "external",
      });
      expect(onStateSync).toHaveBeenCalledWith({
        namespace: "sync",
        instanceId: "sync-id",
        source: "external",
        key: "ogis_sync_sync-id",
      });
    });

    it("does not echo an external write back to storage", async () => {
      const store = usePersistedState(
        "echo",
        { defaults: { count: 0 }, crossTab: true, debounce: 5 },
        "echo-id",
      );
      const key = "ogis_echo_echo-id";
      const incoming = envelope({ count: 11 });
      localStorage.setItem(key, incoming);

      const setItem = vi.spyOn(Storage.prototype, "setItem");
      dispatchStorage(key, incoming);

      await nextTick();
      await settle();

      const writes = setItem.mock.calls.filter(
        ([writtenKey]) => writtenKey === key,
      );
      expect(writes).toHaveLength(0);
      expect(store.state.count).toBe(11);

      setItem.mockRestore();
    });

    it("ignores external writes for stores without crossTab", async () => {
      const onSync = vi.fn();
      const store = usePersistedState(
        "no-sync",
        { defaults: { count: 0 }, crossTab: false, onSync },
        "no-sync-id",
      );

      dispatchStorage("ogis_no-sync_no-sync-id", envelope({ count: 5 }));
      await nextTick();

      expect(store.state.count).toBe(0);
      expect(onSync).not.toHaveBeenCalled();
    });

    it("ignores invalid external data without quarantining it", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = usePersistedState(
        "invalid-sync",
        { version: 1, defaults: { count: 0 }, crossTab: true },
        "invalid-sync-id",
      );
      const key = "ogis_invalid-sync_invalid-sync-id";

      dispatchStorage(key, envelope({ count: 99 }, 99));
      await nextTick();

      expect(store.state.count).toBe(0);
      expect(
        localStorage.getItem("ogis_quarantine_invalid-sync_invalid-sync-id"),
      ).toBeNull();

      warn.mockRestore();
    });
  });

  describe("migrateSessionToLocal", () => {
    it("moves a session value to local and removes the session copy", () => {
      const raw = JSON.stringify({ permissionGranted: true });
      sessionStorage.setItem("ogis_locate_move-id", raw);

      expect(migrateSessionToLocal("locate", "move-id")).toBe(true);
      expect(localStorage.getItem("ogis_locate_move-id")).toBe(raw);
      expect(sessionStorage.getItem("ogis_locate_move-id")).toBeNull();
    });

    it("lets the session value win when both exist", () => {
      localStorage.setItem("ogis_locate_both-id", JSON.stringify({ a: 1 }));
      sessionStorage.setItem("ogis_locate_both-id", JSON.stringify({ a: 2 }));

      expect(migrateSessionToLocal("locate", "both-id")).toBe(true);
      expect(JSON.parse(localStorage.getItem("ogis_locate_both-id"))).toEqual({
        a: 2,
      });
      expect(sessionStorage.getItem("ogis_locate_both-id")).toBeNull();
    });

    it("is a no-op when session storage has no value", () => {
      localStorage.setItem("ogis_locate_local-only", JSON.stringify({ a: 1 }));

      expect(migrateSessionToLocal("locate", "local-only")).toBe(false);
      expect(
        JSON.parse(localStorage.getItem("ogis_locate_local-only")),
      ).toEqual({ a: 1 });
    });

    it("keeps the session value when the local write fails", () => {
      const raw = JSON.stringify({ a: 2 });
      sessionStorage.setItem("ogis_locate_write-fails", raw);

      const setItem = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation(() => {
          throw new Error("local storage unavailable");
        });

      try {
        expect(migrateSessionToLocal("locate", "write-fails")).toBe(false);
      } finally {
        setItem.mockRestore();
      }

      expect(sessionStorage.getItem("ogis_locate_write-fails")).toBe(raw);
      expect(localStorage.getItem("ogis_locate_write-fails")).toBeNull();
    });

    it("never throws when storage is unavailable", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const getItem = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("storage unavailable");
        });

      expect(() => migrateSessionToLocal("locate", "throws-id")).not.toThrow();
      expect(migrateSessionToLocal("locate", "throws-id")).toBe(false);

      getItem.mockRestore();
      warn.mockRestore();
    });
  });

  describe("migrateLocalToSession", () => {
    it("moves a local value to session and removes the local copy", () => {
      const raw = JSON.stringify({ permissionGranted: true });
      localStorage.setItem("ogis_locate_move-id", raw);

      expect(migrateLocalToSession("locate", "move-id")).toBe(true);
      expect(sessionStorage.getItem("ogis_locate_move-id")).toBe(raw);
      expect(localStorage.getItem("ogis_locate_move-id")).toBeNull();
    });

    it("lets an existing session value win and removes the local copy", () => {
      localStorage.setItem("ogis_locate_both-id", JSON.stringify({ a: 1 }));
      sessionStorage.setItem("ogis_locate_both-id", JSON.stringify({ a: 2 }));

      expect(migrateLocalToSession("locate", "both-id")).toBe(false);
      expect(JSON.parse(sessionStorage.getItem("ogis_locate_both-id"))).toEqual(
        { a: 2 },
      );
      expect(localStorage.getItem("ogis_locate_both-id")).toBeNull();
    });

    it("is a no-op when neither storage has the key", () => {
      expect(migrateLocalToSession("locate", "empty-id")).toBe(false);
      expect(sessionStorage.getItem("ogis_locate_empty-id")).toBeNull();
      expect(localStorage.getItem("ogis_locate_empty-id")).toBeNull();
    });

    it("never throws when storage is unavailable", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const getItem = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("storage unavailable");
        });

      expect(() => migrateLocalToSession("locate", "throws-id")).not.toThrow();
      expect(migrateLocalToSession("locate", "throws-id")).toBe(false);

      getItem.mockRestore();
      warn.mockRestore();
    });
  });

  describe("session storage", () => {
    it("reads and writes sessionStorage and never opts into cross-tab sync", async () => {
      const onSync = vi.fn();
      const store = usePersistedState(
        "session",
        {
          defaults: { count: 0 },
          storage: "session",
          crossTab: true,
          onSync,
          debounce: 5,
        },
        "session-id",
      );

      store.state.count = 4;
      store.flush();

      expect(
        JSON.parse(sessionStorage.getItem("ogis_session_session-id")),
      ).toMatchObject({
        __ogisState: 1,
        version: 1,
        data: { count: 4 },
      });
      expect(localStorage.getItem("ogis_session_session-id")).toBeNull();

      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "ogis_session_session-id",
          newValue: envelope({ count: 8 }),
          storageArea: localStorage,
        }),
      );
      await nextTick();

      expect(store.state.count).toBe(4);
      expect(onSync).not.toHaveBeenCalled();
    });
  });
});
