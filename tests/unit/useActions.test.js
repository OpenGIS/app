import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/composables/useMap.js", () => ({
  getMapInstance: vi.fn(),
}));

vi.mock("@/composables/useUI.js", () => ({
  useUI: vi.fn(),
}));

import { ref } from "vue";
import { getMapInstance } from "@/composables/useMap.js";
import { useUI } from "@/composables/useUI.js";
import { useActions } from "@/composables/useActions.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// The registry is cached per instance for the app lifetime, so each test gets
// its own instance id rather than resetting the module.
let instanceSeq = 0;
const nextInstanceId = () => `actions-test-${instanceSeq++}`;

const activeMode = () => ({ active: ref(true), stop: vi.fn() });
const inactiveMode = () => ({ active: ref(false), stop: vi.fn() });

const createUI = ({ desktop = false } = {}) => ({
  isDesktop: ref(desktop),
  closePanel: vi.fn(),
});

let map;
let ui;

beforeEach(() => {
  vi.resetAllMocks();

  map = { id: "map" };
  getMapInstance.mockReturnValue(map);

  ui = createUI();
  useUI.mockReturnValue(ui);
});

// ─── Mode registry ───────────────────────────────────────────────────────────

describe("useActions / mode registry", () => {
  it("lists active modes in registration order and excludes inactive ones", () => {
    const actions = useActions(nextInstanceId());

    actions.registerMode("follow", activeMode());
    actions.registerMode("measure", inactiveMode());
    actions.registerMode("record", activeMode());

    expect(actions.activeModes.value).toEqual(["follow", "record"]);
  });

  it("replaces a same-id mode in place without changing registration order", () => {
    const actions = useActions(nextInstanceId());
    const first = activeMode();
    actions.registerMode("follow", first);
    actions.registerMode("record", activeMode());

    const replacement = activeMode();
    actions.registerMode("follow", replacement);

    expect(actions.activeModes.value).toEqual(["follow", "record"]);

    // The replacement, not the superseded registration, is the live mode.
    actions.claimMap();
    expect(replacement.stop).toHaveBeenCalledWith({ handoff: true });
    expect(first.stop).not.toHaveBeenCalled();
  });

  it("an old unregister cannot remove a same-id replacement", () => {
    const actions = useActions(nextInstanceId());
    const unregisterFirst = actions.registerMode("follow", activeMode());
    actions.registerMode("follow", activeMode());

    unregisterFirst();

    expect(actions.activeModes.value).toEqual(["follow"]);
  });

  it("unregister removes only its own registration", () => {
    const actions = useActions(nextInstanceId());
    const unregisterFollow = actions.registerMode("follow", activeMode());
    actions.registerMode("record", activeMode());

    unregisterFollow();

    expect(actions.activeModes.value).toEqual(["record"]);
  });

  it("tracks modes registered after the first evaluation", () => {
    const actions = useActions(nextInstanceId());
    const follow = activeMode();
    actions.registerMode("follow", follow);

    // The computed is evaluated before any later registration happens.
    expect(actions.activeModes.value).toEqual(["follow"]);

    const late = inactiveMode();
    const unregisterLate = actions.registerMode("record", late);
    expect(actions.activeModes.value).toEqual(["follow"]);

    // The late mode's flag must be tracked, not missed by the cached computed.
    late.active.value = true;
    expect(actions.activeModes.value).toEqual(["follow", "record"]);

    // The existing mode still updates after the late registration.
    follow.active.value = false;
    expect(actions.activeModes.value).toEqual(["record"]);
    follow.active.value = true;
    expect(actions.activeModes.value).toEqual(["follow", "record"]);

    // Unregistering an active mode removes it from the computed set.
    unregisterLate();
    expect(actions.activeModes.value).toEqual(["follow"]);

    // A stale flag on the removed mode cannot resurrect it.
    late.active.value = false;
    late.active.value = true;
    expect(actions.activeModes.value).toEqual(["follow"]);
  });
});

// ─── Claiming the map ────────────────────────────────────────────────────────

