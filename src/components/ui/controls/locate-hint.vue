<script setup>
import { computed, watch, onBeforeUnmount } from "vue";
import { useLocale } from "@/composables/useLocale";
import { useLocateHints } from "@/composables/useLocateHints";

const props = defineProps({
  mode: { type: String, default: null },
  headingPending: { type: Boolean, default: false },
  hasFix: { type: Boolean, default: true },
  orientationPending: { type: Boolean, default: false },
  canFollow: { type: Boolean, default: true },
  restoreSettled: { type: Boolean, default: true },
});

const { t } = useLocale();
const { current, showFor, dismiss } = useLocateHints();

const text = computed(() => {
  if (current.value === "idle") return t("locate.hint.idle");
  if (current.value === "active") return t("locate.hint.active");
  if (current.value === "following") return t("locate.hint.following");
  if (current.value === "heading") return t("locate.hint.heading");
  return "";
});

let booted = false;
watch(
  [
    () => props.mode,
    () => props.headingPending,
    () => props.hasFix,
    () => props.orientationPending,
    () => props.canFollow,
    () => props.restoreSettled,
  ],
  ([
    mode,
    headingPending,
    hasFix,
    orientationPending,
    canFollow,
    restoreSettled,
  ]) => {
    // A pending restore has not decided the chip's first state yet, so hold the
    // boot hint rather than flashing the idle one over it.
    if (!restoreSettled) return;
    showFor(mode, {
      boot: !booted,
      headingPending,
      hasFix,
      orientationPending,
      canFollow,
    });
    booted = true;
  },
  { immediate: true },
);

onBeforeUnmount(dismiss);
</script>

<template>
  <Transition name="ogis-locate-hint">
    <div
      v-if="current"
      class="ogis-locate-hint"
      :data-hint="current"
      role="status"
      aria-live="polite"
    >
      <span class="ogis-locate-hint__text">{{ text }}</span>
    </div>
  </Transition>
</template>
