<script setup>
import { computed } from "vue";
import Modal from "@/components/modals/modal.vue";
import ModalClose from "@/components/modals/modal-close.vue";
import { useLocate } from "@/composables/useLocate";
import { useLocale } from "@/composables/useLocale";

const { showErrorModal, retryPosition, errorCause } = useLocate();
const { t } = useLocale();

const isDenied = computed(() => errorCause.value === "denied");

const title = computed(() => {
  switch (errorCause.value) {
    case "denied":
      return t("modal.locate.deniedTitle");
    case "unavailable":
      return t("modal.locate.unavailableTitle");
    case "timeout":
      return t("modal.locate.timeoutTitle");
    case "unsupported":
      return t("modal.locate.unsupportedTitle");
    default:
      return t("modal.locate.unknownTitle");
  }
});

const body = computed(() => {
  switch (errorCause.value) {
    case "denied":
      return t("modal.locate.deniedIntro");
    case "unavailable":
      return t("modal.locate.unavailableBody");
    case "timeout":
      return t("modal.locate.timeoutBody");
    case "unsupported":
      return t("modal.locate.unsupportedBody");
    default:
      return t("modal.locate.unknownBody");
  }
});

const canRetry = computed(() => errorCause.value !== "unsupported");
</script>

<template>
  <Modal v-model="showErrorModal" labelledby="locate-error-title">
    <template #default="{ close }">
      <div class="modal-header">
        <h5 class="modal-title" id="locate-error-title">
          {{ title }}
        </h5>
        <ModalClose :label="t('common.close')" @click="close" />
      </div>
      <div class="modal-body">
        <p>{{ body }}</p>
        <ol v-if="isDenied" class="small mb-0">
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
          v-if="canRetry"
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
