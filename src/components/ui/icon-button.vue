<script setup>
import Icon from "@/components/ui/icon.vue";

defineProps({
  icon: { type: String, required: true },
  label: { type: String, required: true },
  iconWidth: { type: Number, default: 40 },
  iconHeight: { type: Number, default: 40 },
  iconColor: { type: String, default: "currentColor" },
  active: { type: Boolean, default: false },
  id: { type: String, default: undefined },
  chip: { type: Boolean, default: false },
});
</script>

<template>
  <button
    type="button"
    class="icon-btn d-flex align-items-center"
    :class="
      chip ? 'icon-btn--chip flex-row' : 'flex-column border-0 bg-transparent'
    "
    :id="id"
    :aria-pressed="active"
    :style="iconColor !== 'currentColor' ? { color: iconColor } : undefined"
  >
    <div class="icon-btn__icon" :style="{ height: iconHeight + 'px' }">
      <Icon :width="iconWidth" :height="iconHeight" :name="icon" />
    </div>
    <span class="icon-btn__label">{{ label }}</span>
    <slot />
  </button>
</template>
