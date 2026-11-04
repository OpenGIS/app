import { computed, inject } from "vue";
import { usePersistedState } from "@/resilience/persistedState";
import { hydrateWelcome } from "@/resilience/hydrators/welcome";

const cache = new Map();

/**
 * One-time welcome card state for one instance.
 *
 * `showWelcome` is true until the visitor dismisses the card; dismissal is
 * persisted so the card never returns on this device.
 *
 * @param {string} [instanceId]
 * @returns {{ showWelcome: import('vue').ComputedRef<boolean>, dismissWelcome: Function }}
 */
export function useWelcome(instanceId) {
  const id = instanceId ?? inject("ogisAppId", "app");

  if (!cache.has(id)) {
    const store = usePersistedState(
      "welcome",
      {
        version: 1,
        defaults: { seen: false },
        hydrate: hydrateWelcome,
      },
      id,
    );
    cache.set(id, store);
  }

  const { state, flush } = cache.get(id);

  const showWelcome = computed(() => !state.seen);

  const dismissWelcome = () => {
    state.seen = true;
    flush();
  };

  return { showWelcome, dismissWelcome };
}
