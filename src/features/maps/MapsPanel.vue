<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useLocale } from "@/composables/useLocale";
import { useMapsBrowser } from "@/composables/resources/useMapsBrowser";
import { useUI } from "@/composables/useUI";

const { t } = useLocale();
const { setActivePanel, openPanel } = useUI();
const {
  loading: authLoading,
  isAuthenticated,
  refreshSession,
} = useAuthStore();
const {
  maps,
  loadingMaps,
  mapsError,
  creatingMap,
  createMapError,
  createMapValidationErrors,
  createMapSaved,
  deletingSelectedMap,
  deleteSelectedMapError,
  deleteSelectedMapSaved,
  availableCollections,
  loadingAvailableCollections,
  availableCollectionsError,
  selectedMap,
  loadingSelectedMap,
  selectedMapError,
  renderedFeatureCount,
  savingSelectedMapMeta,
  selectedMapMetaError,
  selectedMapMetaValidationErrors,
  selectedMapMetaSaved,
  loadMaps,
  loadAvailableCollections,
  createMap,
  selectMap,
  saveSelectedMapMeta,
  deleteSelectedMap,
  clearSelection,
  clear,
} = useMapsBrowser();

const newMap = ref({
  title: "",
  slug: "",
  description: "",
  visibility: "private",
  collections: [],
});

const editableMeta = ref({
  title: "",
  slug: "",
  description: "",
  visibility: "private",
  collections: [],
});

const mapsErrorMessage = computed(() => {
  if (mapsError.value === "unauthorized") {
    return t("panel.maps.errorUnauthorized");
  }

  if (mapsError.value === "load-failed") {
    return t("panel.maps.errorLoad");
  }

  return null;
});

const selectedMapErrorMessage = computed(() => {
  if (selectedMapError.value === "unauthorized") {
    return t("panel.maps.errorUnauthorized");
  }

  if (selectedMapError.value === "not-found") {
    return t("panel.maps.errorNotFound");
  }

  if (selectedMapError.value === "invalid-geojson") {
    return t("panel.maps.errorInvalidGeojson");
  }

  if (selectedMapError.value === "load-failed") {
    return t("panel.maps.errorLoad");
  }

  return null;
});

const createMapErrorMessage = computed(() => {
  if (createMapError.value === "validation") {
    return t("panel.maps.metaValidationError");
  }

  if (createMapError.value === "unauthorized") {
    return t("panel.maps.errorUnauthorized");
  }

  if (createMapError.value === "save-failed") {
    return t("panel.maps.errorCreate");
  }

  return null;
});

const deleteMapErrorMessage = computed(() => {
  if (deleteSelectedMapError.value === "unauthorized") {
    return t("panel.maps.errorUnauthorized");
  }

  if (deleteSelectedMapError.value === "not-found") {
    return t("panel.maps.errorNotFound");
  }

  if (deleteSelectedMapError.value === "delete-failed") {
    return t("panel.maps.errorDelete");
  }

  return null;
});

const hasMaps = computed(() => maps.value.length > 0);
const hasSelectedMap = computed(() => !!selectedMap.value);
const hasAvailableCollections = computed(
  () => availableCollections.value.length > 0,
);

const availableCollectionOptions = computed(() =>
  availableCollections.value.map((collection) => ({
    id: collection.id,
    title: collection.title || collection.slug || collection.id,
  })),
);

const selectedMapMetaErrorMessage = computed(() => {
  if (selectedMapMetaError.value === "validation") {
    return t("panel.maps.metaValidationError");
  }

  if (selectedMapMetaError.value === "unauthorized") {
    return t("panel.maps.errorUnauthorized");
  }

  if (selectedMapMetaError.value === "not-found") {
    return t("panel.maps.errorNotFound");
  }

  if (selectedMapMetaError.value === "save-failed") {
    return t("panel.maps.errorSave");
  }

  return null;
});

