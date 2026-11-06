<!-- RoutesPanel.vue — side-panel content for the GPX/GeoJSON routes feature -->
<script setup>
import { computed, inject } from "vue";
import { useLocale } from "@/composables/useLocale";
import {
  documentDistance,
  documentPointCount,
  lineGeometry,
  waypointCount,
} from "@/utils/track/index.js";

const { t, locale } = useLocale();

const {
  routes,
  navigating,
  error,
  isMetric,
  importTracks,
  deleteRoute,
  toggleVisibility,
  isVisible,
  startNavigation,
  stopNavigation,
  shareTrack,
  formatDistance,
} = inject("routes");

// Map the importer's stable error codes to translated messages; unknown errors
// fall back to the generic import failure rather than the raw message.
const errorMessage = computed(() => {
  const err = error.value;
  if (!err) return "";
  switch (err.code) {
    case "invalid-gpx":
      return t("panel.routes.errorInvalidGpx");
    case "invalid-geojson":
      return t("panel.routes.errorInvalidGeoJSON");
    case "unsupported-format":
      return t("panel.routes.errorUnsupported");
    case "no-importable-features":
      return t("panel.routes.errorNoRoutes");
    case "file-too-large":
      return t("panel.routes.errorTooLarge");
    default:
      return t("panel.routes.errorImport");
  }
});

const hasPoints = (route) => documentPointCount(route) > 0;
const hasWaypoints = (route) => waypointCount(route) > 0;

const navigateTitle = (route) => {
  if (!isVisible(route.id)) return t("panel.routes.navigateHidden");
  if (navigating.value && navigating.value !== route.id) {
    return t("panel.routes.navigateBusy");
  }
  return undefined;
};

const onFiles = async (event) => {
  const files = Array.from(event.target.files ?? []);
  await importTracks(files);
  event.target.value = "";
};

const onShare = async (event, route, format) => {
  event.currentTarget.closest("details")?.removeAttribute("open");
  await shareTrack(route, format);
};

const confirmDelete = (route) => {
  const name = route.name || t("panel.routes.defaultName");
  if (!window.confirm(t("panel.routes.confirmDelete", { name }))) return;
  deleteRoute(route.id);
};
</script>

<template>
  <div class="sidebar-section sidebar-section-body p-3 pb-0">
    <h5 class="mb-0">{{ t("menu.routes") }}</h5>
  </div>

  <div class="sidebar-section sidebar-section-body p-3 border-top">
    <input
      type="file"
      accept=".gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json"
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
      <div class="d-flex align-items-center gap-2">
        <span
          class="ogis-track-swatch"
          :style="{ backgroundColor: route.color }"
        ></span>
        <span class="ogis-track-name fw-semibold text-truncate">
          {{ route.name || t("panel.routes.defaultName") }}
        </span>
      </div>

      <div class="small text-body-secondary">
        <span v-if="hasPoints(route)">
          {{ formatDistance(documentDistance(route), isMetric, locale.value) }}
        </span>
        <span v-if="hasPoints(route) && hasWaypoints(route)"> · </span>
        <span v-if="hasWaypoints(route)">
          {{ t("panel.routes.waypoints", { count: waypointCount(route) }) }}
        </span>
      </div>

      <div class="d-flex flex-wrap gap-1 mt-1">
        <button
          class="btn btn-sm"
          :class="isVisible(route.id) ? 'btn-primary' : 'btn-outline-primary'"
          :aria-pressed="isVisible(route.id)"
          @click="toggleVisibility(route.id)"
        >
          {{
            isVisible(route.id)
              ? t("panel.routes.hide")
              : t("panel.routes.show")
          }}
        </button>

        <button
          v-if="lineGeometry(route)"
          class="btn btn-sm"
          :class="
            navigating === route.id ? 'btn-success' : 'btn-outline-success'
          "
          :disabled="
            !isVisible(route.id) ||
            Boolean(navigating && navigating !== route.id)
          "
          :title="navigateTitle(route)"
          @click="
            navigating === route.id
              ? stopNavigation()
              : startNavigation(route.id)
          "
        >
          {{
            navigating === route.id
              ? t("panel.routes.stop")
              : t("panel.routes.navigate")
          }}
        </button>

        <details class="ogis-share-menu">
          <summary class="btn btn-sm btn-outline-secondary">
            {{ t("panel.routes.share") }}
          </summary>
          <div class="ogis-share-menu__items">
            <button
              class="btn btn-sm btn-outline-secondary"
              @click="onShare($event, route, 'gpx')"
            >
              GPX
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              @click="onShare($event, route, 'geojson')"
            >
              GeoJSON
            </button>
          </div>
        </details>

        <button
          class="btn btn-sm btn-outline-danger"
          @click="confirmDelete(route)"
        >
          {{ t("panel.routes.delete") }}
        </button>
      </div>
    </div>
  </div>
</template>
