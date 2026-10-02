import { computed, inject, ref } from "vue";
import { useAuthSession } from "@/composables/auth/useAuthSession";
import { useSyncStore } from "@/stores/syncStore";

export function useResourceSync(instanceId) {
  const id = instanceId ?? inject("ogisAppId", "app");
  const auth = useAuthSession(id);
  const syncStore = useSyncStore(id);
  const processing = ref(false);

  const canProcess = computed(
    () => auth.isAuthenticated.value && syncStore.queue.value.length > 0,
  );

  const processQueue = async (processOperation) => {
    if (typeof processOperation !== "function") {
      throw new Error("processQueue requires a processOperation callback.");
    }

    if (processing.value) {
      return { processed: 0, stopped: true, reason: "already-processing" };
    }

    if (!auth.isAuthenticated.value) {
      return { processed: 0, stopped: true, reason: "unauthenticated" };
    }

    processing.value = true;
    let processed = 0;

    try {
      const items = [...syncStore.queue.value];

      for (const item of items) {
        syncStore.markProcessing(item.id);

        try {
          await processOperation(item);
          syncStore.markDone(item.id);
          processed += 1;
        } catch (error) {
          const status = error?.response?.status;

          if (status === 401) {
            syncStore.markPending(item.id);
            auth.clearSession();
            return { processed, stopped: true, reason: "unauthenticated" };
          }

          if (status === 422) {
            syncStore.markFailed(item.id, error);
            continue;
          }

          syncStore.markPending(item.id);
          return { processed, stopped: true, reason: "retryable-error" };
        }
      }

      return { processed, stopped: false, reason: null };
    } finally {
      processing.value = false;
    }
  };

  return {
    queue: syncStore.queue,
    failed: syncStore.failed,
    pendingCount: syncStore.pendingCount,
    failedCount: syncStore.failedCount,
    processing,
    canProcess,
    enqueue: syncStore.enqueue,
    clearFailed: syncStore.clearFailed,
    reset: syncStore.reset,
    processQueue,
  };
}
