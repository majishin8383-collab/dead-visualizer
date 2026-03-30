import { CONFIG } from "./config.js";
import { computeBlackout } from "./transitions.js";
import { VisualEngine } from "./visual-engine.js";
import { FallbackEngine } from "./fallback-engine.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
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

    this.motionDebug = { baseFlow: 0, motionScale: 1, finalMotion: 0, finalTransport: 0 };
    this.lastTs = performance.now();
    this.lastActiveSignalAt = this.lastTs;
    this.silenceTimer = 0;

    this.running = false;
    this.crashed = false;
    this.usingFallback = false;
    this.lastMotionDiagAt = 0;
    this.modeChangeListeners = [];

    this.defaultModeSettings = cloneSettings(CONFIG.modes.settingsByMode ?? {});
    this.modeSettings = cloneSettings(this.defaultModeSettings);

    try {
      this.visual = new VisualEngine(canvas);
      this.engineName = "WebGL2";
    } catch (err) {
      console.error("WebGL2 visual engine failed to initialize, using Canvas fallback.", err);
      this.activateFallback("init");
    }

    window.addEventListener("resize", () => this.resize());
    this.resize();

    this.applyModeSettings(this.mode);
    this.updateHudMode();
  }

  getModeSettings(mode) {
    return { ...(this.modeSettings[String(mode)] ?? this.defaultModeSettings[String(mode)] ?? {}) };
  }

  getDefaultModeSettings(mode) {
    return { ...(this.defaultModeSettings[String(mode)] ?? {}) };
  }

  getRuntimeState() {
    const debug = this.audioEngine.getDebugState?.() ?? {};
    return {
      mode: this.mode,
      settings: this.getCurrentModeActiveSettings(),
      rawEnergy: debug.rawEnergy ?? 0,
      signalAboveBaseline: !!(debug.motionDecision?.signalAboveBaseline ?? debug.activeAboveBaseline),
      sustainEnergy: debug.sustainEnergy ?? 0,
      motionEnabled: !!debug.motionEnabled,
      transport: debug.transport ?? 0,
      finalMotion: this.motionDebug.finalMotion ?? 0,
      baseline: debug.noiseFloor ?? 0,
    };
  }

  applyModeSettings(mode) {
    const settings = this.getModeSettings(mode);
    this.audioEngine.setTuning(settings);
  }

  setCurrentModeLiveSettings(partial) {
    if (!partial || typeof partial !== "object") return;
    const key = String(this.mode);
    this.modeSettings[key] = { ...this.getModeSettings(this.mode), ...partial };
    this.audioEngine.setTuning(partial);
  }

  saveCurrentModeSettings() {
    const key = String(this.mode);
    this.modeSettings[key] = this.getCurrentModeActiveSettings();
  }

  resetCurrentModeSettings() {
    const key = String(this.mode);
    this.modeSettings[key] = this.getDefaultModeSettings(this.mode);
    this.applyModeSettings(this.mode);
  }

  getCurrentModeActiveSettings() {
    return this.audioEngine.getTuning?.() ?? this.getModeSettings(this.mode);
  }

  onModeChange(listener) {
    if (typeof listener !== "function") return () => {};
    this.modeChangeListeners.push(listener);
    return () => {
      this.modeChangeListeners = this.modeChangeListeners.filter((fn) => fn !== listener);
    };
  }

  notifyModeChange(prevMode) {
    const payload = {
      mode: this.mode,
      prevMode,
      settings: this.getCurrentModeActiveSettings(),
      savedSettings: this.getModeSettings(this.mode),
    };
    this.modeChangeListeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error("Mode change listener failed", err);
      }
    });
  }

  resize() {
    this.visual.resize(window.innerWidth, window.innerHeight);
  }

  setMode(mode) {
    const prevMode = this.mode;
    this.mode = mode;
    this.applyModeSettings(mode);
    this.visual.setMode?.(mode);
    this.updateHudMode();
    this.notifyModeChange(prevMode);
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
    const settings = this.getCurrentModeActiveSettings();

    const activeSignalThreshold = CONFIG.blackout.activeSignalThreshold ?? 0.045;
    const activeSignalLevel = Math.max(audio.trueSignal ?? 0, audio.energy ?? 0, audio.sustainEnergy ?? 0, (audio.onset ?? 0) * 0.55, (audio.peak ?? 0) * 0.45);
    if (activeSignalLevel >= activeSignalThreshold) this.lastActiveSignalAt = now;
    this.silenceTimer = Math.max(0, (now - this.lastActiveSignalAt) / 1000);

    const pulseDrive = clamp(audio.pulseDrive ?? 0, 0, 1.5);
    const motionScale = clamp(audio.motionScale ?? settings.motionScale ?? 0.08, 0, 0.2);
    const baseFlow = clamp(audio.baseFlow ?? settings.baseFlow ?? 0, 0, 0.03);
    const finalTransport = clamp(audio.finalTransport ?? 0, 0, 0.25);
    const finalMotion = clamp(audio.finalMotion ?? 0, 0, 0.25);
    const motionTime = clamp(audio.motionTime ?? 0, 0, Number.MAX_SAFE_INTEGER);
    const motionDelta = finalMotion * dt;
    this.motionDebug.baseFlow = baseFlow;
    this.motionDebug.motionScale = motionScale;
    this.motionDebug.finalTransport = finalTransport;
    this.motionDebug.finalMotion = finalMotion;

    const events = this.eventsEngine.update(audio, dt);

    if (this.autoMode) {
      this.autoSwitchTimer += dt * (0.35 + pulseDrive * 0.65 + audio.onset * 0.35);
      if (this.autoSwitchTimer > this.autoCycleSeconds) {
        this.autoSwitchTimer = 0;
        this.setMode(this.mode >= 4 ? 1 : this.mode + 1);
      }
    }

    const blackout = computeBlackout(audio.silence, this.silenceTimer, events.blackoutPulse, CONFIG);

    try {
      this.visual.render({ mode: this.mode, time: motionTime, motionEnabled: finalMotion > 0, dt, blackout: blackout.fade, audio, events });
      this.crashed = false;
    } catch (err) {
      if (!this.crashed) console.error("Visualizer render failed; activating fallback.", err);
      if (!this.usingFallback) this.activateFallback("runtime");
      this.visual.render?.({ mode: this.mode, time: motionTime, motionEnabled: finalMotion > 0, blackout: blackout.fade, audio });
      this.crashed = true;
    }

    this.hudRefs.transportLabel.textContent = (audio.transport ?? 0).toFixed(2);
    this.hudRefs.energyLabel.textContent = (audio.energyLevel ?? audio.energy ?? 0).toFixed(2);
    this.hudRefs.silenceLabel.textContent = audio.silence.toFixed(2);

    if (this.hudRefs.audioDebugLabel) {
      const dbg = this.audioEngine.getDebugState?.() ?? {};
      this.hudRefs.audioDebugLabel.textContent =
        `mode:${this.mode}` +
        ` rawE:${(dbg.rawEnergy ?? 0).toFixed(3)}` +
        ` sig:${dbg.activeAboveBaseline ? "Y" : "N"}` +
        ` sus:${(dbg.sustainEnergy ?? 0).toFixed(3)}` +
        ` me:${dbg.motionEnabled ? "Y" : "N"}` +
        ` tr:${(dbg.transport ?? 0).toFixed(3)}` +
        ` fm:${this.motionDebug.finalMotion.toFixed(3)}` +
        ` base:${(dbg.noiseFloor ?? 0).toFixed(3)}` +
        ` bl:${dbg.baselineLearning ? "L" : "-"}` +
        ` lk:${dbg.baselineLocked ? "Y" : "N"}` +
        ` act:${(dbg.activateThreshold ?? settings.activateThreshold ?? 0).toFixed(3)}` +
        ` deact:${(dbg.deactivateThreshold ?? settings.deactivateThreshold ?? 0).toFixed(3)}` +
        ` hold:${Math.round(dbg.holdTimeMs ?? settings.holdTime ?? 0)}` +
        ` fade:${Math.round(dbg.fadeTimeMs ?? settings.fadeTime ?? 0)}`;
    }

    if (now - this.lastMotionDiagAt > 800) {
      this.lastMotionDiagAt = now;
      console.debug("[motion-diag]", {
        mode: this.mode,
        dt: Number(dt.toFixed(4)),
        transport: Number((audio.transport ?? 0).toFixed(4)),
        baseFlow: Number(baseFlow.toFixed(4)),
        motionScale: Number(motionScale.toFixed(4)),
        finalTransport: Number(finalTransport.toFixed(4)),
        finalMotion: Number(finalMotion.toFixed(4)),
        maxSpeed: Number((audio.maxSpeed ?? settings.maxSpeed ?? 0).toFixed(4)),
        motionDelta: Number(motionDelta.toFixed(5)),
      });
    }
  }
}
