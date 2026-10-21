<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useLocale } from "@/composables/useLocale";
import { getMapInstance } from "@/composables/useMap";
import { geodesicLine } from "@/utils/track";
import Icon from "@/components/ui/icon.vue";

const props = defineProps({
  navigation: {
    type: Object,
    required: true,
  },
});

const instanceId = inject("ogisAppId", "app");
const { t } = useLocale();

const points = ref("");

let boundMap = null;
let frame = null;

const shouldDraw = () =>
  props.navigation.state === "off-route" &&
  props.navigation.position &&
  props.navigation.point &&
  props.navigation.distance <= 1000;

const update = () => {
  const map = getMapInstance(instanceId);

  if (!map || !shouldDraw()) {
    points.value = "";
    return;
  }

  bindMap(map);

  const rect = map.getCanvas().getBoundingClientRect();
  const coords = geodesicLine(
    props.navigation.position,
    props.navigation.point,
  );

  if (!coords.length) {
    points.value = "";
    return;
  }

  const projected = coords.map(([lng, lat]) => {
    const point = map.project([lng, lat]);
    return [point.x + rect.left, point.y + rect.top];
  });

  const marker = map
    .getContainer()
    .querySelector(".ogis-locate-position, .ogis-locate-heading");

  if (marker) {
    const box = marker.getBoundingClientRect();
    projected[0] = [box.left + box.width / 2, box.top + box.height / 2];
  }

  const target = map.project([
    props.navigation.point.lng,
    props.navigation.point.lat,
  ]);
  projected[projected.length - 1] = [target.x + rect.left, target.y + rect.top];

  points.value = projected.map(([x, y]) => `${x},${y}`).join(" ");
};

const scheduleUpdate = () => {
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    update();
  });
};

const bindMap = (map) => {
  if (!map || map === boundMap) return;
  unbindMap();
  boundMap = map;
  map.on("move", scheduleUpdate);
  map.on("resize", scheduleUpdate);
};

const unbindMap = () => {
  if (!boundMap) return;
  boundMap.off("move", scheduleUpdate);
  boundMap.off("resize", scheduleUpdate);
  boundMap = null;
};

onMounted(() => {
  bindMap(getMapInstance(instanceId));
  scheduleUpdate();
});

onUnmounted(() => {
  unbindMap();
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
});

watch(
  () => props.navigation,
  () => {
    bindMap(getMapInstance(instanceId));
    scheduleUpdate();
  },
  { deep: true },
);

const iconName = computed(() =>
  props.navigation.state === "on-route" ? "check" : "nav-arrow",
);

const iconSize = computed(() =>
  props.navigation.state === "on-route" ? 24 : 29,
);

const caption = computed(() => {
  if (props.navigation.state === "on-route") {
    return t("panel.routes.navigationOnRoute");
  }
  if (props.navigation.state === "locating") {
    return t("panel.routes.navigationLocating");
  }
  return t("panel.routes.navigationOffRouteLabel");
});

const showCaption = computed(() => {
  if (props.navigation.state !== "on-route") return true;
  return (
    caption.value.toLowerCase() !==
    String(props.navigation.label ?? "").toLowerCase()
  );
});

const iconStyle = computed(() => {
  const style = {
    width: `${iconSize.value}px`,
    height: `${iconSize.value}px`,
  };

  if (props.navigation.state === "off-route") {
    style.transform = `rotate(${props.navigation.bearingDeg}deg)`;
  }

  return style;
});
</script>

<template>
  <Teleport to="body">
    <svg v-if="points" class="ogis-nav-connector" aria-hidden="true">
      <polyline :points="points" />
    </svg>
  </Teleport>

  <div
    class="ogis-nav-control"
    data-variant="card"
    :data-state="navigation.state"
    role="status"
    aria-live="off"
    :aria-label="navigation.title"
  >
    <span class="ogis-nav-control__icon" aria-hidden="true">
      <Icon
        :name="iconName"
        :width="iconSize"
        :height="iconSize"
        :style="iconStyle"
      />
    </span>
    <span class="ogis-nav-control__body">
      <span class="ogis-nav-control__value">{{ navigation.label }}</span>
      <span v-if="showCaption" class="ogis-nav-control__caption">
        {{ caption }}
      </span>
    </span>
  </div>
</template>
