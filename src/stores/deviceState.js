// The trainer's state on the device's SD card: images, labels and which hour folders were
// collected. Saved from one browser and loaded in another (e.g. a phone, to go on labelling
// there). Loading merges: missing images are added, and per image the label record changed
// last wins, so labelling on two browsers in turn loses nothing.
//
// The device takes files up to 8000 KB, so the state is several files: STATE_PATH holds the
// labels and the list of images (which part each is in), and the JPEGs go in parts of at
// most PART_BYTES. Part names carry the save's time: the parts of the previous save are
// deleted only after the new list is in place, so an interrupted save leaves the old one whole.
import { zip, unzip } from "fflate";
import * as dev from "@/services/device.js";
import * as store from "@/services/db.js";
import { decodeBrowser, IN_W, IN_H } from "@/lib/dataset.js";
import { resizeBilinear } from "@/lib/resize.js";
import { t } from "@/i18n/index.js";
import { app, say, runTask } from "@/stores/app.js";
import { data, refreshProject } from "@/stores/project.js";
import { num } from "@/utils/format.js";

export const STATE_PATH = "/config/trainer-state.zip";
const VERSION = 2;               // 1: one file with the JPEGs inside
const PART_BYTES = 7_000_000;    // below the device's 8000 KB, with room for the zip's own headers
const PART_RE = /^trainer-state-(\w+)-(\d+)\.zip$/;
const partPath = (id, k) => `/config/trainer-state-${id}-${k}.zip`;
const mb = (n) => (n / 1e6).toFixed(1);
const zipAsync = (files) => new Promise((res, rej) => zip(files, (err, d) => (err ? rej(err) : res(d))));
const unzipAsync = (bytes) => new Promise((res, rej) => unzip(bytes, (err, d) => (err ? rej(err) : res(d))));

/** Saves everything in this browser to the device, replacing what was saved before. */
export function saveToDevice(where) {
  if (!data.crops.length) { say(where, t("Nothing to save yet."), true); return; }
  return runTask("saving to the device", where, async () => {
    const savedAt = Date.now(), id = savedAt.toString(36);
    const parts = [], crops = [];
    let files = {}, size = 0;
    for (const [i, c] of data.crops.entries()) {
      const { pix, ...meta } = c; // pix is made again from the JPEG on loading
      const b = await store.getJpeg(c.id);
      if (!b) continue;
      if (size + b.length > PART_BYTES && size) { parts.push(files); files = {}; size = 0; }
      files[`jpeg/${i}.jpg`] = [b, { level: 0 }]; // JPEGs don't compress further
      size += b.length + 100;
      crops.push({ ...meta, file: i, part: parts.length + 1 });
    }
    if (size) parts.push(files);
    let total = 0;
    for (const [k, p] of parts.entries()) {
      if (app.stop) throw new Error(t("stopped; the state saved before is unchanged"));
      const out = await zipAsync(p);
      say(where, t("Uploading part {i} of {n} ({mb} MB)…", { i: k + 1, n: parts.length, mb: mb(out.length) }));
      await dev.upload(partPath(id, k + 1), out, 600000);
      total += out.length;
    }
    // labels from storage: the records there carry the time they changed ("at"), loading compares it
    const state = { version: VERSION, savedAt, id, parts: parts.length, crops, labels: [...(await store.allLabels()).values()], collectedHours: await store.kvGet("collectedHours", {}) };
    const head = await zipAsync({ "state.json": new TextEncoder().encode(JSON.stringify(state)) });
    await dev.upload(STATE_PATH, head, 600000);
    total += head.length;
    // the previous save's parts
    for (const f of await dev.list("config")) {
      const m = PART_RE.exec(f.name);
      if (m && m[1] !== id) await dev.remove(`/config/${f.name}`);
    }
    say(where, t("Saved {n} images and their labels on the device ({mb} MB in {p} files: {file} and its parts). Load it in another browser with “Load from the device”.",
      { n: num(crops.length), file: STATE_PATH, p: parts.length + 1, mb: mb(total) }));
  }, (err) => t("Saving failed: {err}", { err }));
}

/** Loads the state saved on the device and merges it into this browser. */
export function loadFromDevice(where) {
  return runTask("loading from the device", where, async () => {
    say(where, t("Downloading the saved state…"));
    let bytes;
    try { bytes = await dev.getBytes(`/fileserver${STATE_PATH}`, 600000); } catch (e) {
      if (e.status === 404) throw new Error(t("nothing saved on the device yet"));
      throw e;
    }
    const head = await unzipAsync(bytes);
    if (!head["state.json"]) throw new Error(t("{file} is not a saved trainer state", { file: STATE_PATH }));
    const state = JSON.parse(new TextDecoder().decode(head["state.json"]));
    if (state.version > VERSION) throw new Error(t("the state was saved by a newer version of this page; update it first"));

    const have = new Set(data.crops.map((c) => c.id));
    const todo = state.crops.filter((c) => !have.has(c.id));
    // version 1 has the JPEGs in the same file; else fetch only the parts with missing images
    const byPart = new Map();
    for (const c of todo) { const k = c.part ?? 0; if (!byPart.has(k)) byPart.set(k, []); byPart.get(k).push(c); }
    let batch = [], added = 0, partNo = 0;
    for (const [k, cs] of [...byPart].sort((a, b) => a[0] - b[0])) {
      if (app.stop) break;
      let files = head;
      if (k) {
        say(where, t("Downloading part {i} of {n}…", { i: ++partNo, n: byPart.size }));
        files = await unzipAsync(await dev.getBytes(`/fileserver${partPath(state.id, k)}`, 600000));
      }
      for (const { file, part, ...c } of cs) {
        if (app.stop) break;
        const jpeg = files[`jpeg/${file}.jpg`];
        if (!jpeg) continue;
        try {
          const im = await decodeBrowser(jpeg);
          batch.push({ crop: { ...c, pix: resizeBilinear(im.data, im.width, im.height, IN_W, IN_H, 4) }, jpeg });
        } catch { continue; /* unreadable: skip */ }
        if (batch.length >= 200) { await store.putCrops(batch); added += batch.length; batch = []; say(where, t("Added {i} of {n} images…", { i: num(added), n: num(todo.length) })); }
      }
    }
    if (batch.length) { await store.putCrops(batch); added += batch.length; }

    // per image, the label record changed last wins
    const local = await store.allLabels();
    const newer = state.labels.filter((r) => (r.at || 0) > (local.get(r.id)?.at || 0));
    if (newer.length) await store.putLabels(newer, true);
    const hours = await store.kvGet("collectedHours", {});
    await store.kvSet("collectedHours", { ...state.collectedHours, ...hours });
    await refreshProject();
    say(where, t("Loaded the state saved {when}: {a} images added, {l} labels updated.", { when: new Date(state.savedAt).toLocaleString(), a: num(added), l: num(newer.length) }));
  }, (err) => t("Loading failed: {err}", { err }));
}
