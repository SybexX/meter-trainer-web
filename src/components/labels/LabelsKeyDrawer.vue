<!-- The label keys drawer at the bottom: the selected image large, its sources, a key per label
     (a key labels the image and moves on, like the keyboard) and previous / next for touch screens. -->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { t } from "@/i18n/index.js";
import { LABELS } from "@/lib/labels.js";
import { app } from "@/stores/app.js";
import { data, rev } from "@/stores/project.js";
import { review, setHuman, labelAndNext, moveSel } from "@/stores/review.js";
import { sourcesText } from "@/utils/format.js";
import BaseCropImage from "@/components/BaseCropImage.vue";

const crop = computed(() => (review.drawer && app.step === "labels" ? review.list[review.sel] : null));
const eff = computed(() => (rev.value, crop.value && data.eff.get(crop.value.id)));
const rec = computed(() => (rev.value, (crop.value && data.labels.get(crop.value.id)) || {}));

const info = computed(() => {
  if (review.tPending) return t("Between two digits: press the lower one (T 6 = 6/7)");
  const c = crop.value, e = eff.value, r = rec.value;
  return t("{roi}  {ts}  label {l} ({src})  device {d}{rej}  AI {ai}", { roi: c.roi, ts: c.ts, l: e.status === "excluded" ? "x" : e.label ?? "?",
    src: sourcesText(e.sources), d: c.pred ?? "–", rej: c.rejected ? t(" rejected") : "", ai: r.llm ?? "–" });
});
/** The key that is lit: your label, else the shown one; "x" when excluded. */
const isOn = (l) => (l === "x" ? eff.value.status === "excluded" : (rec.value.human || (eff.value.status !== "excluded" && eff.value.label)) === l);

// the page keeps room under the grid for the drawer, and a selected tile scrolls clear of it
const el = ref(null);
const setH = (h) => document.documentElement.style.setProperty("--drawerh", `${Math.ceil(h)}px`);
const ro = new ResizeObserver(([en]) => {
  setH(en.target.offsetHeight);
  document.querySelector('#revGrid [aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); // the drawer may now cover it
});
watch(el, (e, old) => { if (old) ro.unobserve(old); if (e) ro.observe(e); else setH(0); });
onBeforeUnmount(() => { ro.disconnect(); setH(0); });
</script>

<template>
  <Teleport to="body">
    <div v-if="crop" id="drawer" ref="el" class="drawer">
      <div class="drawer-in">
        <BaseCropImage :id="crop.id" />
        <div class="drawer-info">
          <div class="drawer-top">
            <div id="selInfo" class="status">{{ info }}</div>
            <div class="drawer-nav">
              <button type="button" :aria-label="t('Previous image')" :disabled="review.sel <= 0" @click="moveSel(-1)">‹</button>
              <span>{{ review.sel + 1 }}/{{ review.list.length }}</span>
              <button type="button" :aria-label="t('Next image')" :disabled="review.sel >= review.list.length - 1" @click="moveSel(+1)">›</button>
              <button type="button" :aria-label="t('Close')" @click="review.drawer = false">✕</button>
            </div>
          </div>
          <div id="keys" class="keys">
            <template v-for="(l, i) in [...LABELS, 'x']" :key="l">
              <span v-if="i === 10 || i === 20" class="sep"></span>
              <button type="button" :class="{ on: isOn(l), kx: l === 'x' }" @click="labelAndNext(crop, l)">{{ l === "x" ? t("X unusable") : l }}</button>
            </template>
            <button type="button" class="kr" :disabled="!rec.human" @click="setHuman(crop, null)">{{ t("Remove my label") }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
