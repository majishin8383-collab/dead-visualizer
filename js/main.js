import { AudioEngine } from "./audio.js";
import { Renderer } from "./renderer.js";
import { EventsEngine } from "./events.js";
import { CONFIG } from "./config.js";

const canvas = document.getElementById("mainCanvas");
const startButton = document.getElementById("startButton");
const startScreen = document.getElementById("startScreen");
const modeLabel = document.getElementById("modeLabel");
const audioLabel = document.getElementById("audioLabel");
const transportLabel = document.getElementById("transportLabel");
const energyLabel = document.getElementById("energyLabel");
const silenceLabel = document.getElementById("silenceLabel");
const audioDebugLabel = document.getElementById("audioDebugLabel");
const fsButton = document.getElementById("fsButton");
const micButton = document.getElementById("micButton");
const hud = document.getElementById("hud");
const warmupStatus = document.getElementById("warmupStatus");
const devPanel = document.getElementById("devPanel");
const devPanelToggle = document.getElementById("devPanelToggle");
const devPanelContent = document.getElementById("devPanelContent");
const devMenuToggle = document.getElementById("devMenuToggle");
const debugToggle = document.getElementById("debugToggle");
const modeSelect = document.getElementById("modeSelect");
const autoToggle = document.getElementById("autoToggle");
const autoCycleDuration = document.getElementById("autoCycleDuration");
const blackoutButton = document.getElementById("blackoutButton");
const reconnectButton = document.getElementById("reconnectButton");
const fsDevButton = document.getElementById("fsDevButton");
const micSensitivity = document.getElementById("micSensitivity");
const noiseGate = document.getElementById("noiseGate");
const smoothing = document.getElementById("smoothing");
const baselineTransport = document.getElementById("baselineTransport");
const audioReactivity = document.getElementById("audioReactivity");
const peakIntensity = document.getElementById("peakIntensity");
const micSensitivityValue = document.getElementById("micSensitivityValue");
const noiseGateValue = document.getElementById("noiseGateValue");
const smoothingValue = document.getElementById("smoothingValue");
const baselineTransportValue = document.getElementById("baselineTransportValue");
const audioReactivityValue = document.getElementById("audioReactivityValue");
const peakIntensityValue = document.getElementById("peakIntensityValue");

const audioEngine = new AudioEngine();
const eventsEngine = new EventsEngine();

const renderer = new Renderer(canvas, audioEngine, eventsEngine, {
  modeLabel,
  transportLabel,
  energyLabel,
  silenceLabel,
  audioDebugLabel,
});

function enterFullscreen() {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    elem.requestFullscreen?.();
  }
}

async function connectAudio() {
  try {
    await audioEngine.start();
    audioLabel.textContent = "Live input connected";
  } catch (err) {
    console.error(err);
    audioLabel.textContent = "Audio permission failed";
  }
}

async function boot() {
  startScreen.style.display = "none";
  await connectAudio();
}

renderer.start();
requestAnimationFrame(() => {
  if (!warmupStatus) return;
  warmupStatus.textContent = "warm and ready";
  warmupStatus.classList.add("ready");
});

startButton.addEventListener("click", boot);
fsButton.addEventListener("click", enterFullscreen);

micButton.addEventListener("click", async () => {
  await connectAudio();
});

function bindRange(input, output, key) {
  if (!input || !output) return;
  const tuning = audioEngine.getTuning();
  input.value = tuning[key];
  output.textContent = Number(tuning[key]).toFixed(2);
  input.addEventListener("input", () => {
    const value = Number(input.value);
    output.textContent = value.toFixed(2);
    audioEngine.setTuning({ [key]: value });
  });
}

if (devPanel) {
  const enabled = !!CONFIG.devControls?.enabled;
  devPanel.style.display = enabled ? "block" : "none";

  bindRange(micSensitivity, micSensitivityValue, "micSensitivity");
  bindRange(noiseGate, noiseGateValue, "noiseGate");
  bindRange(smoothing, smoothingValue, "smoothing");
  bindRange(baselineTransport, baselineTransportValue, "baselineTransport");
  bindRange(audioReactivity, audioReactivityValue, "audioReactivity");
  bindRange(peakIntensity, peakIntensityValue, "peakIntensity");

  modeSelect.value = String(renderer.mode);
  modeSelect.addEventListener("change", () => renderer.setMode(Number(modeSelect.value)));

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

  devPanelToggle.addEventListener("click", () => {
    devPanelContent.classList.toggle("collapsed");
  });

  devMenuToggle.addEventListener("click", () => {
    hud.classList.toggle("hidden");
  });

  debugToggle.addEventListener("change", () => {
    audioDebugLabel.style.display = debugToggle.checked ? "block" : "none";
    transportLabel.parentElement.style.display = debugToggle.checked ? "block" : "none";
    energyLabel.parentElement.style.display = debugToggle.checked ? "block" : "none";
    silenceLabel.parentElement.style.display = debugToggle.checked ? "block" : "none";
  });
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();

  if (k === "1") renderer.setMode(1);
  if (k === "2") renderer.setMode(2);
  if (k === "3") renderer.setMode(3);
  if (k === "4") renderer.setMode(4);
  if (k === "a") renderer.toggleAutoMode();
  if (k === " ") {
    e.preventDefault();
    eventsEngine.triggerBlackoutPulse();
  }
  if (k === "h") hud.classList.toggle("hidden");
  if (k === "f") enterFullscreen();
});