describe("useActions / claimMap", () => {
  it("stops every active mode with exactly the hand-off flag", () => {
    const actions = useActions(nextInstanceId());
    const follow = activeMode();
    const measure = inactiveMode();
    const record = activeMode();
    actions.registerMode("follow", follow);
    actions.registerMode("measure", measure);
    actions.registerMode("record", record);

    actions.claimMap();

    expect(follow.stop).toHaveBeenCalledTimes(1);
    expect(follow.stop.mock.calls[0]).toEqual([{ handoff: true }]);
    expect(measure.stop).not.toHaveBeenCalled();
    expect(record.stop).toHaveBeenCalledTimes(1);
    expect(record.stop.mock.calls[0]).toEqual([{ handoff: true }]);
  });

  it("leaves the excepted mode running", () => {
    const actions = useActions(nextInstanceId());
    const follow = activeMode();
    const record = activeMode();
    actions.registerMode("follow", follow);
    actions.registerMode("record", record);

    actions.claimMap({ except: "follow" });

    expect(follow.stop).not.toHaveBeenCalled();
    expect(record.stop).toHaveBeenCalledWith({ handoff: true });
  });
});

// ─── Disposal ───────────────────────────────────────────────────────────────

describe("useActions / disposal", () => {
  it("dispose drops only this instance's cached registry", () => {
    const id = nextInstanceId();
    const first = useActions(id);
    first.registerMode("follow", activeMode());

    first.dispose();

    const second = useActions(id);
    expect(second).not.toBe(first);
    expect(second.activeModes.value).toEqual([]);
  });

  it("does not cache a registry when creation throws", () => {
    const id = nextInstanceId();
    useUI.mockImplementationOnce(() => {
      throw new Error("ui boom");
    });

    expect(() => useActions(id)).toThrow("ui boom");

    // The failed creation left no poisoned cache entry.
    const actions = useActions(id);
    expect(actions.registerMode).toBeTypeOf("function");
  });
});

// ─── Performing an action ────────────────────────────────────────────────────

describe("useActions / perform", () => {
  it("claims the map before running the action and passes the context through", () => {
    const id = nextInstanceId();
    const actions = useActions(id);
    const order = [];

    const follow = activeMode();
    follow.stop.mockImplementation(() => order.push("stop:follow"));
    const record = activeMode();
    record.stop.mockImplementation(() => order.push("stop:record"));
    actions.registerMode("follow", follow);
    actions.registerMode("record", record);

    const payload = { source: "test" };
    const run = vi.fn(() => order.push("run"));

    const result = actions.perform({ needsMap: true, run }, payload);

    expect(result).toBe(true);
    expect(order).toEqual(["stop:follow", "stop:record", "run"]);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        map,
        instanceId: id,
        orientView: expect.any(Function),
      }),
      payload,
    );
  });

  it("returns false without claiming or dismissing when the map is missing", () => {
    const actions = useActions(nextInstanceId());
    const follow = activeMode();
    actions.registerMode("follow", follow);
    getMapInstance.mockReturnValue(null);
    const run = vi.fn();

    const result = actions.perform({ needsMap: true, dismissPanel: true, run });

    expect(result).toBe(false);
    expect(follow.stop).not.toHaveBeenCalled();
    expect(ui.closePanel).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("aborts before claiming or dismissing when requires returns false", () => {
    const id = nextInstanceId();
    const actions = useActions(id);
    const follow = activeMode();
    actions.registerMode("follow", follow);
    const requires = vi.fn(() => false);
    const run = vi.fn();

    const result = actions.perform({
      needsMap: true,
      dismissPanel: true,
      requires,
      run,
    });

    expect(result).toBe(false);
    expect(requires).toHaveBeenCalledWith(
      expect.objectContaining({
        map,
        instanceId: id,
        orientView: expect.any(Function),
      }),
    );
    expect(follow.stop).not.toHaveBeenCalled();
    expect(ui.closePanel).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    [false, 1],
    [true, 0],
  ])(
    "dismisses the pane only on compact layouts (desktop=%s)",
    (desktop, expectedCalls) => {
      const closePanel = vi.fn();
      useUI.mockReturnValueOnce({ isDesktop: ref(desktop), closePanel });
      const actions = useActions(nextInstanceId());
      const run = vi.fn();

      const result = actions.perform({ dismissPanel: true, run });

      expect(result).toBe(true);
      expect(closePanel).toHaveBeenCalledTimes(expectedCalls);
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it("leaves active modes alone when the action does not need the map", () => {
    const id = nextInstanceId();
    const actions = useActions(id);
    const follow = activeMode();
    actions.registerMode("follow", follow);
    const run = vi.fn();

    const result = actions.perform({ run });

    expect(result).toBe(true);
    expect(follow.stop).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        map,
        instanceId: id,
        orientView: expect.any(Function),
      }),
      undefined,
    );
  });
});
