<script setup>
import { computed, ref } from "vue";
import Icon from "@/components/ui/icon.vue";
import { useFitText } from "@/composables/useFitText";

const props = defineProps({
  icon: { type: String, required: true },
  label: { type: String, required: true },
  iconWidth: { type: Number, default: 40 },
  iconHeight: { type: Number, default: 40 },
  iconColor: { type: String, default: "currentColor" },
  active: { type: Boolean, default: false },
  id: { type: String, default: undefined },
  chip: { type: Boolean, default: false },
  iconSize: { type: Number, default: null },
  iconGap: { type: Number, default: null },
  labelMin: { type: Number, default: null },
  labelMax: { type: Number, default: null },
  labelTarget: { type: Number, default: null },
});

const buttonRef = ref(null);
const labelRef = ref(null);

const buttonStyle = computed(() => {
  const style = {};
  if (props.iconColor !== "currentColor") style.color = props.iconColor;
  if (props.chip) {
    if (props.iconSize !== null)
      style["--ogis-chip-icon-size"] = `${props.iconSize}px`;
    if (props.iconGap !== null) style["--ogis-chip-gap"] = `${props.iconGap}px`;
    if (props.labelMin !== null)
      style["--ogis-chip-label-min"] = `${props.labelMin}px`;
    if (props.labelMax !== null)
      style["--ogis-chip-label-max"] = `${props.labelMax}px`;
    if (props.labelTarget !== null)
      style["--ogis-chip-label-target"] = `${props.labelTarget * 100}%`;
  }
  return Object.keys(style).length ? style : undefined;
});

useFitText(buttonRef, labelRef, () => props.label, {
  enabled: () => props.chip,
});
</script>

<template>
  <button
    ref="buttonRef"
    type="button"
    class="icon-btn d-flex align-items-center"
    :class="
      chip
        ? 'icon-btn--chip flex-column'
        : 'flex-column border-0 bg-transparent'
    "
    :id="id"
    :aria-pressed="active"
    :style="buttonStyle"
  >
    <div
      class="icon-btn__icon"
      :style="chip ? undefined : { height: iconHeight + 'px' }"
    >
      <Icon :width="iconWidth" :height="iconHeight" :name="icon" />
    </div>
    <span ref="labelRef" class="icon-btn__label">{{ label }}</span>
    <slot />
  </button>
</template>
