// Build training arrays from the stored crops and their effective labels.
//  - test split, per wheel and label: the newest ~20% of that group's images (at least
//    TEST_MIN, from groups of TEST_MIN_GROUP or more), so every label is tested, the rarer
//    in-between positions too, on images newer than any it learned from; near-duplicates
//    left out and at most TEST_CAP per group, so a wheel standing still for hours does not
//    count as hundreds of images
//  - all: no test split; the final model trains on every usable image
//  - only "you" and "confirmed" labels, unless includeUnconfirmed
//  - per wheel and label at most `cap` training crops, spread over time (every hour that has
//    any, old and new days), leaving out near-duplicates of crops already taken (a wheel at
//    rest would otherwise flood the set with one picture)
//  - smaller wheel + label groups are repeated (up to MAX_REPEAT times) towards the median
//    group size, so each is seen about as often; augmentation makes the repeats differ
import { PIX, IN_H, IN_W, IN_C } from "./dataset.js";
import { LABELS, target } from "./labels.js";
import { spreadOrder } from "./spread.js";

// Mean gray difference (0..255) on a 16x10 thumbnail below which two crops count as the same
// picture. Crops of a resting wheel minutes apart differ by ~0.7 (JPEG and sensor noise).
export const DUP_DIST = 1.0;
const MAX_REPEAT = 4;
const TEST_MIN_GROUP = 10, TEST_MIN = 3, TEST_CAP = 50;
const SIG_H = IN_H / 2, SIG_W = IN_W / 2, SIG = SIG_H * SIG_W;

/** 16x10 gray thumbnail of a crop (2x2 blocks). */
function signature(pix) {
  const s = new Float32Array(SIG);
  for (let y = 0; y < IN_H; y++) for (let x = 0; x < IN_W; x++) {
    let v = 0;
    for (let c = 0; c < IN_C; c++) v += pix[(y * IN_W + x) * IN_C + c];
    s[(y >> 1) * SIG_W + (x >> 1)] += v;
  }
  for (let i = 0; i < SIG; i++) s[i] /= 4 * IN_C;
  return s;
}

/** Up to cap rows of one group, spread over time, none a near-duplicate of another. -> {kept, dupes} */
function distinct(rows, cap) {
  const kept = [], sigs = [];
  let dupes = 0;
  for (const r of spreadOrder(rows)) {
    if (kept.length >= cap) break;
    const s = signature(r.pix);
    const lim = DUP_DIST * SIG;
    if (sigs.some((o) => { let d = 0; for (let i = 0; i < SIG && d < lim; i++) d += Math.abs(o[i] - s[i]); return d < lim; })) { dupes++; continue; }
    kept.push(r); sigs.push(s);
  }
  return { kept, dupes };
}

