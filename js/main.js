import { AudioEngine } from "./audio.js";
import { Renderer } from "./renderer.js";
import { EventsEngine } from "./events.js";

const canvas = document.getElementById("mainCanvas");
const startButton = document.getElementById("startButton");
const startScreen = document.getElementById("startScreen");
const modeLabel = document.getElementById("modeLabel");
const audioLabel = document.getElementById("audioLabel");
const transportLabel = document.getElementById("transportLabel");
const energyLabel = document.getElementById("energyLabel");
const silenceLabel = document.getElementById("silenceLabel");
const fsButton = document.getElementById("fsButton");
const micButton = document.getElementById("micButton");
const hud = document.getElementById("hud");

const audioEngine = new AudioEngine();
const eventsEngine = new EventsEngine();

const renderer = new Renderer(canvas, audioEngine, eventsEngine, {
  modeLabel,
  transportLabel,
  energyLabel,
  silenceLabel,
});

function enterFullscreen() {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    elem.requestFullscreen?.();
  }
}

async function boot() {
  try {
    await audioEngine.start();
    audioLabel.textContent = "Live input connected";
  } catch (err) {
    console.error(err);
    audioLabel.textContent = "Audio permission failed";
  }

  startScreen.style.display = "none";
  renderer.start();
}

startButton.addEventListener("click", boot);
fsButton.addEventListener("click", enterFullscreen);

micButton.addEventListener("click", async () => {
  try {
    await audioEngine.start();
    audioLabel.textContent = "Live input connected";
  } catch (err) {
    console.error(err);
    audioLabel.textContent = "Audio permission failed";
  }
});

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