// recordings/index.js — Recordings core feature for ogis.app
import { reactive, ref, computed } from "vue";
import { useGeoJSON } from "@/composables/useGeoJSON.js";
import { useLocate } from "@/composables/useLocate.js";
import {
  haversine,
  totalDistance,
  formatDuration,
  formatDistance,
} from "@/utils/geo.js";
import RecordButton from "./RecordButton.vue";
import RecordingsPanel from "./RecordingsPanel.vue";

export { formatDuration, formatDistance };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a saved recording to a GPX XML string. */
function toGPX(recording) {
  const pts = recording.points
    .map(
      (p) =>
        `      <trkpt lat="${p.lat}" lon="${p.lng}">` +
        `<time>${new Date(p.t).toISOString()}</time></trkpt>`,
    )
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="ogis.app">',
    "  <trk>",
    `    <name>Recording ${new Date(recording.timestamp).toLocaleString()}</name>`,
    "    <trkseg>",
    pts,
    "    </trkseg>",
    "  </trk>",
    "</gpx>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Map layer constants
// ---------------------------------------------------------------------------

const COLOR_ACTIVE = "#39d353"; // app green
const COLOR_PAUSED = "#6c757d"; // Bootstrap secondary grey
const TRACK_ID = "recordings-active-track";

// ---------------------------------------------------------------------------
// Feature
// ---------------------------------------------------------------------------

export const RecordingsFeature = {
  install({ useStorage, useSettings, getMap, instanceId, provide, addButton }) {
    const stored = useStorage("recordings", { saved: [], active: null });
    const { isMetric } = useSettings();
    const { requestPermission } = useLocate(instanceId);

    const state = reactive({
      isRecording: false,
      isPaused: false,
      points: stored.active?.points ?? [],
      startTime: stored.active?.startTime ?? null,
      saved: stored.saved,
    });

    const elapsed = ref(0);
    const distance = computed(() => totalDistance(state.points));

    let watchId = null;
    let timerId = null;

    const geoJSON = useGeoJSON(instanceId);

    const updateLine = () => {
      const coords = state.points.map((p) => [p.lng, p.lat]);
      if (coords.length < 2) {
        geoJSON.removeFeature(TRACK_ID);
        return;
      }
      geoJSON.setFeature({
        type: "Feature",
        id: TRACK_ID,
        geometry: { type: "LineString", coordinates: coords },
        properties: {
          "ogis.color": state.isPaused ? COLOR_PAUSED : COLOR_ACTIVE,
          "ogis.width": 3,
          "ogis.opacity": 0.85,
        },
      });
    };

    const persist = () => {
      const active =
        state.isRecording || state.isPaused
          ? { points: state.points, startTime: state.startTime }
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
      state.saved.push({
        id: Date.now().toString(),
        timestamp: state.startTime,
        points: [...state.points],
        distance: totalDistance(state.points),
        duration: Date.now() - state.startTime,
      });
      discard();
    };

    const deleteRecording = (id) => {
      state.saved = state.saved.filter((r) => r.id !== id);
      persist();
    };

    const downloadGPX = async (recording) => {
      const filename = `recording-${recording.id}.gpx`;
      const blob = new Blob([toGPX(recording)], {
        type: "application/gpx+xml",
      });

      // Web Share API: best on mobile — triggers the native share sheet (iOS Save to Files, Android, etc.)
      if (navigator.share) {
        const file = new File([blob], filename, {
          type: "application/gpx+xml",
        });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
            return;
          } catch (err) {
            if (err.name === "AbortError") return; // user cancelled share sheet
            // share failed for another reason — fall through to anchor download
          }
        }
      }

      // Fallback: anchor download (desktop browsers)
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const showOnMap = (recording) => {
      const coords = recording.points.map((p) => [p.lng, p.lat]);
      geoJSON.setFeature({
        type: "Feature",
        id: TRACK_ID,
        geometry: { type: "LineString", coordinates: coords },
        properties: {
          "ogis.color": COLOR_ACTIVE,
          "ogis.width": 3,
          "ogis.opacity": 0.85,
        },
      });
      const map = getMap();
      if (map && coords.length > 1) {
        const lngs = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 40 },
        );
      }
    };

    // Crash recovery: restore paused line if the app was closed mid-recording.
    if (stored.active?.points?.length >= 2) {
      state.isPaused = true;
      updateLine();
    }

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
      deleteRecording,
      downloadGPX,
      showOnMap,
    });

    addButton({
      id: "record",
      icon: "route",
      position: "bottom-right",
      component: RecordButton,
      panel: {
        title: "Recordings",
        component: RecordingsPanel,
      },
    });

    return () => {
      stopGeo();
      stopTimer();
    };
  },
};
