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
    this.lastMotionPhase = 0;
    this.lastTs = performance.now();
    this.lastActiveSignalAt = this.lastTs;
    this.silenceTimer = 0;

    this.running = false;
    this.crashed = false;
    this.forcedFallback = false;

    this.usingFallback = false;
    this.lastMotionDiagAt = 0;
    this.modeChangeListeners = [];
    this.baseTuning = {
      ...CONFIG.audio.tuning,
      ...(this.audioEngine.getTuning?.() ?? {}),
    };
    this.savedModeTunings = this.initializeSavedModeTunings();

    try {
      this.visual = new VisualEngine(canvas);
      this.engineName = "WebGL2";
    } catch (err) {
      console.error("WebGL2 visual engine failed to initialize, using Canvas fallback.", err);
      this.activateFallback("init");
    }

    window.addEventListener("resize", () => this.resize());
    this.resize();

    this.applySavedTuningForMode(this.mode);
    this.updateHudMode();
  }

  initializeSavedModeTunings() {
    const configured = CONFIG.modes?.tuningByMode ?? {};
    const modes = Object.keys(CONFIG.modes?.names ?? {});
    const saved = {};
    for (const modeKey of modes) {
      saved[modeKey] = {
        ...this.baseTuning,
        ...(configured[modeKey] ?? {}),
      };
    }
    return saved;
  }

  getSavedTuningForMode(mode) {
    const key = String(mode);
    return {
      ...this.baseTuning,
      ...(this.savedModeTunings[key] ?? {}),
    };
  }

  applySavedTuningForMode(mode) {
    if (!this.audioEngine?.setTuning) return;
    const saved = this.getSavedTuningForMode(mode);
    this.audioEngine.setTuning(saved);
  }

  setCurrentModeLiveTuning(partial) {
    if (!this.audioEngine?.setTuning) return;
    this.audioEngine.setTuning(partial);
  }

  saveCurrentModeTuning() {
    if (!this.audioEngine?.getTuning) return;
    this.savedModeTunings[String(this.mode)] = this.audioEngine.getTuning();
  }

  getCurrentModeActiveTuning() {
    if (!this.audioEngine?.getTuning) return this.getSavedTuningForMode(this.mode);
    return this.audioEngine.getTuning();
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
      tuning: this.getCurrentModeActiveTuning(),
      savedTuning: this.getSavedTuningForMode(this.mode),
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
    this.applySavedTuningForMode(mode);
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
    const activeSignalThreshold = CONFIG.blackout.activeSignalThreshold ?? 0.045;
    const activeSignalLevel = Math.max(
      audio.trueSignal ?? 0,
      audio.energy ?? 0,
      (audio.onset ?? 0) * 0.55,
      (audio.peak ?? 0) * 0.45
    );
    if (activeSignalLevel >= activeSignalThreshold) {
      this.lastActiveSignalAt = now;
    }
    this.silenceTimer = Math.max(0, (now - this.lastActiveSignalAt) / 1000);

    const pulseDrive = clamp(audio.pulseDrive ?? 0, 0, 1.5);
    this.motionPhase = Number.isFinite(audio.motionTime) ? audio.motionTime : this.motionPhase;
    const motionDelta = this.motionPhase - this.lastMotionPhase;
    this.lastMotionPhase = this.motionPhase;
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
      this.visual.render({
        mode: this.mode,
        time: this.motionPhase,
        motionEnabled: !!audio.motionEnabled,
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
        motionEnabled: !!audio.motionEnabled,
        blackout: blackout.fade,
        audio,
      });
      this.crashed = true;
    }

    this.hudRefs.transportLabel.textContent = (audio.transport ?? 0).toFixed(2);
    this.hudRefs.energyLabel.textContent = (audio.energyLevel ?? audio.energy ?? 0).toFixed(2);
    this.hudRefs.silenceLabel.textContent = audio.silence.toFixed(2);

    if (this.hudRefs.audioDebugLabel) {
      const dbg = this.audioEngine.getDebugState?.();
      if (dbg) {
        this.hudRefs.audioDebugLabel.textContent =
          `init:${dbg.initialized ? "Y" : "N"}` +
          ` live:${dbg.live ? "Y" : "N"}` +
          ` ctx:${dbg.ctxState ?? "?"}` +
          ` str:${dbg.streamActive ? "Y" : "N"}` +
          ` fft:${dbg.fftSize ?? 0}` +
          ` bins:${dbg.freqBinCount ?? 0}` +
          ` f0:${((dbg.firstBins?.[0] ?? 0) * 1).toFixed(2)}` +
          ` f1:${((dbg.firstBins?.[1] ?? 0) * 1).toFixed(2)}` +
          ` f2:${((dbg.firstBins?.[2] ?? 0) * 1).toFixed(2)}` +
          ` obsE:${(dbg.observedEnergy ?? 0).toFixed(2)}` +
          ` rmsR:${(dbg.rmsRaw ?? 0).toFixed(2)}` +
          ` bR:${(dbg.bassRaw ?? 0).toFixed(2)}` +
          ` mR:${(dbg.midsRaw ?? 0).toFixed(2)}` +
          ` hR:${(dbg.highsRaw ?? 0).toFixed(2)}` +
          ` rawE:${dbg.rawEnergy.toFixed(2)}` +
          ` sigE:${(dbg.signalEnergy ?? 0).toFixed(2)}` +
          ` gatE:${(dbg.gatedEnergy ?? 0).toFixed(2)}` +
          ` bass:${dbg.bass.toFixed(2)}` +
          ` mids:${dbg.mids.toFixed(2)}` +
          ` highs:${dbg.highs.toFixed(2)}` +
          ` smE:${dbg.smoothedEnergy.toFixed(2)}` +
          ` nf:${dbg.noiseFloor.toFixed(2)}` +
          ` ts:${dbg.trueSignal.toFixed(2)}` +
          ` rc:${(dbg.rhythmConfidence ?? 0).toFixed(2)}` +
          ` pd:${dbg.pulseDrive.toFixed(2)}` +
          ` eL:${dbg.energyLevel.toFixed(2)}` +
          ` tr:${dbg.transport.toFixed(2)}` +
          ` on:${dbg.onset.toFixed(2)}` +
          ` sil:${dbg.silence.toFixed(2)}` +
          ` act:${dbg.activeAboveBaseline ? "Y" : "N"}` +
          ` ph:${dbg.motionPhaseAdvancing ? "Y" : "N"}` +
          ` me:${dbg.motionEnabled ? "Y" : "N"}` +
          ` hs:${dbg.hardSilence ? "Y" : "N"}` +
          ` fr:${dbg.motionFrozen ? "Y" : "N"}` +
          ` md:${motionDelta.toFixed(4)}` +
          ` mt:${(dbg.motionTime ?? this.motionPhase).toFixed(2)}` +
          ` aE:${(audio.energy ?? 0).toFixed(2)}` +
          ` aB:${(audio.bass ?? 0).toFixed(2)}` +
          ` aM:${(audio.mids ?? 0).toFixed(2)}` +
          ` aH:${(audio.highs ?? 0).toFixed(2)}` +
          ` aT:${(audio.transport ?? 0).toFixed(2)}` +
          ` mode:${this.mode}` +
          ` b:${(audio.burstSpeed ?? 0).toFixed(2)}` +
          ` rs:${(audio.renderSpeed ?? 0).toFixed(2)}`;
      }
    }

    if (now - this.lastMotionDiagAt > 600) {
      this.lastMotionDiagAt = now;
      console.debug("[motion-diag]", {
        mode: this.mode,
        masterTime: Number(this.motionPhase.toFixed(4)),
        masterTimeDelta: Number(motionDelta.toFixed(5)),
        dt: Number(dt.toFixed(4)),
        transport: Number((audio.transport ?? 0).toFixed(4)),
        pulseDrive: Number((audio.pulseDrive ?? 0).toFixed(4)),
        renderSpeed: Number((audio.renderSpeed ?? 0).toFixed(4)),
        detailSpeed: Number((audio.detailSpeed ?? 0).toFixed(4)),
        burst: Number((audio.burstSpeed ?? 0).toFixed(4)),
        onset: Number((audio.onset ?? 0).toFixed(4)),
        peak: Number((audio.peak ?? 0).toFixed(4)),
        rawEnergy: Number((audio.energy ?? 0).toFixed(4)),
        trueSignal: Number((audio.trueSignal ?? 0).toFixed(4)),
        aboveBaseline: !!audio.activeAboveBaseline,
        motionPhaseAdvancing: !!audio.motionPhaseAdvancing,
        motionEnabled: !!audio.motionEnabled,
        hardSilence: !!audio.hardSilence,
        motionFrozen: !!audio.motionFrozen,
        audioDriven: {
          masterTime: true,
          shaderUTime: true,
          blackoutFade: true,
          mode2Burst: true,
        },
      });
    }
  }
}
