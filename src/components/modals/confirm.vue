<script setup>
import { computed } from "vue";
import Modal from "@/components/modals/modal.vue";
import { useConfirm } from "@/composables/useConfirm";
import { useLocale } from "@/composables/useLocale";

const { request, answer } = useConfirm();
const { t } = useLocale();

// Closing the dialog any other way (the × button) counts as Cancel.
const open = computed({
  get: () => request.value !== null,
  set: (value) => {
    if (!value) answer(false);
  },
});
</script>

<template>
  <Modal v-model="open" id="ogis-confirm" labelledby="ogis-confirm-message">
    <div class="modal-body">
      <p class="mb-0" id="ogis-confirm-message">{{ request?.message }}</p>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" @click="answer(false)">
        {{ t("common.cancel") }}
      </button>
      <button type="button" class="btn btn-danger" @click="answer(true)">
        {{ request?.confirmLabel || t("common.delete") }}
      </button>
    </div>
  </Modal>
</template>
