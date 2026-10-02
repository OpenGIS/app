import CollectionsPanel from "./CollectionsPanel.vue";

export const CollectionsFeature = {
  install({ addPanel }) {
    addPanel({
      id: "collections",
      icon: "list",
      titleKey: "menu.collections",
      component: CollectionsPanel,
    });
  },
};
