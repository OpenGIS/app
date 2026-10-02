import AccountPanel from "./AccountPanel.vue";

export const AccountFeature = {
  install({ addPanel }) {
    addPanel({
      id: "account",
      icon: "person-circle",
      titleKey: "menu.account",
      component: AccountPanel,
    });
  },
};
