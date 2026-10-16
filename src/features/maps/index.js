import MapsPanel from "./MapsPanel.vue";

export const MapsFeature = {
  install({ addPanel, useLocale }) {
    const { t } = useLocale();
    addPanel({
      id: "maps",
      icon: "map",
      title: () => t("menu.maps"),
      component: MapsPanel,
    });
  },
};
