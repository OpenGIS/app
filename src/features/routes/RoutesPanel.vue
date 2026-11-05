<!-- RoutesPanel.vue — side-panel content for the GPX/GeoJSON routes feature -->
<script setup>
import { computed, inject, ref } from "vue";
import Icon from "@/components/ui/icon.vue";
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

const fileInput = ref(null);

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
  <div class="sidebar-section sidebar-section-body p-3 pb-2">
    <div class="ogis-routes-titlebar">
      <h5 class="mb-0">{{ t("menu.routes") }}</h5>
      <button
        type="button"
        class="btn ogis-routes-add"
        @click="fileInput?.click()"
      >
        <Icon name="plus-circle" width="16" height="16" aria-hidden="true" />
        {{ t("panel.routes.add") }}
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json"
        multiple
        class="visually-hidden"
        tabindex="-1"
        :aria-label="t('panel.routes.addLabel')"
        @change="onFiles"
      />
    </div>
    <div v-if="error" class="small text-danger mt-2">
      {{ errorMessage }}
    </div>
  </div>

  <div class="sidebar-section sidebar-section-body ogis-routes-list px-3 pb-3">
    <p v-if="!routes.length" class="text-body-tertiary small mb-0">
      {{ t("panel.routes.empty") }}
    </p>

    <div v-for="route in routes" :key="route.id" class="ogis-route-card">
      <div class="ogis-route-card__head">
        <span
          class="ogis-track-swatch"
          :style="{ backgroundColor: route.color }"
        ></span>
        <div class="ogis-route-card__text">
          <div class="ogis-track-name text-truncate">
            {{ route.name || t("panel.routes.defaultName") }}
          </div>
          <div class="ogis-route-card__meta">
            <span v-if="hasPoints(route)">
              {{
                formatDistance(documentDistance(route), isMetric, locale.value)
              }}
            </span>
            <span v-if="hasPoints(route) && hasWaypoints(route)"> · </span>
            <span v-if="hasWaypoints(route)">
              {{ t("panel.routes.waypoints", { count: waypointCount(route) }) }}
            </span>
          </div>
        </div>
        <button
          type="button"
          class="btn ogis-route-card__remove"
          :aria-label="t('panel.routes.delete')"
          :title="t('panel.routes.delete')"
          @click="confirmDelete(route)"
        >
          <Icon name="trash" width="16" height="16" aria-hidden="true" />
        </button>
      </div>

      <div class="ogis-route-card__actions">
        <button
          type="button"
          class="btn ogis-route-btn"
          :class="
            isVisible(route.id) ? 'ogis-route-btn--on' : 'ogis-route-btn--main'
          "
          :aria-pressed="isVisible(route.id)"
          :title="isVisible(route.id) ? t('panel.routes.hideHint') : undefined"
          @click="toggleVisibility(route.id)"
        >
          <Icon
            :name="isVisible(route.id) ? 'check' : 'map'"
            width="14"
            height="14"
            aria-hidden="true"
          />
          {{
            isVisible(route.id)
              ? t("panel.routes.hide")
              : t("panel.routes.show")
          }}
        </button>

        <button
          v-if="lineGeometry(route)"
          type="button"
          class="btn ogis-route-btn"
          :class="{ 'ogis-route-btn--main': navigating === route.id }"
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
          <Icon name="nav-arrow" width="14" height="14" aria-hidden="true" />
          {{
            navigating === route.id
              ? t("panel.routes.stop")
              : t("panel.routes.navigate")
          }}
        </button>

        <details class="ogis-share-menu">
          <summary class="btn ogis-route-btn">
            <Icon name="share" width="14" height="14" aria-hidden="true" />
            {{ t("panel.routes.share") }}
          </summary>
          <div class="ogis-share-menu__items">
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              @click="onShare($event, route, 'gpx')"
            >
              GPX
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              @click="onShare($event, route, 'geojson')"
            >
              GeoJSON
            </button>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>
