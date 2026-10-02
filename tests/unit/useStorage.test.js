import { describe, it, expect, vi, beforeEach } from "vitest";
import { reactive, watch, inject } from "vue";

// Mock vue — capture provide/inject and reactive behaviour
vi.mock("vue", () => {
  let injectReturn = "app";
  return {
    inject: vi.fn(() => injectReturn),
    reactive: vi.fn((obj) => (Array.isArray(obj) ? [...obj] : { ...obj })),
    watch: vi.fn(),
    __setInjectReturn: (val) => {
      injectReturn = val;
    },
  };
});

import { useStorage } from "@/composables/useStorage";
import { __setInjectReturn } from "vue";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  __setInjectReturn("app");
});

describe("useStorage", () => {
  describe("key format", () => {
    it("generates key as onrte_{namespace}_{instanceId}", () => {
      __setInjectReturn("my-app");
      useStorage("view", {});
      const keys = Object.keys(localStorage);
      // The key is read via localStorage.getItem — check inject was called correctly
      expect(inject).toHaveBeenCalledWith("onrteAppId", "app");
    });

    it("reads from the correct key: onrte_{namespace}_{id}", () => {
      __setInjectReturn("app");
      const data = { mapView: { center: { lat: 51.5, lng: -0.1 }, zoom: 10 } };
      localStorage.setItem("onrte_view_app", JSON.stringify(data));

      const state = useStorage("view", { mapView: null });
      expect(state.mapView).toEqual(data.mapView);
    });

    it("uses default instanceId 'app' when no onrteAppId is provided", () => {
      __setInjectReturn("app");
      const data = { value: 42 };
      localStorage.setItem("onrte_test_app", JSON.stringify(data));

      const state = useStorage("test", { value: 0 });
      expect(state.value).toBe(42);
    });

    it("scopes keys by instance id — different ids produce different keys", () => {
      __setInjectReturn("map-a");
      localStorage.setItem("onrte_view_map-a", JSON.stringify({ zoom: 10 }));
      localStorage.setItem("onrte_view_map-b", JSON.stringify({ zoom: 5 }));

      const stateA = useStorage("view", { zoom: 1 });
      expect(stateA.zoom).toBe(10);

      __setInjectReturn("map-b");
      const stateB = useStorage("view", { zoom: 1 });
      expect(stateB.zoom).toBe(5);
    });
  });

  describe("reading from localStorage", () => {
    it("returns default state when localStorage is empty", () => {
      const state = useStorage("prefs", { theme: "light", units: "metric" });
      expect(state.theme).toBe("light");
      expect(state.units).toBe("metric");
    });

    it("merges stored values over defaults", () => {
      localStorage.setItem(
        "onrte_prefs_app",
        JSON.stringify({ theme: "dark" }),
      );
      const state = useStorage("prefs", { theme: "light", units: "metric" });
      expect(state.theme).toBe("dark");
      expect(state.units).toBe("metric");
    });

    it("handles corrupted JSON gracefully", () => {
      localStorage.setItem("onrte_bad_app", "not-json!!!");
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const state = useStorage("bad", { val: 1 });
      expect(state.val).toBe(1);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("writing to localStorage", () => {
    it("sets up a deep watcher on the state", () => {
      useStorage("w", { a: 1 });
      expect(watch).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Function),
        { deep: true },
      );
    });

    it("watcher callback persists state to localStorage", () => {
      __setInjectReturn("app");
      useStorage("data", { count: 0 });

      // Extract the watcher callback and invoke it
      const [, callback] = watch.mock.calls[0];
      callback({ count: 5 });

      const stored = JSON.parse(localStorage.getItem("onrte_data_app"));
      expect(stored.count).toBe(5);
    });
  });

  describe("array default state", () => {
    it("returns a reactive array where push and length work", () => {
      const regions = useStorage("offline-regions", []);
      expect(Array.isArray(regions)).toBe(true);
      expect(regions.length).toBe(0);

      regions.push({ id: 1, name: "Region 1" });
      expect(regions.length).toBe(1);
      expect(regions[0].id).toBe(1);
    });

    it("persists array mutations to localStorage", () => {
      useStorage("offline-regions", []);

      const [, callback] = watch.mock.calls[0];
      callback([{ id: 1, name: "Region 1" }]);

      const stored = JSON.parse(
        localStorage.getItem("onrte_offline-regions_app"),
      );
      expect(Array.isArray(stored)).toBe(true);
      expect(stored).toEqual([{ id: 1, name: "Region 1" }]);
    });
  });
});
