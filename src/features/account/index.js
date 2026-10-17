import AccountPanel from "./AccountPanel.vue";

export const AccountFeature = {
  install({ addPanel, useLocale }) {
    const { t } = useLocale();
    addPanel({
      id: "account",
      icon: "person-circle",
      title: () => t("menu.account"),
      component: AccountPanel,
    });
  },
};
