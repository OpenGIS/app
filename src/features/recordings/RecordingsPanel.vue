<!-- RecordingsPanel.vue — side-panel content for the Recordings feature -->
<script setup>
import { inject, computed } from "vue";
import { useSettings } from "@/composables/useSettings.js";
import { useLocale } from "@/composables/useLocale";
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
  deleteRecording,
  downloadGPX,
  showOnMap,
} = inject("recordings");

const isActive = computed(() => state.isRecording || state.isPaused);

const sortedRecordings = computed(() =>
  [...state.saved].sort(
    (a, b) => b.timestamp - a.timestamp || Number(b.id) - Number(a.id),
  ),
);
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
      <div class="small text-body-secondary">
        {{ new Date(rec.timestamp).toLocaleString(formatLocale) }}
      </div>
      <div class="d-flex justify-content-between small">
        <span>{{ formatDuration(rec.duration) }}</span>
        <span>{{ formatDistance(rec.distance, isMetric, locale.value) }}</span>
      </div>
      <div class="d-flex gap-1 mt-1">
        <button class="btn btn-sm btn-outline-primary" @click="showOnMap(rec)">
          {{ t("panel.recordings.show") }}
        </button>
        <button
          class="btn btn-sm btn-outline-secondary"
          @click="downloadGPX(rec)"
        >
          {{ t("panel.recordings.gpx") }}
        </button>
        <button
          class="btn btn-sm btn-outline-danger"
          @click="deleteRecording(rec.id)"
        >
          {{ t("panel.recordings.delete") }}
        </button>
      </div>
    </div>
  </div>
</template>
