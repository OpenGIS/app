import MapsPanel from "./MapsPanel.vue";

export const MapsFeature = {
  install({ addPanel }) {
    addPanel({
      id: "maps",
      icon: "map",
      titleKey: "menu.maps",
      component: MapsPanel,
    });
  },
};
