<script setup>
import { useLocale } from "@/composables/useLocale";

const { t } = useLocale();
</script>

<template>
  <div class="onrte-privacy-panel d-flex flex-column flex-grow-1">
    <div class="sidebar-section sidebar-section-body p-3 pb-0">
      <h5 class="mb-0">{{ t('panel.privacy.title') }}</h5>
    </div>

    <div class="sidebar-section sidebar-section-body p-3 border-top">
      <h6 class="mb-2 text-muted small text-uppercase fw-semibold">{{ t('panel.privacy.onDevice') }}</h6>
      <p class="mb-2 small">{{ t('panel.privacy.onDeviceBody') }}</p>
      <ul class="mb-0 small ps-3">
        <li>{{ t('panel.privacy.mapView') }}</li>
      </ul>
    </div>

    <div class="sidebar-section sidebar-section-body p-3 border-top">
      <h6 class="mb-2 text-muted small text-uppercase fw-semibold">{{ t('panel.privacy.thirdParty') }}</h6>
      <p class="mb-0 small">{{ t('panel.privacy.thirdPartyBody') }}</p>
    </div>

    <div class="sidebar-section sidebar-section-body p-3 border-top">
      <h6 class="mb-2 text-muted small text-uppercase fw-semibold">{{ t('panel.privacy.location') }}</h6>
      <p class="mb-0 small">{{ t('panel.privacy.locationBody') }}</p>
    </div>

    <div class="sidebar-section sidebar-section-body p-3 border-top">
      <h6 class="mb-2 text-muted small text-uppercase fw-semibold">{{ t('panel.privacy.noTracking') }}</h6>
      <p class="mb-0 small">{{ t('panel.privacy.noTrackingBody') }}</p>
    </div>
  </div>
</template>
