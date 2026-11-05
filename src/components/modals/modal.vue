<script setup>
import { onBeforeUnmount, watch } from "vue";

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  id: { type: String, default: null },
  labelledby: { type: String, default: null },
});

const emit = defineEmits(["update:modelValue"]);
const close = () => emit("update:modelValue", false);
defineExpose({ close });

// Escape closes the open modal. It marks the key as handled so the side
// panel, or a second modal, does not close on the same press.
const onKeydown = (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  e.preventDefault();
  close();
};
watch(
  () => props.modelValue,
  (open) => {
    if (open) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
  { immediate: true },
);
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="ogis-fade">
      <div
        v-if="modelValue"
        class="modal-backdrop fade show ogis-modal-backdrop"
      ></div>
    </Transition>
    <Transition name="ogis-pop">
      <div
        v-if="modelValue"
        :id="id"
        class="modal fade show d-block ogis-modal"
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
    </Transition>
  </Teleport>
</template>
