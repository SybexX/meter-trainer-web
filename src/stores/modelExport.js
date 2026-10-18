// The trained model as a zip with the images it learned from: model.tflite, model.json,
// labels.csv, images/ and index.html, a page showing every image by wheel and label
// (opens from the unpacked folder, no server needed). The model does not know the wheel:
// it gets the crop only, one model for all wheels, so the page groups by label first.
import { zip } from "fflate";
import * as store from "@/services/db.js";
import { LANG, t } from "@/i18n/index.js";
import { say, runTask } from "@/stores/app.js";
import { data } from "@/stores/project.js";
import { train } from "@/stores/train.js";
import { LABELS } from "@/lib/labels.js";
import { LOC, num, saveFile } from "@/utils/format.js";

const COLS = ["path", "roi", "label", "status", "ts", "split", "device"];
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The viewer page: data embedded, so it works from file://. */
function viewerHtml(m, rows, learned) {
  const items = rows.map((r) => [r.path, r.roi, r.label, r.ts, r.split === "test" ? 1 : 0]);
  const text = {
    intro: t("{n} images the model learned from.", { n: num(learned) }),
    byLabel: t("By label"), byWheel: t("By wheel and label"),
    test: m.final ? t("Outlined: the test images (each wheel’s newest days). The comparison model did not see them; this final model learned from them too.")
      : t("Outlined: the test images (each wheel’s newest days), not learned from, used to compare with the installed model."),
    when: t("Trained {date}", { date: new Date(m.at).toLocaleString(LOC) }) + (m.acc != null ? ` · ${t("accuracy on the test images {p}%", { p: (m.acc * 100).toFixed(1) })}` : ""),
  };
  // a "<" in the data must not end the script element
  const json = JSON.stringify({ items, order: LABELS, text }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${LANG}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.name)}</title>
<style>
:root { --bg: #fafaf9; --ink: #1c1917; --muted: #78716c; --line: #e7e5e4; --sunk: #e7e5e4; --test: #c2410c; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --ink: #f5f5f4; --muted: #a8a29e; --line: #44403c; --sunk: #292524; --test: #fb923c; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 4px; overflow-wrap: anywhere; }
.modes { display: flex; gap: 6px; margin: 12px 0 4px; }
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
</style></head><body>
<h1>${esc(m.name)}</h1>
<div id="head"></div><div class="modes" id="modes"></div><div id="out"></div>
<script id="data" type="application/json">${json}</script>
<script>
const D = JSON.parse(document.getElementById("data").textContent);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const head = document.getElementById("head"), out = document.getElementById("out");
for (const s of [D.text.when, D.text.intro, D.text.test]) head.append(el("p", "", s));
const ord = (l) => { const i = D.order.indexOf(l); return i < 0 ? 999 : i; };
const byKey = (list, k) => { const m = new Map(); for (const it of list) { if (!m.has(it[k])) m.set(it[k], []); m.get(it[k]).push(it); } return m; };
const when = (ts) => ts.slice(0, 4) + "-" + ts.slice(4, 6) + "-" + ts.slice(6, 8) + " " + ts.slice(9, 11) + ":" + ts.slice(11, 13);
/** One label's images in a row, oldest first. */
function row(lab, list) {
  const r = el("div", "row"), l = el("div", "lab", lab), imgs = el("div", "imgs");
  l.append(el("small", "", String(list.length)));
  for (const it of list.sort((a, b) => (a[3] < b[3] ? -1 : 1))) {
    const img = el("img", it[4] ? "test" : "");
    img.loading = "lazy"; img.src = it[0]; img.alt = lab; img.title = it[1] + " · " + when(it[3]);
    imgs.append(img);
  }
  r.append(l, imgs);
  return r;
}
const labels = (list) => [...byKey(list, 2)].sort((a, b) => ord(a[0]) - ord(b[0]));
function render(mode) {
  out.replaceChildren();
  for (const b of modes.children) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  if (mode === "label") { for (const [lab, list] of labels(D.items)) out.append(row(lab, list)); return; }
  for (const [roi, list] of [...byKey(D.items, 1)].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    out.append(el("h2", "", roi + " · " + list.length));
    for (const [lab, l] of labels(list)) out.append(row(lab, l));
  }
}
const modes = document.getElementById("modes");
for (const [mode, name] of [["label", D.text.byLabel], ["wheel", D.text.byWheel]]) {
  const b = el("button", "", name); b.type = "button"; b.dataset.mode = mode;
  b.onclick = () => { location.hash = mode === "wheel" ? "wheel" : ""; render(mode); };
  modes.append(b);
}
render(location.hash === "#wheel" ? "wheel" : "label");
</script></body></html>
`;
}

/** Saves the last model with the images it learned from (and the test images) as one zip. */
export function exportModelZip(where) {
  const m = train.model;
  if (!m?.trainIds) { say(where, t("Train a model first: the images it learned from are known only for models trained with this version."), true); return; }
  return runTask("export", where, async () => {
    const byId = new Map(data.crops.map((c) => [c.id, c]));
    const test = new Set(m.testIds || []);
    const ids = [...new Set([...m.trainIds, ...test])];
    const files = {}, rows = [];
    const trained = new Set(m.trainIds);
    let missing = 0, learned = 0;
    for (const id of ids) {
      const c = byId.get(id), b = c && (await store.getJpeg(id));
      if (!b) { missing++; continue; }
      const path = `images/${String(rows.length).padStart(6, "0")}.jpg`;
      files[path] = [b, { level: 0 }]; // JPEGs don't compress further
      const e = data.eff.get(id) || {};
      if (trained.has(id)) learned++;
      rows.push({ path, roi: c.roi, label: e.label ?? "", status: e.status ?? "", ts: c.ts, split: test.has(id) ? "test" : "train", device: c.pred ?? "" });
      if (rows.length % 500 === 0) say(where, t("Packing {i} of {n} images…", { i: num(rows.length), n: num(ids.length) }));
    }
    const enc = new TextEncoder();
    const { bytes, trainIds, testIds, ...info } = m;
    files[m.name] = [bytes, { level: 0 }];
    files["model.json"] = enc.encode(JSON.stringify({ ...info, images: rows.length }, null, 1));
    files["labels.csv"] = enc.encode([COLS.join(","), ...rows.map((r) => COLS.map((k) => csvCell(r[k])).join(","))].join("\n") + "\n");
    files["index.html"] = enc.encode(viewerHtml(m, rows, learned));
    const out = await new Promise((res, rej) => zip(files, (err, d) => (err ? rej(err) : res(d))));
    saveFile(m.name.replace(/\.tflite$/, "") + ".zip", out, "application/zip");
    say(where, t("Exported the model with {n} images ({mb} MB). Unpack it and open index.html to see them all.", { n: num(rows.length), mb: (out.length / 1e6).toFixed(1) }) +
      (missing ? " " + t("{n} images deleted since training are missing.", { n: num(missing) }) : ""));
  }, (err) => t("Export failed: {err}", { err }));
}
