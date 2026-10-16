<script setup>
import { computed, inject, ref } from "vue";
import { useMap, getMapInstance, fitCountryBounds } from "@/composables/useMap";
import { useLocale } from "@/composables/useLocale";
import { useAttribution } from "@/composables/useAttribution";
import { formatUrlHash } from "@/composables/useUrlHash";
import Icon from "@/components/ui/icon.vue";

const { mapView } = useMap();
const { t } = useLocale();
const instanceId = inject("ogisAppId", "app");

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

const osmNoteUrl = computed(() => {
  if (!mapView.value) return null;
  const { lat, lng } = mapView.value;
  const zoom = Math.round(mapView.value.zoom);
  return `https://www.openstreetmap.org/note/new#map=${zoom}/${lat.toFixed(6)}/${lng.toFixed(6)}&layers=DN`;
});

const randomUrl = computed(() => {
  const url = new URL(window.location.href);
  url.searchParams.set("country", "random");
  return `${url.pathname}${url.search}`;
});

const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    const el = document.querySelector(".ogis-share-textarea");
    if (el) {
      el.select();
      document.execCommand("copy");
    }
  }
};

const onShare = async (e) => {
  // Let the browser handle modifier clicks (open in new tab, etc.).
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if (navigator.share) {
    try {
      await navigator.share({ url: shareUrl.value });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  await copyToClipboard();
};

const onRandom = (e) => {
  // Let the browser handle modifier clicks (open in new tab, etc.).
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const map = getMapInstance(instanceId);
  // Defensive: before the map is ready, fall back to the href navigation.
  if (!map) return;
  e.preventDefault();
  fitCountryBounds(map, "");
};
</script>

<template>
  <div class="ogis-info-panel d-flex flex-column flex-grow-1">
    <div class="sidebar-section sidebar-section-body p-3">
      <textarea
        id="ogis-share-url"
        name="ogis-share-url"
        class="ogis-share-textarea form-control form-control-sm font-monospace mb-2"
        :value="shareUrl"
        readonly
        rows="3"
        @focus="$event.target.select()"
      ></textarea>

      <a
        class="btn btn-sm ogis-share-link w-100 d-flex align-items-center justify-content-center gap-1"
        :class="copied ? 'btn-success' : 'btn-outline-primary'"
        :href="shareUrl"
        @click="onShare"
      >
        {{ copied ? t("panel.view.copied") : t("panel.view.share") }}
        <Icon
          width="18"
          height="18"
          fill="currentColor"
          :name="copied ? 'check' : 'share'"
        />
      </a>

      <hr class="my-2 opacity-25" />

      <div class="d-flex gap-2">
        <a
          class="btn btn-sm btn-outline-secondary flex-fill d-flex align-items-center justify-content-center gap-1"
          :href="osmNoteUrl ?? '#'"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t("panel.view.improve") }}
          <Icon width="16" height="16" fill="currentColor" name="pencil" />
        </a>
        <a
          class="btn btn-sm btn-outline-secondary flex-fill d-flex align-items-center justify-content-center gap-1"
          :href="randomUrl"
          @click="onRandom"
        >
          {{ t("panel.view.random") }}
          <Icon width="18" height="18" fill="currentColor" name="dice" />
        </a>
      </div>
    </div>

    <!-- About -->
    <div
      class="sidebar-section sidebar-section-body p-3 border-top ogis-about-section"
    >
      <div class="d-flex align-items-center gap-3">
        <p class="lead mb-0">
          {{ t("panel.about.freePrivate") }}
          <a
            href="https://github.com/OpenGIS/app/"
            target="_blank"
            rel="noopener"
            >{{ t("panel.about.openSource") }}</a
          >.
        </p>
        <img
          src="/icon-192.png"
          alt="OpenGIS"
          class="ms-auto flex-shrink-0 ogis-about-logo rounded-1"
        />
      </div>
    </div>

    <!-- Privacy -->
    <div
      class="sidebar-section sidebar-section-body p-3 border-top ogis-privacy-section"
    >
      <h5 class="mb-2">{{ t("panel.privacy.title") }}</h5>
      <p class="mb-2 small text-body-secondary">
        {{ t("panel.privacy.summary") }}
      </p>

      <details class="ogis-disclosure">
        <summary>
          <span class="ogis-disclosure-more">{{
            t("panel.info.readMore")
          }}</span>
          <span class="ogis-disclosure-less">{{
            t("panel.info.readLess")
          }}</span>
        </summary>

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
    <div
      class="sidebar-section sidebar-section-body px-3 py-2 border-top ogis-attribution-section"
    >
      <p class="mb-0 small ogis-attribution-text" v-html="attributionHtml"></p>
    </div>
  </div>
</template>
