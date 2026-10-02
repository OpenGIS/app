<script setup>
import { inject, computed, shallowRef } from "vue";
import { useUI } from "@/composables/useUI";
import { useLocale } from "@/composables/useLocale";
import IconButton from "@/components/ui/icon-button.vue";
import LocateButton from "@/components/ui/controls/locate.vue";
import AttributionControl from "@/components/ui/controls/attribution.vue";
import { getMapInstance } from "@/composables/useMap";

const instanceId = inject("ogisAppId", "app");
const buttonsRef = inject("navigatorButtons", shallowRef([]));

const {
  togglePanel,
  setActivePanel,
  openPanel,
  isPanelVisible,
  isMenuVisible,
  isDesktop,
} = useUI();
const { t } = useLocale();

const bottomRightButtons = computed(() =>
  buttonsRef.value.filter((b) => b.position === "bottom-right"),
);

const handleCustomClick = (btn) => {
  if (btn.panel) {
    setActivePanel(btn.id);
    openPanel();
  }
  if (typeof btn.onClick === "function") {
    const map = getMapInstance(instanceId);
    btn.onClick({ map, instanceId });
  }
};
</script>

<template>
  <div
    class="ogis-controls"
    :class="{ 'panel-open': isPanelVisible && isDesktop }"
  >
    <div class="ogis-corner ogis-corner--tl">
      <IconButton
        id="menu-button"
        chip
        icon="layout-sidebar-inset"
        :label="t('nav.menu')"
        :icon-width="20"
        :icon-height="20"
        :active="isMenuVisible"
        @click="togglePanel()"
      />
    </div>

    <div class="ogis-corner ogis-corner--tr">
      <LocateButton />
    </div>

    <div class="ogis-corner ogis-corner--br">
      <template v-for="btn in bottomRightButtons" :key="btn.id">
        <component
          v-if="btn.component"
          :is="btn.component"
          v-bind="btn.props || {}"
        />
        <IconButton
          v-else
          chip
          :icon="btn.icon"
          :label="btn.labelKey ? t(btn.labelKey) : btn.label"
          :data-custom-button="btn.id"
          @click="handleCustomClick(btn)"
        />
      </template>
    </div>

    <div class="ogis-corner ogis-corner--bl">
      <AttributionControl />
    </div>
  </div>
</template>
