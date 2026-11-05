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

const isTilt = computed(() => current.value === "tilt");

// Touch screens pinch and twist; mice use the wheel and right-click drag.
const coarse =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;
const gestures = computed(() =>
  coarse
    ? [
        { icon: "pinch", text: t("locate.hint.tilt.zoom") },
        { icon: "twist", text: t("locate.hint.tilt.rotate") },
        { icon: "slide", text: t("locate.hint.tilt.tilt") },
      ]
    : [
        { icon: "pinch", text: t("locate.hint.tilt.zoomMouse") },
        { icon: "twist", text: t("locate.hint.tilt.rotateMouse") },
        { icon: "slide", text: t("locate.hint.tilt.tiltMouse") },
      ],
);

const text = computed(() => {
  if (current.value === "idle") return t("locate.hint.idle");
  if (current.value === "active") return t("locate.hint.active");
  if (current.value === "following") return t("locate.hint.following");
  return "";
});

let booted = false;
watch(
  () => props.mode,
  (mode, previous) => {
    showFor(mode, { boot: !booted, previous });
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
      <div v-if="isTilt" class="ogis-locate-hint__tilt">
        <strong class="ogis-locate-hint__title">{{
          t("locate.hint.tilt.title")
        }}</strong>
        <ul class="ogis-locate-hint__gestures">
          <li v-for="g in gestures" :key="g.icon">
            <svg
              class="ogis-locate-hint__gesture"
              viewBox="0 0 24 24"
              width="28"
              height="28"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <template v-if="g.icon === 'pinch'">
                <path d="M4 4l6 6M4 4v4M4 4h4" />
                <path d="M20 20l-6-6M20 20v-4M20 20h-4" />
              </template>
              <template v-else-if="g.icon === 'twist'">
                <path d="M19 12a7 7 0 1 1-2.1-5" />
                <path d="M19 3v4h-4" />
              </template>
              <template v-else>
                <path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />
              </template>
            </svg>
            <span>{{ g.text }}</span>
          </li>
        </ul>
      </div>
      <span v-else class="ogis-locate-hint__text">{{ text }}</span>
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
