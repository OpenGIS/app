<script setup>
import { ref, inject, onMounted, watch } from "vue";
import iconSprite from "@/icons/ogis-icons.svg?raw";

// UI
import Controls from "@/components/ui/controls.vue";
import Panels from "@/components/ui/panels.vue";
import LocateConfirm from "@/components/modals/locate-confirm.vue";

import { useMap } from "@/composables/useMap";
import { useUI } from "@/composables/useUI";
import { useActions } from "@/composables/useActions";
import { useLocale } from "@/composables/useLocale";
import { useAttribution } from "@/composables/useAttribution";
import { useWakeLock } from "@/composables/useWakeLock";

const instanceId = inject("ogisAppId", "app");

// Keep the meta description in sync with the active locale. The static English
// value in index.html is the no-JS default; this replaces it once the app boots.
const { locale, t } = useLocale();
watch(
  locale,
  () => {
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", t("app.description"));
  },
  { immediate: true },
);

// Map — template ref passed so useMap manages the full lifecycle
const mapContainer = ref(null);
useMap(mapContainer, {});

// Attribution collapse state — mirrored onto the root so theme.scss can place
// the MapLibre scale control inline beside the collapsed chip.
const { collapsed: attributionCollapsed } = useAttribution();

// UI Store
const {
  openInfo,
  togglePanelExpanded,
  visiblePane,
  isPanelVisible,
  isPanelExpanded,
  isDesktop,
  isMobile,
} = useUI();

const { activeModes } = useActions();

const handleMapClick = () => {
  // If Mobile Panel is visible and expanded, collapse it (minimize it)
  if (isMobile.value && isPanelVisible.value && isPanelExpanded.value) {
    togglePanelExpanded();
  }
};

if (isDesktop.value) {
  openInfo();
}

const rootEl = ref(null);
const { init: initWakeLock } = useWakeLock();
onMounted(() => initWakeLock());
</script>

<template>
  <!-- Percentage height fills the visible viewport in browser modes. iOS
       standalone viewport handling is addressed via the viewport meta (cover
       removed), as cover triggers an iOS 26.5.2 viewport shortfall. -->
  <div
    ref="rootEl"
    class="ogis-root position-fixed top-0 start-0 w-100 h-100 overflow-hidden"
    :data-attrib-collapsed="attributionCollapsed ? 'true' : 'false'"
    :data-modes="activeModes.length ? activeModes.join(' ') : null"
    :data-pane="visiblePane ?? 'closed'"
  >
    <div style="display: none" v-html="iconSprite"></div>

    <div class="ogis-content">
      <Panels />
    </div>

    <!-- Map -->
    <div
      ref="mapContainer"
      class="ogis-map"
      :data-ogis-id="instanceId"
      :class="{ 'panel-open': isPanelVisible && isDesktop }"
      @click="handleMapClick"
    />

    <!-- Corner controls overlay -->
    <Controls />

    <!-- Global modals -->
    <LocateConfirm />
  </div>
</template>
