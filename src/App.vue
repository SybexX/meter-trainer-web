<!-- The page: header readout, step rail, the running task, one step at a time. -->
<script setup>
import { onMounted, ref, watch } from "vue";
import { t, LANG, LANGS, setLang } from "@/i18n/index.js";
import * as dev from "@/services/device.js";
import { app, go, STEPS, STEP_NAMES, pills, pillText, pillTip, stepOf } from "@/stores/app.js";
import { refreshProject } from "@/stores/project.js";
import { refreshSetup } from "@/stores/setup.js";
import { loadAiSettings } from "@/stores/ai.js";
import { loadCollectSpeed } from "@/stores/collect.js";
import { initWorker, loadLastModel } from "@/stores/train.js";
import { loadInstalls } from "@/stores/install.js";
import StartView from "@/views/StartView.vue";
import SetupView from "@/views/SetupView.vue";
import CollectView from "@/views/CollectView.vue";
import LabelsView from "@/views/LabelsView.vue";
import TrainView from "@/views/TrainView.vue";
import InstallView from "@/views/InstallView.vue";
import StepNav from "@/components/StepNav.vue";

const SECTIONS = { start: ["sAuto", StartView], setup: ["sSetup", SetupView], collect: ["sCollect", CollectView], labels: ["sLabels", LabelsView], train: ["sTrain", TrainView], install: ["sInstall", InstallView] };
const otherLang = LANG === "ru" ? "en" : "ru";
const version = __APP_VERSION__; // set by vite.config.js
const header = ref(null), nav = ref(null);
const copied = ref(""); // "ok" / "fail" for a moment after the diagnostics copy button

function switchLang() {
  if (!app.busy || confirm(t("Switching the language reloads the page and stops “{task}”. Continue?", { task: app.busy }))) setLang(otherLang);
}

// the URL hash names the open step
watch(() => app.step, (step) => {
  if (location.hash !== `#${step}`) history.replaceState(null, "", `#${step}`);
  // keep the step rail where it is: if it is pinned to the top, open the new step right
  // under it; otherwise don't scroll at all (jumping to the top made the page lurch)
  const railTop = header.value.getBoundingClientRect().bottom + scrollY + parseFloat(getComputedStyle(nav.value.parentElement).rowGap || "0");
  if (scrollY > railTop) window.scrollTo({ top: railTop, behavior: "instant" });
}, { flush: "post" });

/** Asks the device for its status; sets the header badge and keeps the diagnostics. */
async function probeDevice() {
  app.deviceText = t("device …");
  const d = await dev.detect();
  app.onDevice = d.ok;
  app.deviceDiag = d.diag;
  app.deviceText = d.ok ? t("device {host} · {status}", { host: location.host, status: d.status }) : t("not on a device");
  if (d.ok) dev.readConfig().catch(() => "").then(dev.meterName).then((name) => { if (name) app.meterName = name; });
  return d.ok;
}
/** "Check again" in the diagnostics panel: a device found now gets its setup checks too. */
async function recheckDevice() {
  const was = app.onDevice;
  if (await probeDevice() && !was) await Promise.all([refreshSetup(), refreshProject()]);
}

/** The lines of the diagnostics panel, from what detect() recorded. */
function diagLines(d) {
  if (!d) return [t("Not checked yet.")];
  const lines = [t("Page address: {url}", { url: d.page })];
  if (d.reason !== "file") lines.push(t("Asked: {url} ({n} of {tries} attempts, {s} s each)", { url: d.url, n: d.attempts, tries: d.tries, s: d.timeoutMs / 1000 }));
  lines.push({
    ok: t("Answered in {ms} ms: {status}", { ms: d.ms, status: d.body }),
    file: t("The page was opened as a local file, not from the device. Upload trainer.html.gz to /html/ on the device and open http://<device>/trainer.html."),
    timeout: t("No answer within {s} s. The device may be busy with a reading round or restarting; check again in a minute. If http://{host}/ does not open either, the device's web server is hung (the browser keeps this page for 12 h, so it opens even then): power-cycle the device.", { s: d.timeoutMs / 1000, host: location.host }),
    http: t("The server answered HTTP {code} after {ms} ms: {err}", { code: d.httpStatus, ms: d.ms, err: d.error }) + (d.httpStatus === 404 ? " " + t("It has no /statusflow: not an AI-on-the-edge device, or its firmware is too old.") : ""),
    network: t("The request failed after {ms} ms: {err}. The page was not served by the device (another host or port), or the connection to it dropped.", { ms: d.ms, err: d.error }),
    html: t("The answer was a web page, not a status line: this server is not an AI-on-the-edge device."),
  }[d.reason] || d.error || "");
  lines.push(t("Checked at {time} · {ua}", { time: d.at, ua: navigator.userAgent }));
  return lines;
}

