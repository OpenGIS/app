<script setup>
import Modal from "@/components/modals/modal.vue";
import { useWelcome } from "@/stores/welcomeStore";
import { useLocale } from "@/composables/useLocale";

const { showWelcome, dismissWelcome } = useWelcome();
const { t } = useLocale();
</script>

<template>
  <Modal
    :model-value="showWelcome"
    labelledby="welcome-title"
    @update:model-value="dismissWelcome"
  >
    <template #default>
      <div class="modal-header">
        <h5 class="modal-title" id="welcome-title">
          {{ t("modal.welcome.title") }}
        </h5>
      </div>
      <div class="modal-body">
        <p class="mb-0">{{ t("modal.welcome.body") }}</p>
      </div>
      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-primary"
          id="welcome-continue"
          @click="dismissWelcome"
        >
          {{ t("modal.welcome.continue") }}
        </button>
      </div>
    </template>
  </Modal>
</template>