const hasUnsavedMetaChanges = computed(() => {
  if (!selectedMap.value) {
    return false;
  }

  const currentDescription = selectedMap.value.description ?? "";
  const currentCollections = (selectedMap.value.collections ?? [])
    .map((collection) => collection.id)
    .filter((id) => !!id)
    .sort();
  const nextCollections = [...(editableMeta.value.collections ?? [])]
    .filter((id) => !!id)
    .sort();

  return (
    editableMeta.value.title !== (selectedMap.value.title ?? "") ||
    editableMeta.value.slug !== (selectedMap.value.slug ?? "") ||
    editableMeta.value.description !== currentDescription ||
    editableMeta.value.visibility !==
      (selectedMap.value.visibility ?? "private") ||
    JSON.stringify(currentCollections) !== JSON.stringify(nextCollections)
  );
});

const firstFieldError = (field) =>
  selectedMapMetaValidationErrors.value?.[field]?.[0] ?? null;
const firstCollectionsError = computed(
  () => firstFieldError("collections") ?? firstFieldError("collections.0"),
);
const firstCreateFieldError = (field) =>
  createMapValidationErrors.value?.[field]?.[0] ?? null;
const firstCreateCollectionsError = computed(
  () =>
    firstCreateFieldError("collections") ??
    firstCreateFieldError("collections.0"),
);

const openAccountPanel = () => {
  setActivePanel("account");
  openPanel();
};

const initialize = async () => {
  const session = await refreshSession();
  if (session) {
    await Promise.all([loadMaps(), loadAvailableCollections()]);
  } else {
    clear();
  }
};

const refreshMaps = async () => {
  if (!isAuthenticated.value) {
    return;
  }

  await Promise.all([loadMaps(), loadAvailableCollections()]);
};

const openMap = async (mapId) => {
  if (!mapId) {
    return;
  }

  await selectMap(mapId);
};

const resetNewMap = () => {
  newMap.value = {
    title: "",
    slug: "",
    description: "",
    visibility: "private",
    collections: [],
  };
};

const resetEditableMeta = () => {
  if (!selectedMap.value) {
    editableMeta.value = {
      title: "",
      slug: "",
      description: "",
      visibility: "private",
      collections: [],
    };
    return;
  }

  editableMeta.value = {
    title: selectedMap.value.title ?? "",
    slug: selectedMap.value.slug ?? "",
    description: selectedMap.value.description ?? "",
    visibility: selectedMap.value.visibility ?? "private",
    collections: (selectedMap.value.collections ?? [])
      .map((collection) => collection.id)
      .filter((id) => !!id),
  };
};

const submitCreate = async () => {
  const result = await createMap(newMap.value);

  if (result.ok) {
    resetNewMap();
  }
};

const submitMeta = async () => {
  if (!hasSelectedMap.value) {
    return;
  }

  await saveSelectedMapMeta(editableMeta.value);
};

const submitDelete = async () => {
  await deleteSelectedMap();
};

watch(isAuthenticated, (authenticated) => {
  if (!authenticated) {
    clear();
  }
});

watch(selectedMap, () => {
  resetEditableMeta();
});

onMounted(() => {
  initialize();
});
</script>

