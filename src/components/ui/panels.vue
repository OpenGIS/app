<script setup>
import { computed, inject, ref, shallowRef, watch, nextTick } from "vue";
import { useUI } from "@/composables/useUI";
import { useLocale } from "@/composables/useLocale";
import { getMapInstance } from "@/composables/useMap";
import IconButton from "@/components/ui/icon-button.vue";
import InfoPanel from "@/components/panels/info.vue";
import SettingsPanel from "@/components/panels/settings.vue";

const instanceId = inject("onrteAppId", "app");
const buttonsRef = inject("navigatorButtons", shallowRef([]));
const panelsRef = inject("navigatorPanels", shallowRef([]));

const { isPanelVisible, activePanel, setActivePanel, closePanel, isDesktop } = useUI();
const { t } = useLocale();

const builtInTabs = [
  { id: "info",     icon: "info-circle", labelKey: "menu.info",     btnId: "info-button" },
  { id: "settings", icon: "gear",        labelKey: "menu.settings", btnId: "settings-button" },
];

// Custom buttons that have a panel definition become additional tabs
const buttonTabs = computed(() =>
  buttonsRef.value
    .filter((b) => b.panel)
    .map((b) => ({
      id: b.id,
      icon: b.icon,
      labelKey: b.panel.titleKey || b.labelKey || null,
      label: b.panel.title || b.label,
    })),
);

// Standalone custom panels (no toolbar button required)
const panelTabs = computed(() =>
  panelsRef.value.map((p) => ({
    id: p.id,
    icon: p.icon,
    labelKey: p.titleKey || null,
    label: p.title,
  })),
);

const tabs = computed(() => [
  ...builtInTabs,
  ...buttonTabs.value,
  ...panelTabs.value,
]);

const panelComponents = {
  info:     InfoPanel,
  settings: SettingsPanel,
};

const isCustomPanel = computed(() => !(activePanel.value in panelComponents));
const activeComponent = computed(() => panelComponents[activePanel.value] ?? null);

// Resolve a Vue component from custom button/panel configs
const activeCustomComponent = computed(() => {
  if (!isCustomPanel.value) return null;
  const btn = buttonsRef.value.find((b) => b.id === activePanel.value);
  if (btn?.panel?.component) return btn.panel.component;
  const panel = panelsRef.value.find((p) => p.id === activePanel.value);
  if (panel?.component) return panel.component;
  return null;
});

const activeCustomProps = computed(() => {
  const btn = buttonsRef.value.find((b) => b.id === activePanel.value);
  if (btn?.panel?.component) return btn.panel.props || {};
  const panel = panelsRef.value.find((p) => p.id === activePanel.value);
  if (panel?.component) return panel.props || {};
  return {};
});

// Ref for the custom panel render container (DOM-based fallback)
const customPanelContainer = ref(null);

// When the active panel switches to a custom one with a render function, call it
watch(
  [activePanel, customPanelContainer],
  async () => {
    if (!isCustomPanel.value || !customPanelContainer.value) return;
    if (activeCustomComponent.value) return;
    await nextTick();
    const map = getMapInstance(instanceId);
    const ctx = { map, instanceId };

    // Check button-based panels first, then standalone panels
    const btn = buttonsRef.value.find((b) => b.id === activePanel.value);
    if (btn?.panel?.render) {
      customPanelContainer.value.innerHTML = "";
      btn.panel.render(customPanelContainer.value, ctx);
      return;
    }
    const panel = panelsRef.value.find((p) => p.id === activePanel.value);
    if (panel?.render) {
      customPanelContainer.value.innerHTML = "";
      panel.render(customPanelContainer.value, ctx);
    }
  },
  { flush: "post" },
);
</script>

<template>
  <div
    class="offcanvas offcanvas-start onrte-panel"
    :class="{ show: isPanelVisible }"
    tabindex="-1"
    aria-labelledby="offcanvasLabel"
    data-bs-scroll="true"
    data-bs-backdrop="false"
  >
    <div class="offcanvas-body p-0 d-flex flex-column">
      <!-- Panel Nav -->
      <div class="panel-nav border-bottom bg-body">
        <template v-for="tab in tabs" :key="tab.id">
          <IconButton
            v-if="tab.labelKey"
            :id="tab.btnId"
            :icon="tab.icon"
            :label="t(tab.labelKey)"
            :icon-width="32"
            :icon-height="32"
            :active="activePanel === tab.id"
            @click="setActivePanel(tab.id)"
          />
          <IconButton
            v-else
            :icon="tab.icon"
            :label="tab.label"
            :icon-width="32"
            :icon-height="32"
            :active="activePanel === tab.id"
            @click="setActivePanel(tab.id)"
          />
        </template>
      </div>

      <!-- Active Panel Content -->
      <div class="flex-grow-1 overflow-auto">
        <component v-if="activeComponent" :is="activeComponent" />
        <component v-else-if="activeCustomComponent" :is="activeCustomComponent" v-bind="activeCustomProps" />
        <div v-else ref="customPanelContainer" class="p-3" />
      </div>
    </div>
  </div>

  <!-- Backdrop for mobile -->
  <div
    v-if="isPanelVisible && !isDesktop"
    class="offcanvas-backdrop fade show"
    @click="closePanel()"
  ></div>
</template>

