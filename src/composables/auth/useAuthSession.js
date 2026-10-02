import { computed, inject, ref } from "vue";
import { api, ensureCsrfCookie, resetCsrfCookieState } from "@/api/client";

const cache = new Map();

function createState() {
  return {
    user: ref(null),
    loading: ref(false),
    error: ref(null),
  };
}

export function useAuthSession(instanceId) {
  const id = instanceId ?? inject("ogisAppId", "app");

  if (!cache.has(id)) {
    cache.set(id, createState());
  }

  const state = cache.get(id);
  const isAuthenticated = computed(() => !!state.user.value);

  const clearSession = () => {
    state.user.value = null;
  };

  const fetchSession = async () => {
    state.loading.value = true;
    state.error.value = null;

    try {
      const { data } = await api.get("/api/auth/session");
      state.user.value = data;
      return data;
    } catch (error) {
      if (error?.response?.status === 401) {
        state.user.value = null;
        return null;
      }

      state.user.value = null;
      state.error.value = "Unable to load your account session.";
      throw error;
    } finally {
      state.loading.value = false;
    }
  };

  const logout = async () => {
    state.loading.value = true;
    state.error.value = null;

    try {
      await ensureCsrfCookie();
      await api.post("/api/auth/logout");
    } catch (error) {
      if (error?.response?.status !== 401) {
        state.error.value = "Unable to log out right now.";
        throw error;
      }
    } finally {
      state.user.value = null;
      state.loading.value = false;
      resetCsrfCookieState();
    }
  };

  return {
    user: state.user,
    loading: state.loading,
    error: state.error,
    isAuthenticated,
    fetchSession,
    logout,
    clearSession,
  };
}
