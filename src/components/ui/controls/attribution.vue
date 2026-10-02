<script setup>
import { computed } from "vue";
import { useUI } from "@/composables/useUI";
import { useLocale } from "@/composables/useLocale";
import { useAttribution } from "@/composables/useAttribution";
import Icon from "@/components/ui/icon.vue";

const { isInfoVisible, toggleInfo } = useUI();
const { t } = useLocale();

// Attribution HTML comes from our trusted style (OpenGIS/outdoors style.json),
// so rendering it with v-html is safe. The collapsed state and the map 'drag'
// listener live in the composable so the root can mirror the state in CSS.
const { attributionHtml, collapsed } = useAttribution();

const isActive = computed(() => isInfoVisible.value);
</script>

<template>
  <button
    type="button"
    id="attribution-button"
    class="icon-btn icon-btn--chip ogis-attribution-chip d-flex align-items-center flex-row"
    :aria-pressed="isActive"
    :aria-label="t('menu.info')"
    @click="toggleInfo()"
  >
    <div class="icon-btn__icon">
      <Icon :width="20" :height="20" name="info-circle" />
    </div>
    <span
      v-if="!collapsed"
      class="icon-btn__label ogis-attribution-chip__text"
      v-html="attributionHtml"
    ></span>
  </button>
</template>
