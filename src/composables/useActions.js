import { computed, inject, markRaw, reactive } from "vue";
import { getMapInstance } from "@/composables/useMap";
import { useOrientView } from "@/composables/useOrientView";
import { useUI } from "@/composables/useUI";

// Per-instance cache: instanceId -> action registry
const actionsCache = new Map();

/**
 * Composable for the per-instance action and map-mode registry.
 *
 * Modes own the camera; actions declare what they need. A sustained mode
 * registers an `active` flag and a synchronous, idempotent `stop`. Before an
 * action moves the camera it claims the map, which stops every other active
 * mode as a hand-off: the outgoing mode releases suppression without
 * persisting, so the incoming action's camera move is the one that persists.
 *
 * Actions are plain descriptors (`needsMap`, `dismissPanel`, `requires`,
 * `except`, `run`). `perform` resolves the map first, then evaluates
 * preconditions, claims the map, dismisses the panel and runs — in that order.
 *
 * State is cached per app instance and shared across all callers.
 *
 * @param {string} [explicitInstanceId] - App instance ID; resolved via
 *   `inject('ogisAppId')` when omitted.
 * @returns {{
 *   registerMode: (id: string, mode: { active: import('vue').Ref<boolean>, stop: Function }) => Function,
 *   activeModes: import('vue').ComputedRef<string[]>,
 *   claimMap: (options?: { except?: string }) => void,
 *   dismissPanel: () => void,
 *   perform: (action: Object, payload?: any) => boolean,
 *   dispose: () => void,
 * }} The registry is shared by every caller on the instance. `dispose()` is
 *   terminal teardown for one instance and must not be called by a feature.
 */
export const useActions = (explicitInstanceId) => {
  const instanceId = explicitInstanceId ?? inject("ogisAppId", "app");

  if (!actionsCache.has(instanceId)) {
    try {
      const ui = useUI(instanceId);
      const { orientView } = useOrientView(instanceId);
      const modes = reactive(new Map());

      /**
       * Register a sustained map mode.
       *
       * Registering the same id replaces the existing registration in place.
       * The returned unregister function only removes the registration if the
       * currently registered mode is the same object.
       *
       * @param {string} id - Stable mode identifier.
       * @param {{ active: import('vue').Ref<boolean>, stop: Function }} mode
       * @returns {Function} Unregister function.
       */
      const registerMode = (id, mode) => {
        const entry = markRaw({ id, ...mode });
        modes.set(id, entry);

        return () => {
          if (modes.get(id) === entry) modes.delete(id);
        };
      };

      /** IDs of the modes whose `active` flag is true, in registration order. */
      const activeModes = computed(() =>
        [...modes.values()]
          .filter((mode) => mode.active?.value)
          .map((mode) => mode.id),
      );

      /**
       * Hand the camera to an incoming action by stopping every active mode,
       * except the one named by `except`. Each stop is a hand-off: the mode
       * releases camera suppression without persisting its final pose.
       *
       * @param {{ except?: string }} [options]
       */
      const claimMap = ({ except } = {}) => {
        for (const mode of [...modes.values()]) {
          if (mode.id === except) continue;
          if (mode.active?.value) mode.stop({ handoff: true });
        }
      };

      /** Close the side pane on compact layouts; a no-op on desktop. */
      const dismissPanel = () => {
        if (!ui.isDesktop.value) ui.closePanel();
      };

      /**
       * Run an action descriptor against this instance.
       *
       * @param {Object} action - Action descriptor.
       * @param {boolean} [action.needsMap] - Require a resolved map.
       * @param {boolean} [action.dismissPanel] - Close the side pane first.
       * @param {Function} [action.requires] - Precondition; returning false
       *   aborts before any mode is stopped or the UI changes.
       * @param {string} [action.except] - Mode id to leave running when claiming.
       * @param {Function} action.run - Receives `{ map, instanceId, orientView }`
       *   and `payload`.
       * @param {any} [payload] - Passed through to `action.run`.
       * @returns {boolean} Whether the action ran.
       */
      const perform = (action, payload) => {
        const map = getMapInstance(instanceId);

        if (action.needsMap && !map) return false;

        const context = { map, instanceId, orientView };
        if (action.requires && !action.requires(context)) return false;

        if (action.needsMap) claimMap({ except: action.except });
        if (action.dismissPanel) dismissPanel();

        action.run(context, payload);
        return true;
      };

      let registry = null;

      /** Terminal teardown for one instance; never called by a feature. */
      const dispose = () => {
        if (registry && actionsCache.get(instanceId) === registry) {
          actionsCache.delete(instanceId);
        }
      };

      registry = {
        registerMode,
        activeModes,
        claimMap,
        dismissPanel,
        perform,
        dispose,
      };

      actionsCache.set(instanceId, registry);
    } catch (error) {
      actionsCache.delete(instanceId);
      throw error;
    }
  }

  return actionsCache.get(instanceId);
};
