<script setup>
import { computed, ref } from "vue";
import { useMap } from "@/composables/useMap";
import { useLocale } from "@/composables/useLocale";
import { useAttribution } from "@/composables/useAttribution";
import { formatUrlHash } from "@/composables/useUrlHash";
import Icon from "@/components/ui/icon.vue";

const { mapView } = useMap();
const { t } = useLocale();

// Attribution HTML comes from our trusted style (OpenGIS/outdoors style.json),
// so rendering it with v-html is safe.
const { attributionHtml } = useAttribution();

const copied = ref(false);

const shareUrl = computed(() => {
  const base = `${window.location.origin}${window.location.pathname}`;
  if (!mapView.value) return `${base}${window.location.hash}` || base;
  const { lat, lng, zoom, pitch, bearing } = mapView.value;
  return `${base}${formatUrlHash(zoom, lat, lng, pitch, bearing)}`;
});

const osmUrl = computed(() => {
  if (!mapView.value) return null;
  const { lat, lng } = mapView.value;
  const zoom = Math.round(mapView.value.zoom);
  return `https://www.openstreetmap.org/#map=${zoom}/${lat.toFixed(6)}/${lng.toFixed(6)}`;
});

const osmEditUrl = computed(() => {
  if (!mapView.value) return null;
  const { lat, lng } = mapView.value;
  const zoom = Math.round(mapView.value.zoom);
  return `https://www.openstreetmap.org/edit#map=${zoom}/${lat.toFixed(6)}/${lng.toFixed(6)}`;
});

const copyLink = async () => {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    const el = document.querySelector(".onrte-share-textarea");
    if (el) {
      el.select();
      document.execCommand("copy");
    }
  }
};
</script>

