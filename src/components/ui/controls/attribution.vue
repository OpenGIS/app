<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useUI } from "@/composables/useUI";
import { useLocale } from "@/composables/useLocale";
import { useAttribution } from "@/composables/useAttribution";
import { useFitText } from "@/composables/useFitText";
import Icon from "@/components/ui/icon.vue";

const { isInfoVisible, toggleInfo } = useUI();
const { t } = useLocale();

// Attribution HTML comes from our trusted style (OpenGIS/outdoors style.json),
// so rendering it with v-html is safe. The collapsed state and the map 'drag'
// listener live in the composable so the root can mirror the state in CSS.
const { attributionHtml, collapsed } = useAttribution();

const isActive = computed(() => isInfoVisible.value);

const buttonRef = ref(null);
const collapsedLabelRef = ref(null);

// The collapsed chip is a 72px circle, so its icon renders at the chip class
// default (29px) and gains the same fitted label as its corner peers. The
// expanded pill keeps its original 20px icon and credits text.
const iconSize = computed(() => (collapsed.value ? 29 : 20));

// Fit the collapsed label with the same levers as the corner chips. It only
// applies while collapsed; the expanded credits span is untouched.
const { fit } = useFitText(buttonRef, collapsedLabelRef, () => t("menu.info"), {
  enabled: () => collapsed.value,
});

// The collapsed label only exists once the chip collapses, so re-fit after the
// DOM updates rather than waiting on the ResizeObserver.
watch(collapsed, () => nextTick(fit));
</script>

<template>
  <button
    ref="buttonRef"
    type="button"
    id="attribution-button"
    class="icon-btn icon-btn--chip ogis-attribution-chip d-flex align-items-center"
    :aria-pressed="isActive"
    :aria-label="t('menu.info')"
    @click="toggleInfo()"
  >
    <div class="icon-btn__icon">
      <Icon :width="iconSize" :height="iconSize" name="info-circle" />
    </div>
    <span
      v-if="!collapsed"
      class="icon-btn__label ogis-attribution-chip__text"
      v-html="attributionHtml"
    ></span>
    <span v-else ref="collapsedLabelRef" class="icon-btn__label">{{
      t("menu.info")
    }}</span>
  </button>
</template>
