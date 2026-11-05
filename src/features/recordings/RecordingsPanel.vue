<!-- RecordingsPanel.vue — side-panel content for the Recordings feature -->
<script setup>
import { inject, computed } from "vue";
import Icon from "@/components/ui/icon.vue";
import RenameInput from "@/components/ui/rename-input.vue";
import { useInlineRename } from "@/composables/useInlineRename.js";
import { useSettings } from "@/composables/useSettings.js";
import { useLocale } from "@/composables/useLocale";
import { documentDistance } from "@/utils/track/index.js";
import { formatDuration, formatDistance } from "./index.js";
import { askConfirm } from "@/composables/useConfirm";

const { isMetric } = useSettings();
const { t, locale, formatLocale } = useLocale();

const {
  state,
  elapsed,
  locationError,
  distance,
  start,
  pause,
  resume,
  discard,
  save,
  shareRecording,
  toggleVisibility,
  isVisible,
  deleteRecording,
  renameRecording,
} = inject("recordings");

const rename = useInlineRename();
const formatDate = (rec) =>
  new Date(rec.createdAt).toLocaleString(formatLocale.value);

const isActive = computed(() => state.isRecording || state.isPaused);

const locationErrorText = computed(() => {
  switch (locationError.value) {
    case "denied":
      return t("panel.recordings.locationDenied");
    case "timeout":
      return t("panel.recordings.locationTimeout");
    case "unavailable":
      return t("panel.recordings.locationUnavailable");
    default:
      return "";
  }
});

const sortedRecordings = computed(() =>
  [...state.saved].sort(
    (a, b) =>
      (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
      String(b.id).localeCompare(String(a.id)),
  ),
);

const onShare = async (event, recording, format) => {
  event.currentTarget.closest("details")?.removeAttribute("open");
  await shareRecording(recording, format);
};

const confirmDelete = async (recording) => {
  const date = new Date(recording.createdAt).toLocaleString(formatLocale.value);
  if (!(await askConfirm(t("panel.recordings.confirmDelete", { date }))))
    return;
  deleteRecording(recording.id);
};
</script>

<template>
  <div class="ogis-recordings-panel p-3">
    <h5 class="ogis-section-title">{{ t("menu.recordings") }}</h5>

    <p v-if="locationError" class="text-danger small" role="alert">
      {{ locationErrorText }}
    </p>

    <!-- Active recording -->
    <template v-if="isActive">
      <h6 class="ogis-section-heading">
        {{ t("panel.recordings.currentRecording") }}
      </h6>

      <div class="ogis-live-card mb-3">
        <div class="d-flex justify-content-between">
          <span>{{ t("panel.recordings.duration") }}</span>
          <strong>{{ formatDuration(elapsed) }}</strong>
        </div>

        <div class="d-flex justify-content-between">
          <span>{{ t("panel.recordings.distance") }}</span>
          <strong>
            {{ formatDistance(distance, isMetric, locale.value) }}
          </strong>
        </div>

        <div class="ogis-track-card__actions">
          <button
            type="button"
            class="btn ogis-track-btn"
            :class="{ 'ogis-track-btn--main': !state.isRecording }"
            @click="state.isRecording ? pause() : resume()"
          >
            <Icon
              :name="state.isRecording ? 'pause-circle' : 'record-btn-fill'"
              width="14"
              height="14"
              aria-hidden="true"
            />
            {{
              state.isRecording
                ? t("panel.recordings.pause")
                : t("panel.recordings.resume")
            }}
          </button>
          <button
            type="button"
            class="btn ogis-track-btn ogis-track-btn--main"
            @click="save"
          >
            <Icon name="check" width="14" height="14" aria-hidden="true" />
            {{ t("panel.recordings.save") }}
          </button>
          <button type="button" class="btn ogis-track-btn" @click="discard">
            <Icon name="x-circle" width="14" height="14" aria-hidden="true" />
            {{ t("panel.recordings.discard") }}
          </button>
        </div>
      </div>
    </template>

    <!-- Idle — start a new recording -->
    <template v-else>
      <button
        id="recordings-start-button"
        type="button"
        class="btn ogis-cta"
        @click="start"
      >
        <Icon
          name="record-btn-fill"
          width="18"
          height="18"
          aria-hidden="true"
        />
        {{ t("panel.recordings.start") }}
      </button>
    </template>

    <!-- Saved recordings -->
    <h6 class="ogis-section-heading">{{ t("panel.recordings.saved") }}</h6>

    <p v-if="!state.saved.length" class="text-body-tertiary small">
      {{ t("panel.recordings.empty") }}
    </p>

    <div class="ogis-recordings-list">
      <div
        v-for="rec in sortedRecordings"
        :key="rec.id"
        class="ogis-track-card"
      >
        <div class="ogis-track-card__head">
          <span
            class="ogis-track-swatch"
            :style="{ backgroundColor: rec.color }"
          ></span>
          <div class="ogis-track-card__text">
            <RenameInput
              v-if="rename.editingId.value === rec.id"
              v-model="rename.draft.value"
              :label="t('panel.recordings.rename')"
              @commit="rename.commit(renameRecording)"
              @cancel="rename.cancel"
            />
            <div v-else class="ogis-track-name text-truncate">
              {{ rec.name || formatDate(rec) }}
            </div>
            <div class="ogis-track-card__meta">
              <template v-if="rec.name">{{ formatDate(rec) }} · </template>
              {{ formatDuration(rec.duration ?? 0) }} ·
              {{
                formatDistance(documentDistance(rec), isMetric, locale.value)
              }}
            </div>
          </div>
          <button
            type="button"
            class="btn ogis-track-card__rename"
            :aria-label="t('panel.recordings.rename')"
            :title="t('panel.recordings.rename')"
            @mousedown.prevent
            @click="rename.begin(rec.id, rec.name || '')"
          >
            <Icon name="pencil" width="16" height="16" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="btn ogis-track-card__remove"
            :aria-label="t('panel.recordings.delete')"
            :title="t('panel.recordings.delete')"
            @click="confirmDelete(rec)"
          >
            <Icon name="trash" width="16" height="16" aria-hidden="true" />
          </button>
        </div>

        <div class="ogis-track-card__actions">
          <button
            type="button"
            class="btn ogis-track-btn"
            :class="
              isVisible(rec.id) ? 'ogis-track-btn--on' : 'ogis-track-btn--show'
            "
            :aria-pressed="isVisible(rec.id)"
            :title="
              isVisible(rec.id) ? t('panel.recordings.hideHint') : undefined
            "
            @click="toggleVisibility(rec)"
          >
            <Icon
              :name="isVisible(rec.id) ? 'check' : 'map'"
              width="14"
              height="14"
              aria-hidden="true"
            />
            {{
              isVisible(rec.id)
                ? t("panel.recordings.hide")
                : t("panel.recordings.show")
            }}
          </button>

          <details class="ogis-share-menu">
            <summary class="btn ogis-track-btn">
              <Icon name="share" width="14" height="14" aria-hidden="true" />
              {{ t("panel.recordings.share") }}
            </summary>
            <div class="ogis-share-menu__items">
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                @click="onShare($event, rec, 'gpx')"
              >
                GPX
              </button>
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                @click="onShare($event, rec, 'geojson')"
              >
                GeoJSON
              </button>
            </div>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>
