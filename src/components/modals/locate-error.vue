<script setup>
import Modal from "@/components/modals/modal.vue";
import { useLocate } from "@/composables/useLocate";
import { useLocale } from "@/composables/useLocale";

const { showErrorModal, retryPosition } = useLocate();
const { t } = useLocale();
</script>

<template>
  <Modal v-model="showErrorModal" labelledby="locate-error-title">
    <template #default="{ close }">
      <div class="modal-header">
        <h5 class="modal-title" id="locate-error-title">
          {{ t("modal.locate.deniedTitle") }}
        </h5>
        <button
          type="button"
          class="btn-close"
          :aria-label="t('common.close')"
          @click="close"
        ></button>
      </div>
      <div class="modal-body">
        <p>{{ t("modal.locate.deniedIntro") }}</p>
        <ol class="small mb-0">
          <li>
            {{ t("modal.locate.tryOne") }}
          </li>
          <li>
            {{ t("modal.locate.tryTwo") }}
          </li>
          <li>
            {{ t("modal.locate.tryThree") }}
          </li>
        </ol>
      </div>
      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-outline-secondary"
          id="locate-error-close"
          @click="close"
        >
          {{ t("modal.locate.close") }}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          id="locate-error-retry"
          @click="retryPosition"
        >
          {{ t("modal.locate.retry") }}
        </button>
      </div>
    </template>
  </Modal>
</template>
