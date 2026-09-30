<script setup>
import { computed, inject, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { useUI } from "@/composables/useUI";
import { useLocale } from "@/composables/useLocale";
import { useAttribution } from "@/composables/useAttribution";
import { getMapInstance } from "@/composables/useMap";
import { emitter } from "@/emitter.js";
import Icon from "@/components/ui/icon.vue";

const instanceId = inject("onrteAppId", "app");
const { activePanel, isPanelVisible, setActivePanel, openPanel } = useUI();
const { t } = useLocale();

// Attribution HTML comes from our trusted style (OpenGIS/outdoors style.json),
// so rendering it with v-html is safe.
const { attributionHtml } = useAttribution();

// Expanded on load, then collapsed on the first user drag — exact parity with
// MapLibre's built-in attribution control. It never expands again.
const collapsed = ref(false);

const seenMap = shallowRef(null);

const onDrag = () => {
  collapsed.value = true;
};

const attach = (map) => {
  seenMap.value = map;
  map.on("drag", onDrag);
};

onMounted(() => {
  const existing = getMapInstance(instanceId);
  if (existing) {
    attach(existing);
  } else {
    emitter.once("map:ready", ({ map }) => attach(map));
  }
});

onUnmounted(() => {
  if (seenMap.value) seenMap.value.off("drag", onDrag);
});

const isActive = computed(
  () => isPanelVisible.value && activePanel.value === "info",
);

// Any click opens the Info panel — the chip never toggles or expands itself,
// and links inside it are decoration only (pointer-events disabled in CSS).
const openInfo = () => {
  setActivePanel("info");
  openPanel();
};
</script>

<template>
  <button
    type="button"
    id="attribution-button"
    class="icon-btn icon-btn--chip onrte-attribution-chip d-flex align-items-center flex-row"
    :aria-pressed="isActive"
    :aria-label="t('menu.info')"
    @click="openInfo"
  >
    <div class="icon-btn__icon">
      <Icon :width="20" :height="20" name="info-circle" />
    </div>
    <span
      v-if="!collapsed"
      class="icon-btn__label onrte-attribution-chip__text"
      v-html="attributionHtml"
    ></span>
  </button>
</template>
