// recordings/index.js — Recordings core feature for ogis.app
import { reactive, ref, computed, watch } from "vue";
import { useActions } from "@/composables/useActions";
import { useGeoJSON } from "@/composables/useGeoJSON.js";
import { useLocate } from "@/composables/useLocate.js";
import { useUI } from "@/composables/useUI.js";
import { totalDistance, formatDuration, formatDistance } from "@/utils/geo.js";
import { shareFile } from "@/utils/share.js";
import { assignTrackColors } from "@/utils/track/colors.js";
import {
  createTrackId,
  documentBounds,
  lineGeometry,
  normalisePoint,
  toGPX,
  toGeoJSON,
  trackFilename,
  trackMime,
} from "@/utils/track/index.js";
import {
  hydrateRecordingActive,
  hydrateRecordings,
  migrateRecordingsSession,
} from "@/resilience/hydrators/recordings.js";
import RecordingsPanel from "./RecordingsPanel.vue";

export { formatDuration, formatDistance };

// ---------------------------------------------------------------------------
// Map layer constants
// ---------------------------------------------------------------------------

const COLOR_ACTIVE = "#39d353"; // app green
const COLOR_PAUSED = "#6c757d"; // Bootstrap secondary grey
const TRACK_ID = "recordings-active-track";

// A watch with no fix must fail rather than record silently forever.
const RECORDING_GPS_TIMEOUT_MS = 15000;

const lineFeatureId = (id) => `recordings-saved-${id}`;
const waypointFeatureId = (id, index) => `recordings-waypoint-${id}-${index}`;

// ---------------------------------------------------------------------------
// Feature
// ---------------------------------------------------------------------------

