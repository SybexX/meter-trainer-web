// The trainer's state on the device's SD card, as one file: images, labels and which hour
// folders were collected. Saved from one browser and loaded in another (e.g. a phone, to go
// on labelling there). Loading merges: missing images are added, and per image the label
// record changed last wins, so labelling on two browsers in turn loses nothing.
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
const VERSION = 1;
const mb = (n) => (n / 1e6).toFixed(1);

/** Saves everything in this browser to the device, replacing the file saved before. */
export function saveToDevice(where) {
  if (!data.crops.length) { say(where, t("Nothing to save yet."), true); return; }
  return runTask("saving to the device", where, async () => {
    const files = {}, crops = [];
    for (const [i, c] of data.crops.entries()) {
      const { pix, ...meta } = c; // pix is made again from the JPEG on loading
      const b = await store.getJpeg(c.id);
      if (!b) continue;
      files[`jpeg/${i}.jpg`] = [b, { level: 0 }]; // JPEGs don't compress further
      crops.push({ ...meta, file: i });
    }
    // labels from storage: the records there carry the time they changed ("at"), loading compares it
    const state = { version: VERSION, savedAt: Date.now(), crops, labels: [...(await store.allLabels()).values()], collectedHours: await store.kvGet("collectedHours", {}) };
    files["state.json"] = new TextEncoder().encode(JSON.stringify(state));
    const out = await new Promise((res, rej) => zip(files, (err, d) => (err ? rej(err) : res(d))));
    say(where, t("Uploading {mb} MB to the device…", { mb: mb(out.length) }));
    await dev.upload(STATE_PATH, out, 600000);
    say(where, t("Saved {n} images and their labels on the device ({file}, {mb} MB). Load it in another browser with “Load from the device”.", { n: num(crops.length), file: STATE_PATH, mb: mb(out.length) }));
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
    const files = await new Promise((res, rej) => unzip(bytes, (err, out) => (err ? rej(err) : res(out))));
    if (!files["state.json"]) throw new Error(t("{file} is not a saved trainer state", { file: STATE_PATH }));
    const state = JSON.parse(new TextDecoder().decode(files["state.json"]));
    if (state.version > VERSION) throw new Error(t("the state was saved by a newer version of this page; update it first"));

    const have = new Set(data.crops.map((c) => c.id));
    const todo = state.crops.filter((c) => !have.has(c.id));
    let batch = [], added = 0;
    for (const { file, ...c } of todo) {
      if (app.stop) break;
      const jpeg = files[`jpeg/${file}.jpg`];
      if (!jpeg) continue;
      try {
        const im = await decodeBrowser(jpeg);
        batch.push({ crop: { ...c, pix: resizeBilinear(im.data, im.width, im.height, IN_W, IN_H, 4) }, jpeg });
      } catch { continue; /* unreadable: skip */ }
      if (batch.length >= 200) { await store.putCrops(batch); added += batch.length; batch = []; say(where, t("Added {i} of {n} images…", { i: num(added), n: num(todo.length) })); }
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
