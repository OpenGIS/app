<script setup>
import { computed } from "vue";
import { useLocale } from "@/composables/useLocale";
import { useSettings } from "@/composables/useSettings";

const { t, locale } = useLocale();
const { resolvedUnits } = useSettings();

const unitsLabel = computed(() =>
    resolvedUnits.value === "imperial"
        ? t("panel.settings.imperial")
        : t("panel.settings.metric"),
);

const languageLabel = computed(() => {
    try {
        return (
            new Intl.DisplayNames([locale.value], { type: "language" }).of(
                locale.value,
            ) || locale.value
        );
    } catch {
        return locale.value;
    }
});
</script>

<template>
    <div class="sidebar-section sidebar-section-body p-3 pb-0">
        <h5 class="mb-0">{{ t('panel.settings.title') }}</h5>
    </div>

    <div class="sidebar-section sidebar-section-body p-3 border-top">
        <h6 class="mb-3 text-muted small text-uppercase fw-semibold">{{ t('panel.settings.units') }}</h6>
        <p class="mb-0" id="settings-units">{{ unitsLabel }}</p>
        <p class="mb-0 text-body-secondary small">{{ t('panel.settings.fromDevice') }}</p>
    </div>

    <div class="sidebar-section sidebar-section-body p-3 border-top">
        <h6 class="mb-3 text-muted small text-uppercase fw-semibold">{{ t('panel.settings.language') }}</h6>
        <p class="mb-0" id="settings-language">{{ languageLabel }}</p>
        <p class="mb-0 text-body-secondary small">{{ t('panel.settings.fromDevice') }}</p>
    </div>
</template>
