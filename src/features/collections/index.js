import CollectionsPanel from "./CollectionsPanel.vue";

export const CollectionsFeature = {
  install({ addPanel, useLocale }) {
    const { t } = useLocale();
    addPanel({
      id: "collections",
      icon: "list",
      title: () => t("menu.collections"),
      component: CollectionsPanel,
    });
  },
};
