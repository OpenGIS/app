<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useLocale } from "@/composables/useLocale";
import { useCollectionsBrowser } from "@/composables/resources/useCollectionsBrowser";
import { useUI } from "@/composables/useUI";

const { t } = useLocale();
const { setActivePanel, openPanel } = useUI();
const {
  loading: authLoading,
  isAuthenticated,
  refreshSession,
} = useAuthStore();
const {
  collections,
  loadingCollections,
  collectionsError,
  availableMaps,
  loadingAvailableMaps,
  availableMapsError,
  selectedCollection,
  loadingSelectedCollection,
  selectedCollectionError,
  savingSelectedCollectionMeta,
  selectedCollectionMetaError,
  selectedCollectionMetaValidationErrors,
  selectedCollectionMetaSaved,
  creatingCollection,
  createCollectionError,
  createCollectionValidationErrors,
  createCollectionSaved,
  deletingSelectedCollection,
  deleteSelectedCollectionError,
  deleteSelectedCollectionSaved,
  loadCollections,
  loadAvailableMaps,
  selectCollection,
  saveSelectedCollectionMeta,
  createCollection,
  deleteSelectedCollection,
  clearSelection,
  clear,
} = useCollectionsBrowser();

const editableMeta = ref({
  title: "",
  slug: "",
  description: "",
  visibility: "private",
  parent_id: null,
  maps: [],
});

const newCollection = ref({
  title: "",
  slug: "",
  description: "",
  visibility: "private",
  parent_id: null,
  maps: [],
});

const collectionsErrorMessage = computed(() => {
  if (collectionsError.value === "unauthorized") {
    return t("panel.collections.errorUnauthorized");
  }

  if (collectionsError.value === "load-failed") {
    return t("panel.collections.errorLoad");
  }

  return null;
});

const selectedCollectionErrorMessage = computed(() => {
  if (selectedCollectionError.value === "unauthorized") {
    return t("panel.collections.errorUnauthorized");
  }

  if (selectedCollectionError.value === "not-found") {
    return t("panel.collections.errorNotFound");
  }

  if (selectedCollectionError.value === "load-failed") {
    return t("panel.collections.errorLoad");
  }

  return null;
});

const selectedCollectionMetaErrorMessage = computed(() => {
  if (selectedCollectionMetaError.value === "validation") {
    return t("panel.collections.metaValidationError");
  }

  if (selectedCollectionMetaError.value === "unauthorized") {
    return t("panel.collections.errorUnauthorized");
  }

  if (selectedCollectionMetaError.value === "not-found") {
    return t("panel.collections.errorNotFound");
  }

  if (selectedCollectionMetaError.value === "save-failed") {
    return t("panel.collections.errorSave");
  }

  return null;
});

const createCollectionErrorMessage = computed(() => {
  if (createCollectionError.value === "validation") {
    return t("panel.collections.metaValidationError");
  }

  if (createCollectionError.value === "unauthorized") {
    return t("panel.collections.errorUnauthorized");
  }

  if (createCollectionError.value === "save-failed") {
    return t("panel.collections.errorSave");
  }

  return null;
});

const deleteCollectionErrorMessage = computed(() => {
  if (deleteSelectedCollectionError.value === "unauthorized") {
    return t("panel.collections.errorUnauthorized");
  }

  if (deleteSelectedCollectionError.value === "not-found") {
    return t("panel.collections.errorNotFound");
  }

  if (deleteSelectedCollectionError.value === "delete-failed") {
    return t("panel.collections.errorDelete");
  }

  return null;
});

const hasCollections = computed(() => collections.value.length > 0);
const hasSelectedCollection = computed(() => !!selectedCollection.value);
const hasAvailableMaps = computed(() => availableMaps.value.length > 0);

