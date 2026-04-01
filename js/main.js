import { AudioEngine } from "./audio.js";
import { Renderer } from "./renderer.js";
import { EventsEngine } from "./events.js";
import { CONFIG } from "./config.js";

const byId = (id) => document.getElementById(id);

const canvas = byId("mainCanvas");
const startButton = byId("startButton");
const startScreen = byId("startScreen");
const modeLabel = byId("modeLabel");
const audioLabel = byId("audioLabel");
const transportLabel = byId("transportLabel");
const energyLabel = byId("energyLabel");
const silenceLabel = byId("silenceLabel");
const audioDebugLabel = byId("audioDebugLabel");
const fsButton = byId("fsButton");
const micButton = byId("micButton");
const hud = byId("hud");
const overlay = byId("overlay");
const warmupStatus = byId("warmupStatus");
const devPanel = byId("devPanel");
const devPanelToggle = byId("devPanelToggle");
const devPanelContent = byId("devPanelContent");
const devMenuToggle = byId("devMenuToggle");
const debugToggle = byId("debugToggle");
const modeSelect = byId("modeSelect");
const autoToggle = byId("autoToggle");
const autoCycleDuration = byId("autoCycleDuration");
const blackoutButton = byId("blackoutButton");
const reconnectButton = byId("reconnectButton");
const fsDevButton = byId("fsDevButton");
const saveModeSettingsButton = byId("saveModeSettingsButton");
const resetModeDefaultsButton = byId("resetModeDefaultsButton");
const saveModeSettingsStatus = byId("saveModeSettingsStatus");
const runtimeDebugPanel = byId("runtimeDebugPanel");
const runtimeTuningPanel = byId("runtimeTuningPanel");
const baselineControlButton = byId("baselineControlButton");
const baselineStatusLabel = byId("baselineStatusLabel");

const audioEngine = new AudioEngine();
const eventsEngine = new EventsEngine();
const renderer = new Renderer(canvas, audioEngine, eventsEngine, { modeLabel, transportLabel, energyLabel, silenceLabel, audioDebugLabel });

const controlSpec = {
  micSensitivity: { decimals: 2 },
  noiseGate: { decimals: 3 },
  sustainThreshold: { decimals: 3 },
  activateThreshold: { decimals: 3 },
  deactivateThreshold: { decimals: 3 },
  holdTime: { decimals: 0 },
  fadeTime: { decimals: 0 },
  motionScale: { decimals: 2 },
  baseFlow: { decimals: 2 },
  responseCurve: { decimals: 2 },
  maxSpeed: { decimals: 2 },
  audioReactivity: { decimals: 2 },
  peakIntensity: { decimals: 2 },
  bassWeight: { decimals: 2 },
  midsWeight: { decimals: 2 },
  highsWeight: { decimals: 2 },
};

const controls = Object.fromEntries(
  Object.keys(controlSpec).map((key) => [
    key,
    { input: byId(key), current: byId(`${key}Value`), engine: byId(`${key}Engine`) },
  ])
);

function fmt(value, decimals = 2) {
  return Number(value ?? 0).toFixed(decimals);
}

function setModeSettingsStatus(text = "", kind = "") {
  if (!saveModeSettingsStatus) return;
  saveModeSettingsStatus.textContent = text;
  saveModeSettingsStatus.dataset.kind = kind;
}

function syncControlsFromRuntime() {
  const settings = renderer.getCurrentModeActiveSettings();
  Object.entries(controls).forEach(([key, refs]) => {
    const cfg = controlSpec[key];
    const val = Number(settings[key] ?? 0);
    if (refs.input) refs.input.value = String(val);
    if (refs.current) refs.current.textContent = fmt(val, cfg.decimals);
    if (refs.engine) refs.engine.textContent = fmt(val, cfg.decimals);
  });
}

