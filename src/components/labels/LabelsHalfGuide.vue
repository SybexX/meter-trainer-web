<!-- How to label a wheel between two digits: the rule, and drawn examples of the window. -->
<script setup>
import { t, N_ } from "@/i18n/index.js";

// the window as on the watermeter: 46 x 81 px, digits about 45 px tall, 61 px apart on the wheel
const W = 46, H = 81, PITCH = 61;
const EXAMPLES = [
  { pos: 3, label: "3", why: N_("in the middle") },
  { pos: 3.25, label: "3", why: N_("3 whole, the edge of 4 below") },
  { pos: 3.5, label: "3/4", why: N_("both cut off") },
  { pos: 3.75, label: "4", why: N_("4 whole, the edge of 3 above") },
  { pos: 4, label: "4", why: N_("in the middle") },
];
/** The digits of the wheel near pos, with their y in the window (digits go up as the wheel turns on). */
const digitsAt = (pos) => [-1, 0, 1, 2].map((k) => {
  const d = Math.floor(pos) + k;
  return { d: ((d % 10) + 10) % 10, y: H / 2 + (d - pos) * PITCH };
}).filter((g) => g.y > -40 && g.y < H + 40);
</script>

<template>
  <details class="halves">
    <summary><b>{{ t("How to label a wheel between two digits") }}</b></summary>
    <p class="hint">{{ t("One digit visible whole: label that digit, even with a piece of the next one at the edge. Between (T, then the lower digit: T 3 = 3/4) only when both digits are cut off by the window’s edges. The device counts the same way: closer than 0.3 to a digit is that digit, 0.3 to 0.7 is between. Labels that differ on this border teach the model “something in between”, and it then hesitates on such images.") }}</p>
    <div class="ex">
      <figure v-for="e in EXAMPLES" :key="e.pos">
        <svg :viewBox="`0 0 ${W} ${H}`" :width="W * 1.25" :height="H * 1.25" role="img" :aria-label="t('Window with the wheel at {p}', { p: e.pos })">
          <rect :width="W" :height="H" rx="3" class="win" />
          <text v-for="g in digitsAt(e.pos)" :key="g.d" :x="W / 2" :y="g.y" class="dg">{{ g.d }}</text>
          <path :d="`M0 ${H / 2}h4M${W - 4} ${H / 2}h4`" class="mid" />
        </svg>
        <figcaption><b>{{ e.label }}</b><span>{{ t(e.why) }}</span></figcaption>
      </figure>
    </div>
  </details>
</template>

<style scoped>
.halves { margin: var(--space-xs) 0; }
.halves > p { max-width: 72ch; }
.ex { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-top: var(--space-xs); }
figure { margin: 0; display: grid; justify-items: center; gap: var(--space-3xs); width: 84px; }
.win { fill: var(--color-sunk); stroke: var(--color-rule-strong); }
.dg { font: 600 52px var(--font-mono); fill: var(--color-ink); text-anchor: middle; dominant-baseline: central; }
.mid { stroke: var(--color-accent); stroke-width: 1.5; }
figcaption { display: grid; justify-items: center; text-align: center; font-size: 0.6875rem; line-height: 1.25; color: var(--color-muted); }
figcaption b { font: 600 var(--text-base) var(--font-mono); color: var(--color-accent); }
</style>
