<script setup>
import { computed, watch, onBeforeUnmount } from "vue";
import { useLocale } from "@/composables/useLocale";
import { useLocateHints } from "@/composables/useLocateHints";

const props = defineProps({
  mode: { type: String, default: null },
});

const { t } = useLocale();
const { current, showFor, dismiss } = useLocateHints();

const text = computed(() => {
  if (current.value === "idle") return t("locate.hint.idle");
  if (current.value === "active") return t("locate.hint.active");
  if (current.value === "following") return t("locate.hint.following");
  return "";
});

let booted = false;
watch(
  () => props.mode,
  (mode) => {
    showFor(mode, { boot: !booted });
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
