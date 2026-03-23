import { CONFIG } from "./config.js";
import { computeBlackout } from "./transitions.js";
import { VisualEngine } from "./visual-engine.js";
import { FallbackEngine } from "./fallback-engine.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export class Renderer {
  constructor(canvas, audioEngine, eventsEngine, hudRefs) {
    this.canvas = canvas;
    this.audioEngine = audioEngine;
    this.eventsEngine = eventsEngine;
    this.hudRefs = hudRefs;

    this.mode = CONFIG.modes.defaultMode;
    this.autoMode = false;
    this.autoSwitchTimer = 0;
    this.autoCycleSeconds = CONFIG.modes.autoCycleSeconds;

    this.motionPhase = 0;
    this.lastTs = performance.now();

    this.running = false;
    this.crashed = false;
    this.forcedFallback = false;

    this.usingFallback = false;

    try {
      this.visual = new VisualEngine(canvas);
      this.engineName = "WebGL2";
    } catch (err) {
      console.error("WebGL2 visual engine failed to initialize, using Canvas fallback.", err);
      this.activateFallback("init");
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

  activateFallback(reason = "runtime") {
    const fallback = new FallbackEngine(this.canvas);
    this.visual = fallback;
    this.usingFallback = true;
    this.engineName = fallback.ready ? "Canvas Fallback" : "Renderer Unavailable";
    this.updateHudMode();
    if (this.hudRefs?.transportLabel) {
      this.hudRefs.transportLabel.textContent = fallback.ready ? "fallback" : "renderer-unavailable";
    }
    if (!fallback.ready) {
      console.error(`Fallback activation (${reason}) failed: 2D context unavailable.`);
    }
  }

  toggleAutoMode() {
    this.autoMode = !this.autoMode;
    this.autoSwitchTimer = 0;
  }

  setAutoMode(enabled) {
    this.autoMode = !!enabled;
    this.autoSwitchTimer = 0;
  }

  setAutoCycleSeconds(seconds) {
    this.autoCycleSeconds = Math.max(3, Number(seconds) || CONFIG.modes.autoCycleSeconds);
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

    const audio = this.audioEngine.update();
    const pulseDrive = clamp(audio.pulseDrive ?? 0, 0, 1.5);
    const phaseStep = pulseDrive > 0.01 ? pulseDrive * dt : 0;
    this.motionPhase += phaseStep;
    const events = this.eventsEngine.update(audio, dt);

    if (this.autoMode) {
      this.autoSwitchTimer += dt * (0.35 + pulseDrive * 0.65 + audio.onset * 0.35);
      if (this.autoSwitchTimer > this.autoCycleSeconds) {
        this.autoSwitchTimer = 0;
        this.mode = this.mode >= 4 ? 1 : this.mode + 1;
        this.updateHudMode();
      }
    }

    const blackout = computeBlackout(audio.silence, audio.energy, events.blackoutPulse, CONFIG);

    try {
      this.visual.render({
        mode: this.mode,
        time: this.motionPhase,
        dt,
        blackout: blackout.fade,
        audio,
        events,
      });
      this.crashed = false;
    } catch (err) {
      if (!this.crashed) {
        console.error("Visualizer render failed; activating fallback.", err);
      }
      if (!this.usingFallback) {
        this.activateFallback("runtime");
      }
      this.visual.render?.({
        mode: this.mode,
        time: this.motionPhase,
        blackout: blackout.fade,
        audio,
      });
      this.crashed = true;
    }

    this.hudRefs.transportLabel.textContent = (audio.pulseDrive ?? audio.transport ?? 0).toFixed(2);
    this.hudRefs.energyLabel.textContent = (audio.energyLevel ?? audio.energy ?? 0).toFixed(2);
    this.hudRefs.silenceLabel.textContent = audio.silence.toFixed(2);

    if (this.hudRefs.audioDebugLabel) {
      const dbg = this.audioEngine.getDebugState?.();
      if (dbg) {
        this.hudRefs.audioDebugLabel.textContent =
          `init:${dbg.initialized ? "Y" : "N"}` +
          ` live:${dbg.live ? "Y" : "N"}` +
          ` rawE:${dbg.rawEnergy.toFixed(2)}` +
          ` bass:${dbg.bass.toFixed(2)}` +
          ` mids:${dbg.mids.toFixed(2)}` +
          ` highs:${dbg.highs.toFixed(2)}` +
          ` smE:${dbg.smoothedEnergy.toFixed(2)}` +
          ` pd:${dbg.pulseDrive.toFixed(2)}` +
          ` eL:${dbg.energyLevel.toFixed(2)}` +
          ` tr:${dbg.transport.toFixed(2)}` +
          ` on:${dbg.onset.toFixed(2)}` +
          ` sil:${dbg.silence.toFixed(2)}` +
          ` ph:${dbg.motionPhaseAdvancing ? "Y" : "N"}`;
      }
    }
  }
}
