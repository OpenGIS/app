<!-- RecordingsPanel.vue — side-panel content for the Recordings feature -->
<script setup>
import { inject, computed } from "vue";
import { useSettings } from "@/composables/useSettings.js";
import { useLocale } from "@/composables/useLocale";
import { documentDistance } from "@/utils/track/index.js";
import { formatDuration, formatDistance } from "./index.js";

const { isMetric } = useSettings();
const { t, locale, formatLocale } = useLocale();

const {
  state,
  elapsed,
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
} = inject("recordings");

const isActive = computed(() => state.isRecording || state.isPaused);

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

const confirmDelete = (recording) => {
  const date = new Date(recording.createdAt).toLocaleString(formatLocale.value);
  if (!window.confirm(t("panel.recordings.confirmDelete", { date }))) return;
  deleteRecording(recording.id);
};
</script>

<template>
  <div class="p-3">
    <!-- Active recording -->
    <template v-if="isActive">
      <h6 class="text-body-secondary mb-3">
        {{ t("panel.recordings.currentRecording") }}
      </h6>

      <div class="d-flex justify-content-between mb-1">
        <span>{{ t("panel.recordings.duration") }}</span>
        <strong>{{ formatDuration(elapsed) }}</strong>
      </div>

      <div class="d-flex justify-content-between mb-3">
        <span>{{ t("panel.recordings.distance") }}</span>
        <strong>{{ formatDistance(distance, isMetric, locale.value) }}</strong>
      </div>

      <div class="d-flex gap-2 mb-4">
        <button
          class="btn btn-sm"
          :class="state.isRecording ? 'btn-warning' : 'btn-primary'"
          @click="state.isRecording ? pause() : resume()"
        >
          {{
            state.isRecording
              ? t("panel.recordings.pause")
              : t("panel.recordings.resume")
          }}
        </button>
        <button class="btn btn-sm btn-success" @click="save">
          {{ t("panel.recordings.save") }}
        </button>
        <button class="btn btn-sm btn-outline-danger" @click="discard">
          {{ t("panel.recordings.discard") }}
        </button>
      </div>
    </template>

    <!-- Idle — start a new recording -->
    <template v-else>
      <button
        id="recordings-start-button"
        class="btn btn-sm btn-primary w-100 mb-3"
        @click="start"
      >
        {{ t("panel.recordings.start") }}
      </button>
    </template>

    <!-- Saved recordings -->
    <h6 class="text-body-secondary">{{ t("panel.recordings.saved") }}</h6>

    <p v-if="!state.saved.length" class="text-body-tertiary small">
      {{ t("panel.recordings.empty") }}
    </p>

    <div v-for="rec in sortedRecordings" :key="rec.id" class="border-top py-2">
      <div class="d-flex align-items-center gap-2 small text-body-secondary">
        <span
          class="ogis-track-swatch"
          :style="{ backgroundColor: rec.color }"
        ></span>
        <span>{{
          new Date(rec.createdAt).toLocaleString(formatLocale.value)
        }}</span>
      </div>
      <div class="d-flex justify-content-between small">
        <span>{{ formatDuration(rec.duration ?? 0) }}</span>
        <span>
          {{ formatDistance(documentDistance(rec), isMetric, locale.value) }}
        </span>
      </div>
      <div class="d-flex flex-wrap gap-1 mt-1">
        <button
          class="btn btn-sm"
          :class="isVisible(rec.id) ? 'btn-primary' : 'btn-outline-primary'"
          :aria-pressed="isVisible(rec.id)"
          @click="toggleVisibility(rec)"
        >
          {{
            isVisible(rec.id)
              ? t("panel.recordings.hide")
              : t("panel.recordings.show")
          }}
        </button>

        <details class="ogis-share-menu">
          <summary class="btn btn-sm btn-outline-secondary">
            {{ t("panel.recordings.share") }}
          </summary>
          <div class="ogis-share-menu__items">
            <button
              class="btn btn-sm btn-outline-secondary"
              @click="onShare($event, rec, 'gpx')"
            >
              GPX
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              @click="onShare($event, rec, 'geojson')"
            >
              GeoJSON
            </button>
          </div>
        </details>

        <button
          class="btn btn-sm btn-outline-danger"
          @click="confirmDelete(rec)"
        >
          {{ t("panel.recordings.delete") }}
        </button>
      </div>
    </div>
  </div>
</template>
