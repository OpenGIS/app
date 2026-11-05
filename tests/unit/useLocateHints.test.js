import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPersistedStateForTests } from "@/resilience/persistedState";
import {
  LOCATE_HINT_BOOT_DELAY_MS,
  LOCATE_HINT_CHANGE_DELAY_MS,
  LOCATE_HINT_DURATION_MS,
  __resetLocateHintsForTests,
  hintKeyForMode,
  hydrateLocateHints,
  useLocateHints,
} from "@/composables/useLocateHints";

const ID = "hints-test";

describe("hintKeyForMode", () => {
  it("maps locate modes to hint keys", () => {
    expect(hintKeyForMode(null)).toBe("idle");
    expect(hintKeyForMode(undefined)).toBe("idle");
    expect(hintKeyForMode("active")).toBe("active");
    expect(hintKeyForMode("following")).toBe("following");
    expect(hintKeyForMode("error")).toBeNull();
  });

  it("gives the 3D tip when follow stops", () => {
    expect(hintKeyForMode(null, "following")).toBe("tilt");
    expect(hintKeyForMode(null, "active")).toBe("idle");
    expect(hintKeyForMode("active", "following")).toBe("active");
  });
});

describe("hydrateLocateHints", () => {
  it("keeps only known, unique keys", () => {
    expect(
      hydrateLocateHints({ seen: ["idle", "bogus", "idle", "following"] }),
    ).toEqual({ seen: ["idle", "following"] });
  });

  it("recovers from malformed data", () => {
    expect(hydrateLocateHints(null)).toEqual({ seen: [] });
    expect(hydrateLocateHints({ seen: "idle" })).toEqual({ seen: [] });
  });
});

describe("useLocateHints", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetLocateHintsForTests();
    __resetPersistedStateForTests();
    localStorage.clear();
    delete window.__ogisDisableHints;
    document.body.innerHTML = "";
  });

  afterEach(() => {
    __resetLocateHintsForTests();
    __resetPersistedStateForTests();
    vi.useRealTimers();
  });

  it("shows the boot hint after the boot delay and marks it seen", () => {
    const hints = useLocateHints(ID);
    hints.showFor(null, { boot: true });

    vi.advanceTimersByTime(LOCATE_HINT_BOOT_DELAY_MS - 1);
    expect(hints.current.value).toBeNull();

    vi.advanceTimersByTime(1);
    expect(hints.current.value).toBe("idle");
    expect(hints.isSeen("idle")).toBe(true);
  });

  it("shows the 3D tip after follow stops and keeps it up", () => {
    const hints = useLocateHints(ID);
    hints.showFor(null, { previous: "following" });
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBe("tilt");
    expect(hints.isSeen("tilt")).toBe(true);

    vi.advanceTimersByTime(LOCATE_HINT_DURATION_MS * 10);
    expect(hints.current.value).toBe("tilt");

    hints.dismiss();
    hints.showFor(null, { previous: "following" });
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBeNull();
  });

  it("hides on its own after the display duration", () => {
    const hints = useLocateHints(ID);
    hints.showFor("active");
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBe("active");

    vi.advanceTimersByTime(LOCATE_HINT_DURATION_MS);
    expect(hints.current.value).toBeNull();
  });

  it("shows each hint only once", () => {
    const hints = useLocateHints(ID);
    hints.showFor("following");
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    hints.dismiss();

    hints.showFor("following");
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBeNull();
  });

  it("skips a state the chip only passes through", () => {
    const hints = useLocateHints(ID);
    hints.showFor("active");
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS - 1);
    hints.showFor("following");
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);

    expect(hints.current.value).toBe("following");
    expect(hints.isSeen("active")).toBe(false);
  });

  it("has no hint for the error state", () => {
    const hints = useLocateHints(ID);
    hints.showFor("error");
    vi.advanceTimersByTime(LOCATE_HINT_BOOT_DELAY_MS * 2);
    expect(hints.current.value).toBeNull();
  });

  it("waits for an open modal to close", () => {
    document.body.innerHTML = '<div class="modal show"></div>';
    const hints = useLocateHints(ID);
    hints.showFor("active");
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS + 3000);
    expect(hints.current.value).toBeNull();
    expect(hints.isSeen("active")).toBe(false);

    document.body.innerHTML = "";
    vi.advanceTimersByTime(1000);
    expect(hints.current.value).toBe("active");
  });

  it("stays silent when hints are disabled", () => {
    window.__ogisDisableHints = true;
    const hints = useLocateHints(ID);
    hints.showFor(null, { boot: true });
    vi.advanceTimersByTime(LOCATE_HINT_BOOT_DELAY_MS * 2);
    expect(hints.current.value).toBeNull();
  });

  it("remembers seen hints across reloads", async () => {
    const hints = useLocateHints(ID);
    hints.showFor("active");
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    await vi.runAllTimersAsync();

    const raw = JSON.parse(localStorage.getItem(`ogis_locate-hints_${ID}`));
    expect(raw.data.seen).toEqual(["active"]);

    __resetLocateHintsForTests();
    __resetPersistedStateForTests();
    expect(useLocateHints(ID).isSeen("active")).toBe(true);
  });

  it("reset plays every hint again", () => {
    const hints = useLocateHints(ID);
    hints.showFor("active");
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    hints.reset();
    expect(hints.current.value).toBeNull();
    expect(hints.isSeen("active")).toBe(false);
  });
});
