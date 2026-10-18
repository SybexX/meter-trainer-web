// The trained model as a zip with the images it learned from: model.tflite, model.json,
// labels.csv, images/ and index.html, a page showing every image by wheel and label
// (opens from the unpacked folder, no server needed). The model does not know the wheel:
// it gets the crop only, one model for all wheels, so the page groups by label first.
// The same page also opens in a new tab straight from the browser's storage (openModelPage).
import { zip } from "fflate";
import * as store from "@/services/db.js";
import { LANG, t } from "@/i18n/index.js";
import { say, runTask } from "@/stores/app.js";
import { data } from "@/stores/project.js";
import { train } from "@/stores/train.js";
import { LABELS } from "@/lib/labels.js";
import { LOC, num, saveFile } from "@/utils/format.js";

const COLS = ["path", "roi", "label", "status", "ts", "split", "device", "model"];
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The viewer page: data embedded, so it works from file:// and from a blob: tab. */
function viewerHtml(m, rows, learned) {
  // [src, wheel, label, ts, 0 learned / 1 test / 2 test the comparison model got wrong, its answer, its %]
  const items = rows.map((r) => [r.path, r.roi, r.label, r.ts, r.err ? 2 : r.split === "test" ? 1 : 0, r.err?.guess ?? "", r.err ? Math.round(r.err.p * 100) : 0]);
  const nErr = rows.filter((r) => r.err).length, nTest = rows.filter((r) => r.split === "test").length;
  const text = {
    intro: t("{n} images the model learned from.", { n: num(learned) }),
    byLabel: t("By label"), byWheel: t("By wheel and label"),
    all: t("All"), test: t("Test images ({n})", { n: num(nTest) }), errs: t("Mistakes ({n})", { n: num(nErr) }),
    model: t("model"),
    outlined: (m.final ? t("Outlined: the test images (the newest of each wheel and label). The comparison model did not see them; this final model learned from them too.")
      : t("Outlined: the test images (the newest of each wheel and label), not learned from, used to compare with the installed model.")) +
      " " + t("Red: the ones the comparison model got wrong; point at one for its answer."),
    when: t("Trained {date}", { date: new Date(m.at).toLocaleString(LOC) }) + (m.acc != null ? ` · ${t("accuracy on the test images {p}%", { p: (m.acc * 100).toFixed(1) })}` : ""),
  };
  // a "<" in the data must not end the script element
  const json = JSON.stringify({ items, order: LABELS, text }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${LANG}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.name)}</title>