export function buildTrainSet(crops, eff, { includeUnconfirmed = false, cap = 300, testFrac = 0.2, all = false } = {}) {
  const ok = (s) => s === "human" || s === "confirmed" || (includeUnconfirmed && s === "unconfirmed");
  const rows = crops.filter((c) => { const e = eff.get(c.id); return e && e.label && ok(e.status); })
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const days = [...new Set(rows.map((r) => r.ts.slice(0, 8)))].sort();
  const byGroup = new Map();
  for (const r of rows) {
    const k = `${r.roi}|${eff.get(r.id).label}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(r);
  }
  const test = [], groups = [];
  for (const g of byGroup.values()) {
    // the newest of the group's sure labels are tested; unconfirmed ones only ever train
    const sure = g.filter((r) => eff.get(r.id).status !== "unconfirmed");
    const nTest = all || sure.length < TEST_MIN_GROUP ? 0 : Math.max(TEST_MIN, Math.round(sure.length * testFrac));
    const cut = nTest ? sure[sure.length - nTest].ts : "~";
    test.push(...distinct(sure.slice(sure.length - nTest), TEST_CAP).kept);
    groups.push(g.filter((r) => r.ts < cut));
  }
  const train = [], groupOfRow = [];
  let dupes = 0;
  for (const g of groups) {
    const d = distinct(g, cap);
    dupes += d.dupes;
    groupOfRow.push(...d.kept.map(() => d.kept.length));
    train.push(...d.kept);
  }
  const rowsOut = [...train, ...test];
  const X = new Uint8Array(rowsOut.length * PIX), Y = new Float32Array(rowsOut.length * 10);
  const meta = rowsOut.map((r, i) => {
    X.set(r.pix, i * PIX);
    const e = eff.get(r.id);
    Y.set(target(e.label), i * 10);
    return { id: r.id, roi: r.roi, ts: r.ts, label: e.label, status: e.status, pred: r.pred, rejected: r.rejected };
  });
  const trainIdx = train.map((_, i) => i);
  for (let i = trainIdx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [trainIdx[i], trainIdx[j]] = [trainIdx[j], trainIdx[i]]; }
  const nVal = Math.max(1, Math.round(trainIdx.length * 0.08));
  // repeat rows of small groups (after the validation split, so no repeat is validated on)
  const sizes = [...groupOfRow].sort((a, b) => a - b), median = sizes[sizes.length >> 1] || 1;
  const fit = trainIdx.slice(nVal);
  for (const i of trainIdx.slice(nVal)) {
    const n = Math.min(MAX_REPEAT, Math.round(median / groupOfRow[i]));
    for (let k = 1; k < n; k++) fit.push(i);
  }
  for (let i = fit.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [fit[i], fit[j]] = [fit[j], fit[i]]; }
  return {
    X, Y, meta,
    valIdx: trainIdx.slice(0, nVal), trainIdx: fit,
    testIdx: test.map((_, k) => train.length + k),
    unique: train.length, dupes,
    days: days.length,
  };
}

/** The digit with the highest probability in row k of probs. */
function argmax(probs, k) {
  let am = 0;
  for (let c = 1; c < 10; c++) if (probs[k * 10 + c] > probs[k * 10 + am]) am = c;
  return am;
}

/** Per wheel: model accuracy vs the device's own reading on the test crops. */
export function compareOnTest(set, probs) {
  const g = new Map();
  set.testIdx.forEach((r, k) => {
    const m = set.meta[r];
    const am = argmax(probs, k);
    const isT = m.label.includes("/");
    const e = g.get(m.roi) || { roi: m.roi, n: 0, model: 0, dev: 0, devN: 0, modelOnDev: 0, t: 0, tModel: 0 };
    e.n++; e.model += set.Y[r * 10 + am] >= 0.5;
    if (isT) { e.t++; e.tModel += set.Y[r * 10 + am] >= 0.5; }
    if (m.pred != null) { // same images for both: only those the device read itself
      e.devN++;
      e.dev += !m.rejected && set.Y[r * 10 + (Math.round(m.pred) % 10)] >= 0.5;
      e.modelOnDev += set.Y[r * 10 + am] >= 0.5;
    }
    g.set(m.roi, e);
  });
  return [...g.values()].sort((a, b) => a.roi.localeCompare(b.roi, undefined, { numeric: true }));
}

/** Per label: model accuracy and the device's on the test crops, in label order. */
export function compareByLabel(set, probs) {
  const g = new Map();
  set.testIdx.forEach((r, k) => {
    const m = set.meta[r], ok = set.Y[r * 10 + argmax(probs, k)] >= 0.5;
    const e = g.get(m.label) || { label: m.label, n: 0, model: 0, dev: 0, devN: 0 };
    e.n++; e.model += ok;
    if (m.pred != null) { e.devN++; e.dev += !m.rejected && set.Y[r * 10 + (Math.round(m.pred) % 10)] >= 0.5; }
    g.set(m.label, e);
  });
  return LABELS.filter((l) => g.has(l)).map((l) => g.get(l));
}

/**
 * Test crops the model got wrong, the most confident mistakes first: a model that is sure
 * and still "wrong" often points at a wrong label. guess is the model's answer, as a pair
 * ("6/7") when the next digit up or down is nearly as likely.
 */
export function testErrors(set, probs) {
  const out = [];
  set.testIdx.forEach((r, k) => {
    const am = argmax(probs, k);
    if (set.Y[r * 10 + am] >= 0.5) return;
    const p = (c) => probs[k * 10 + ((c + 10) % 10)];
    const nb = p(am + 1) >= p(am - 1) ? (am + 1) % 10 : (am + 9) % 10;
    const lo = nb === (am + 1) % 10 ? am : nb;
    const m = set.meta[r];
    out.push({ id: m.id, roi: m.roi, label: m.label, p: p(am), guess: p(nb) >= 0.25 ? `${lo}/${(lo + 1) % 10}` : String(am) });
  });
  return out.sort((a, b) => b.p - a.p);
}
