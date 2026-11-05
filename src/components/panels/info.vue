<script setup>
import { computed, inject, ref } from "vue";
import { useMap, getMapInstance } from "@/composables/useMap";
import { useLocale } from "@/composables/useLocale";
import { useAttribution } from "@/composables/useAttribution";
import { useActions } from "@/composables/useActions";
import { formatUrlHash } from "@/composables/useUrlHash";
import { actions } from "@/actions";
import Icon from "@/components/ui/icon.vue";

const { mapView } = useMap();
const { t } = useLocale();
const { perform } = useActions();
const instanceId = inject("ogisAppId", "app");

// Attribution HTML comes from our trusted style (OpenGIS/outdoors style.json),
// so rendering it with v-html is safe.
const { attributionHtml } = useAttribution();

const copied = ref(false);

// Touch screens pinch and twist; mice use the wheel and right-click drag.
const coarse =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;
const gestures = computed(() =>
  coarse
    ? [
        { icon: "pinch", text: t("panel.view.map3d.zoom") },
        { icon: "twist", text: t("panel.view.map3d.rotate") },
        { icon: "slide", text: t("panel.view.map3d.tilt") },
      ]
    : [
        { icon: "pinch", text: t("panel.view.map3d.zoomMouse") },
        { icon: "twist", text: t("panel.view.map3d.rotateMouse") },
        { icon: "slide", text: t("panel.view.map3d.tiltMouse") },
      ],
);

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
  perform(actions.random);
};

const onImprove = (e) => {
  // Let the browser handle modifier clicks (open in new tab, etc.).
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const map = getMapInstance(instanceId);
  // Defensive: before the map is ready, fall back to the href navigation.
  if (!map) return;
  e.preventDefault();
  perform(actions.improve);
};
</script>

<template>
  <div class="ogis-info-panel d-flex flex-column flex-grow-1">
    <div class="sidebar-section sidebar-section-body p-3">
      <div class="ogis-live-card">
        <textarea
          id="ogis-share-url"
          name="ogis-share-url"
          class="ogis-share-textarea form-control form-control-sm font-monospace"
          :value="shareUrl"
          readonly
          rows="2"
          @focus="$event.target.select()"
        ></textarea>

        <a
          class="btn ogis-cta ogis-share-link w-100"
          :class="{ 'ogis-cta--soft': copied }"
          :href="shareUrl"
          aria-describedby="ogis-share-hint"
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
        <p id="ogis-share-hint" class="ogis-hint text-center">
          {{ t("panel.view.shareHint") }}
        </p>
      </div>

      <div class="ogis-info-actions">
        <div class="ogis-info-action">
          <a
            class="btn ogis-track-btn"
            :href="osmNoteUrl ?? '#'"
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby="ogis-improve-hint"
            @click="onImprove"
          >
            {{ t("panel.view.improve") }}
            <Icon width="16" height="16" fill="currentColor" name="pencil" />
          </a>
          <p id="ogis-improve-hint" class="ogis-hint">
            {{ t("panel.view.improveHint") }}
          </p>
        </div>
        <div class="ogis-info-action">
          <a
            class="btn ogis-track-btn"
            :href="randomUrl"
            aria-describedby="ogis-random-hint"
            @click="onRandom"
          >
            {{ t("panel.view.random") }}
            <Icon width="18" height="18" fill="currentColor" name="dice" />
          </a>
          <p id="ogis-random-hint" class="ogis-hint">
            {{ t("panel.view.randomHint") }}
          </p>
        </div>
      </div>
    </div>

    <!-- Moving the 3D map -->
    <div class="sidebar-section sidebar-section-body px-3 pb-3">
      <section class="ogis-live-card ogis-map3d-card" data-card="map3d">
        <h6 class="ogis-map3d-card__title">
          {{ t("panel.view.map3d.title") }}
        </h6>
        <ul class="ogis-map3d-card__gestures">
          <li v-for="g in gestures" :key="g.icon">
            <svg
              class="ogis-map3d-card__icon"
              viewBox="0 0 24 24"
              width="28"
              height="28"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <template v-if="g.icon === 'pinch'">
                <path d="M4 4l6 6M4 4v4M4 4h4" />
                <path d="M20 20l-6-6M20 20v-4M20 20h-4" />
              </template>
              <template v-else-if="g.icon === 'twist'">
                <path d="M19 12a7 7 0 1 1-2.1-5" />
                <path d="M19 3v4h-4" />
              </template>
              <template v-else>
                <path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />
              </template>
            </svg>
            <span>{{ g.text }}</span>
          </li>
        </ul>
      </section>
    </div>

    <!-- About -->
    <div
      class="sidebar-section sidebar-section-body p-3 border-top border-bottom ogis-about-section"
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

    <!-- Privacy and attribution share one pinned surface: the bar sits above
         the credits, and a single sticky wrapper avoids stacked glass. -->
    <div class="sidebar-section border-top ogis-info-footer">
      <section
        class="ogis-privacy-section"
        aria-labelledby="ogis-privacy-title"
      >
        <details class="ogis-privacy-bar">
          <summary>
            <h5 id="ogis-privacy-title" class="ogis-privacy-bar__title">
              {{ t("panel.privacy.title") }}
            </h5>
            <span class="ogis-privacy-bar__summary">
              {{ t("panel.privacy.summary") }}
            </span>
            <span class="ogis-privacy-bar__toggle">
              {{ t("panel.privacy.details") }}
            </span>
          </summary>

          <div class="ogis-privacy-bar__body">
            <h6 class="mb-2 text-muted small text-uppercase fw-semibold">
              {{ t("panel.privacy.onDevice") }}
            </h6>
            <p class="mb-3 small">{{ t("panel.privacy.onDeviceBody") }}</p>

            <h6 class="mb-2 text-muted small text-uppercase fw-semibold">
              {{ t("panel.privacy.thirdParty") }}
            </h6>
            <p class="mb-0 small">{{ t("panel.privacy.thirdPartyBody") }}</p>
          </div>
        </details>
      </section>

      <div
        class="sidebar-section sidebar-section-body px-3 py-2 border-top ogis-attribution-section"
      >
        <p
          class="mb-0 small ogis-attribution-text"
          v-html="attributionHtml"
        ></p>
      </div>
    </div>
  </div>
</template>
