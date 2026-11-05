<!-- OfflinePanel.vue — side-panel content for the Offline download feature -->
<script setup>
import { ref, computed, inject, onUnmounted, onMounted, watch } from "vue";
import { useUI } from "@/composables/useUI";
import { useActions } from "@/composables/useActions";
import { useLocale } from "@/composables/useLocale";
import { useOrientView } from "@/composables/useOrientView";
import { useInlineRename } from "@/composables/useInlineRename.js";
import Icon from "@/components/ui/icon.vue";
import RenameInput from "@/components/ui/rename-input.vue";

const { openPanel, isDesktop } = useUI();
const { claimMap, dismissPanel, registerMode } = useActions();
const { t, locale, formatLocale } = useLocale();
const { orientView, switchProjection } = useOrientView();
const rename = useInlineRename();

const {
  regions,
  estimate,
  download,
  addRegion,
  deleteRegion,
  showRegion,
  getStorageInfo,
  requestPersistence,
  getMap,
} = inject("offline");

// --- Region drawing state ---
const drawing = ref(false);
const drawStart = ref(null); // { lng, lat } at mousedown
const bounds = ref(null); // { west, south, east, north }
const overlayStyle = ref({ display: "none" });
let moveHandler = null;
let upHandler = null;
let downHandler = null;
let cancelHandler = null;
let restoreProjection = null;
let unregisterDraw = null;

const map = () => getMap();

// --- Estimate state (declared early so drawing can reset it) ---
const estimateState = ref(null); // { tileCount, estimatedBytes }
const estimateError = ref("");

const projectToOverlay = () => {
  const m = map();
  const container = m?.getContainer();
  if (!m || !container) return null;
  const rect = container.getBoundingClientRect();
  return (lngLat) => {
    const p = m.project([lngLat.lng, lngLat.lat]);
    return {
      left: rect.left + p.x,
      top: rect.top + p.y,
    };
  };
};

