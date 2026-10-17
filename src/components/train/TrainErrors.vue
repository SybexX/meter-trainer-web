<!-- The test images the new model got wrong, surest mistakes first; a click opens them in the review. -->
<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { t } from "@/i18n/index.js";
import { go } from "@/stores/app.js";
import { data } from "@/stores/project.js";
import { train } from "@/stores/train.js";
import { openCrops } from "@/stores/review.js";
import BaseCropImage from "@/components/BaseCropImage.vue";

const PAGE = 48;
const shown = ref(PAGE);
/** The mistakes with their crops (a crop deleted since training is left out). */
const rows = computed(() => {
  if (!train.errors) return [];
  const byId = new Map(data.crops.map((c) => [c.id, c]));
  return train.errors.map((e) => ({ e, c: byId.get(e.id) })).filter((r) => r.c);
});
watch(() => train.errors, () => { shown.value = PAGE; });

function review(k) {
  openCrops(rows.value.map((r) => r.c), t("{n} test images the new model got wrong", { n: rows.value.length }), k);
  go("labels");
  nextTick(() => document.getElementById("revGrid")?.scrollIntoView({ block: "start" }));
}
</script>

<template>
  <div v-if="train.errors" id="trainErrors" class="stack">
    <h3>{{ t("Where the new model was wrong") }}</h3>
    <p v-if="!rows.length" class="hint">{{ t("The new model read all {n} test images right.", { n: train.testN }) }}</p>
    <template v-else>
      <p class="hint">{{ t("{n} of {m} test images. The surest mistakes come first: there the label itself is often wrong. Click an image to check its label in the review.", { n: rows.length, m: train.testN }) }}</p>
      <div class="grid">
        <button v-for="(r, k) in rows.slice(0, shown)" :key="r.e.id" type="button" class="tile" @click="review(k)">
          <BaseCropImage :id="r.c.id" lazy />
          <span class="l">{{ r.e.label }}</span>
          <span class="s">{{ t("model {g} · {p}%", { g: r.e.guess, p: Math.round(r.e.p * 100) }) }}<br>{{ r.e.roi }}</span>
        </button>
      </div>
      <div class="row">
        <button v-if="shown < rows.length" type="button" @click="shown += PAGE">{{ t("Show more ({n} left)", { n: rows.length - shown }) }}</button>
        <button type="button" @click="review(-1)">{{ t("Review all of them") }}</button>
      </div>
    </template>
  </div>
</template>
