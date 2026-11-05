<!-- rename-input.vue — text field shown in place of a name while renaming -->
<script setup>
import { onMounted, ref } from "vue";

defineProps({
  modelValue: { type: String, default: "" },
  label: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue", "commit", "cancel"]);

const input = ref(null);

onMounted(() => {
  input.value?.focus();
  input.value?.select();
});
</script>

<template>
  <input
    ref="input"
    type="text"
    class="form-control form-control-sm ogis-rename-input"
    maxlength="80"
    :value="modelValue"
    :aria-label="label"
    @input="emit('update:modelValue', $event.target.value)"
    @keydown.enter.prevent="emit('commit')"
    @keydown.esc.prevent="emit('cancel')"
    @blur="emit('commit')"
  />
</template>