export const RecordingsFeature = {
  install({
    useStorage,
    useSettings,
    getMap,
    instanceId,
    provide,
    addPanel,
    onCleanup,
    useLocale,
  }) {
    migrateRecordingsSession(instanceId);

    const recordingsStore = useStorage("recordings", {
      version: 2,
      defaults: { saved: [] },
      hydrate: hydrateRecordings,
      crossTab: true,
      onSync: () => reconcileSavedRecordings(),
    });
    const stored = recordingsStore.state;

    const activeStore = useStorage("recording-active", {
      version: 1,
      storage: "session",
      defaults: { active: null },
      hydrate: hydrateRecordingActive,
    });
    const active = activeStore.state;

    const flushStorage = () => {
      recordingsStore.flush();
      activeStore.flush();
    };

    assignTrackColors(stored.saved);

    const { isMetric } = useSettings();
    const { requestPermission } = useLocate(instanceId);
    const actions = useActions(instanceId);
    const { t, formatLocale } = useLocale();

    const state = reactive({
      isRecording: false,
      isPaused: false,
      points: active.active?.segments?.[0]?.points ?? [],
      startTime: active.active?.createdAt ?? null,
      saved: stored.saved,
    });

    // A restored paused recording starts its clock at the last recorded point,
    // so the panel reflects the elapsed capture rather than 0:00.
    const lastRestoredPoint = state.points.at(-1);
    const restoredElapsed =
      Number.isFinite(lastRestoredPoint?.t) &&
      Number.isFinite(active.active?.createdAt)
        ? Math.max(0, lastRestoredPoint.t - active.active.createdAt)
        : 0;

    const elapsed = ref(restoredElapsed);
    const locationError = ref(null);
    const distance = computed(() => totalDistance(state.points));
    const visible = reactive(new Set());

    let watchId = null;
    let timerId = null;

    const geoJSON = useGeoJSON(instanceId);

    const updateLine = () => {
      const geometry = lineGeometry({ segments: [{ points: state.points }] });
      if (!geometry) {
        geoJSON.removeFeature(TRACK_ID);
        return;
      }
      geoJSON.setFeature({
        type: "Feature",
        id: TRACK_ID,
        geometry,
        properties: {
          "ogis.color": state.isPaused ? COLOR_PAUSED : COLOR_ACTIVE,
          "ogis.width": 3,
          "ogis.opacity": 0.85,
          "ogis.direction": true,
        },
      });
    };

    const persist = () => {
      const activeDoc =
        state.isRecording || state.isPaused
          ? {
              v: 2,
              kind: "recording",
              name: null,
              gpxType: null,
              createdAt: state.startTime,
              source: { format: "gps" },
              segments: [{ points: state.points }],
              waypoints: [],
            }
          : null;
      stored.saved = state.saved;
      active.active = activeDoc;
    };

    const startGeo = () => {
      if (watchId !== null) return true;
      if (typeof navigator.geolocation?.watchPosition !== "function") {
        onGeoError({ code: 2 });
        return false;
      }
      try {
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            if (!state.isRecording) return;
            state.points.push({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              t: Date.now(),
            });
            persist();
            updateLine();
          },
          (error) => onGeoError(error),
          {
            enableHighAccuracy: true,
            maximumAge: 2000,
            timeout: RECORDING_GPS_TIMEOUT_MS,
          },
        );
      } catch (error) {
        onGeoError(error);
        return false;
      }
      return true;
    };

    // A denied, revoked or unavailable GPS pauses the session instead of
    // leaving a running recording with no points. Pausing flushes the points
    // captured so far; zero-point sessions are preserved too.
    const onGeoError = (error) => {
      if (!state.isRecording) return;
      locationError.value =
        error?.code === 1
          ? "denied"
          : error?.code === 3
            ? "timeout"
            : "unavailable";
      pause();
    };

    const stopGeo = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };

    const startTimer = () => {
      elapsed.value = Date.now() - state.startTime;
      timerId = setInterval(() => {
        elapsed.value = Date.now() - state.startTime;
      }, 1000);
    };

    const stopTimer = () => {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    const doStart = () => {
      locationError.value = null;
      state.isRecording = true;
      state.isPaused = false;
      if (!state.startTime) state.startTime = Date.now();
      if (!startGeo()) return;
      startTimer();
      persist();
      flushStorage();
      updateLine();
    };

    const start = () => requestPermission(doStart);

    const pause = () => {
      state.isRecording = false;
      state.isPaused = true;
      stopGeo();
      stopTimer();
      persist();
      flushStorage();
      updateLine();
    };

    const resume = () => start();

    const discard = () => {
      state.isRecording = false;
      state.isPaused = false;
      state.points = [];
      state.startTime = null;
      elapsed.value = 0;
      locationError.value = null;
      stopGeo();
      stopTimer();
      persist();
      flushStorage();
      geoJSON.removeFeature(TRACK_ID);
    };

    const save = () => {
      if (state.points.length === 0) return;
      const recording = {
        v: 2,
        id: createTrackId(),
        kind: "recording",
        name: null,
        gpxType: null,
        createdAt: state.startTime,
        source: { format: "gps" },
        segments: [{ points: state.points.map((point) => ({ ...point })) }],
        waypoints: [],
        duration: Date.now() - state.startTime,
      };
      assignTrackColors([...state.saved, recording]);
      state.saved.push(recording);
      discard();
    };

    // Feature ids rendered for each visible saved recording, so a re-render or
    // removal can clean up exactly the waypoints that were drawn.
    const renderedWaypoints = new Map();

    const removeRecordingFeatures = (recordingOrId) => {
      const id =
        typeof recordingOrId === "object" && recordingOrId !== null
          ? recordingOrId.id
          : recordingOrId;
      if (id === null || id === undefined) return;

      geoJSON.removeFeature(lineFeatureId(id));
      for (const featureId of renderedWaypoints.get(id) ?? []) {
        geoJSON.removeFeature(featureId);
      }
      renderedWaypoints.delete(id);
    };

    const renderRecording = (recording) => {
      removeRecordingFeatures(recording);

      const waypointIds = [];
      const geometry = lineGeometry(recording);
      if (geometry) {
        geoJSON.setFeature({
          type: "Feature",
          id: lineFeatureId(recording.id),
          geometry,
          properties: {
            "ogis.color": recording.color,
            "ogis.width": 3,
            "ogis.opacity": 0.85,
            "ogis.direction": true,
          },
        });
      }

      (recording.waypoints ?? []).forEach((waypoint, index) => {
        const point = normalisePoint(waypoint);
        if (!point) return;
        const coordinates = [point.lng, point.lat];
        if (point.ele !== undefined) coordinates.push(point.ele);
        const featureId = waypointFeatureId(recording.id, index);
        waypointIds.push(featureId);
        geoJSON.setFeature({
          type: "Feature",
          id: featureId,
          geometry: { type: "Point", coordinates },
          properties: {
            "ogis.color": recording.color,
            "ogis.radius": 5,
          },
        });
      });

      renderedWaypoints.set(recording.id, waypointIds);
    };

    const isVisible = (id) => visible.has(id);

    const showOnMap = (recording) => {
      if (!recording) return;
      actions.claimMap();

      renderRecording(recording);
      visible.add(recording.id);

      const bounds = documentBounds(recording);
      const map = getMap();
      if (map && bounds) map.fitBounds(bounds, { padding: 40 });
    };

    const hideOnMap = (id) => {
      const recording = state.saved.find((item) => item.id === id);
      if (!recording) return;

      removeRecordingFeatures(recording);
      visible.delete(id);
    };

    const toggleVisibility = (recording) => {
      if (visible.has(recording.id)) hideOnMap(recording.id);
      else showOnMap(recording);
    };

    const deleteRecording = (id) => {
      const index = state.saved.findIndex((item) => item.id === id);
      if (index === -1) return;

      const [recording] = state.saved.splice(index, 1);
      removeRecordingFeatures(recording);
      visible.delete(id);
      persist();
      flushStorage();
    };

    /**
     * Reconcile the in-memory saved list and map after another tab replaced
     * the shared recordings store. The object store replaces its properties,
     * so `state.saved` must be re-pointed at the new array before the UI reads
     * it. Visibility is last-writer-wins and stays in-memory only.
     */
    const reconcileSavedRecordings = () => {
      if (!Array.isArray(stored.saved)) return;
      state.saved = stored.saved;

      assignTrackColors(state.saved);
      const ids = new Set(state.saved.map((recording) => recording.id));

      for (const id of [...visible]) {
        const recording = ids.has(id)
          ? state.saved.find((item) => item.id === id)
          : null;
        if (!recording) {
          removeRecordingFeatures(id);
          visible.delete(id);
          continue;
        }

        renderRecording(recording);
      }
    };

    const shareRecording = async (recording, format) => {
      const name = t("panel.recordings.exportName", {
        date: new Date(recording.createdAt).toLocaleString(formatLocale.value),
      });
      const content =
        format === "gpx"
          ? toGPX(recording, { name })
          : JSON.stringify(toGeoJSON(recording, { name }), null, 2);
      const blob = new Blob([content], { type: trackMime(format) });
      const filename = trackFilename(recording, format, { name });

      await shareFile(blob, filename, { title: name });
    };

    // Crash recovery: restore paused line if the app was closed mid-recording.
    if (active.active?.segments?.[0]?.points?.length >= 2) {
      state.isPaused = true;
      updateLine();
    }

    // Surface the recording state on the always-mounted menu chip (via useUI's
    // generic badge signal) so it shows even while the panel is closed.
    const { setMenuBadge } = useUI(instanceId);
    const stopMenuBadgeWatch = watch(
      () => {
        if (state.isRecording) return "recording";
        if (state.isPaused) return "paused";
        return null;
      },
      (value) => setMenuBadge(value),
      { immediate: true },
    );
    onCleanup(stopMenuBadgeWatch);

    // Feature-owned recording resources: the GPS watch and elapsed timer only
    // run while recording, but app destroy must still release them.
    onCleanup(() => {
      stopGeo();
      stopTimer();
    });

    provide("recordings", {
      state,
      elapsed,
      locationError,
      distance,
      isMetric,
      start,
      pause,
      resume,
      discard,
      save,
      shareRecording,
      toggleVisibility,
      isVisible,
      hideOnMap,
      showOnMap,
      deleteRecording,
    });

    addPanel({
      id: "record",
      icon: "route",
      title: () => t("menu.recordings"),
      component: RecordingsPanel,
    });

    return () => {
      stopGeo();
      stopTimer();
    };
  },
};