<style>
:root { --bg: #fafaf9; --ink: #1c1917; --muted: #78716c; --line: #e7e5e4; --sunk: #e7e5e4; --test: #c2410c; --err: #dc2626; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --ink: #f5f5f4; --muted: #a8a29e; --line: #44403c; --sunk: #292524; --test: #fb923c; --err: #f87171; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 4px; overflow-wrap: anywhere; }
.modes { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 4px; }
button { font: inherit; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--ink); cursor: pointer; }
button[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
h2 { font-size: 16px; margin: 24px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
p { margin: 2px 0; color: var(--muted); }
.row { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; }
.lab { flex: 0 0 3.2em; font: 600 15px ui-monospace, monospace; }
.lab small { display: block; font: 400 11px system-ui, sans-serif; color: var(--muted); }
.imgs { display: flex; flex-wrap: wrap; gap: 3px; min-width: 0; }
img { width: 30px; height: 48px; object-fit: fill; border-radius: 2px; background: var(--sunk); }
img.test { outline: 2px solid var(--test); outline-offset: -2px; }
img.err { outline: 3px solid var(--err); outline-offset: -3px; }
</style></head><body>
<h1>${esc(m.name)}</h1>
<div id="head"></div><div class="modes" id="modes"></div><div class="modes" id="shows"></div><div id="out"></div>
<script id="data" type="application/json">${json}</script>
<script>
const D = JSON.parse(document.getElementById("data").textContent);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const head = document.getElementById("head"), out = document.getElementById("out");
for (const s of [D.text.when, D.text.intro, D.text.outlined]) head.append(el("p", "", s));
const ord = (l) => { const i = D.order.indexOf(l); return i < 0 ? 999 : i; };
const byKey = (list, k) => { const m = new Map(); for (const it of list) { if (!m.has(it[k])) m.set(it[k], []); m.get(it[k]).push(it); } return m; };
const when = (ts) => ts.slice(0, 4) + "-" + ts.slice(4, 6) + "-" + ts.slice(6, 8) + " " + ts.slice(9, 11) + ":" + ts.slice(11, 13);
/** One label's images in a row, oldest first. */
function row(lab, list) {
  const r = el("div", "row"), l = el("div", "lab", lab), imgs = el("div", "imgs");
  l.append(el("small", "", String(list.length)));
  for (const it of list.sort((a, b) => (a[3] < b[3] ? -1 : 1))) {
    const img = el("img", ["", "test", "err"][it[4]]);
    img.loading = "lazy"; img.src = it[0]; img.alt = lab;
    img.title = it[1] + " · " + when(it[3]) + (it[4] === 2 ? " · " + D.text.model + " " + it[5] + " · " + it[6] + "%" : "");
    imgs.append(img);
  }
  r.append(l, imgs);
  return r;
}
const labels = (list) => [...byKey(list, 2)].sort((a, b) => ord(a[0]) - ord(b[0]));
const state = { mode: "label", show: "all" };
function render() {
  out.replaceChildren();
  for (const b of modes.children) b.setAttribute("aria-pressed", String(b.dataset.v === state.mode));
  for (const b of shows.children) b.setAttribute("aria-pressed", String(b.dataset.v === state.show));
  const items = D.items.filter((it) => state.show === "all" || (state.show === "test" ? it[4] > 0 : it[4] === 2));
  history.replaceState(null, "", "#" + [state.mode === "wheel" && "wheel", state.show !== "all" && state.show].filter(Boolean).join(","));
  if (state.mode === "label") { for (const [lab, list] of labels(items)) out.append(row(lab, list)); return; }
  for (const [roi, list] of [...byKey(items, 1)].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    out.append(el("h2", "", roi + " · " + list.length));
    for (const [lab, l] of labels(list)) out.append(row(lab, l));
  }
}
const modes = document.getElementById("modes"), shows = document.getElementById("shows");
function buttons(box, key, list) {
  for (const [v, name] of list) {
    const b = el("button", "", name); b.type = "button"; b.dataset.v = v;
    b.onclick = () => { state[key] = v; render(); };
    box.append(b);
  }
}
buttons(modes, "mode", [["label", D.text.byLabel], ["wheel", D.text.byWheel]]);
buttons(shows, "show", [["all", D.text.all], ["test", D.text.test], ["errs", D.text.errs]]);
const h = location.hash.slice(1).split(",");
if (h.includes("wheel")) state.mode = "wheel";
state.show = h.includes("errs") ? "errs" : h.includes("test") ? "test" : "all";
render();
</script></body></html>
`;
}

/**
 * The rows of the page: the images the model learned from and the test images, the test
 * mistakes marked. src(jpeg, k) says where the page finds image k. -> {rows, learned, missing}
 */
async function gather(m, where, src) {
  const byId = new Map(data.crops.map((c) => [c.id, c]));
  const test = new Set(m.testIds || []), trained = new Set(m.trainIds);
  const errs = new Map((m.testErrors || []).map((e) => [e.id, e]));
  const ids = [...new Set([...m.trainIds, ...test])];
  const rows = [];
  let missing = 0, learned = 0;
  for (const id of ids) {
    const c = byId.get(id), b = c && (await store.getJpeg(id));
    if (!b) { missing++; continue; }
    const e = data.eff.get(id) || {}, err = errs.get(id);
    if (trained.has(id)) learned++;
    rows.push({ path: src(b, rows.length), roi: c.roi, label: e.label ?? "", status: e.status ?? "", ts: c.ts,
      split: test.has(id) ? "test" : "train", device: c.pred ?? "", err, model: err?.guess ?? "" });
    if (rows.length % 500 === 0) say(where, t("Packing {i} of {n} images…", { i: num(rows.length), n: num(ids.length) }));
  }
  return { rows, learned, missing };
}
const noModel = (where) => say(where, t("Train a model first: the images it learned from are known only for models trained with this version."), true);
const missingNote = (n) => (n ? " " + t("{n} images deleted since training are missing.", { n: num(n) }) : "");

/** Saves the last model with the images it learned from (and the test images) as one zip. */
export function exportModelZip(where) {
  const m = train.model;
  if (!m?.trainIds) return noModel(where);
  return runTask("export", where, async () => {
    const files = {};
    const { rows, learned, missing } = await gather(m, where, (b, k) => {
      const path = `images/${String(k).padStart(6, "0")}.jpg`;
      files[path] = [b, { level: 0 }]; // JPEGs don't compress further
      return path;
    });
    const enc = new TextEncoder();
    const { bytes, trainIds, testIds, testErrors, ...info } = m;
    files[m.name] = [bytes, { level: 0 }];
    files["model.json"] = enc.encode(JSON.stringify({ ...info, images: rows.length }, null, 1));
    files["labels.csv"] = enc.encode([COLS.join(","), ...rows.map((r) => COLS.map((k) => csvCell(r[k])).join(","))].join("\n") + "\n");
    files["index.html"] = enc.encode(viewerHtml(m, rows, learned));
    const out = await new Promise((res, rej) => zip(files, (err, d) => (err ? rej(err) : res(d))));
    saveFile(m.name.replace(/\.tflite$/, "") + ".zip", out, "application/zip");
    say(where, t("Exported the model with {n} images ({mb} MB). Unpack it and open index.html to see them all.", { n: num(rows.length), mb: (out.length / 1e6).toFixed(1) }) + missingNote(missing));
  }, (err) => t("Export failed: {err}", { err }));
}

let pageUrls = []; // blob URLs of the page opened last; freed when it is opened again

/** Opens the same page in a new tab, its images straight from this browser's storage. */
export function openModelPage(where) {
  const m = train.model;
  if (!m?.trainIds) return noModel(where);
  const w = window.open("", "_blank"); // now, while the click still counts; filled when ready
  if (!w) { say(where, t("The browser blocked the new tab; allow pop-ups for this page."), true); return; }
  w.document.title = m.name;
  w.document.body.textContent = t("Preparing the images…");
  return runTask("export", where, async () => {
    pageUrls.forEach((u) => URL.revokeObjectURL(u));
    pageUrls = [];
    const url = (b, type) => { const u = URL.createObjectURL(new Blob([b], { type })); pageUrls.push(u); return u; };
    const { rows, learned, missing } = await gather(m, where, (b) => url(b, "image/jpeg"));
    w.location.href = url(viewerHtml(m, rows, learned), "text/html");
    say(where, t("Opened the page with {n} images in a new tab.", { n: num(rows.length) }) + missingNote(missing));
  }, (err) => { w.close(); return t("Export failed: {err}", { err }); });
}