const updateOverlay = (start, current) => {
  const proj = projectToOverlay();
  if (!proj) return;
  const a = proj(start);
  const b = proj(current);
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const width = Math.abs(b.left - a.left);
  const height = Math.abs(b.top - a.top);
  overlayStyle.value = {
    display: "block",
    position: "fixed",
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
};

const startDraw = () => {
  const m = map();
  if (!m) return;
  claimMap();
  dismissPanel();
  estimateRun++;
  downloadNotice.value = "";
  bounds.value = null;
  estimateState.value = null;
  overlayStyle.value = { display: "none" };
  drawing.value = true;

  // Use a flat 2D mercator projection for the duration of the drag (restored
  // when the draw stops) and reset rotation. Centre and zoom are untouched.
  restoreProjection = switchProjection("mercator");
  orientView();

  // Stop MapLibre panning/box-zoom while we capture the drag ourselves
  if (m.dragPan) m.dragPan.disable();
  if (m.boxZoom) m.boxZoom.disable();
  if (m.doubleClickZoom) m.doubleClickZoom.disable();
  if (m.touchZoomRotate) m.touchZoomRotate.disable();
  if (m.touchPitch) m.touchPitch.disable();

  downHandler = (e) => {
    drawStart.value = { lng: e.lngLat.lng, lat: e.lngLat.lat };
  };

  moveHandler = (e) => {
    if (!drawStart.value) return;
    updateOverlay(drawStart.value, { lng: e.lngLat.lng, lat: e.lngLat.lat });
  };

  upHandler = (e) => {
    if (!drawStart.value) {
      stopDraw();
      return;
    }
    const start = drawStart.value;
    const end = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    drawStart.value = null;

    // A click without an actual drag (no movement) would yield a zero-area
    // box, so treat it as a click and skip finalising the bounds.
    const a = m.project([start.lng, start.lat]);
    const b = m.project([end.lng, end.lat]);
    const dragged = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (dragged < 4) {
      overlayStyle.value = { display: "none" };
      stopDraw();
      return;
    }

    bounds.value = {
      west: Math.min(start.lng, end.lng),
      east: Math.max(start.lng, end.lng),
      south: Math.min(start.lat, end.lat),
      north: Math.max(start.lat, end.lat),
    };
    stopDraw({ reopen: true });
  };

  cancelHandler = () => {
    drawStart.value = null;
    overlayStyle.value = { display: "none" };
    stopDraw();
  };

  m.on("mousedown", downHandler);
  m.on("mousemove", moveHandler);
  m.on("mouseup", upHandler);
  m.on("touchstart", downHandler);
  m.on("touchmove", moveHandler);
  m.on("touchend", upHandler);
  m.on("touchcancel", cancelHandler);
};

const stopDraw = (opts = {}) => {
  const m = map();
  if (m && moveHandler) m.off("mousemove", moveHandler);
  if (m && upHandler) m.off("mouseup", upHandler);
  if (m && downHandler) m.off("mousedown", downHandler);
  if (m && moveHandler) m.off("touchmove", moveHandler);
  if (m && upHandler) m.off("touchend", upHandler);
  if (m && downHandler) m.off("touchstart", downHandler);
  if (m && cancelHandler) m.off("touchcancel", cancelHandler);
  moveHandler = null;
  upHandler = null;
  downHandler = null;
  cancelHandler = null;
  // Restore the previous projection now the draw is over
  if (restoreProjection) {
    restoreProjection();
    restoreProjection = null;
  }
  // Restore the map's default drag/zoom behaviours
  if (m && m.dragPan) m.dragPan.enable();
  if (m && m.boxZoom) m.boxZoom.enable();
  if (m && m.doubleClickZoom) m.doubleClickZoom.enable();
  if (m && m.touchZoomRotate) m.touchZoomRotate.enable();
  if (m && m.touchPitch) m.touchPitch.enable();
  drawing.value = false;
  if (opts.reopen && !isDesktop.value && bounds.value) {
    openPanel();
  }
};

onMounted(() => {
  unregisterDraw = registerMode("draw", {
    active: drawing,
    stop: ({ handoff = false } = {}) => stopDraw({ reopen: !handoff }),
  });
});

onUnmounted(() => {
  unregisterDraw?.();
  unregisterDraw = null;
  stopDraw();
});

// --- Zoom range controls ---
const minZoom = ref(10);
const maxZoom = ref(14);
const clampZoom = (v) => Math.max(0, Math.min(22, v));

// --- Estimate + warn ---
let estimateRun = 0;
const mayNotFit = ref(false);
const estimateNow = async () => {
  estimateError.value = "";
  mayNotFit.value = false;
  if (!bounds.value) {
    estimateError.value = t("panel.offline.selectFirst");
    return;
  }
  const lo = clampZoom(minZoom.value);
  const hi = clampZoom(maxZoom.value);
  if (lo > hi) {
    estimateError.value = t("panel.offline.zoomOrder");
    return;
  }
  const run = ++estimateRun;
  const est = await estimate(bounds.value, lo, hi);
  // A newer area or zoom was chosen while this was being worked out.
  if (run !== estimateRun) return;
  estimateState.value = est;

  // Quota awareness: warn when the region plus current usage may exceed the
  // storage quota, in addition to the large-region warning below.
  const info = await getStorageInfo();
  if (run !== estimateRun) return;
  if (info.quota > 0 && est.estimatedBytes + info.usage > info.quota) {
    mayNotFit.value = true;
  }
};

const formatNumber = (value, digits) =>
  new Intl.NumberFormat(locale.value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);

const formatBytes = (bytes) => {
  if (bytes >= 1024 * 1024) {
    return `${formatNumber(bytes / (1024 * 1024), 1)} ${t("panel.offline.unitMegabyte")}`;
  }
  if (bytes >= 1024) {
    return `${formatNumber(bytes / 1024, 0)} ${t("panel.offline.unitKilobyte")}`;
  }
  return `${formatNumber(bytes, 0)} ${t("panel.offline.unitByte")}`;
};

const isLarge = computed(() =>
  estimateState.value
    ? estimateState.value.estimatedBytes > 200 * 1024 * 1024
    : false,
);

// The size is always worked out for the chosen area and zoom.
watch([bounds, minZoom, maxZoom], () => {
  if (bounds.value) estimateNow();
});

// --- Download ---
const downloading = ref(false);
const progress = ref({ done: 0, total: 0 });
const downloadError = ref("");
const downloadWarning = ref("");
const downloadNotice = ref("");
const abortController = ref(null);

const runDownload = async () => {
  downloadError.value = "";
  downloadWarning.value = "";
  downloadNotice.value = "";
  if (!estimateState.value) {
    await estimateNow();
    if (!estimateState.value) return;
  }
  if (isLarge.value) {
    const ok = window.confirm(
      t("panel.offline.confirmLarge", {
        size: formatBytes(estimateState.value.estimatedBytes),
      }),
    );
    if (!ok) return;
  }

  // Request persistent storage (user has just committed to a download).
  // Resolves quickly; the download proceeds in parallel.
  const persistPromise = requestPersistence();

  const lo = clampZoom(minZoom.value);
  const hi = clampZoom(maxZoom.value);
  abortController.value = new AbortController();

  downloading.value = true;
  progress.value = { done: 0, total: 0 };

  try {
    const result = await download({
      bounds: bounds.value,
      minZoom: lo,
      maxZoom: hi,
      signal: abortController.value.signal,
      onProgress: (done, total) => {
        progress.value = { done, total };
      },
    });
    addRegion({
      name: t("panel.offline.regionName", { n: regions.length + 1 }),
      bounds: { ...bounds.value },
      minZoom: lo,
      maxZoom: hi,
      tileCount: result.tileCount,
      failedCount: result.failedCount,
      requestedCount: result.requestedCount,
      estimatedBytes: estimateState.value.estimatedBytes,
    });
    // Only worry the person when map pieces themselves are missing; a few
    // missing label fonts do not matter on the trail.
    if (result.tileFailedCount > 0) {
      downloadWarning.value = t("panel.offline.partial");
    } else {
      downloadNotice.value = t("panel.offline.saved");
    }
    // Ready for the next map: clear the chosen area.
    estimateRun++;
    bounds.value = null;
    estimateState.value = null;
    mayNotFit.value = false;
    await persistPromise;
    refreshStorage();
  } catch (err) {
    if (err.name === "AbortError") {
      downloadError.value = t("panel.offline.cancelled");
    } else if (err.code === "download-empty") {
      downloadError.value = t("panel.offline.downloadEmpty");
    } else if (err.code === "map-not-ready") {
      downloadError.value = t("panel.offline.errorMapNotReady");
    } else {
      downloadError.value = t("panel.offline.failed");
    }
  } finally {
    downloading.value = false;
    abortController.value = null;
  }
};

const cancelDownload = () => {
  abortController.value?.abort();
};

const progressPct = computed(() => {
  const { done, total } = progress.value;
  return total > 0 ? Math.round((done / total) * 100) : 0;
});

// --- Storage summary ---
const storageInfo = ref({ usage: 0, quota: 0, persisted: false });

const refreshStorage = async () => {
  storageInfo.value = await getStorageInfo();
};

const storagePct = computed(() => {
  const { usage, quota } = storageInfo.value;
  return quota > 0 ? Math.min(100, Math.round((usage / quota) * 100)) : 0;
});

onMounted(refreshStorage);

// --- Show region: jump to it and get the panel out of the way ---
const showSaved = (region) => {
  showRegion(region);
  dismissPanel();
};

// --- Rename region (an empty name keeps the current one) ---
const renameRegion = (id, name) => {
  const region = regions.find((item) => item.id === id);
  if (region && name) region.name = name;
};

// --- Delete region ---
const deleting = ref(false);
const deleteError = ref("");

const removeRegion = async (region) => {
  const ok = window.confirm(
    t("panel.offline.confirmDelete", { name: region.name }),
  );
  if (!ok) return;
  deleteError.value = "";
  deleting.value = true;
  try {
    await deleteRegion(region);
    await refreshStorage();
  } catch {
    deleteError.value = t("panel.offline.deleteFailed");
  } finally {
    deleting.value = false;
  }
};
</script>

<template>
  <div class="ogis-offline-panel p-3">
    <h5 class="ogis-section-title">{{ t("menu.offline") }}</h5>

    <!-- Region selection and download -->
    <div class="ogis-live-card mb-3">
      <p class="small mb-0 ogis-track-card__meta">
        {{ t("panel.offline.dragHint") }}
      </p>
      <button
        type="button"
        class="btn ogis-cta"
        :class="drawing ? 'ogis-cta--soft' : ''"
        @click="drawing ? stopDraw() : startDraw()"
      >
        <Icon name="map" width="16" height="16" aria-hidden="true" />
        {{
          drawing ? t("panel.offline.drawing") : t("panel.offline.selectRegion")
        }}
      </button>

      <!-- Draw overlay: teleported to body so it escapes the offcanvas's
           transform and can use fixed viewport coordinates -->
      <Teleport to="body">
        <div
          v-if="drawing && drawStart"
          class="offline-draw-overlay"
          :style="overlayStyle"
        ></div>
      </Teleport>

      <div v-if="bounds" class="small ogis-track-card__meta">
        <strong class="ogis-offline-label">{{
          t("panel.offline.selectedRegion")
        }}</strong>
        <div class="font-monospace">
          {{ t("panel.offline.compassW") }} {{ bounds.west.toFixed(4) }} ·
          {{ t("panel.offline.compassS") }}
          {{ bounds.south.toFixed(4) }} ·<br />
          {{ t("panel.offline.compassE") }} {{ bounds.east.toFixed(4) }} ·
          {{ t("panel.offline.compassN") }} {{ bounds.north.toFixed(4) }}
        </div>
      </div>

      <div v-if="estimateError" class="small text-danger">
        {{ estimateError }}
      </div>

      <div
        v-if="estimateState"
        class="small ogis-track-card__meta"
        :class="{ 'text-danger': isLarge }"
      >
        <div class="d-flex justify-content-between">
          <span>{{ t("panel.offline.estSize") }}</span>
          <strong>{{ formatBytes(estimateState.estimatedBytes) }}</strong>
        </div>
        <div v-if="isLarge" class="text-danger mt-1">
          {{ t("panel.offline.largeRegion") }}
        </div>
        <div v-if="mayNotFit" class="text-danger mt-1">
          {{ t("panel.offline.quotaWarning") }}
        </div>
      </div>

      <!-- Zoom range: one tight row -->
      <div class="ogis-zoom-row">
        <span class="ogis-zoom-row__title">{{ t("panel.offline.zoom") }}</span>
        <label class="ogis-zoom-row__field" for="offline-minzoom">
          <span>{{ t("panel.offline.minZoom") }}</span>
          <input
            id="offline-minzoom"
            v-model.number="minZoom"
            type="number"
            class="form-control form-control-sm"
            min="0"
            max="22"
          />
        </label>
        <label class="ogis-zoom-row__field" for="offline-maxzoom">
          <span>{{ t("panel.offline.maxZoom") }}</span>
          <input
            id="offline-maxzoom"
            v-model.number="maxZoom"
            type="number"
            class="form-control form-control-sm"
            min="0"
            max="22"
          />
        </label>
      </div>

      <!-- Download / progress -->
      <template v-if="downloading">
        <div class="progress" style="height: 8px">
          <div
            class="progress-bar bg-success"
            role="progressbar"
            :style="{ width: progressPct + '%' }"
            :aria-valuenow="progressPct"
            aria-valuemin="0"
            aria-valuemax="100"
          ></div>
        </div>
        <div class="d-flex justify-content-between small ogis-track-card__meta">
          <span
            >{{ progress.done.toLocaleString(formatLocale) }} /
            {{ progress.total.toLocaleString(formatLocale) }}</span
          >
          <span>{{ progressPct }}%</span>
        </div>
        <button
          type="button"
          class="btn ogis-cta ogis-cta--soft ogis-cta--danger"
          @click="cancelDownload"
        >
          {{ t("panel.offline.cancel") }}
        </button>
      </template>
      <button
        v-else
        type="button"
        class="btn ogis-cta"
        :disabled="!bounds"
        @click="runDownload"
      >
        <Icon
          name="file-arrow-down"
          width="16"
          height="16"
          aria-hidden="true"
        />
        {{ t("panel.offline.download") }}
      </button>

      <div v-if="downloadNotice" class="ogis-saved-note" role="status">
        <Icon name="check" width="14" height="14" aria-hidden="true" />
        {{ downloadNotice }}
      </div>
      <div v-if="downloadError" class="small text-danger">
        {{ downloadError }}
      </div>
      <div v-if="downloadWarning" class="small text-warning" role="status">
        {{ downloadWarning }}
      </div>
    </div>

    <!-- Downloaded regions -->
    <h6 class="ogis-section-heading">
      {{ t("panel.offline.downloadedRegions") }}
    </h6>

    <p v-if="!regions.length" class="text-body-tertiary small">
      {{ t("panel.offline.noRegions") }}
    </p>

    <div class="ogis-recordings-list">
      <div v-for="region in regions" :key="region.id" class="ogis-track-card">
        <div class="ogis-track-card__head ogis-track-card__head--top">
          <div class="ogis-track-card__text">
            <RenameInput
              v-if="rename.editingId.value === region.id"
              v-model="rename.draft.value"
              :label="t('panel.offline.rename')"
              @commit="rename.commit(renameRegion)"
              @cancel="rename.cancel"
            />
            <div v-else class="ogis-track-name text-truncate">
              {{ region.name }}
            </div>
            <div class="ogis-track-card__meta">
              {{
                t("panel.offline.zoomRange", {
                  min: region.minZoom,
                  max: region.maxZoom,
                })
              }}
              · {{ region.tileCount.toLocaleString(formatLocale) }}
              {{ t("panel.offline.tiles", { count: region.tileCount }) }}
            </div>
          </div>
          <button
            type="button"
            class="btn ogis-track-card__rename"
            :aria-label="t('panel.offline.rename')"
            :title="t('panel.offline.rename')"
            @mousedown.prevent
            @click="rename.begin(region.id, region.name)"
          >
            <Icon name="pencil" width="16" height="16" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="btn ogis-track-card__remove"
            :aria-label="t('panel.offline.delete')"
            :title="t('panel.offline.delete')"
            :disabled="deleting"
            @click="removeRegion(region)"
          >
            <Icon name="trash" width="16" height="16" aria-hidden="true" />
          </button>
        </div>

        <div class="ogis-track-card__foot">
          <div class="ogis-track-card__meta">
            {{ formatBytes(region.estimatedBytes) }} ·
            {{ new Date(region.createdAt).toLocaleDateString(formatLocale) }}
          </div>
          <button
            type="button"
            class="btn ogis-track-btn ogis-track-btn--pill"
            :disabled="deleting"
            @click="showSaved(region)"
          >
            <Icon name="map" width="14" height="14" aria-hidden="true" />
            {{ t("panel.offline.show") }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleteError" class="small text-danger mt-2">
      {{ deleteError }}
    </div>

    <!-- Storage summary -->
    <h6 class="ogis-section-heading mt-3">{{ t("panel.offline.storage") }}</h6>
    <div class="ogis-live-card mb-3">
      <div class="small ogis-track-card__meta">
        {{
          t("panel.offline.storageUsed", {
            usage: formatBytes(storageInfo.usage),
            quota: formatBytes(storageInfo.quota),
          })
        }}
      </div>
      <div class="progress" style="height: 6px">
        <div
          class="progress-bar bg-success"
          role="progressbar"
          :style="{ width: storagePct + '%' }"
          :aria-valuenow="storagePct"
          aria-valuemin="0"
          aria-valuemax="100"
        ></div>
      </div>
      <p v-if="regions.length && !storageInfo.persisted" class="ogis-hint">
        {{ t("panel.offline.mayBeCleared") }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.offline-draw-overlay {
  position: fixed;
  border: 2px solid #39d353 !important;
  background: rgba(57, 211, 83, 0.2);
  pointer-events: none;
  z-index: 999;
}
</style>