const hasUnsavedMetaChanges = computed(() => {
  if (!selectedCollection.value) {
    return false;
  }

  const currentDescription = selectedCollection.value.description ?? "";
  const currentParent = selectedCollection.value.parent_id ?? null;
  const currentMaps = (selectedCollection.value.maps ?? [])
    .map((map) => map.id)
    .filter((id) => !!id)
    .sort();
  const nextMaps = [...(editableMeta.value.maps ?? [])]
    .filter((id) => !!id)
    .sort();

  return (
    editableMeta.value.title !== (selectedCollection.value.title ?? "") ||
    editableMeta.value.slug !== (selectedCollection.value.slug ?? "") ||
    editableMeta.value.description !== currentDescription ||
    editableMeta.value.visibility !==
      (selectedCollection.value.visibility ?? "private") ||
    editableMeta.value.parent_id !== currentParent ||
    JSON.stringify(currentMaps) !== JSON.stringify(nextMaps)
  );
});

const selectableParentOptions = computed(() =>
  collections.value
    .filter((collection) => collection.id !== selectedCollection.value?.id)
    .map((collection) => ({
      id: collection.id,
      title: collection.title || collection.slug || collection.id,
    })),
);

const createParentOptions = computed(() =>
  collections.value.map((collection) => ({
    id: collection.id,
    title: collection.title || collection.slug || collection.id,
  })),
);

const availableMapOptions = computed(() =>
  availableMaps.value.map((map) => ({
    id: map.id,
    title: map.title || map.slug || map.id,
  })),
);

const firstFieldError = (field) =>
  selectedCollectionMetaValidationErrors.value?.[field]?.[0] ?? null;
const firstCreateFieldError = (field) =>
  createCollectionValidationErrors.value?.[field]?.[0] ?? null;

const openAccountPanel = () => {
  setActivePanel("account");
  openPanel();
};

const initialize = async () => {
  const session = await refreshSession();
  if (session) {
    await Promise.all([loadCollections(), loadAvailableMaps()]);
  } else {
    clear();
  }
};

const refreshCollections = async () => {
  if (!isAuthenticated.value) {
    return;
  }

  await Promise.all([loadCollections(), loadAvailableMaps()]);
};

const openCollection = async (collectionId) => {
  if (!collectionId) {
    return;
  }

  await selectCollection(collectionId);
};

const resetEditableMeta = () => {
  if (!selectedCollection.value) {
    editableMeta.value = {
      title: "",
      slug: "",
      description: "",
      visibility: "private",
      parent_id: null,
      maps: [],
    };
    return;
  }

  editableMeta.value = {
    title: selectedCollection.value.title ?? "",
    slug: selectedCollection.value.slug ?? "",
    description: selectedCollection.value.description ?? "",
    visibility: selectedCollection.value.visibility ?? "private",
    parent_id: selectedCollection.value.parent_id ?? null,
    maps: (selectedCollection.value.maps ?? [])
      .map((map) => map.id)
      .filter((id) => !!id),
  };
};

const resetNewCollection = () => {
  newCollection.value = {
    title: "",
    slug: "",
    description: "",
    visibility: "private",
    parent_id: null,
    maps: [],
  };
};

const submitMeta = async () => {
  if (!hasSelectedCollection.value) {
    return;
  }

  await saveSelectedCollectionMeta(editableMeta.value);
};

const submitCreate = async () => {
  const result = await createCollection(newCollection.value);

  if (result.ok) {
    resetNewCollection();
  }
};

const submitDelete = async () => {
  await deleteSelectedCollection();
};

watch(isAuthenticated, (authenticated) => {
  if (!authenticated) {
    clear();
  }
});

watch(selectedCollection, () => {
  resetEditableMeta();
});

onMounted(() => {
  initialize();
});
</script>