/** Copies the diagnostics panel as text. The page is plain http, where navigator.clipboard
 * is missing, so a hidden textarea and execCommand("copy") are the fallback. */
async function copyDiag() {
  const text = [diagTitle(), ...diagLines(app.deviceDiag)].join("\n");
  let ok = false;
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch { /* denied or insecure context */ }
  if (!ok) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
  }
  copied.value = ok ? "ok" : "fail";
  setTimeout(() => { copied.value = ""; }, 1500);
}
const diagTitle = () => (app.onDevice ? t("Device check") : t("Why “not on a device”"));

// the guided review's group bar docks under the step rail
const setNavH = () => document.documentElement.style.setProperty("--navh", `${nav.value.offsetHeight}px`);

onMounted(async () => {
  setNavH(); addEventListener("resize", setNavH);
  addEventListener("hashchange", () => go(location.hash.slice(1)));
  addEventListener("beforeunload", (e) => { if (app.busy) { e.preventDefault(); e.returnValue = ""; } });
  go(location.hash.slice(1) || "start");

  initWorker().then((backend) => { app.backendText = backend === "webgl" ? "GPU (WebGL)" : t("CPU only: training will be slow"); });
  await probeDevice();
  await Promise.all([loadAiSettings(), loadCollectSpeed()]);
  await loadLastModel();
  await Promise.all([refreshSetup(), refreshProject()]);
  loadInstalls();
});
</script>

<template>
  <div class="wrap">
    <header ref="header">
      <h1>{{ t("Meter model trainer") }}<a v-if="app.meterName" id="meterName" href="/" :data-hint="t('Open the device’s own pages (leaves the trainer)')">{{ app.meterName }}</a></h1>
      <div class="badges">
        <span id="bDevice"><button type="button" class="link" :data-hint="t('How the device was detected: click for details')" @click="app.showDiag = !app.showDiag">{{ app.deviceText }}</button></span><span id="bBackend">{{ app.backendText }}</span><span>v{{ version }}</span>
        <button type="button" class="link lang" :lang="otherLang" @click="switchLang">{{ LANGS[otherLang] }}</button>
      </div>
    </header>

    <nav id="steps" ref="nav" class="steps" :aria-label="t('Steps')">
      <button v-for="(s, i) in STEPS" :key="s" type="button" :data-step="s" :aria-current="app.step === s ? 'step' : null" @click="go(s)">
        <span class="sn">{{ i }}</span>{{ STEP_NAMES[s] }}<span class="np" :class="pills[s].kind" :data-hint="pillTip(s)">{{ pillText(s) }}</span>
      </button>
    </nav>
    <div v-if="app.showDiag" id="deviceDiag" class="confirm diag" :class="{ ok: app.onDevice }">
      <b>{{ diagTitle() }}</b>
      <button type="button" class="link copy" :aria-label="t('Copy to clipboard')" :data-hint="t('Copy to clipboard')" @click="copyDiag">
        <span v-if="copied" class="copied">{{ copied === "ok" ? t("Copied") : t("Copy failed") }}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 1.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 5H2.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V13" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
      </button>
      <ul><li v-for="(l, i) in diagLines(app.deviceDiag)" :key="i">{{ l }}</li></ul>
      <span class="acts">
        <button type="button" :disabled="!!app.busy" @click="recheckDevice">{{ t("Check again") }}</button>
        <button type="button" class="link" @click="app.showDiag = false">{{ t("Close") }}</button>
      </span>
    </div>
    <div v-if="app.busy" id="activity" class="activity">
      <span>{{ app.activity }}</span><button class="link" type="button" @click="go(stepOf(app.where))">{{ t("Show") }}</button>
    </div>

    <section v-for="(sec, s) in SECTIONS" v-show="app.step === s" :id="sec[0]" :key="s" :data-step="s">
      <component :is="sec[1]" />
      <StepNav :step="s" />
    </section>

    <footer class="foot"><span>{{ t("Meter model trainer") }}</span><a href="https://github.com/alfeg" target="_blank" rel="noopener">github.com/alfeg</a></footer>
  </div>
</template>
