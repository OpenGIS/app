<script setup>
import { computed } from "vue";
import { useLocate } from "@/composables/useLocate";
import { useLocale } from "@/composables/useLocale";
import IconButton from "@/components/ui/icon-button.vue";
import LocateError from "@/components/modals/locate-error.vue";
import LocateHint from "@/components/ui/controls/locate-hint.vue";
import { useLocateHints } from "@/composables/useLocateHints";

const { mode, cycle, headingRecoveryPending } = useLocate();
const { t } = useLocale();
const { dismiss: dismissHint } = useLocateHints();

// A tap answers the hint on screen; the next state brings its own.
const onClick = () => {
  dismissHint();
  cycle();
};

const iconName = computed(() => {
  if (mode.value === "following") return "position-locked";
  if (mode.value === "active") return "position-unlocked";
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
    :icon-width="26"
    :icon-height="26"
    :icon-color="iconColor"
    :active="mode !== null && mode !== 'error'"
    :class="{ 'locate-btn--error': mode === 'error' }"
    :icon-size="36"
    :label-target="0.53"
    id="locate-button"
    :aria-label="label"
    @click="onClick"
  />
  <LocateHint :mode="mode" :heading-pending="headingRecoveryPending" />
  <LocateError />
</template>
