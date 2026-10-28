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
import { hydrateRecordings } from "@/resilience/hydrators/recordings.js";
import RecordingsPanel from "./RecordingsPanel.vue";

export { formatDuration, formatDistance };

// ---------------------------------------------------------------------------
// Map layer constants
// ---------------------------------------------------------------------------

const COLOR_ACTIVE = "#39d353"; // app green
const COLOR_PAUSED = "#6c757d"; // Bootstrap secondary grey
const TRACK_ID = "recordings-active-track";

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
    useLocale,
  }) {
    const stored = useStorage("recordings", {
      version: 1,
      defaults: { saved: [], active: null },
      hydrate: hydrateRecordings,
    }).state;
    assignTrackColors(stored.saved);

    const { isMetric } = useSettings();
    const { requestPermission } = useLocate(instanceId);
    const actions = useActions(instanceId);
    const { t, formatLocale } = useLocale();

    const state = reactive({
      isRecording: false,
      isPaused: false,
      points: stored.active?.segments?.[0]?.points ?? [],
      startTime: stored.active?.createdAt ?? null,
      saved: stored.saved,
    });

    const elapsed = ref(0);
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
      const active =
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
      stored.active = active;
    };

    const startGeo = () => {
      if (watchId !== null) return;
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
        null,
        { enableHighAccuracy: true, maximumAge: 2000 },
      );
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
      state.isRecording = true;
      state.isPaused = false;
      if (!state.startTime) state.startTime = Date.now();
      startGeo();
      startTimer();
      persist();
      updateLine();
    };

    const start = () => requestPermission(doStart);

    const pause = () => {
      state.isRecording = false;
      state.isPaused = true;
      stopGeo();
      stopTimer();
      persist();
      updateLine();
    };

    const resume = () => start();

    const discard = () => {
      state.isRecording = false;
      state.isPaused = false;
      state.points = [];
      state.startTime = null;
      elapsed.value = 0;
      stopGeo();
      stopTimer();
      persist();
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

    const renderRecording = (recording) => {
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
        geoJSON.setFeature({
          type: "Feature",
          id: waypointFeatureId(recording.id, index),
          geometry: { type: "Point", coordinates },
          properties: {
            "ogis.color": recording.color,
            "ogis.radius": 5,
          },
        });
      });
    };

    const removeRecordingFeatures = (recording) => {
      geoJSON.removeFeature(lineFeatureId(recording.id));
      (recording.waypoints ?? []).forEach((_waypoint, index) => {
        geoJSON.removeFeature(waypointFeatureId(recording.id, index));
      });
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
    if (stored.active?.segments?.[0]?.points?.length >= 2) {
      state.isPaused = true;
      updateLine();
    }

    // Surface the recording state on the always-mounted menu chip (via useUI's
    // generic badge signal) so it shows even while the panel is closed.
    const { setMenuBadge } = useUI(instanceId);
    watch(
      () => {
        if (state.isRecording) return "recording";
        if (state.isPaused) return "paused";
        return null;
      },
      (value) => setMenuBadge(value),
      { immediate: true },
    );

    provide("recordings", {
      state,
      elapsed,
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
