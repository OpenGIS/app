<script setup>
import { computed, onMounted, ref } from "vue";
import { useLocale } from "@/composables/useLocale";
import { useResourceOverview } from "@/composables/resources/useResourceOverview";
import { useAuthStore } from "@/stores/authStore";

const { t } = useLocale();
const {
  user,
  loading,
  sessionError,
  isAuthenticated,
  submittingMagicLink,
  magicLinkMessage,
  magicLinkError,
  magicLinkRetryAfter,
  refreshSession,
  requestMagicLink,
  logout,
  clearFeedback,
} = useAuthStore();
const {
  maps,
  collections,
  loading: resourcesLoading,
  error: resourcesError,
  mapCount,
  collectionCount,
  refresh: refreshResources,
  clear: clearResources,
} = useResourceOverview();

const email = ref("");
const panelError = ref(null);

const callbackUrl = computed(
  () =>
    `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`,
);

const memberSinceLabel = computed(() => {
  if (!user.value?.created_at) return null;
  const date = new Date(user.value.created_at);
  if (Number.isNaN(date.getTime())) return user.value.created_at;
  return date.toLocaleString();
});

const visibleMaps = computed(() => maps.value.slice(0, 5));
const visibleCollections = computed(() => collections.value.slice(0, 5));

const resourcesErrorMessage = computed(() => {
  if (resourcesError.value === "unauthorized") {
    return t("panel.account.resourcesUnauthorized");
  }

  if (resourcesError.value === "load-failed") {
    return t("panel.account.resourcesError");
  }

  return null;
});

const visibilityLabel = (visibility) =>
  visibility === "public"
    ? t("panel.account.visibilityPublic")
    : t("panel.account.visibilityPrivate");

const resourceLabel = (resource) =>
  resource?.title || resource?.slug || resource?.id || "—";

const refreshSessionState = async () => {
  panelError.value = null;
  try {
    const session = await refreshSession();

    if (!session) {
      clearResources();
      return;
    }

    await refreshResources();
  } catch {
    panelError.value = t("panel.account.errorSession");
    clearResources();
  }
};

const submitMagicLink = async () => {
  panelError.value = null;
  const result = await requestMagicLink(email.value, callbackUrl.value);
  if (result.ok) {
    email.value = "";
  }
};

const logoutSession = async () => {
  panelError.value = null;
  try {
    await logout();
  } catch {
    panelError.value = t("panel.account.errorLogout");
  } finally {
    clearResources();
  }
};

onMounted(() => {
  clearFeedback();
  refreshSessionState();
});
</script>

