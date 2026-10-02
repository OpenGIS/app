<script setup>
import { computed, inject, ref, shallowRef, watch, nextTick } from "vue";
import { useUI } from "@/composables/useUI";
import { useLocale } from "@/composables/useLocale";
import { getMapInstance } from "@/composables/useMap";
import IconButton from "@/components/ui/icon-button.vue";
import InfoPanel from "@/components/panels/info.vue";

const instanceId = inject("onrteAppId", "app");
const buttonsRef = inject("navigatorButtons", shallowRef([]));
const panelsRef = inject("navigatorPanels", shallowRef([]));

const {
  isPanelVisible,
  isInfoVisible,
  activePanel,
  setActivePanel,
  closePanel,
  isDesktop,
} = useUI();
const { t } = useLocale();

// Built-in tabs are empty — the menu is feature-only. Kept as an extension point.
const builtInTabs = [];

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

// Defensive fallback: if the active tab no longer exists (stale session, feature
// not installed), show the first available tab so the pane never renders empty.
const effectivePanel = computed(() => {
  const ids = tabs.value.map((tab) => tab.id);
  if (ids.includes(activePanel.value)) return activePanel.value;
  return ids[0] ?? null;
});

const panelComponents = {};

const isCustomPanel = computed(
  () => !(effectivePanel.value in panelComponents),
);
const activeComponent = computed(
  () => panelComponents[effectivePanel.value] ?? null,
);

// Resolve a Vue component from custom button/panel configs
const activeCustomComponent = computed(() => {
  if (!isCustomPanel.value) return null;
  const btn = buttonsRef.value.find((b) => b.id === effectivePanel.value);
  if (btn?.panel?.component) return btn.panel.component;
  const panel = panelsRef.value.find((p) => p.id === effectivePanel.value);
  if (panel?.component) return panel.component;
  return null;
});

const activeCustomProps = computed(() => {
  const btn = buttonsRef.value.find((b) => b.id === effectivePanel.value);
  if (btn?.panel?.component) return btn.panel.props || {};
  const panel = panelsRef.value.find((p) => p.id === effectivePanel.value);
  if (panel?.component) return panel.props || {};
  return {};
});

// Ref for the custom panel render container (DOM-based fallback)
const customPanelContainer = ref(null);

// When the active panel switches to a custom one with a render function, call it
watch(
  [effectivePanel, customPanelContainer],
  async () => {
    if (!isCustomPanel.value || !customPanelContainer.value) return;
    if (activeCustomComponent.value) return;
    await nextTick();
    const map = getMapInstance(instanceId);
    const ctx = { map, instanceId };

    // Check button-based panels first, then standalone panels
    const btn = buttonsRef.value.find((b) => b.id === effectivePanel.value);
    if (btn?.panel?.render) {
      customPanelContainer.value.innerHTML = "";
      btn.panel.render(customPanelContainer.value, ctx);
      return;
    }
    const panel = panelsRef.value.find((p) => p.id === effectivePanel.value);
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
      <!-- Menu Pane: tab strip. Rendered whenever the Info pane is not active so
           the tabbed feature panels stay mounted while the pane is closed
           (offcanvas `show` class handles visibility). Switching to Info still
           unmounts them. -->
      <div v-if="!isInfoVisible" class="panel-nav border-bottom bg-body">
        <template v-for="tab in tabs" :key="tab.id">
          <IconButton
            v-if="tab.labelKey"
            :id="tab.btnId"
            :icon="tab.icon"
            :label="t(tab.labelKey)"
            :icon-width="32"
            :icon-height="32"
            :active="effectivePanel === tab.id"
            @click="setActivePanel(tab.id)"
          />
          <IconButton
            v-else
            :icon="tab.icon"
            :label="tab.label"
            :icon-width="32"
            :icon-height="32"
            :active="effectivePanel === tab.id"
            @click="setActivePanel(tab.id)"
          />
        </template>
      </div>

      <!-- Pane Content -->
      <div class="flex-grow-1 overflow-auto">
        <!-- Info Pane: rendered directly, without the tab strip -->
        <InfoPanel v-if="isInfoVisible" />

        <!-- Menu Pane: active tab content -->
        <template v-else>
          <component v-if="activeComponent" :is="activeComponent" />
          <component
            v-else-if="activeCustomComponent"
            :is="activeCustomComponent"
            v-bind="activeCustomProps"
          />
          <div v-else ref="customPanelContainer" class="p-3" />
        </template>
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