function refreshRuntimePanel() {
  const state = renderer.getRuntimeState();
  const debug = audioEngine.getDebugState?.() ?? {};
  const baselineState = audioEngine.getBaselineState?.() ?? {};
  const baseline = Number(state.baseline ?? 0);
  byId("baselineValue").textContent = baseline.toFixed(3);
  byId("baselineValueEngine").textContent = baseline.toFixed(3);

  if (baselineControlButton) {
    baselineControlButton.textContent = baselineState.baselineLearning ? "Lock Baseline" : "Set Baseline";
  }
  if (baselineStatusLabel) {
    const status = baselineState.baselineLearning
      ? "Learning"
      : baselineState.baselineLocked
      ? "Locked"
      : "Auto";
    const lockedValue = Number(baselineState.lockedBaselineValue ?? 0);
    baselineStatusLabel.textContent =
      status === "Locked" ? `Baseline: Locked (${lockedValue.toFixed(3)})` : `Baseline: ${status}`;
  }

  const inUse = state.settings ?? {};
  Object.entries(controls).forEach(([key, refs]) => {
    if (refs.engine) refs.engine.textContent = fmt(inUse[key], controlSpec[key].decimals);
  });

  if (runtimeTuningPanel) {
    runtimeTuningPanel.textContent =
      `mode: ${state.mode} | ` +
      `micSensitivity: ${fmt(inUse.micSensitivity, 2)} | ` +
      `noiseGate: ${fmt(inUse.noiseGate, 3)} | ` +
      `sustainThreshold: ${fmt(inUse.sustainThreshold, 3)} | ` +
      `activateThreshold: ${fmt(inUse.activateThreshold, 3)} | ` +
      `deactivateThreshold: ${fmt(inUse.deactivateThreshold, 3)} | ` +
      `holdTime: ${fmt(inUse.holdTime, 0)} | ` +
      `fadeTime: ${fmt(inUse.fadeTime, 0)} | ` +
      `motionScale: ${fmt(inUse.motionScale, 2)} | ` +
      `baseFlow: ${fmt(inUse.baseFlow, 2)} | ` +
      `responseCurve: ${fmt(inUse.responseCurve, 2)} | ` +
      `maxSpeed: ${fmt(inUse.maxSpeed, 2)} | ` +
      `audioReactivity: ${fmt(inUse.audioReactivity, 2)} | ` +
      `peakIntensity: ${fmt(inUse.peakIntensity, 2)}`;
  }

  runtimeDebugPanel.textContent =
    `rawEnergy: ${fmt(state.rawEnergy, 3)} | ` +
    `observedEnergy: ${fmt(state.observedEnergy, 3)} | ` +
    `trueSignal: ${fmt(state.trueSignal, 3)} | ` +
    `sustainEnergy: ${fmt(state.sustainEnergy, 3)} | ` +
    `transport(intermediate): ${fmt(state.transport, 3)} | ` +
    `finalMotion(driver): ${fmt(state.finalMotionDriver, 3)} | ` +
    `motionPhase: ${fmt(state.motionPhase, 3)} | ` +
    `motionEnabled: ${state.motionEnabled} | ` +
    `silence: ${fmt(state.silence, 3)} | ` +
    `baselineValue: ${fmt(state.baseline, 3)} | ` +
    `baselineLearning: ${baselineState.baselineLearning ? "yes" : "no"} | ` +
    `baselineLocked: ${baselineState.baselineLocked ? "yes" : "no"} | ` +
    `rendererTime: ${fmt(state.rendererTime, 3)} | ` +
    `shaderTransport: ${fmt(state.shaderTransport, 3)} | ` +
    `shaderMotionEnabled: ${state.shaderMotionEnabled ? "yes" : "no"}`;
}

function setModeAndSync(mode) {
  renderer.setMode(mode);
  if (modeSelect) modeSelect.value = String(renderer.mode);
  syncControlsFromRuntime();
  refreshRuntimePanel();
  setModeSettingsStatus(`Loaded mode ${renderer.mode} settings`, "loaded");
}

function enterFullscreen() {
  const elem = document.documentElement;
  if (!document.fullscreenElement) elem.requestFullscreen?.();
}

async function connectAudio() {
  try {
    await audioEngine.start();
    audioLabel.textContent = "Live input connected";
    syncControlsFromRuntime();
  } catch (err) {
    const reason = audioEngine.getLastInitError?.() || err?.message || String(err);
    console.error("[audio-init] connect failed", { reason, error: err });
    audioLabel.textContent = `Failed to load mic audio: ${reason}`;
  }
}

async function boot() {
  startScreen.style.display = "none";
  await connectAudio();
}

