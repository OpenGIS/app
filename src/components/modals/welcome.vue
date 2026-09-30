<script setup>
import Modal from "@/components/modals/modal.vue";
import { useUI } from "@/composables/useUI";
import { useLocale } from "@/composables/useLocale";

const { showAboutModal, closeAboutModal } = useUI();
const { t } = useLocale();
</script>

<template>
  <Modal
    id="about-modal"
    :model-value="showAboutModal"
    labelledby="about-modal-title"
    @update:model-value="closeAboutModal"
  >
    <template #default>
      <div class="modal-header">
        <h5 class="modal-title" id="about-modal-title">
          {{ t("modal.welcome.title") }}
        </h5>
        <button
          type="button"
          class="btn-close"
          aria-label="Close"
          @click="closeAboutModal"
        ></button>
      </div>
      <div class="modal-body">
        <p class="lead">{{ t("modal.welcome.introOne") }}</p>
        <p>{{ t("modal.welcome.introTwo") }}</p>
        <p class="mb-0 text-body-secondary small">
          {{ t("modal.welcome.locateInfo") }}
        </p>
      </div>
      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-primary"
          id="about-modal-close"
          @click="closeAboutModal"
        >
          {{ t("modal.welcome.getStarted") }}
        </button>
      </div>
    </template>
  </Modal>
</template>
