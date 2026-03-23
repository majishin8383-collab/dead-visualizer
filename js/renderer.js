import { CONFIG } from "./config.js";
import { computeBlackout } from "./transitions.js";
import { VisualEngine } from "./visual-engine.js";
import { FallbackEngine } from "./fallback-engine.js";

export class Renderer {
  constructor(canvas, audioEngine, eventsEngine, hudRefs) {
    this.canvas = canvas;
    this.audioEngine = audioEngine;
    this.eventsEngine = eventsEngine;
    this.hudRefs = hudRefs;

    this.mode = CONFIG.modes.defaultMode;
    this.autoMode = false;
    this.autoSwitchTimer = 0;

    this.masterTime = 0;
    this.lastTs = performance.now();

    this.running = false;
    this.crashed = false;
    this.forcedFallback = false;

    try {
      this.visual = new VisualEngine(canvas);
      this.engineName = "WebGL2";
    } catch (err) {
      console.error("WebGL2 visual engine failed to initialize, using Canvas fallback.", err);
      this.visual = new FallbackEngine(canvas);
      this.engineName = "Canvas Fallback";
      if (this.hudRefs?.transportLabel) {
        this.hudRefs.transportLabel.textContent = "fallback";
      }
    }

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.updateHudMode();
  }

  resize() {
    this.visual.resize(window.innerWidth, window.innerHeight);
  }

  setMode(mode) {
    this.mode = mode;
    this.visual.setMode?.(mode);
    this.updateHudMode();
  }

  toggleAutoMode() {
    this.autoMode = !this.autoMode;
    this.autoSwitchTimer = 0;
  }

  updateHudMode() {
    this.hudRefs.modeLabel.textContent = `${CONFIG.modes.names[this.mode] || "Unknown"} (${CONFIG.buildTag} · ${this.engineName})`;
  }

  start() {
    this.running = true;
    this.lastTs = performance.now();
    this.loop();
  }

  loop() {
    if (!this.running) return;

    requestAnimationFrame(() => this.loop());

    const now = performance.now();
    const dt = Math.min(0.05, Math.max(1 / 240, (now - this.lastTs) / 1000));
    this.lastTs = now;
    this.masterTime += dt;

    const audio = this.audioEngine.update();
    const events = this.eventsEngine.update(audio, dt);

    if (this.autoMode) {
      this.autoSwitchTimer += dt * (0.55 + audio.energy * 0.7 + audio.onset * 0.6);
      if (this.autoSwitchTimer > CONFIG.modes.autoCycleSeconds) {
        this.autoSwitchTimer = 0;
        this.mode = this.mode >= 4 ? 1 : this.mode + 1;
        this.updateHudMode();
      }
    }

    const blackout = computeBlackout(audio.silence, audio.energy, events.blackoutPulse, CONFIG);

    try {
      this.visual.render({
        mode: this.mode,
        time: this.masterTime,
        dt,
        blackout: Math.min(1, blackout.fade),
        audio,
        events,
      });
      this.crashed = false;
    } catch (err) {
      if (!this.crashed) {
        console.error("Visualizer render failed; switching to Canvas fallback engine.", err);
      }
      if (!this.forcedFallback) {
        this.visual = new FallbackEngine(this.canvas);
        this.visual.resize(window.innerWidth, window.innerHeight);
        this.engineName = "Canvas Fallback";
        this.forcedFallback = true;
        this.updateHudMode();
      }
      this.crashed = true;
    }

    this.hudRefs.transportLabel.textContent = audio.transport.toFixed(2);
    this.hudRefs.energyLabel.textContent = audio.energy.toFixed(2);
    this.hudRefs.silenceLabel.textContent = audio.silence.toFixed(2);
  }
}
