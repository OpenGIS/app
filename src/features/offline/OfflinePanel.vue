<!-- OfflinePanel.vue — side-panel content for the Offline download feature -->
<script setup>
import { ref, computed, inject, onUnmounted, onMounted } from "vue";
import { useUI } from "@/composables/useUI";
import { useActions } from "@/composables/useActions";
import { useLocale } from "@/composables/useLocale";
import { useOrientView } from "@/composables/useOrientView";

const { openPanel, isDesktop } = useUI();
const { claimMap, dismissPanel, registerMode } = useActions();
const { t, locale, formatLocale } = useLocale();
const { orientView, switchProjection } = useOrientView();

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
  const est = await estimate(bounds.value, lo, hi);
  estimateState.value = est;

  // Quota awareness: warn when the region plus current usage may exceed the
  // storage quota, in addition to the large-region warning below.
  const info = await getStorageInfo();
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

// --- Download ---
const downloading = ref(false);
const progress = ref({ done: 0, total: 0 });
const downloadError = ref("");
const downloadWarning = ref("");
const abortController = ref(null);

const runDownload = async () => {
  downloadError.value = "";
  downloadWarning.value = "";
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
    if (result.failedCount > 0) {
      downloadWarning.value = t("panel.offline.partial", {
        succeeded: result.totalCount,
        total: result.requestedCount,
      });
    }
    await persistPromise;
    refreshStorage();
  } catch (err) {
    if (err.name === "AbortError") {
      downloadError.value = t("panel.offline.cancelled");
    } else if (err.code === "download-empty") {
      downloadError.value = t("panel.offline.empty");
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
  <div class="p-3">
    <h6 class="text-body-secondary mb-3">{{ t("menu.offline") }}</h6>

    <!-- Region selection -->
    <p class="small text-body-secondary mb-2">
      {{ t("panel.offline.dragHint") }}
    </p>
    <button
      class="btn btn-sm mb-3"
      :class="drawing ? 'btn-warning' : 'btn-primary'"
      @click="drawing ? stopDraw() : startDraw()"
    >
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

    <div v-if="bounds" class="small text-body-secondary mb-3">
      <strong>{{ t("panel.offline.selectedRegion") }}</strong>
      <div class="font-monospace">
        {{ t("panel.offline.compassW") }} {{ bounds.west.toFixed(4) }} ·
        {{ t("panel.offline.compassS") }} {{ bounds.south.toFixed(4) }} ·<br />
        {{ t("panel.offline.compassE") }} {{ bounds.east.toFixed(4) }} ·
        {{ t("panel.offline.compassN") }} {{ bounds.north.toFixed(4) }}
      </div>
    </div>

    <!-- Zoom range -->
    <div class="row g-2 mb-3">
      <div class="col-6">
        <label class="form-label small mb-1" for="offline-minzoom">{{
          t("panel.offline.minZoom")
        }}</label>
        <input
          id="offline-minzoom"
          v-model.number="minZoom"
          type="number"
          class="form-control form-control-sm"
          min="0"
          max="22"
        />
      </div>
      <div class="col-6">
        <label class="form-label small mb-1" for="offline-maxzoom">{{
          t("panel.offline.maxZoom")
        }}</label>
        <input
          id="offline-maxzoom"
          v-model.number="maxZoom"
          type="number"
          class="form-control form-control-sm"
          min="0"
          max="22"
        />
      </div>
    </div>

    <!-- Estimate -->
    <button
      class="btn btn-sm btn-outline-primary w-100 mb-2"
      :disabled="!bounds || downloading"
      @click="estimateNow"
    >
      {{ t("panel.offline.estimate") }}
    </button>

    <div v-if="estimateError" class="small text-danger mb-2">
      {{ estimateError }}
    </div>

    <div
      v-if="estimateState"
      class="small text-body-secondary mb-3"
      :class="{ 'text-danger': isLarge }"
    >
      <div class="d-flex justify-content-between">
        <span>{{ t("panel.offline.tilesLabel") }}</span>
        <strong>{{
          estimateState.tileCount.toLocaleString(formatLocale)
        }}</strong>
      </div>
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

    <!-- Download / progress -->
    <template v-if="downloading">
      <div class="progress mb-2" style="height: 8px">
        <div
          class="progress-bar bg-success"
          role="progressbar"
          :style="{ width: progressPct + '%' }"
          :aria-valuenow="progressPct"
          aria-valuemin="0"
          aria-valuemax="100"
        ></div>
      </div>
      <div
        class="d-flex justify-content-between small text-body-secondary mb-2"
      >
        <span
          >{{ progress.done.toLocaleString(formatLocale) }} /
          {{ progress.total.toLocaleString(formatLocale) }}</span
        >
        <span>{{ progressPct }}%</span>
      </div>
      <button
        class="btn btn-sm btn-outline-danger w-100"
        @click="cancelDownload"
      >
        {{ t("panel.offline.cancel") }}
      </button>
    </template>
    <button
      v-else
      class="btn btn-sm btn-success w-100"
      :disabled="!bounds"
      @click="runDownload"
    >
      {{ t("panel.offline.download") }}
    </button>

    <div v-if="downloadError" class="small text-danger mt-2">
      {{ downloadError }}
    </div>
    <div v-if="downloadWarning" class="small text-warning mt-2" role="status">
      {{ downloadWarning }}
    </div>

    <!-- Storage summary -->
    <hr class="my-3 opacity-25" />
    <h6 class="text-body-secondary">{{ t("panel.offline.storage") }}</h6>
    <div class="small text-body-secondary mb-1 d-flex justify-content-between">
      <span>{{
        t("panel.offline.storageUsed", {
          usage: formatBytes(storageInfo.usage),
          quota: formatBytes(storageInfo.quota),
        })
      }}</span>
      <span>{{
        storageInfo.persisted
          ? t("panel.offline.persistent")
          : t("panel.offline.mayBeCleared")
      }}</span>
    </div>
    <div class="progress mb-3" style="height: 6px">
      <div
        class="progress-bar bg-success"
        role="progressbar"
        :style="{ width: storagePct + '%' }"
        :aria-valuenow="storagePct"
        aria-valuemin="0"
        aria-valuemax="100"
      ></div>
    </div>

    <!-- Downloaded regions -->
    <hr class="my-3 opacity-25" />
    <h6 class="text-body-secondary">
      {{ t("panel.offline.downloadedRegions") }}
    </h6>

    <p v-if="!regions.length" class="text-body-tertiary small">
      {{ t("panel.offline.noRegions") }}
    </p>

    <div v-for="region in regions" :key="region.id" class="border-top py-2">
      <div class="d-flex justify-content-between align-items-start small">
        <div>
          <div>
            <strong>{{ region.name }}</strong>
          </div>
          <div class="text-body-secondary">
            {{
              t("panel.offline.zoomRange", {
                min: region.minZoom,
                max: region.maxZoom,
              })
            }}
            · {{ region.tileCount.toLocaleString(formatLocale) }}
            {{ t("panel.offline.tiles", { count: region.tileCount }) }}
          </div>
          <div class="text-body-tertiary">
            {{ formatBytes(region.estimatedBytes) }} ·
            {{ new Date(region.createdAt).toLocaleString(formatLocale) }}
          </div>
        </div>
        <div class="d-flex gap-1">
          <button
            class="btn btn-sm btn-outline-primary"
            :disabled="deleting"
            @click="showRegion(region)"
          >
            {{ t("panel.offline.show") }}
          </button>
          <button
            class="btn btn-sm btn-outline-danger"
            :disabled="deleting"
            @click="removeRegion(region)"
          >
            {{ t("panel.offline.delete") }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleteError" class="small text-danger mt-2">
      {{ deleteError }}
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
