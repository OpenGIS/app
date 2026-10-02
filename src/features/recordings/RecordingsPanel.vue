<!-- RecordingsPanel.vue — side-panel content for the Recordings feature -->
<script setup>
import { inject, computed } from "vue";
import { useSettings } from "@/composables/useSettings.js";
import { formatDuration, formatDistance } from "./index.js";

const { isMetric } = useSettings();

const {
  state,
  elapsed,
  distance,
  pause,
  resume,
  discard,
  save,
  deleteRecording,
  downloadGPX,
  showOnMap,
} = inject("recordings");

const isActive = computed(() => state.isRecording || state.isPaused);
</script>

<template>
  <div class="p-3">
    <!-- Active recording -->
    <template v-if="isActive">
      <h6 class="text-body-secondary mb-3">Current Recording</h6>

      <div class="d-flex justify-content-between mb-1">
        <span>Duration</span>
        <strong>{{ formatDuration(elapsed) }}</strong>
      </div>

      <div class="d-flex justify-content-between mb-3">
        <span>Distance</span>
        <strong>{{ formatDistance(distance, isMetric) }}</strong>
      </div>

      <div class="d-flex gap-2 mb-4">
        <button
          class="btn btn-sm"
          :class="state.isRecording ? 'btn-warning' : 'btn-primary'"
          @click="state.isRecording ? pause() : resume()"
        >
          {{ state.isRecording ? "Pause" : "Resume" }}
        </button>
        <button class="btn btn-sm btn-success" @click="save">Save</button>
        <button class="btn btn-sm btn-outline-danger" @click="discard">
          Discard
        </button>
      </div>
    </template>

    <!-- Saved recordings -->
    <h6 class="text-body-secondary">Saved Recordings</h6>

    <p v-if="!state.saved.length" class="text-body-tertiary small">
      No recordings yet.
    </p>

    <div v-for="rec in state.saved" :key="rec.id" class="border-top py-2">
      <div class="small text-body-secondary">
        {{ new Date(rec.timestamp).toLocaleString() }}
      </div>
      <div class="d-flex justify-content-between small">
        <span>{{ formatDuration(rec.duration) }}</span>
        <span>{{ formatDistance(rec.distance, isMetric) }}</span>
      </div>
      <div class="d-flex gap-1 mt-1">
        <button class="btn btn-sm btn-outline-primary" @click="showOnMap(rec)">
          Show
        </button>
        <button
          class="btn btn-sm btn-outline-secondary"
          @click="downloadGPX(rec)"
        >
          GPX
        </button>
        <button
          class="btn btn-sm btn-outline-danger"
          @click="deleteRecording(rec.id)"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
</template>
