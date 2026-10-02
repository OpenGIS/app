import { computed, inject } from "vue";
import { useAuthSession } from "@/composables/auth/useAuthSession";
import { useMagicLinkAuth } from "@/composables/auth/useMagicLinkAuth";

const cache = new Map();

export function useAuthStore(instanceId) {
  const id = instanceId ?? inject("onrteAppId", "app");

  if (!cache.has(id)) {
    cache.set(id, {
      session: useAuthSession(id),
      magicLink: useMagicLinkAuth(id),
    });
  }

  const store = cache.get(id);

  const status = computed(() => {
    if (store.session.loading.value) return "loading";
    return store.session.isAuthenticated.value ? "authenticated" : "guest";
  });

  const error = computed(
    () => store.session.error.value || store.magicLink.error.value,
  );

  return {
    user: store.session.user,
    loading: store.session.loading,
    sessionError: store.session.error,
    isAuthenticated: store.session.isAuthenticated,
    status,

    submittingMagicLink: store.magicLink.submitting,
    magicLinkMessage: store.magicLink.message,
    magicLinkError: store.magicLink.error,
    magicLinkRetryAfter: store.magicLink.retryAfter,
    error,

    refreshSession: store.session.fetchSession,
    clearSession: store.session.clearSession,
    logout: store.session.logout,
    requestMagicLink: store.magicLink.requestMagicLink,
    clearFeedback: store.magicLink.clearFeedback,
  };
}
