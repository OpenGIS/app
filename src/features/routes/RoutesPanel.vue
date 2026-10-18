<!-- RoutesPanel.vue — side-panel content for the GPX routes feature -->
<script setup>
import { computed, inject } from "vue";
import { useLocale } from "@/composables/useLocale";

const { t, locale } = useLocale();

const {
  routes,
  navigating,
  error,
  isMetric,
  importGPX,
  deleteRoute,
  showOnMap,
  startNavigation,
  stopNavigation,
  formatDistance,
} = inject("routes");

// Map the parser's stable error codes to translated messages; unknown errors
// fall back to the generic import failure rather than the raw message.
const errorMessage = computed(() => {
  const err = error.value;
  if (!err) return "";
  if (err.code === "invalid-gpx") return t("panel.routes.errorInvalidGpx");
  if (err.code === "no-routes") return t("panel.routes.errorNoRoutes");
  return t("panel.routes.errorImport");
});

const onFiles = async (e) => {
  for (const file of e.target.files) {
    await importGPX(file);
  }
  e.target.value = "";
};
</script>

<template>
  <div class="sidebar-section sidebar-section-body p-3 pb-0">
    <h5 class="mb-0">{{ t("menu.routes") }}</h5>
  </div>

  <div class="sidebar-section sidebar-section-body p-3 border-top">
    <input
      type="file"
      accept=".gpx,application/gpx+xml"
      multiple
      class="form-control"
      @change="onFiles"
    />
    <div v-if="error" class="small text-danger mt-2">
      {{ errorMessage }}
    </div>
  </div>

  <div class="sidebar-section sidebar-section-body p-3 border-top">
    <p v-if="!routes.length" class="text-body-tertiary small mb-0">
      {{ t("panel.routes.empty") }}
    </p>

    <div v-for="route in routes" :key="route.id" class="border-top py-2">
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <div class="fw-semibold">{{ route.name }}</div>
          <div class="small text-body-secondary">
            {{ formatDistance(route.distance, isMetric, locale.value) }}
          </div>
        </div>
        <div class="btn-group btn-group-sm" role="group">
          <button class="btn btn-outline-primary" @click="showOnMap(route.id)">
            {{ t("panel.routes.show") }}
          </button>
          <button
            v-if="navigating === route.id"
            class="btn btn-success"
            @click="stopNavigation"
          >
            {{ t("panel.routes.stop") }}
          </button>
          <button
            v-else
            class="btn btn-outline-success"
            @click="startNavigation(route.id)"
          >
            {{ t("panel.routes.navigate") }}
          </button>
          <button class="btn btn-outline-danger" @click="deleteRoute(route.id)">
            {{ t("panel.routes.delete") }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="navigating" class="border-top small text-body-secondary py-2">
      {{ t("panel.routes.navigating") }}
    </div>
  </div>
</template>
