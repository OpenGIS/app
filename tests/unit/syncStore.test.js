import { beforeEach, describe, expect, it } from "vitest";
import { useSyncStore } from "@/stores/syncStore";

describe("useSyncStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("enqueues sync operations as pending items", () => {
    const store = useSyncStore(`sync-store-${Math.random()}`);

    const item = store.enqueue({
      resource: "maps",
      action: "create",
      payload: { title: "Test map" },
    });

    expect(item.status).toBe("pending");
    expect(store.queue.value).toHaveLength(1);
    expect(store.pendingCount.value).toBe(1);
  });

  it("tracks failed operations with status and error details", () => {
    const store = useSyncStore(`sync-store-${Math.random()}`);
    const item = store.enqueue({
      resource: "collections",
      action: "update",
      resourceId: "col-1",
      payload: { title: "Updated name" },
    });

    store.markProcessing(item.id);
    store.markFailed(item.id, {
      response: {
        status: 422,
        data: { message: "The slug has already been taken." },
      },
    });

    expect(store.queue.value[0].status).toBe("failed");
    expect(store.failed.value).toHaveLength(1);
    expect(store.failed.value[0].lastError).toEqual({
      status: 422,
      message: "The slug has already been taken.",
    });
    expect(store.failedCount.value).toBe(1);
  });

  it("removes completed operations from queue and failed collections", () => {
    const store = useSyncStore(`sync-store-${Math.random()}`);
    const item = store.enqueue({
      resource: "maps",
      action: "delete",
      resourceId: "map-1",
    });

    store.markFailed(item.id, { message: "Temporary network issue" });
    expect(store.failed.value).toHaveLength(1);

    store.markDone(item.id);

    expect(store.queue.value).toHaveLength(0);
    expect(store.failed.value).toHaveLength(0);
  });
});
