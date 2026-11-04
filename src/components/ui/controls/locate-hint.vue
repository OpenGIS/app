<script setup>
import { computed, watch, onBeforeUnmount } from "vue";
import { useLocale } from "@/composables/useLocale";
import { useLocateHints } from "@/composables/useLocateHints";
import Icon from "@/components/ui/icon.vue";

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
      <button
        type="button"
        class="ogis-locate-hint__close"
        :aria-label="t('locate.hint.dismiss')"
        :title="t('locate.hint.dismiss')"
        @click="dismiss"
      >
        <Icon name="x-circle" :width="18" :height="18" />
      </button>
    </div>
  </Transition>
</template>
