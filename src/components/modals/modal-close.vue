<script setup>
import Icon from "@/components/ui/icon.vue";

defineProps({
  label: {
    type: String,
    required: true,
  },
});

defineEmits(["click"]);
</script>

<template>
  <button
    type="button"
    class="ogis-modal-close"
    :aria-label="label"
    @click="$emit('click')"
  >
    <Icon name="x" :width="16" :height="16" aria-hidden="true" />
  </button>
</template>
