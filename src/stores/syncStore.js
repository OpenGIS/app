import { computed, inject } from "vue";
import { useStorage } from "@/composables/useStorage";

const cache = new Map();

function nextId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useSyncStore(instanceId) {
  const id = instanceId ?? inject("ogisAppId", "app");

  if (!cache.has(id)) {
    cache.set(id, {
      state: useStorage("sync", { queue: [], failed: [] }, id),
    });
  }

  const { state } = cache.get(id);

  const queue = computed(() => state.queue);
  const failed = computed(() => state.failed);
  const pendingCount = computed(
    () => state.queue.filter((item) => item.status === "pending").length,
  );
  const failedCount = computed(() => state.failed.length);

  const enqueue = (operation) => {
    const item = {
      id: nextId(),
      status: "pending",
      attempts: 0,
      resource: operation.resource,
      action: operation.action,
      resourceId: operation.resourceId ?? null,
      payload: operation.payload ?? null,
      createdAt: new Date().toISOString(),
      lastError: null,
    };

    state.queue.push(item);
    return item;
  };

  const markProcessing = (idToMark) => {
    const item = state.queue.find(({ id: itemId }) => itemId === idToMark);
    if (!item) return;

    item.status = "processing";
    item.attempts += 1;
  };

  const markPending = (idToMark) => {
    const item = state.queue.find(({ id: itemId }) => itemId === idToMark);
    if (!item) return;
    item.status = "pending";
  };

  const markDone = (idToMark) => {
    state.queue = state.queue.filter(({ id: itemId }) => itemId !== idToMark);
    state.failed = state.failed.filter(({ id: itemId }) => itemId !== idToMark);
  };

  const markFailed = (idToMark, error = null) => {
    const item = state.queue.find(({ id: itemId }) => itemId === idToMark);
    if (!item) return;

    const status = error?.response?.status ?? null;
    const message =
      error?.response?.data?.message || error?.message || "Sync failed";

    item.status = "failed";
    item.lastError = { status, message };

    state.failed = [
      ...state.failed.filter(({ id: itemId }) => itemId !== idToMark),
      {
        id: item.id,
        resource: item.resource,
        action: item.action,
        resourceId: item.resourceId,
        payload: item.payload,
        attempts: item.attempts,
        lastError: item.lastError,
      },
    ];
  };

  const clearFailed = () => {
    state.failed = [];
  };

  const reset = () => {
    state.queue = [];
    state.failed = [];
  };

  return {
    queue,
    failed,
    pendingCount,
    failedCount,
    enqueue,
    markProcessing,
    markPending,
    markDone,
    markFailed,
    clearFailed,
    reset,
  };
}
