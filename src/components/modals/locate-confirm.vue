<script setup>
import Modal from "@/components/modals/modal.vue";
import { useLocate } from "@/composables/useLocate";
import { useLocale } from "@/composables/useLocale";

const { showConfirmModal, confirmLocate } = useLocate();
const { t } = useLocale();
</script>

<template>
  <Modal v-model="showConfirmModal" labelledby="locate-confirm-title">
    <template #default="{ close }">
      <div class="modal-header">
        <h5 class="modal-title" id="locate-confirm-title">
          {{ t("modal.locate.permissionTitle") }}
        </h5>
        <button
          type="button"
          class="btn-close"
          :aria-label="t('common.close')"
          @click="close"
        ></button>
      </div>
      <div class="modal-body">
        <p class="mb-0">{{ t("modal.locate.permissionBody") }}</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" @click="close">
          {{ t("modal.locate.cancel") }}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          id="locate-confirm-allow"
          @click="confirmLocate"
        >
          {{ t("modal.locate.iUnderstand") }}
        </button>
      </div>
    </template>
  </Modal>
</template>
