<script setup>
import { ref, inject, onMounted } from "vue";
import iconSprite from "@ogis/icons/dist/ogis-icons.svg?raw";

// UI
import Controls from "@/components/ui/controls.vue";
import Panels from "@/components/ui/panels.vue";
import About from "@/components/modals/welcome.vue";
import LocateConfirm from "@/components/modals/locate-confirm.vue";

import { useMap } from "@/composables/useMap";
import { useUI } from "@/composables/useUI";
import { useAttribution } from "@/composables/useAttribution";
import { useSettings } from "@/composables/useSettings";
import { useWakeLock } from "@/composables/useWakeLock";

const instanceId = inject("onrteAppId", "app");

// Map — template ref passed so useMap manages the full lifecycle
const mapContainer = ref(null);
useMap(mapContainer, {});

const { resolvedTheme } = useSettings();

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
  <div
    ref="rootEl"
    class="onrte-root position-fixed top-0 start-0 w-100 h-100 overflow-hidden"
    :data-bs-theme="resolvedTheme"
    :data-attrib-collapsed="attributionCollapsed ? 'true' : 'false'"
  >
    <div style="display: none" v-html="iconSprite"></div>

    <div class="onrte-content">
      <Panels />
    </div>

    <!-- Map -->
    <div
      ref="mapContainer"
      class="onrte-map"
      :data-onrte-id="instanceId"
      :class="{ 'panel-open': isPanelVisible && isDesktop }"
      @click="handleMapClick"
    />

    <!-- Corner controls overlay -->
    <Controls />

    <!-- Global modals -->
    <About />
    <LocateConfirm />
  </div>
</template>