<template>
  <div class="onrte-info-panel d-flex flex-column flex-grow-1">
    <!-- Map View -->
    <div class="sidebar-section sidebar-section-body p-3 pb-0">
      <h5 class="mb-0">{{ t("panel.view.title") }}</h5>
    </div>

    <div class="sidebar-section sidebar-section-body p-3 border-top">
      <p class="mb-2 small text-body-secondary">
        {{ t("panel.view.shareDescription") }}
      </p>

      <textarea
        id="onrte-share-url"
        name="onrte-share-url"
        class="onrte-share-textarea form-control form-control-sm font-monospace mb-2"
        :value="shareUrl"
        readonly
        rows="3"
        @focus="$event.target.select()"
      ></textarea>

      <button
        type="button"
        class="btn btn-sm w-100 d-flex align-items-center justify-content-center gap-1"
        :class="copied ? 'btn-success' : 'btn-outline-primary'"
        @click="copyLink"
      >
        <Icon
          width="16"
          height="16"
          fill="currentColor"
          :name="copied ? 'check' : 'globe'"
        />
        {{ copied ? t("panel.view.copied") : t("panel.view.copyLink") }}
      </button>

      <hr class="my-2 opacity-25" />

      <div class="d-flex gap-2">
        <a
          class="btn btn-sm btn-outline-secondary flex-fill d-flex align-items-center justify-content-center gap-1"
          :href="osmUrl ?? '#'"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon width="14" height="14" fill="currentColor" name="globe" />
          {{ t("panel.view.viewOnOsm") }}
        </a>
        <a
          class="btn btn-sm btn-outline-secondary flex-fill d-flex align-items-center justify-content-center gap-1"
          :href="osmEditUrl ?? '#'"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon width="14" height="14" fill="currentColor" name="pencil" />
          {{ t("panel.view.editOnOsm") }}
        </a>
      </div>
    </div>

    <!-- About -->
    <div class="sidebar-section sidebar-section-body p-3 border-top onrte-about-section">
      <h5 class="mb-2">{{ t("panel.about.title") }}</h5>
      <p class="mb-2 small text-body-secondary">
        {{ t("panel.about.summary") }}
      </p>

      <details class="onrte-disclosure">
        <summary>{{ t("panel.info.readMore") }}</summary>

        <div class="pt-2">
          <p class="lead">{{ t("panel.about.descriptionOne") }}</p>

          <p>{{ t("panel.about.descriptionTwo") }}</p>

          <p>{{ t("panel.about.descriptionThree") }}</p>

          <p>
            {{ t("panel.about.by") }}
            <a href="https://github.com/OpenGIS/navigator">GitHub</a>.
          </p>

          <h6 class="mb-3 w-100 d-flex align-items-center">
            {{ t("panel.about.thanksOpenSource") }}
            <Icon
              class="ms-auto text-danger"
              width="32"
              height="32"
              fill="currentColor"
              name="heart"
            />
          </h6>

          <div class="d-flex flex-column gap-3">
            <div class="d-flex align-items-center">
              <span class="badge bg-danger bg-opacity-10 text-danger rounded-pill me-2">
                {{ t("panel.about.mapData") }}
              </span>
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener"
                class="text-body text-end small ms-auto text-decoration-underline"
              >
                &copy; OpenStreetMap contributors
              </a>
            </div>

            <div class="d-flex align-items-center">
              <span class="badge bg-primary bg-opacity-10 text-primary rounded-pill me-2">
                {{ t("panel.about.tileHosting") }}
              </span>
              <a
                href="https://openfreemap.org"
                target="_blank"
                rel="noopener"
                class="text-body text-end small ms-auto text-decoration-underline"
              >
                OpenFreeMap
              </a>
            </div>

            <div class="d-flex align-items-center">
              <span class="badge bg-warning bg-opacity-10 text-warning rounded-pill me-2">
                {{ t("panel.about.rendering") }}
              </span>
              <a
                href="https://maplibre.org/"
                target="_blank"
                rel="noopener"
                class="text-body text-end small ms-auto text-decoration-underline"
              >
                MapLibre GL JS
              </a>
            </div>

            <div class="d-flex align-items-center">
              <span class="badge bg-info bg-opacity-10 text-info rounded-pill me-2">
                {{ t("panel.about.tileSchema") }}
              </span>
              <a
                href="https://www.openmaptiles.org/"
                target="_blank"
                rel="noopener"
                class="text-body text-end small text-decoration-underline"
              >
                OpenMapTiles</a
              >
              &nbsp;/&nbsp;
              <a
                href="https://github.com/openmaptiles/osm-bright-gl-style"
                target="_blank"
                rel="noopener"
                class="text-body text-end small text-decoration-underline"
                >OSM Bright</a
              >
            </div>

            <div class="d-flex align-items-center">
              <span class="badge bg-success bg-opacity-10 text-success rounded-pill me-2">
                {{ t("panel.about.userInterface") }}
              </span>
              <span class="ms-auto small">
                <a
                  href="https://vuejs.org/"
                  target="_blank"
                  rel="noopener"
                  class="text-body text-end text-decoration-underline"
                  >Vue JS</a
                >
                &nbsp;/&nbsp;
                <a
                  href="https://getbootstrap.com/"
                  target="_blank"
                  rel="noopener"
                  class="text-body text-end text-decoration-underline"
                  >Bootstrap</a
                >
              </span>
            </div>
          </div>
        </div>
      </details>
    </div>

    <!-- Privacy -->
    <div class="sidebar-section sidebar-section-body p-3 border-top onrte-privacy-section">
      <h5 class="mb-2">{{ t("panel.privacy.title") }}</h5>
      <p class="mb-2 small text-body-secondary">
        {{ t("panel.privacy.summary") }}
      </p>

      <details class="onrte-disclosure">
        <summary>{{ t("panel.info.readMore") }}</summary>

        <div class="pt-2">
          <h6 class="mb-2 text-muted small text-uppercase fw-semibold">
            {{ t("panel.privacy.onDevice") }}
          </h6>
          <p class="mb-2 small">{{ t("panel.privacy.onDeviceBody") }}</p>
          <ul class="mb-3 small ps-3">
            <li>{{ t("panel.privacy.mapView") }}</li>
          </ul>

          <h6 class="mb-2 text-muted small text-uppercase fw-semibold">
            {{ t("panel.privacy.thirdParty") }}
          </h6>
          <p class="mb-3 small">{{ t("panel.privacy.thirdPartyBody") }}</p>

          <h6 class="mb-2 text-muted small text-uppercase fw-semibold">
            {{ t("panel.privacy.location") }}
          </h6>
          <p class="mb-3 small">{{ t("panel.privacy.locationBody") }}</p>

          <h6 class="mb-2 text-muted small text-uppercase fw-semibold">
            {{ t("panel.privacy.noTracking") }}
          </h6>
          <p class="mb-0 small">{{ t("panel.privacy.noTrackingBody") }}</p>
        </div>
      </details>
    </div>

    <!-- Attribution -->
    <div class="sidebar-section sidebar-section-body p-3 border-top onrte-attribution-section">
      <h5 class="mb-2">{{ t("panel.info.attribution") }}</h5>
      <p class="mb-0 small onrte-attribution-text" v-html="attributionHtml"></p>
    </div>
  </div>
</template>
