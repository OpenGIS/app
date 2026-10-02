<!-- RecordButton.vue — corner control chip that toggles recording -->
<script setup>
import { inject, computed } from "vue";
import { useUI } from "@/composables/useUI.js";
import IconButton from "@/components/ui/icon-button.vue";

const { state, start, pause, resume } = inject("recordings");
const { setActivePanel, openPanel } = useUI();

const toggle = () => {
  if (state.isRecording) {
    pause();
    setActivePanel("record");
    openPanel();
  } else if (state.isPaused) {
    resume();
  } else {
    start();
    setActivePanel("record");
    openPanel();
  }
};

const isActive = computed(() => state.isRecording || state.isPaused);

const iconName = computed(() => (isActive.value ? "pause-circle" : "circle"));

const iconColor = computed(() =>
  isActive.value ? "var(--bs-primary)" : "currentColor",
);

const label = computed(() => {
  if (state.isRecording) return "Recording";
  if (state.isPaused) return "Paused";
  return "Record";
});
</script>

<template>
  <IconButton
    id="recordings-button"
    chip
    :icon="iconName"
    :label="label"
    :icon-width="20"
    :icon-height="20"
    :icon-color="iconColor"
    :active="isActive"
    @click="toggle"
  />
</template>
