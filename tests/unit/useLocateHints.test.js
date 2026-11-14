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

  it("selects the heading key only while Following awaits a compass", () => {
    expect(hintKeyForMode("following", { headingPending: true })).toBe(
      "heading",
    );
    expect(hintKeyForMode("following", { headingPending: false })).toBe(
      "following",
    );
    expect(hintKeyForMode("active", { headingPending: true })).toBe("active");
    expect(hintKeyForMode(null, { headingPending: true })).toBe("idle");
    expect(hintKeyForMode("error", { headingPending: true })).toBeNull();
  });

  it("suppresses the Located hint on an incapable device", () => {
    // An incapable device keeps a plain Located state with no hint.
    expect(hintKeyForMode("active", { canFollow: false })).toBeNull();
    // Unknown and capable capability keeps the ordinary active copy.
    expect(hintKeyForMode("active", { canFollow: true })).toBe("active");
    expect(hintKeyForMode("active")).toBe("active");
    // Following cannot occur on an incapable device, so it is never relabelled.
    expect(hintKeyForMode("following", { canFollow: false })).toBe("following");
    expect(hintKeyForMode(null, { canFollow: false })).toBe("idle");
    expect(hintKeyForMode("error", { canFollow: false })).toBeNull();
    // The suppression still yields to the fix gate.
    expect(
      hintKeyForMode("active", { canFollow: false, hasFix: false }),
    ).toBeNull();
  });

  it("suppresses active and following hints until a fix exists", () => {
    expect(hintKeyForMode("active", { hasFix: false })).toBeNull();
    expect(hintKeyForMode("following", { hasFix: false })).toBeNull();
    // The fix gate wins over the heading hint.
    expect(
      hintKeyForMode("following", { headingPending: true, hasFix: false }),
    ).toBeNull();
    expect(
      hintKeyForMode("following", { headingPending: true, hasFix: true }),
    ).toBe("heading");
    // Idle is unaffected: it explains the inactive chip, not a position.
    expect(hintKeyForMode(null, { hasFix: false })).toBe("idle");
  });

  it("suppresses every hint while an orientation prompt is outstanding", () => {
    expect(hintKeyForMode("active", { orientationPending: true })).toBeNull();
    expect(
      hintKeyForMode("following", { orientationPending: true }),
    ).toBeNull();
    expect(
      hintKeyForMode("following", {
        headingPending: true,
        orientationPending: true,
      }),
    ).toBeNull();
    expect(hintKeyForMode(null, { orientationPending: true })).toBeNull();
    expect(hintKeyForMode(undefined, { orientationPending: true })).toBeNull();
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

  it("keeps a seen heading key while filtering and de-duplicating", () => {
    expect(
      hydrateLocateHints({ seen: ["heading", "bogus", "heading", "idle"] }),
    ).toEqual({ seen: ["heading", "idle"] });
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

  it("waits for a fix before showing the active hint", () => {
    const hints = useLocateHints(ID);

    hints.showFor("active", { hasFix: false });
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS * 2);
    expect(hints.current.value).toBeNull();
    expect(hints.isSeen("active")).toBe(false);

    hints.showFor("active", { hasFix: true });
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBe("active");
    expect(hints.isSeen("active")).toBe(true);
  });

  it("shows no hint in Located on an incapable device", () => {
    const hints = useLocateHints(ID);
    hints.showFor("active", { canFollow: false });

    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS * 2);
    expect(hints.current.value).toBeNull();
    expect(hints.isSeen("active")).toBe(false);
  });

  it("dismisses a visible active hint when capability settles incapable", async () => {
    const hints = useLocateHints(ID);

    // Unknown is optimistic: the ordinary active hint shows first.
    hints.showFor("active", { canFollow: true });
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBe("active");

    // The probe then settles incapable while Located: the visible hint is
    // dismissed and no hint key is recorded for a no-compass state.
    hints.showFor("active", { canFollow: false });
    expect(hints.current.value).toBeNull();

    await vi.runAllTimersAsync();
    expect(hints.current.value).toBeNull();
    expect(hints.isSeen("active")).toBe(true);

    const raw = JSON.parse(localStorage.getItem(`ogis_locate-hints_${ID}`));
    expect(raw.data.seen).toEqual(["active"]);
  });

  it("dismisses a visible following hint when a late downgrade leaves Located incapable", async () => {
    const hints = useLocateHints(ID);

    // Capability is optimistic while unknown, so Following shows its hint.
    hints.showFor("following", { canFollow: true });
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBe("following");
    expect(hints.isSeen("following")).toBe(true);

    // A late probe leaves Following for Located with capability incapable in
    // the same flush: the watcher sees `active` + `canFollow: false`, so it
    // dismisses rather than replacing the hint with the Located one.
    hints.showFor("active", { canFollow: false });
    expect(hints.current.value).toBeNull();

    await vi.runAllTimersAsync();
    expect(hints.current.value).toBeNull();
    expect(hints.isSeen("active")).toBe(false);
  });

  it("leaves a visible idle hint alone when capability settles", () => {
    const hints = useLocateHints(ID);
    hints.showFor(null, { boot: true });
    vi.advanceTimersByTime(LOCATE_HINT_BOOT_DELAY_MS);
    expect(hints.current.value).toBe("idle");

    // The probe settles while the chip is still idle: the same idle hint
    // stays readable instead of being cleared by the capability change.
    hints.showFor(null, { canFollow: false });
    expect(hints.current.value).toBe("idle");
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

  it("shows the heading hint while Following awaits a compass", () => {
    const hints = useLocateHints(ID);
    hints.showFor("following", { headingPending: true });

    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBe("heading");
    expect(hints.isSeen("heading")).toBe(false);
    expect(hints.isSeen("following")).toBe(false);

    // Persistent: there is no hide timer, so it outlives the normal duration.
    vi.advanceTimersByTime(LOCATE_HINT_DURATION_MS + 1);
    expect(hints.current.value).toBe("heading");
  });

  it("keeps the heading hint until dismissed and shows it again", () => {
    const hints = useLocateHints(ID);
    hints.showFor("following", { headingPending: true });
    vi.advanceTimersByTime(
      LOCATE_HINT_CHANGE_DELAY_MS + LOCATE_HINT_DURATION_MS + 1,
    );
    expect(hints.current.value).toBe("heading");
    expect(hints.isSeen("heading")).toBe(false);

    hints.dismiss();
    expect(hints.current.value).toBeNull();

    // Not once-only: the next pending state shows it again.
    hints.showFor("following", { headingPending: true });
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBe("heading");
    expect(hints.isSeen("heading")).toBe(false);
  });

  it("replaces the heading hint once the compass is available", () => {
    const hints = useLocateHints(ID);
    hints.showFor("following", { headingPending: true });
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBe("heading");

    // The pending state ends: the heading hint goes at once and the ordinary
    // following hint takes over after the state-change delay.
    hints.showFor("following", { headingPending: false });
    expect(hints.current.value).toBeNull();
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBe("following");
    expect(hints.isSeen("heading")).toBe(false);
  });

  it("ignores the heading flag outside Following", () => {
    const hints = useLocateHints(ID);
    hints.showFor("active", { headingPending: true });
    vi.advanceTimersByTime(LOCATE_HINT_CHANGE_DELAY_MS);
    expect(hints.current.value).toBe("active");
    expect(hints.isSeen("heading")).toBe(false);
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
