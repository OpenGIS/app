<script setup>
import { computed } from "vue";
import { useLocate } from "@/composables/useLocate";
import { useLocale } from "@/composables/useLocale";
import IconButton from "@/components/ui/icon-button.vue";
import LocateError from "@/components/modals/locate-error.vue";

const { mode, cycle } = useLocate();
const { t } = useLocale();

const iconName = computed(() => {
  if (mode.value === "following") return "position-lock";
  return "position";
});

const iconColor = computed(() => {
  if (mode.value === "active" || mode.value === "following")
    return "var(--bs-primary)";
  if (mode.value === "error") return "var(--bs-danger)";
  return "currentColor";
});

const label = computed(() => {
  if (mode.value === "active") return t("locate.button.located");
  if (mode.value === "following") return t("locate.button.following");
  if (mode.value === "error") return t("locate.button.error");
  return t("locate.button.locate");
});
</script>

<template>
  <IconButton
    chip
    :icon="iconName"
    :label="label"
    :icon-width="20"
    :icon-height="20"
    :icon-color="iconColor"
    :active="mode !== null && mode !== 'error'"
    :class="{ 'locate-btn--error': mode === 'error' }"
    id="locate-button"
    :aria-label="label"
    @click="cycle"
  />
  <LocateError />
</template>
