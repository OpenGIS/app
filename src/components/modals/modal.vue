<script setup>
defineProps({
  modelValue: { type: Boolean, required: true },
  id: { type: String, default: null },
  labelledby: { type: String, default: null },
});

const emit = defineEmits(["update:modelValue"]);
const close = () => emit("update:modelValue", false);
defineExpose({ close });
</script>

<template>
  <Teleport to="body">
    <template v-if="modelValue">
      <div class="modal-backdrop fade show onrte-modal-backdrop"></div>
      <div
        :id="id"
        class="modal fade show d-block onrte-modal"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledby"
      >
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <slot :close="close" />
          </div>
        </div>
      </div>
    </template>
  </Teleport>
</template>