renderer.start();
requestAnimationFrame(() => {
  warmupStatus.textContent = "warm and ready";
  warmupStatus.classList.add("ready");
});

startButton.addEventListener("click", boot);
fsButton.addEventListener("click", enterFullscreen);
micButton.addEventListener("click", connectAudio);

function bindRange(key) {
  const refs = controls[key];
  if (!refs?.input) return;
  refs.input.addEventListener("input", () => {
    const value = Number(refs.input.value);
    refs.current.textContent = fmt(value, controlSpec[key].decimals);
    renderer.setCurrentModeLiveSettings({ [key]: value });
    refreshRuntimePanel();
    setModeSettingsStatus(`Unsaved changes for mode ${renderer.mode}`, "dirty");
  });
}

if (devPanel) {
  devPanel.style.display = CONFIG.devControls?.enabled ? "block" : "none";

  Object.keys(controlSpec).forEach(bindRange);
  modeSelect.value = String(renderer.mode);
  syncControlsFromRuntime();

  modeSelect.addEventListener("change", () => setModeAndSync(Number(modeSelect.value)));

  renderer.onModeChange(() => {
    modeSelect.value = String(renderer.mode);
    syncControlsFromRuntime();
    refreshRuntimePanel();
    setModeSettingsStatus(`Loaded mode ${renderer.mode} settings`, "loaded");
  });

  saveModeSettingsButton?.addEventListener("click", () => {
    renderer.saveCurrentModeSettings();
    syncControlsFromRuntime();
    setModeSettingsStatus(`Saved settings for mode ${renderer.mode}`, "saved");
  });

  resetModeDefaultsButton?.addEventListener("click", () => {
    renderer.resetCurrentModeSettings();
    syncControlsFromRuntime();
    refreshRuntimePanel();
    setModeSettingsStatus(`Reset mode ${renderer.mode} to defaults`, "reset");
  });

  autoToggle.checked = renderer.autoMode;
  autoToggle.addEventListener("change", () => renderer.setAutoMode(autoToggle.checked));

  autoCycleDuration.value = String(renderer.autoCycleSeconds);
  autoCycleDuration.addEventListener("change", () => {
    renderer.setAutoCycleSeconds(Number(autoCycleDuration.value));
    autoCycleDuration.value = String(renderer.autoCycleSeconds);
  });

  blackoutButton.addEventListener("click", () => eventsEngine.triggerBlackoutPulse());
  reconnectButton.addEventListener("click", connectAudio);
  fsDevButton.addEventListener("click", enterFullscreen);
  baselineControlButton?.addEventListener("click", () => {
    const baselineState = audioEngine.getBaselineState?.() ?? {};
    if (baselineState.baselineLearning) {
      audioEngine.lockBaseline?.();
    } else {
      audioEngine.startBaselineLearning?.();
    }
    refreshRuntimePanel();
  });

  devPanelToggle.addEventListener("click", () => devPanelContent.classList.toggle("collapsed"));
  devMenuToggle.addEventListener("click", () => hud.classList.toggle("hidden"));

  debugToggle.addEventListener("change", () => {
    const visible = debugToggle.checked;
    audioDebugLabel.style.display = visible ? "block" : "none";
    transportLabel.parentElement.style.display = visible ? "block" : "none";
    energyLabel.parentElement.style.display = visible ? "block" : "none";
    silenceLabel.parentElement.style.display = visible ? "block" : "none";
    runtimeDebugPanel.style.display = visible ? "block" : "none";
    if (runtimeTuningPanel) runtimeTuningPanel.style.display = visible ? "block" : "none";
  });

  setInterval(refreshRuntimePanel, 120);
}

function toggleUiVisibility() {
  overlay.classList.toggle("ui-hidden");
  devPanel.classList.toggle("ui-hidden");
  startScreen.classList.toggle("ui-hidden");
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "1") setModeAndSync(1);
  if (k === "2") setModeAndSync(2);
  if (k === "3") setModeAndSync(3);
  if (k === "4") setModeAndSync(4);
  if (k === "a") renderer.toggleAutoMode();
  if (k === " ") {
    e.preventDefault();
    eventsEngine.triggerBlackoutPulse();
  }
  if (k === "h") toggleUiVisibility();
  if (k === "f") enterFullscreen();
});
