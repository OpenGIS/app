import { inject, ref } from "vue";
import { usePersistedState } from "@/resilience/persistedState";

/**
 * Onboarding hints for the top-right locate chip.
 *
 * The chip cycles Locate → Located → Following → stopped, and nothing on it
 * says what the next tap will do. This composable owns a short, once-only
 * explanation per chip state: the first time the chip sits in a state, a
 * small bubble under it explains that state and the next tap. Each hint is
 * remembered as seen (`ogis_locate-hints_{instanceId}`), so a returning user
 * never sees it again.
 *
 * Hints never cover a dialog: while a modal is open (the locate permission
 * prompt, a welcome card, …) the pending hint waits until it closes.
 *
 * E2E runs set `window.__ogisDisableHints = true` before boot so the bubble
 * stays out of functional assertions and the screenshot matrix. The hint spec
 * may set `window.__ogisHintDurationMs` to hold a hint up on slow renderers.
 */

/** Chip states that carry a hint, in the order a user meets them. */
export const LOCATE_HINT_KEYS = ["idle", "active", "following", "tilt"];

/**
 * Hints that stay up until the user closes them: the 3D-map tip has gestures
 * to read and try, so it doesn't fade on its own.
 */
export const LOCATE_HINT_STICKY_KEYS = ["tilt"];

/** How long a hint stays up before it fades on its own. */
export const LOCATE_HINT_DURATION_MS = 8000;

/** Delay before the first (idle) hint, so it doesn't race the map's boot. */
export const LOCATE_HINT_BOOT_DELAY_MS = 1500;

/** Delay before a state-change hint; skips states the chip only passes through. */
export const LOCATE_HINT_CHANGE_DELAY_MS = 400;

/** How often a pending hint re-checks whether a modal has closed. */
const MODAL_RETRY_MS = 750;

/**
 * Map a locate mode to its hint key.
 *
 * Stopping follow (back to idle) is the last step of the sequence: the map
 * has just tilted and turned by itself, so the "tilt" tip explains how to do
 * that by hand.
 *
 * @param {'active'|'following'|'error'|null} mode
 * @param {'active'|'following'|'error'|null} [previous] - The mode before this one.
 * @returns {'idle'|'active'|'following'|'tilt'|null}
 */
export const hintKeyForMode = (mode, previous = null) => {
  if (mode === null || mode === undefined) {
    return previous === "following" ? "tilt" : "idle";
  }
  if (mode === "active" || mode === "following") return mode;
  return null; // 'error' has its own modal
};

/**
 * Keep only known hint keys, de-duplicated.
 *
 * @param {*} data - Stored data.
 * @returns {{ seen: string[] }}
 */
export const hydrateLocateHints = (data) => {
  const seen = Array.isArray(data?.seen) ? data.seen : [];
  return {
    seen: [...new Set(seen.filter((key) => LOCATE_HINT_KEYS.includes(key)))],
  };
};

const isDisabled = () =>
  typeof window !== "undefined" && window.__ogisDisableHints === true;

const hintDuration = () => {
  const override =
    typeof window !== "undefined" ? window.__ogisHintDurationMs : undefined;
  return Number.isFinite(override) && override > 0
    ? override
    : LOCATE_HINT_DURATION_MS;
};

const isModalOpen = () =>
  typeof document !== "undefined" &&
  document.querySelector('.modal.show, [role="dialog"][aria-modal="true"]') !==
    null;

// Per-instance cache: instanceId -> hint state
const cache = new Map();

const createHints = (instanceId) => {
  const store = usePersistedState(
    "locate-hints",
    {
      version: 1,
      storage: "local",
      defaults: { seen: [] },
      hydrate: hydrateLocateHints,
    },
    instanceId,
  );

  const current = ref(null); // the hint on screen: 'idle'|'active'|'following'|'tilt'|null
  let pendingTimer = null;
  let hideTimer = null;

  const clearTimers = () => {
    clearTimeout(pendingTimer);
    clearTimeout(hideTimer);
    pendingTimer = null;
    hideTimer = null;
  };

  const isSeen = (key) => store.state.seen.includes(key);

  const markSeen = (key) => {
    if (!isSeen(key)) store.state.seen = [...store.state.seen, key];
  };

  /** Hide the visible hint and cancel any pending one. */
  const dismiss = () => {
    clearTimers();
    current.value = null;
  };

  /**
   * Show the hint for a locate mode, once, after a short delay.
   *
   * @param {'active'|'following'|'error'|null} mode
   * @param {{ boot?: boolean, previous?: string|null }} [options] - `boot`
   *   uses the longer first delay; `previous` is the mode being left.
   */
  const showFor = (mode, { boot = false, previous = null } = {}) => {
    dismiss();
    const key = hintKeyForMode(mode, previous);
    if (!key || isDisabled() || isSeen(key)) return;

    const attempt = () => {
      if (isModalOpen()) {
        pendingTimer = setTimeout(attempt, MODAL_RETRY_MS);
        return;
      }
      pendingTimer = null;
      current.value = key;
      markSeen(key);
      if (!LOCATE_HINT_STICKY_KEYS.includes(key)) {
        hideTimer = setTimeout(dismiss, hintDuration());
      }
    };

    pendingTimer = setTimeout(
      attempt,
      boot ? LOCATE_HINT_BOOT_DELAY_MS : LOCATE_HINT_CHANGE_DELAY_MS,
    );
  };

  /** Forget every seen hint, so the explanations play again. */
  const reset = () => {
    dismiss();
    store.state.seen = [];
  };

  return { current, showFor, dismiss, isSeen, reset };
};

/**
 * @returns {{ current: import('vue').Ref<'idle'|'active'|'following'|'tilt'|null>, showFor: Function, dismiss: Function, isSeen: Function, reset: Function }}
 */
export const useLocateHints = (explicitInstanceId) => {
  const instanceId = explicitInstanceId ?? inject("ogisAppId", "app");
  if (!cache.has(instanceId)) cache.set(instanceId, createHints(instanceId));
  return cache.get(instanceId);
};

/** Test-only: drop cached instances (timers included). */
export const __resetLocateHintsForTests = () => {
  for (const hints of cache.values()) hints.dismiss();
  cache.clear();
};
