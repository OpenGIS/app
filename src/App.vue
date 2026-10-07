<script setup>
import { ref, inject, onMounted } from "vue";
import iconSprite from "@/icons/ogis-icons.svg?raw";

// UI
import Controls from "@/components/ui/controls.vue";
import Panels from "@/components/ui/panels.vue";
import LocateConfirm from "@/components/modals/locate-confirm.vue";

import { useMap } from "@/composables/useMap";
import { useUI } from "@/composables/useUI";
import { useAttribution } from "@/composables/useAttribution";
import { useWakeLock } from "@/composables/useWakeLock";

const instanceId = inject("ogisAppId", "app");

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
  isPanelVisible,
  isPanelExpanded,
  isDesktop,
  isMobile,
} = useUI();

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
