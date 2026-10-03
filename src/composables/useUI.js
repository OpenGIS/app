import { ref, computed, inject } from "vue";
import { emitter } from "@/emitter.js";

// Module-level state — one UI state per app context.
const instances = new Map();
const resizeCleanups = new Map();

function createState() {
  return {
    width: ref(window.innerWidth),
    visiblePane: ref(null),
    isPanelExpanded: ref(false),
    activePanel: ref("record"),
  };
}

/**
 * Composable for UI state management.
 *
 * Manages responsive breakpoints and side panel visibility. State is shared
 * across all callers within the app.
 */
export const useUI = () => {
  const instanceId = inject("ogisAppId", "app");

  if (!instances.has(instanceId)) {
    instances.set(instanceId, createState());

    const s = instances.get(instanceId);
    const onResize = () => {
      s.width.value = window.innerWidth;
    };

    window.addEventListener("resize", onResize);
    resizeCleanups.set(instanceId, () =>
      window.removeEventListener("resize", onResize),
    );
  }

  const s = instances.get(instanceId);

  // --- Computed ---

  const isDesktop = computed(() => s.width.value >= 992);
  const isTablet = computed(() => s.width.value >= 768 && s.width.value < 992);
  const isMobile = computed(() => s.width.value < 768);

  // The side column hosts one of two independent panes: the menu (tabbed)
  // or the info pane, which renders directly without a tab strip.
  const isPanelVisible = computed(() => s.visiblePane.value !== null);
  const isMenuVisible = computed(() => s.visiblePane.value === "menu");
  const isInfoVisible = computed(() => s.visiblePane.value === "info");

  // --- Actions ---

  const openPanel = () => {
    s.visiblePane.value = "menu";
    s.isPanelExpanded.value = true;
  };

  const togglePanel = () => {
    if (s.visiblePane.value === "menu") {
      s.visiblePane.value = null;
    } else {
      openPanel();
    }
  };

  const closePanel = () => {
    s.visiblePane.value = null;
  };

  const openInfo = () => {
    s.visiblePane.value = "info";
    s.isPanelExpanded.value = true;
  };

  const toggleInfo = () => {
    if (s.visiblePane.value === "info") {
      s.visiblePane.value = null;
    } else {
      openInfo();
    }
  };

  const togglePanelExpanded = () => {
    s.isPanelExpanded.value = !s.isPanelExpanded.value;
  };

  const setPanelExpanded = (value) => {
    s.isPanelExpanded.value = value;
  };

  const setActivePanel = (id) => {
    s.activePanel.value = id;
    emitter.emit("panel:change", id);
  };

  return {
    // State
    width: s.width,
    visiblePane: s.visiblePane,
    isPanelExpanded: s.isPanelExpanded,
    activePanel: s.activePanel,

    // Computed
    isDesktop,
    isTablet,
    isMobile,
    isPanelVisible,
    isMenuVisible,
    isInfoVisible,

    // Actions
    openPanel,
    togglePanel,
    closePanel,
    openInfo,
    toggleInfo,
    togglePanelExpanded,
    setPanelExpanded,
    setActivePanel,
  };
};