<template>
  <div class="ogis-account-panel">
    <div class="sidebar-section sidebar-section-body p-3 pb-0">
      <h5 class="mb-0">{{ t("panel.account.title") }}</h5>
    </div>

    <div class="sidebar-section sidebar-section-body p-3 border-top">
      <p class="small text-body-secondary mb-3">
        {{ t("panel.account.description") }}
      </p>

      <div v-if="loading" class="small text-body-secondary">
        {{ t("panel.account.loading") }}
      </div>

      <template v-else-if="isAuthenticated">
        <p class="mb-1">
          <strong>{{ t("panel.account.signedInAs") }}:</strong>
          {{ user.username }}
        </p>
        <p v-if="memberSinceLabel" class="mb-3 small text-body-secondary">
          <strong>{{ t("panel.account.memberSince") }}:</strong>
          {{ memberSinceLabel }}
        </p>
        <div class="d-flex gap-2">
          <button
            id="account-refresh-session"
            type="button"
            class="btn btn-sm btn-outline-secondary"
            @click="refreshSessionState"
          >
            {{ t("panel.account.checkSession") }}
          </button>
          <button
            id="account-refresh-resources"
            type="button"
            class="btn btn-sm btn-outline-secondary"
            @click="refreshResources"
          >
            {{ t("panel.account.refreshResources") }}
          </button>
          <button
            id="account-logout"
            type="button"
            class="btn btn-sm btn-outline-danger"
            @click="logoutSession"
          >
            {{ t("panel.account.logout") }}
          </button>
        </div>

        <div class="mt-3 pt-3 border-top">
          <h6 class="mb-2">{{ t("panel.account.resourcesTitle") }}</h6>
          <p class="small text-body-secondary mb-2">
            <strong>{{ mapCount }}</strong>
            {{ t("panel.account.resourcesMaps") }},
            <strong>{{ collectionCount }}</strong>
            {{ t("panel.account.resourcesCollections") }}
          </p>

          <div v-if="resourcesLoading" class="small text-body-secondary">
            {{ t("panel.account.resourcesLoading") }}
          </div>

          <p
            v-else-if="resourcesErrorMessage"
            class="alert alert-warning small py-2 px-3 mb-2"
            role="alert"
          >
            {{ resourcesErrorMessage }}
          </p>

          <template v-else>
            <div class="mb-3">
              <p class="small fw-semibold text-body-secondary mb-1">
                {{ t("panel.account.resourcesMapLabel") }}
              </p>
              <ul
                v-if="visibleMaps.length"
                class="list-group list-group-flush small"
              >
                <li
                  v-for="map in visibleMaps"
                  :key="map.id"
                  class="list-group-item px-0 py-2 d-flex justify-content-between align-items-center"
                >
                  <span class="text-truncate pe-2">{{
                    resourceLabel(map)
                  }}</span>
                  <span class="badge text-bg-light">{{
                    visibilityLabel(map.visibility)
                  }}</span>
                </li>
              </ul>
              <p v-else class="small text-body-secondary mb-0">
                {{ t("panel.account.noMaps") }}
              </p>
            </div>

            <div>
              <p class="small fw-semibold text-body-secondary mb-1">
                {{ t("panel.account.resourcesCollectionLabel") }}
              </p>
              <ul
                v-if="visibleCollections.length"
                class="list-group list-group-flush small"
              >
                <li
                  v-for="collection in visibleCollections"
                  :key="collection.id"
                  class="list-group-item px-0 py-2 d-flex justify-content-between align-items-center"
                >
                  <span class="text-truncate pe-2">{{
                    resourceLabel(collection)
                  }}</span>
                  <span class="badge text-bg-light">
                    {{ visibilityLabel(collection.visibility) }}
                  </span>
                </li>
              </ul>
              <p v-else class="small text-body-secondary mb-0">
                {{ t("panel.account.noCollections") }}
              </p>
            </div>
          </template>
        </div>
      </template>

      <template v-else>
        <label for="account-email" class="form-label small">
          {{ t("panel.account.emailLabel") }}
        </label>
        <input
          id="account-email"
          v-model.trim="email"
          type="email"
          class="form-control form-control-sm"
          :placeholder="t('panel.account.emailPlaceholder')"
          autocomplete="email"
        />
        <div class="d-flex gap-2 mt-2">
          <button
            id="account-request-magic-link"
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="submittingMagicLink"
            @click="submitMagicLink"
          >
            {{
              submittingMagicLink
                ? t("panel.account.requesting")
                : t("panel.account.requestMagicLink")
            }}
          </button>
          <button
            id="account-check-session"
            type="button"
            class="btn btn-sm btn-outline-secondary"
            @click="refreshSessionState"
          >
            {{ t("panel.account.checkSession") }}
          </button>
        </div>
      </template>

      <p
        v-if="magicLinkMessage"
        class="alert alert-success small py-2 px-3 mt-3 mb-0"
        role="status"
      >
        {{ magicLinkMessage }}
      </p>

      <p
        v-if="magicLinkError"
        class="alert alert-warning small py-2 px-3 mt-3 mb-0"
        role="alert"
      >
        {{ magicLinkError }}
        <span v-if="magicLinkRetryAfter">
          ({{ magicLinkRetryAfter }}s). {{ t("panel.account.retryAfterHint") }}
        </span>
      </p>

      <p
        v-if="panelError || sessionError"
        class="alert alert-danger small py-2 px-3 mt-3 mb-0"
        role="alert"
      >
        {{ panelError || sessionError }}
      </p>
    </div>
  </div>
</template>