<template>
  <div class="ogis-maps-panel">
    <div class="sidebar-section sidebar-section-body p-3 pb-0">
      <h5 class="mb-0">{{ t("panel.maps.title") }}</h5>
    </div>

    <div class="sidebar-section sidebar-section-body p-3 border-top">
      <p class="small text-body-secondary mb-3">
        {{ t("panel.maps.description") }}
      </p>

      <div v-if="authLoading" class="small text-body-secondary">
        {{ t("panel.maps.loadingSession") }}
      </div>

      <template v-else-if="!isAuthenticated">
        <p class="alert alert-warning small py-2 px-3 mb-2" role="alert">
          {{ t("panel.maps.signInRequired") }}
        </p>

        <button
          id="maps-open-account"
          type="button"
          class="btn btn-sm btn-outline-primary"
          @click="openAccountPanel"
        >
          {{ t("panel.maps.openAccount") }}
        </button>
      </template>

      <template v-else>
        <div class="d-flex gap-2 mb-3">
          <button
            id="maps-refresh"
            type="button"
            class="btn btn-sm btn-outline-secondary"
            :disabled="loadingMaps"
            @click="refreshMaps"
          >
            {{
              loadingMaps ? t("panel.maps.refreshing") : t("panel.maps.refresh")
            }}
          </button>
          <button
            id="maps-clear-selection"
            type="button"
            class="btn btn-sm btn-outline-secondary"
            :disabled="!selectedMap"
            @click="clearSelection"
          >
            {{ t("panel.maps.clearSelection") }}
          </button>
        </div>

        <div v-if="loadingMaps" class="small text-body-secondary mb-2">
          {{ t("panel.maps.loadingMaps") }}
        </div>
        <div
          v-if="loadingAvailableCollections"
          class="small text-body-secondary mb-2"
        >
          {{ t("panel.maps.loadingCollections") }}
        </div>

        <p
          v-if="mapsErrorMessage"
          class="alert alert-warning small py-2 px-3 mb-2"
          role="alert"
        >
          {{ mapsErrorMessage }}
        </p>
        <p
          v-if="availableCollectionsError"
          class="alert alert-warning small py-2 px-3 mb-2"
          role="alert"
        >
          {{ t("panel.maps.errorLoadCollections") }}
        </p>

        <ul v-if="hasMaps" class="list-group list-group-flush small">
          <li
            v-for="map in maps"
            :key="map.id"
            class="list-group-item px-0 py-2"
          >
            <button
              :id="`maps-item-${map.id}`"
              type="button"
              class="btn btn-link text-start text-decoration-none p-0 w-100"
              @click="openMap(map.id)"
            >
              <span class="fw-semibold d-block">{{
                map.title || map.slug || map.id
              }}</span>
              <span class="small text-body-secondary d-block">{{
                map.slug || "-"
              }}</span>
            </button>
          </li>
        </ul>

        <p v-else-if="!loadingMaps" class="small text-body-secondary mb-0">
          {{ t("panel.maps.empty") }}
        </p>

        <div class="mt-3 pt-3 border-top">
          <h6 class="mb-2">{{ t("panel.maps.createTitle") }}</h6>

          <form @submit.prevent="submitCreate">
            <div class="mb-2">
              <label for="maps-create-title" class="form-label small">
                {{ t("panel.maps.fieldTitle") }}
              </label>
              <input
                id="maps-create-title"
                v-model="newMap.title"
                type="text"
                class="form-control form-control-sm"
                :class="{ 'is-invalid': firstCreateFieldError('title') }"
              />
              <div
                v-if="firstCreateFieldError('title')"
                class="invalid-feedback"
              >
                {{ firstCreateFieldError("title") }}
              </div>
            </div>

            <div class="mb-2">
              <label for="maps-create-slug" class="form-label small">
                {{ t("panel.maps.fieldSlug") }}
              </label>
              <input
                id="maps-create-slug"
                v-model="newMap.slug"
                type="text"
                class="form-control form-control-sm"
                :class="{ 'is-invalid': firstCreateFieldError('slug') }"
              />
              <div
                v-if="firstCreateFieldError('slug')"
                class="invalid-feedback"
              >
                {{ firstCreateFieldError("slug") }}
              </div>
            </div>

            <div class="mb-2">
              <label for="maps-create-description" class="form-label small">
                {{ t("panel.maps.fieldDescription") }}
              </label>
              <textarea
                id="maps-create-description"
                v-model="newMap.description"
                rows="2"
                class="form-control form-control-sm"
                :class="{ 'is-invalid': firstCreateFieldError('description') }"
              ></textarea>
              <div
                v-if="firstCreateFieldError('description')"
                class="invalid-feedback"
              >
                {{ firstCreateFieldError("description") }}
              </div>
            </div>

            <div class="mb-2">
              <label for="maps-create-visibility" class="form-label small">
                {{ t("panel.maps.fieldVisibility") }}
              </label>
              <select
                id="maps-create-visibility"
                v-model="newMap.visibility"
                class="form-select form-select-sm"
                :class="{ 'is-invalid': firstCreateFieldError('visibility') }"
              >
                <option value="private">
                  {{ t("panel.account.visibilityPrivate") }}
                </option>
                <option value="public">
                  {{ t("panel.account.visibilityPublic") }}
                </option>
              </select>
              <div
                v-if="firstCreateFieldError('visibility')"
                class="invalid-feedback"
              >
                {{ firstCreateFieldError("visibility") }}
              </div>
            </div>

            <div class="mb-2">
              <label for="maps-create-collections" class="form-label small">
                {{ t("panel.maps.fieldCollections") }}
              </label>
              <select
                id="maps-create-collections"
                v-model="newMap.collections"
                class="form-select form-select-sm"
                :class="{ 'is-invalid': firstCreateCollectionsError }"
                multiple
                :disabled="!hasAvailableCollections"
              >
                <option
                  v-for="option in availableCollectionOptions"
                  :key="option.id"
                  :value="option.id"
                >
                  {{ option.title }}
                </option>
              </select>
              <div v-if="firstCreateCollectionsError" class="invalid-feedback">
                {{ firstCreateCollectionsError }}
              </div>
              <div class="form-text small">
                {{ t("panel.maps.fieldCollectionsHint") }}
              </div>
            </div>

            <p
              v-if="createMapErrorMessage"
              class="alert alert-warning small py-2 px-3 mb-2"
              role="alert"
            >
              {{ createMapErrorMessage }}
            </p>

            <p
              v-if="createMapSaved"
              id="maps-create-saved"
              class="alert alert-success small py-2 px-3 mb-2"
              role="status"
            >
              {{ t("panel.maps.createSaved") }}
            </p>

            <div class="d-flex gap-2">
              <button
                id="maps-create-save"
                type="submit"
                class="btn btn-sm btn-primary"
                :disabled="creatingMap"
              >
                {{
                  creatingMap
                    ? t("panel.maps.creating")
                    : t("panel.maps.createAction")
                }}
              </button>
              <button
                id="maps-create-reset"
                type="button"
                class="btn btn-sm btn-outline-secondary"
                :disabled="creatingMap"
                @click="resetNewMap"
              >
                {{ t("panel.maps.resetMeta") }}
              </button>
            </div>
          </form>
        </div>

        <div class="mt-3 pt-3 border-top">
          <h6 class="mb-2">{{ t("panel.maps.selectedTitle") }}</h6>

          <div v-if="loadingSelectedMap" class="small text-body-secondary">
            {{ t("panel.maps.loadingMap") }}
          </div>

          <p
            v-if="selectedMapErrorMessage"
            class="alert alert-warning small py-2 px-3 mb-2"
            role="alert"
          >
            {{ selectedMapErrorMessage }}
          </p>

          <p
            v-if="deleteMapErrorMessage"
            class="alert alert-warning small py-2 px-3 mb-2"
            role="alert"
          >
            {{ deleteMapErrorMessage }}
          </p>

          <p
            v-if="deleteSelectedMapSaved"
            id="maps-delete-saved"
            class="alert alert-success small py-2 px-3 mb-2"
            role="status"
          >
            {{ t("panel.maps.deleteSaved") }}
          </p>

          <template v-if="selectedMap">
            <p id="maps-selected-title" class="mb-1 fw-semibold">
              {{ selectedMap.title || selectedMap.slug || selectedMap.id }}
            </p>
            <p class="small text-body-secondary mb-1">
              {{ selectedMap.description || t("panel.maps.noDescription") }}
            </p>
            <p class="small text-body-secondary mb-0">
              {{ t("panel.maps.renderedFeatures") }}: {{ renderedFeatureCount }}
            </p>

            <div class="mt-3 pt-3 border-top">
              <h6 class="mb-2">{{ t("panel.maps.metaTitle") }}</h6>

              <form @submit.prevent="submitMeta">
                <div class="mb-2">
                  <label for="maps-meta-title" class="form-label small">
                    {{ t("panel.maps.fieldTitle") }}
                  </label>
                  <input
                    id="maps-meta-title"
                    v-model="editableMeta.title"
                    type="text"
                    class="form-control form-control-sm"
                    :class="{ 'is-invalid': firstFieldError('title') }"
                  />
                  <div v-if="firstFieldError('title')" class="invalid-feedback">
                    {{ firstFieldError("title") }}
                  </div>
                </div>

                <div class="mb-2">
                  <label for="maps-meta-slug" class="form-label small">
                    {{ t("panel.maps.fieldSlug") }}
                  </label>
                  <input
                    id="maps-meta-slug"
                    v-model="editableMeta.slug"
                    type="text"
                    class="form-control form-control-sm"
                    :class="{ 'is-invalid': firstFieldError('slug') }"
                  />
                  <div v-if="firstFieldError('slug')" class="invalid-feedback">
                    {{ firstFieldError("slug") }}
                  </div>
                </div>

                <div class="mb-2">
                  <label for="maps-meta-description" class="form-label small">
                    {{ t("panel.maps.fieldDescription") }}
                  </label>
                  <textarea
                    id="maps-meta-description"
                    v-model="editableMeta.description"
                    rows="2"
                    class="form-control form-control-sm"
                    :class="{ 'is-invalid': firstFieldError('description') }"
                  ></textarea>
                  <div
                    v-if="firstFieldError('description')"
                    class="invalid-feedback"
                  >
                    {{ firstFieldError("description") }}
                  </div>
                </div>

                <div class="mb-2">
                  <label for="maps-meta-visibility" class="form-label small">
                    {{ t("panel.maps.fieldVisibility") }}
                  </label>
                  <select
                    id="maps-meta-visibility"
                    v-model="editableMeta.visibility"
                    class="form-select form-select-sm"
                    :class="{ 'is-invalid': firstFieldError('visibility') }"
                  >
                    <option value="private">
                      {{ t("panel.account.visibilityPrivate") }}
                    </option>
                    <option value="public">
                      {{ t("panel.account.visibilityPublic") }}
                    </option>
                  </select>
                  <div
                    v-if="firstFieldError('visibility')"
                    class="invalid-feedback"
                  >
                    {{ firstFieldError("visibility") }}
                  </div>
                </div>

                <div class="mb-2">
                  <label for="maps-meta-collections" class="form-label small">
                    {{ t("panel.maps.fieldCollections") }}
                  </label>
                  <select
                    id="maps-meta-collections"
                    v-model="editableMeta.collections"
                    class="form-select form-select-sm"
                    :class="{ 'is-invalid': firstCollectionsError }"
                    multiple
                    :disabled="!hasAvailableCollections"
                  >
                    <option
                      v-for="option in availableCollectionOptions"
                      :key="option.id"
                      :value="option.id"
                    >
                      {{ option.title }}
                    </option>
                  </select>
                  <div v-if="firstCollectionsError" class="invalid-feedback">
                    {{ firstCollectionsError }}
                  </div>
                  <div class="form-text small">
                    {{ t("panel.maps.fieldCollectionsHint") }}
                  </div>
                </div>

                <p
                  v-if="selectedMapMetaErrorMessage"
                  class="alert alert-warning small py-2 px-3 mb-2"
                  role="alert"
                >
                  {{ selectedMapMetaErrorMessage }}
                </p>

                <p
                  v-if="selectedMapMetaSaved"
                  id="maps-meta-saved"
                  class="alert alert-success small py-2 px-3 mb-2"
                  role="status"
                >
                  {{ t("panel.maps.metaSaved") }}
                </p>

                <div class="d-flex gap-2 flex-wrap">
                  <button
                    id="maps-meta-save"
                    type="submit"
                    class="btn btn-sm btn-primary"
                    :disabled="savingSelectedMapMeta || !hasUnsavedMetaChanges"
                  >
                    {{
                      savingSelectedMapMeta
                        ? t("panel.maps.savingMeta")
                        : t("panel.maps.saveMeta")
                    }}
                  </button>
                  <button
                    id="maps-meta-reset"
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    :disabled="savingSelectedMapMeta || !hasUnsavedMetaChanges"
                    @click="resetEditableMeta"
                  >
                    {{ t("panel.maps.resetMeta") }}
                  </button>
                  <button
                    id="maps-delete"
                    type="button"
                    class="btn btn-sm btn-outline-danger ms-auto"
                    :disabled="savingSelectedMapMeta || deletingSelectedMap"
                    @click="submitDelete"
                  >
                    {{
                      deletingSelectedMap
                        ? t("panel.maps.deleting")
                        : t("panel.maps.deleteAction")
                    }}
                  </button>
                </div>
              </form>
            </div>
          </template>

          <p v-else class="small text-body-secondary mb-0">
            {{ t("panel.maps.noSelection") }}
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
