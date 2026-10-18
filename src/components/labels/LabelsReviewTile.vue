<!-- One image in the review grid: the crop, its label and where the label came from. -->
<script setup>
import { t } from "@/i18n/index.js";
import { statusHint } from "@/i18n/hints.js";
import { sourcesText } from "@/utils/format.js";
import BaseCropImage from "@/components/BaseCropImage.vue";

defineProps({
  crop: { type: Object, required: true },
  eff: { type: Object, required: true },     // effective label: { label, status, sources }
  selected: { type: Boolean, default: false },
  showRoi: { type: Boolean, default: true },  // off in guided review: every tile is the same wheel
  trained: { type: Boolean, default: false }, // the last model learned from it
});
</script>

<template>
  <button type="button" class="tile" :class="`st-${eff.status}`" :data-hint="statusHint[eff.status] || ''" :aria-selected="selected ? 'true' : 'false'">
    <BaseCropImage :id="crop.id" lazy />
    <span v-if="trained" class="tr" :title="t('Used to train the last model')" :aria-label="t('Used to train the last model')">●</span>
    <span class="l">{{ eff.status === "excluded" ? "x" : (eff.label ?? "?") }}</span>
    <span class="s"><template v-if="showRoi">{{ crop.roi }} · </template>{{ sourcesText(eff.sources) }}</span>
  </button>
</template>