<template>
  <div class="onrte-collections-panel">
    <div class="sidebar-section sidebar-section-body p-3 pb-0">
      <h5 class="mb-0">{{ t("panel.collections.title") }}</h5>
    </div>

    <div class="sidebar-section sidebar-section-body p-3 border-top">
      <p class="small text-body-secondary mb-3">
        {{ t("panel.collections.description") }}
      </p>

      <div v-if="authLoading" class="small text-body-secondary">
        {{ t("panel.collections.loadingSession") }}
      </div>

      <template v-else-if="!isAuthenticated">
        <p class="alert alert-warning small py-2 px-3 mb-2" role="alert">
          {{ t("panel.collections.signInRequired") }}
        </p>

        <button
          id="collections-open-account"
          type="button"
          class="btn btn-sm btn-outline-primary"
          @click="openAccountPanel"
        >
          {{ t("panel.collections.openAccount") }}
        </button>
      </template>

      <template v-else>
        <div class="d-flex gap-2 mb-3">
          <button
            id="collections-refresh"
            type="button"
            class="btn btn-sm btn-outline-secondary"
            :disabled="loadingCollections"
            @click="refreshCollections"
          >
            {{
              loadingCollections
                ? t("panel.collections.refreshing")
                : t("panel.collections.refresh")
            }}
          </button>
          <button
            id="collections-clear-selection"
            type="button"
            class="btn btn-sm btn-outline-secondary"
            :disabled="!selectedCollection"
            @click="clearSelection"
          >
            {{ t("panel.collections.clearSelection") }}
          </button>
        </div>

        <div v-if="loadingCollections" class="small text-body-secondary mb-2">
          {{ t("panel.collections.loadingCollections") }}
        </div>
        <div v-if="loadingAvailableMaps" class="small text-body-secondary mb-2">
          {{ t("panel.collections.loadingMaps") }}
        </div>

        <p
          v-if="collectionsErrorMessage"
          class="alert alert-warning small py-2 px-3 mb-2"
          role="alert"
        >
          {{ collectionsErrorMessage }}
        </p>
        <p
          v-if="availableMapsError"
          class="alert alert-warning small py-2 px-3 mb-2"
          role="alert"
        >
          {{ t("panel.collections.errorLoadMaps") }}
        </p>

        <ul v-if="hasCollections" class="list-group list-group-flush small">
          <li
            v-for="collection in collections"
            :key="collection.id"
            class="list-group-item px-0 py-2"
          >
            <button
              :id="`collections-item-${collection.id}`"
              type="button"
              class="btn btn-link text-start text-decoration-none p-0 w-100"
              @click="openCollection(collection.id)"
            >
              <span class="fw-semibold d-block">
                {{ collection.title || collection.slug || collection.id }}
              </span>
              <span class="small text-body-secondary d-block">{{
                collection.slug || "-"
              }}</span>
            </button>
          </li>
        </ul>

        <p
          v-else-if="!loadingCollections"
          class="small text-body-secondary mb-0"
        >
          {{ t("panel.collections.empty") }}
        </p>

        <div class="mt-3 pt-3 border-top">
          <h6 class="mb-2">{{ t("panel.collections.createTitle") }}</h6>
          <form @submit.prevent="submitCreate">
            <div class="mb-2">
              <label for="collections-create-title" class="form-label small">
                {{ t("panel.collections.fieldTitle") }}
              </label>
              <input
                id="collections-create-title"
                v-model="newCollection.title"
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
              <label for="collections-create-slug" class="form-label small">
                {{ t("panel.collections.fieldSlug") }}
              </label>
              <input
                id="collections-create-slug"
                v-model="newCollection.slug"
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
              <label
                for="collections-create-description"
                class="form-label small"
              >
                {{ t("panel.collections.fieldDescription") }}
              </label>
              <textarea
                id="collections-create-description"
                v-model="newCollection.description"
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
              <label
                for="collections-create-visibility"
                class="form-label small"
              >
                {{ t("panel.collections.fieldVisibility") }}
              </label>
              <select
                id="collections-create-visibility"
                v-model="newCollection.visibility"
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
              <label for="collections-create-parent" class="form-label small">
                {{ t("panel.collections.fieldParent") }}
              </label>
              <select
                id="collections-create-parent"
                v-model="newCollection.parent_id"
                class="form-select form-select-sm"
                :class="{ 'is-invalid': firstCreateFieldError('parent_id') }"
              >
                <option :value="null">
                  {{ t("panel.collections.noParent") }}
                </option>
                <option
                  v-for="option in createParentOptions"
                  :key="option.id"
                  :value="option.id"
                >
                  {{ option.title }}
                </option>
              </select>
              <div
                v-if="firstCreateFieldError('parent_id')"
                class="invalid-feedback"
              >
                {{ firstCreateFieldError("parent_id") }}
              </div>
            </div>

            <div class="mb-2">
              <label for="collections-create-maps" class="form-label small">
                {{ t("panel.collections.fieldMaps") }}
              </label>
              <select
                id="collections-create-maps"
                v-model="newCollection.maps"
                class="form-select form-select-sm"
                multiple
                :disabled="!hasAvailableMaps"
              >
                <option
                  v-for="option in availableMapOptions"
                  :key="option.id"
                  :value="option.id"
                >
                  {{ option.title }}
                </option>
              </select>
              <div class="form-text small">
                {{ t("panel.collections.fieldMapsHint") }}
              </div>
            </div>

            <p
              v-if="createCollectionErrorMessage"
              class="alert alert-warning small py-2 px-3 mb-2"
              role="alert"
            >
              {{ createCollectionErrorMessage }}
            </p>

            <p
              v-if="createCollectionSaved"
              id="collections-create-saved"
              class="alert alert-success small py-2 px-3 mb-2"
              role="status"
            >
              {{ t("panel.collections.createSaved") }}
            </p>

            <div class="d-flex gap-2">
              <button
                id="collections-create-save"
                type="submit"
                class="btn btn-sm btn-primary"
                :disabled="creatingCollection"
              >
                {{
                  creatingCollection
                    ? t("panel.collections.savingMeta")
                    : t("panel.collections.createAction")
                }}
              </button>
              <button
                id="collections-create-reset"
                type="button"
                class="btn btn-sm btn-outline-secondary"
                :disabled="creatingCollection"
                @click="resetNewCollection"
              >
                {{ t("panel.collections.resetMeta") }}
              </button>
            </div>
          </form>
        </div>

        <div class="mt-3 pt-3 border-top">
          <h6 class="mb-2">{{ t("panel.collections.selectedTitle") }}</h6>

          <div
            v-if="loadingSelectedCollection"
            class="small text-body-secondary"
          >
            {{ t("panel.collections.loadingCollection") }}
          </div>

          <p
            v-if="selectedCollectionErrorMessage"
            class="alert alert-warning small py-2 px-3 mb-2"
            role="alert"
          >
            {{ selectedCollectionErrorMessage }}
          </p>

          <p
            v-if="deleteCollectionErrorMessage"
            class="alert alert-warning small py-2 px-3 mb-2"
            role="alert"
          >
            {{ deleteCollectionErrorMessage }}
          </p>

          <p
            v-if="deleteSelectedCollectionSaved"
            id="collections-delete-saved"
            class="alert alert-success small py-2 px-3 mb-2"
            role="status"
          >
            {{ t("panel.collections.deleteSaved") }}
          </p>

          <template v-if="selectedCollection">
            <p id="collections-selected-title" class="mb-1 fw-semibold">
              {{
                selectedCollection.title ||
                selectedCollection.slug ||
                selectedCollection.id
              }}
            </p>
            <p class="small text-body-secondary mb-1">
              {{
                selectedCollection.description ||
                t("panel.collections.noDescription")
              }}
            </p>
            <p class="small text-body-secondary mb-0">
              {{ t("panel.collections.mapCount") }}:
              {{ selectedCollection.maps_count }},
              {{ t("panel.collections.childCount") }}:
              {{ selectedCollection.children_count }}
            </p>

            <div class="mt-3 pt-3 border-top">
              <h6 class="mb-2">{{ t("panel.collections.metaTitle") }}</h6>

              <form @submit.prevent="submitMeta">
                <div class="mb-2">
                  <label for="collections-meta-title" class="form-label small">
                    {{ t("panel.collections.fieldTitle") }}
                  </label>
                  <input
                    id="collections-meta-title"
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
                  <label for="collections-meta-slug" class="form-label small">
                    {{ t("panel.collections.fieldSlug") }}
                  </label>
                  <input
                    id="collections-meta-slug"
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
                  <label
                    for="collections-meta-description"
                    class="form-label small"
                  >
                    {{ t("panel.collections.fieldDescription") }}
                  </label>
                  <textarea
                    id="collections-meta-description"
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
                  <label
                    for="collections-meta-visibility"
                    class="form-label small"
                  >
                    {{ t("panel.collections.fieldVisibility") }}
                  </label>
                  <select
                    id="collections-meta-visibility"
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
                  <label for="collections-meta-parent" class="form-label small">
                    {{ t("panel.collections.fieldParent") }}
                  </label>
                  <select
                    id="collections-meta-parent"
                    v-model="editableMeta.parent_id"
                    class="form-select form-select-sm"
                    :class="{ 'is-invalid': firstFieldError('parent_id') }"
                  >
                    <option :value="null">
                      {{ t("panel.collections.noParent") }}
                    </option>
                    <option
                      v-for="option in selectableParentOptions"
                      :key="option.id"
                      :value="option.id"
                    >
                      {{ option.title }}
                    </option>
                  </select>
                  <div
                    v-if="firstFieldError('parent_id')"
                    class="invalid-feedback"
                  >
                    {{ firstFieldError("parent_id") }}
                  </div>
                </div>

                <div class="mb-2">
                  <label for="collections-meta-maps" class="form-label small">
                    {{ t("panel.collections.fieldMaps") }}
                  </label>
                  <select
                    id="collections-meta-maps"
                    v-model="editableMeta.maps"
                    class="form-select form-select-sm"
                    multiple
                    :disabled="!hasAvailableMaps"
                  >
                    <option
                      v-for="option in availableMapOptions"
                      :key="option.id"
                      :value="option.id"
                    >
                      {{ option.title }}
                    </option>
                  </select>
                  <div class="form-text small">
                    {{ t("panel.collections.fieldMapsHint") }}
                  </div>
                </div>

                <p
                  v-if="selectedCollectionMetaErrorMessage"
                  class="alert alert-warning small py-2 px-3 mb-2"
                  role="alert"
                >
                  {{ selectedCollectionMetaErrorMessage }}
                </p>

                <p
                  v-if="selectedCollectionMetaSaved"
                  id="collections-meta-saved"
                  class="alert alert-success small py-2 px-3 mb-2"
                  role="status"
                >
                  {{ t("panel.collections.metaSaved") }}
                </p>

                <div class="d-flex gap-2 flex-wrap">
                  <button
                    id="collections-meta-save"
                    type="submit"
                    class="btn btn-sm btn-primary"
                    :disabled="
                      savingSelectedCollectionMeta || !hasUnsavedMetaChanges
                    "
                  >
                    {{
                      savingSelectedCollectionMeta
                        ? t("panel.collections.savingMeta")
                        : t("panel.collections.saveMeta")
                    }}
                  </button>
                  <button
                    id="collections-meta-reset"
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    :disabled="
                      savingSelectedCollectionMeta || !hasUnsavedMetaChanges
                    "
                    @click="resetEditableMeta"
                  >
                    {{ t("panel.collections.resetMeta") }}
                  </button>
                  <button
                    id="collections-delete"
                    type="button"
                    class="btn btn-sm btn-outline-danger ms-auto"
                    :disabled="
                      savingSelectedCollectionMeta || deletingSelectedCollection
                    "
                    @click="submitDelete"
                  >
                    {{
                      deletingSelectedCollection
                        ? t("panel.collections.deleting")
                        : t("panel.collections.deleteAction")
                    }}
                  </button>
                </div>
              </form>
            </div>
          </template>

          <p v-else class="small text-body-secondary mb-0">
            {{ t("panel.collections.noSelection") }}
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
