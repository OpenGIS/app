import { inject, ref } from "vue";
import { api, ensureCsrfCookie } from "@/api/client";

const cache = new Map();

function createState() {
  return {
    submitting: ref(false),
    message: ref(null),
    error: ref(null),
    retryAfter: ref(null),
  };
}

function firstValidationMessage(errors = {}) {
  const firstField = Object.values(errors)[0];
  if (!Array.isArray(firstField) || firstField.length === 0) {
    return null;
  }
  return firstField[0];
}

export function useMagicLinkAuth(instanceId) {
  const id = instanceId ?? inject("ogisAppId", "app");

  if (!cache.has(id)) {
    cache.set(id, createState());
  }

  const state = cache.get(id);

  const clearFeedback = () => {
    state.message.value = null;
    state.error.value = null;
    state.retryAfter.value = null;
  };

  const requestMagicLink = async (email, callbackUrl) => {
    const normalizedEmail = email.trim();

    state.submitting.value = true;
    clearFeedback();

    if (!normalizedEmail) {
      state.error.value = "Email is required.";
      state.submitting.value = false;
      return { ok: false, status: 422 };
    }

    try {
      await ensureCsrfCookie();
      await api.post("/api/auth/magic-link", {
        email: normalizedEmail,
        intended: callbackUrl,
      });

      state.message.value = "Magic link sent! Check your email.";
      return { ok: true, status: 200 };
    } catch (error) {
      const status = error?.response?.status;

      if (status === 429) {
        state.error.value = "Too many attempts. Please try again shortly.";
        state.retryAfter.value =
          Number(error.response.headers["retry-after"] || 0) || null;
        return { ok: false, status };
      }

      if (status === 422) {
        state.error.value =
          firstValidationMessage(error?.response?.data?.errors) ||
          "Invalid login request.";
        return { ok: false, status };
      }

      state.error.value = "Unable to request login link.";
      return { ok: false, status: status || 0 };
    } finally {
      state.submitting.value = false;
    }
  };

  return {
    submitting: state.submitting,
    message: state.message,
    error: state.error,
    retryAfter: state.retryAfter,
    requestMagicLink,
    clearFeedback,
  };
}
