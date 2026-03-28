import { CONFIG } from "./config.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function finiteOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function followEnvelope(current, target, attackHz, releaseHz, dt) {
  const rise = target > current;
  const rate = rise ? attackHz : releaseHz;
  const alpha = 1 - Math.exp(-rate * dt);
  return current + (target - current) * alpha;
}

function floorSubtractNormalize(value, floor, maxExpectedSignal, deadZone = 0.012) {
  const signal = Math.max(0, value - floor);
  if (signal < deadZone) return 0;
  return clamp(signal / Math.max(1e-5, maxExpectedSignal), 0, 1);
}

function computePeakNorm(freqData) {
  if (!freqData || freqData.length === 0) return 0;
  let peak = 0;
  for (let i = 0; i < freqData.length; i++) {
    if (freqData[i] > peak) peak = freqData[i];
  }
  return peak / 255;
}

function computeFrequencyRms(freqData) {
  if (!freqData || freqData.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < freqData.length; i++) {
    const normalized = freqData[i] / 255;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / freqData.length);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.inputGain = null;
    this.silentMonitor = null;

    this.freqData = null;
    this.timeData = null;
    this.floatTimeData = null;
    this.lastAnalyserProbeAt = 0;
    this.lastInitError = "";

    this.ready = false;
    this.live = false;
    this.lastEnergy = 0;

    this.transport = 0;
    this.transportPhase = 0;
    this.motionPhase = 0;
    this.motionEnabled = false;
    this.hardSilence = true;
    this.motionFrozen = true;
    this.motionEnableHold = 0;
    this.lastStrongSignalAt = 0;
    this.signalLatchActive = false;
    this.motionDecision = {
      signalAboveBaseline: false,
      sustainActive: false,
      transientActive: false,
      recentActivity: false,
      strongSignal: false,
      sustainEnergy: 0,
      sustainThreshold: 0,
      transientLevel: 0,
      activateThreshold: 0,
      deactivateThreshold: 0,
      timeSinceLastStrongSignal: 0,
    };

    this.lastUpdateAt = performance.now();
    this.lastDebugAt = 0;

    this.noiseFloor = 0.01;
    this.baselineEnergy = 0.02;
    this.baselineLearning = false;
    this.baselineLocked = false;
    this.lockedBaselineValue = null;
    this.baselineLearningValue = this.baselineEnergy;
    this.baselineLearningElapsed = 0;
    this.baselineSamples = [];
    this.bandNoiseFloor = {
      bass: 0.01,
      lowMid: 0.01,
      mids: 0.01,
      highs: 0.01,
      air: 0.01,
      guitar: 0.01,
    };
    this.trueSignal = 0;
    this.activeAboveBaseline = false;
    this.calibratedGain = 1.0;

    this.smooth = {
      bass: 0,
      lowMid: 0,
      mids: 0,
      highs: 0,
      energy: 0,
      onset: 0,
      peak: 0,
      silence: 1,
      sustainEnergy: 0,
      guitar: 0,
      air: 0,
      transport: 0,
      transportRaw: 0,
    };

    this.raw = {
      bass: 0,
      lowMid: 0,
      mids: 0,
      highs: 0,
      guitar: 0,
      air: 0,
      energy: 0,
      onset: 0,
      peak: 0,
      silence: 1,
      rms: 0,
      transport: 0,
    };

    this.motion = {
      pulseDrive: 0,
      renderSpeed: 0,
      speed: 0,
      detail: 0,
      burst: 0,
    };
    this.pulse = {
      onsetEnvelope: 0,
      grooveEnvelope: 0,
      shortPulse: 0,
      longPulse: 0,
      phaseGate: 0,
      motionGate: 0,
      bassDelta: 0,
    };
    this.tuning = {
      ...CONFIG.audio.tuning,
    };
    this.music = {
      prevSpectrum: null,
      history: [],
      confidence: 0,
      active: false,
      hold: 0,
    };

    this.debugState = {
      initialized: false,
      live: false,
      ctxState: "uninitialized",
      streamActive: false,
      fftSize: 0,
      freqBinCount: 0,
      firstBins: [],
      rmsRaw: 0,
      bassRaw: 0,
      lowMidRaw: 0,
      midsRaw: 0,
      highsRaw: 0,
      observedEnergy: 0,
      normalizedFreqRms: 0,
      preGainSignal: 0,
      postGainSignal: 0,
      finalSignal: 0,
      rawEnergy: 0,
      signalEnergy: 0,
      gatedEnergy: 0,
      bass: 0,
      mids: 0,
      highs: 0,
      smoothedEnergy: 0,
      transport: 0,
      onset: 0,
      silence: 1,
      motionSpeed: 0,
      detailSpeed: 0,
      burstSpeed: 0,
      pulseDrive: 0,
      energyLevel: 0,
      sustainEnergy: 0,
      sustainThreshold: 0,
      motionDecision: {},
      motionPhaseAdvancing: false,
      motionEnabled: false,
      hardSilence: true,
      motionFrozen: true,
      noiseFloor: 0,
      trueSignal: 0,
      activeAboveBaseline: false,
      motionTime: 0,
      activateThreshold: 0,
      deactivateThreshold: 0,
      holdTimeMs: 0,
      fadeTimeMs: 0,
      baselineLearning: false,
      baselineLocked: false,
      lockedBaselineValue: 0,
      baselineValue: 0,
      modeParameters: {},
      initError: "",
    };
  }

  async start() {
    try {
      if (this.ready && this.ctx && this.ctx.state !== "closed") {
        if (this.ctx.state === "suspended") {
          await this.ctx.resume();
        }
        console.info("[audio-init] reusing existing audio context", { state: this.ctx.state });
        this.live = true;
        this.lastInitError = "";
        this.debugState.initialized = true;
        this.debugState.live = true;
        this.debugState.initError = "";
        return;
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error("Web Audio API not available in this browser.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("navigator.mediaDevices.getUserMedia is unavailable.");
      }

      this.ctx = this.ctx && this.ctx.state !== "closed" ? this.ctx : new AudioCtx();
      console.info("[audio-init] audio context created", {
        state: this.ctx.state,
        sampleRate: this.ctx.sampleRate,
      });
      if (this.ctx.state !== "running") {
        await this.ctx.resume();
      }
      console.info("[audio-init] audio context after resume", { state: this.ctx.state });
      if (this.ctx.state !== "running") {
        throw new Error(`AudioContext failed to enter running state (state=${this.ctx.state}).`);
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: CONFIG.audio.echoCancellation,
          noiseSuppression: CONFIG.audio.noiseSuppression,
          autoGainControl: CONFIG.audio.autoGainControl,
        },
        video: false,
      });
      const tracks = this.stream.getAudioTracks();
      console.info("[audio-init] getUserMedia stream received", {
        stream: this.stream,
        audioTrackCount: tracks.length,
        trackStates: tracks.map((t) => ({ kind: t.kind, label: t.label, enabled: t.enabled, readyState: t.readyState })),
      });
      if (tracks.length === 0) {
        throw new Error("Microphone stream contains zero audio tracks.");
      }

      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.inputGain = this.ctx.createGain();
      this.inputGain.gain.value = 1.0;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = clamp(Number(CONFIG.audio.fftSize ?? 2048), 1024, 2048);
      this.analyser.smoothingTimeConstant = clamp(this.tuning.smoothing ?? 0.18, 0, 0.5);
      this.silentMonitor = this.ctx.createGain();
      this.silentMonitor.gain.value = 0;

      this.source.connect(this.inputGain);
      this.inputGain.connect(this.analyser);
      this.analyser.connect(this.silentMonitor);
      this.silentMonitor.connect(this.ctx.destination);
      console.info("[audio-init] node chain connected", {
        hasSource: !!this.source,
        hasInputGain: !!this.inputGain,
        hasAnalyser: !!this.analyser,
        hasDestination: !!this.ctx.destination,
      });

      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.fftSize);
      this.floatTimeData = new Float32Array(this.analyser.fftSize);

      this.lastUpdateAt = performance.now();
      this.lastDebugAt = this.lastUpdateAt;
      this.lastAnalyserProbeAt = 0;
      this.ready = true;
      this.live = true;
      this.lastInitError = "";
      this.debugState.initialized = true;
      this.debugState.live = true;
      this.debugState.initError = "";
    } catch (err) {
      this.ready = false;
      this.live = false;
      this.lastInitError = err?.message || String(err);
      this.debugState.initialized = false;
      this.debugState.live = false;
      this.debugState.initError = this.lastInitError;
      console.error("[audio-init] failed", {
        reason: this.lastInitError,
        error: err,
      });
      throw err;
    }
  }

  averageRange(minHz, maxHz) {
    if (!this.analyser || !this.freqData || !this.ctx) return 0;
    const nyquist = this.ctx.sampleRate / 2;
    const n = this.freqData.length;
    const min = clamp(Math.floor((minHz / nyquist) * n), 0, n - 1);
    const max = clamp(Math.ceil((maxHz / nyquist) * n), min + 1, n);

    let sum = 0;
    for (let i = min; i < max; i++) sum += this.freqData[i];
    return (sum / Math.max(1, max - min)) / 255;
  }

  computeRms() {
    if (!this.timeData) return 0;
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = (this.timeData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.timeData.length);
  }

  getDebugState() {
    return { ...this.debugState };
  }

  setTuning(partial) {
    this.tuning = {
      ...this.tuning,
      ...partial,
    };
    this.tuning.micSensitivity = clamp(Number(this.tuning.micSensitivity ?? 1), 0.1, 4);
    this.tuning.noiseGate = clamp(Number(this.tuning.noiseGate ?? 0.03), 0, 0.4);
    this.tuning.sustainThreshold = clamp(Number(this.tuning.sustainThreshold ?? 0.09), 0.02, 0.4);
    this.tuning.activateThreshold = clamp(Number(this.tuning.activateThreshold ?? 0.34), 0.05, 1);
    this.tuning.deactivateThreshold = clamp(Number(this.tuning.deactivateThreshold ?? 0.2), 0.01, this.tuning.activateThreshold);
    this.tuning.holdTime = clamp(Number(this.tuning.holdTime ?? 90), 10, 3000);
    this.tuning.fadeTime = clamp(Number(this.tuning.fadeTime ?? 260), 10, 3000);
    this.tuning.responseCurve = clamp(Number(this.tuning.responseCurve ?? 1.5), 1, 2.5);
    this.tuning.smoothing = clamp(Number(this.tuning.smoothing ?? 0.18), 0, 0.5);
    this.tuning.bassWeight = clamp(Number(this.tuning.bassWeight ?? 0.26), 0, 1.2);
    this.tuning.midsWeight = clamp(Number(this.tuning.midsWeight ?? 0.2), 0, 1.2);
    this.tuning.highsWeight = clamp(Number(this.tuning.highsWeight ?? 0.1), 0, 1.2);
    this.tuning.motionScale = clamp(Number(this.tuning.motionScale ?? 0.35), 0, 2);
    this.tuning.baseFlow = clamp(Number(this.tuning.baseFlow ?? 0.02), 0, 1);
    this.tuning.maxSpeed = clamp(Number(this.tuning.maxSpeed ?? 0.6), 0.01, 2);
    this.tuning.audioReactivity = clamp(Number(this.tuning.audioReactivity ?? 1), 0.1, 4);
    this.tuning.peakIntensity = clamp(Number(this.tuning.peakIntensity ?? 1), 0.1, 4);
    if (this.analyser) {
      this.analyser.smoothingTimeConstant = clamp(this.tuning.smoothing ?? 0.18, 0, 0.5);
    }
  }

  getTuning() {
    return { ...this.tuning };
  }

  getLastInitError() {
    return this.lastInitError;
  }

  startBaselineLearning() {
    this.baselineLearning = true;
    this.baselineLocked = false;
    this.lockedBaselineValue = null;
    this.baselineLearningElapsed = 0;
    this.baselineSamples = [];
    this.baselineLearningValue = this.baselineEnergy;
  }

  computeLearnedBaseline() {
    if (!this.baselineSamples.length) return clamp(this.baselineLearningValue ?? this.baselineEnergy, 0, 0.95);
    const cfg = CONFIG.audio.manualBaseline ?? {};
    const percentile = clamp(cfg.floorPercentile ?? 0.3, 0.05, 0.95);
    const sorted = [...this.baselineSamples].sort((a, b) => a - b);
    const idx = Math.floor((sorted.length - 1) * percentile);
    return clamp(sorted[clamp(idx, 0, sorted.length - 1)], 0, 0.95);
  }

  lockBaseline() {
    const selectedBaseline = clamp(
      this.baselineSamples.length ? this.computeLearnedBaseline() : this.baselineLearningValue ?? this.baselineEnergy,
      0,
      0.95
    );
    this.baselineEnergy = selectedBaseline;
    this.lockedBaselineValue = selectedBaseline;
    this.baselineLocked = true;
    this.baselineLearning = false;
    this.baselineLearningValue = selectedBaseline;
    this.baselineLearningElapsed = 0;
    this.baselineSamples = [];
  }

  getBaselineState() {
    return {
      baselineLearning: this.baselineLearning,
      baselineLocked: this.baselineLocked,
      lockedBaselineValue: this.baselineLocked ? this.lockedBaselineValue ?? this.baselineEnergy : null,
      currentBaselineValue: this.baselineEnergy,
      learningElapsed: this.baselineLearningElapsed,
    };
  }

  evaluateMusicStructure({ dt, onset, pulse, bass, lowMid, mids, highs, trueSignal, activeAboveFloor }) {
    const spectrum = [bass, lowMid, mids, highs];
    let flux = 0;
    if (this.music.prevSpectrum) {
      for (let i = 0; i < spectrum.length; i++) {
        flux += Math.abs(spectrum[i] - this.music.prevSpectrum[i]);
      }
      flux /= spectrum.length;
    }
    this.music.prevSpectrum = spectrum;

    this.music.history.push({
      onset: clamp(onset, 0, 1),
      pulse: clamp(pulse, 0, 1),
      flux: clamp(flux, 0, 1),
    });
    if (this.music.history.length > 96) this.music.history.shift();

    const n = this.music.history.length;
    if (n < 24) {
      this.music.confidence = followEnvelope(this.music.confidence, 0, 4, 2.5, dt);
      this.music.active = false;
      this.music.hold = Math.max(0, this.music.hold - dt);
      return { confidence: this.music.confidence, active: this.music.active };
    }

    const onsetSeries = this.music.history.map((h) => h.onset);
    const pulseSeries = this.music.history.map((h) => h.pulse);
    const fluxSeries = this.music.history.map((h) => h.flux);
    const eventCount = onsetSeries.filter((v) => v > 0.09).length;
    const eventDensity = eventCount / n;
    const pulseMean = pulseSeries.reduce((sum, v) => sum + v, 0) / n;
    const fluxMean = fluxSeries.reduce((sum, v) => sum + v, 0) / n;

    let maxCorr = 0;
    for (let lag = 6; lag <= 24; lag++) {
      if (lag >= n) break;
      let dot = 0;
      let sumA = 0;
      let sumB = 0;
      for (let i = lag; i < n; i++) {
        const a = onsetSeries[i];
        const b = onsetSeries[i - lag];
        dot += a * b;
        sumA += a * a;
        sumB += b * b;
      }
      const corr = dot / Math.max(1e-5, Math.sqrt(sumA * sumB));
      if (corr > maxCorr) maxCorr = corr;
    }

    const signalStrength = clamp(trueSignal / Math.max(1e-5, activeAboveFloor * 3.6), 0, 1);
    const densityScore = clamp((eventDensity - 0.07) / 0.25, 0, 1);
    const regularityScore = clamp((maxCorr - 0.2) / 0.55, 0, 1);
    const fluxScore = clamp((fluxMean - 0.014) / 0.09, 0, 1);
    const pulseScore = clamp((pulseMean - 0.05) / 0.32, 0, 1);

    let targetConfidence =
      densityScore * 0.32 +
      regularityScore * 0.3 +
      fluxScore * 0.22 +
      pulseScore * 0.16;
    targetConfidence *= signalStrength;

    const randomSpikePenalty = eventCount <= 2 && Math.max(...onsetSeries) > 0.35 ? 0.28 : 0;
    targetConfidence = clamp(targetConfidence - randomSpikePenalty, 0, 1);

    this.music.confidence = followEnvelope(this.music.confidence, targetConfidence, 5, 1.8, dt);

    const activate = this.music.confidence > 0.56 && eventCount >= 4 && fluxMean > 0.012;
    const stayActive = this.music.confidence > 0.42 && eventCount >= 3;
    if (activate) {
      this.music.active = true;
      this.music.hold = 0.85;
    } else {
      this.music.hold = Math.max(0, this.music.hold - dt);
      this.music.active = stayActive || this.music.hold > 0;
    }

    return {
      confidence: this.music.confidence,
      active: this.music.active,
    };
  }

  update() {
    const now = performance.now();
    const dt = clamp((now - this.lastUpdateAt) / 1000, 1 / 240, 0.1);
    this.lastUpdateAt = now;

    if (!this.ready || !this.analyser || !this.freqData || !this.timeData) {
      const streamTracks = this.stream?.getAudioTracks?.() ?? [];
      const streamActive = streamTracks.length > 0 && streamTracks.some((track) => track.readyState === "live");
      const idle = {
        bass: 0,
        lowMid: 0,
        mids: 0,
        highs: 0,
        guitar: 0,
        air: 0,
        energy: 0,
        energyLevel: 0,
        pulseDrive: 0,
        transport: 0,
        renderSpeed: 0,
        onset: 0,
        peak: 0,
        silence: 1,
        motionPhaseAdvancing: false,
        motionEnabled: false,
        hardSilence: true,
        motionFrozen: true,
        sustainEnergy: 0,
        sustainThreshold: 0,
        motionDecision: {
          signalAboveBaseline: false,
          sustainActive: false,
          transientActive: false,
          recentActivity: false,
          strongSignal: false,
          sustainEnergy: 0,
          sustainThreshold: 0,
          transientLevel: 0,
          activateThreshold: 0,
          deactivateThreshold: 0,
          timeSinceLastStrongSignal: 0,
        },
      };
      this.debugState = {
        initialized: this.ready,
        live: this.live,
        ctxState: this.ctx?.state ?? "uninitialized",
        streamActive,
        fftSize: this.analyser?.fftSize ?? 0,
        freqBinCount: this.analyser?.frequencyBinCount ?? 0,
        firstBins: [],
        rmsRaw: 0,
        bassRaw: 0,
        lowMidRaw: 0,
        midsRaw: 0,
        highsRaw: 0,
        observedEnergy: 0,
        normalizedFreqRms: 0,
        preGainSignal: 0,
        postGainSignal: 0,
        finalSignal: 0,
        rawEnergy: idle.energy,
        signalEnergy: 0,
        gatedEnergy: idle.energy,
        bass: idle.bass,
        mids: idle.mids,
        highs: idle.highs,
        smoothedEnergy: idle.energy,
        pulseDrive: 0,
        energyLevel: 0,
        transport: idle.transport,
        transportRaw: 0,
        onset: idle.onset,
        silence: idle.silence,
        motionPhaseAdvancing: false,
        motionEnabled: false,
        hardSilence: true,
        motionFrozen: true,
        noiseFloor: 0,
        trueSignal: 0,
        activeAboveBaseline: false,
        motionTime: 0,
        activateThreshold: this.tuning.activateThreshold ?? 0,
        deactivateThreshold: this.tuning.deactivateThreshold ?? 0,
        holdTimeMs: this.tuning.holdTime ?? 0,
        fadeTimeMs: this.tuning.fadeTime ?? 0,
        baselineLearning: this.baselineLearning,
        baselineLocked: this.baselineLocked,
        lockedBaselineValue: this.lockedBaselineValue ?? 0,
        baselineValue: this.baselineEnergy,
        modeParameters: { ...this.tuning },
      };
      return idle;
    }

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);

    const rawBass = this.averageRange(30, 180);
    const rawLowMid = this.averageRange(180, 500);
    const rawMids = this.averageRange(500, 2500);
    const rawHighs = this.averageRange(2500, 9000);
    const rawAir = this.averageRange(9000, 15000);
    const rawGuitar = this.averageRange(700, 3300);
    const rms = this.computeRms();
    const peakNorm = computePeakNorm(this.freqData);
    const normalizedFreqRms = computeFrequencyRms(this.freqData);
    const binPopulation = this.freqData.some((value) => value > 0);

    const baseEnergyNormalized =
      rawBass * 0.36 +
      rawLowMid * 0.2 +
      rawMids * 0.24 +
      rawHighs * 0.1 +
      rms * 0.95 +
      peakNorm * 0.1 +
      normalizedFreqRms * 0.35;

    const targetGain = clamp(0.45 / Math.max(0.04, baseEnergyNormalized), 1.05, 3.6);
    this.calibratedGain = followEnvelope(this.calibratedGain, targetGain, 1.6, 0.5, dt);
    const tunedGain = this.calibratedGain * this.tuning.micSensitivity;
    const signalFloorMultiplier = clamp(CONFIG.audio.inputFloorMultiplier ?? 0.5, 0.1, 0.9);

    const scaledBass = rawBass * tunedGain;
    const scaledLowMid = rawLowMid * tunedGain;
    const scaledMids = rawMids * tunedGain;
    const scaledHighs = rawHighs * tunedGain;
    const scaledAir = rawAir * tunedGain;
    const scaledGuitar = rawGuitar * tunedGain;
    const scaledRms = rms * tunedGain;

    const bassWeight = clamp(this.tuning.bassWeight ?? 0.26, 0, 1.2);
    const midsWeight = clamp(this.tuning.midsWeight ?? 0.2, 0, 1.2);
    const highsWeight = clamp(this.tuning.highsWeight ?? 0.1, 0, 1.2);

    const observedEnergyUnclamped =
      scaledBass * bassWeight +
        scaledLowMid * 0.14 +
        scaledMids * midsWeight +
        scaledHighs * highsWeight +
        scaledRms * 0.78;
    const observedEnergy = clamp(observedEnergyUnclamped, 0, 1);

    const adaptiveCfg = CONFIG.audio.adaptiveNoiseFloor ?? {};
    const floorRiseSeconds = Math.max(6, adaptiveCfg.riseSeconds ?? 9);
    const floorFallSeconds = Math.max(6, adaptiveCfg.fallSeconds ?? 7);
    const riseAlpha = 1 - Math.exp(-dt / floorRiseSeconds);
    const fallAlpha = 1 - Math.exp(-dt / floorFallSeconds);
    const captureHeadroom = clamp(adaptiveCfg.captureHeadroom ?? 0.03, 0.005, 0.08);
    const floorCandidate = Math.min(observedEnergy, this.baselineEnergy + captureHeadroom);
    const burstSuppression = clamp(adaptiveCfg.burstRiseSuppress ?? 0.12, 0.02, 1);
    const floorAlpha = floorCandidate > this.baselineEnergy ? riseAlpha * burstSuppression : fallAlpha;
    const manualBaselineCfg = CONFIG.audio.manualBaseline ?? {};
    const learningSeconds = clamp(manualBaselineCfg.learningSeconds ?? 2.0, 1, 3);
    const minSamples = Math.max(10, manualBaselineCfg.minSamples ?? 25);
    if (this.baselineLearning) {
      this.baselineLearningElapsed += dt;
      this.baselineSamples.push(clamp(observedEnergy, 0, 1));
      if (this.baselineSamples.length > 240) this.baselineSamples.shift();
      const learnedBaseline = this.computeLearnedBaseline();
      this.baselineLearningValue = learnedBaseline;
      this.baselineEnergy = learnedBaseline;
      if (this.baselineLearningElapsed >= learningSeconds && this.baselineSamples.length >= minSamples) {
        this.lockBaseline();
      }
    } else if (!this.baselineLocked) {
      this.baselineEnergy = clamp(
        this.baselineEnergy + (floorCandidate - this.baselineEnergy) * floorAlpha,
        0,
        0.95
      );
    } else {
      this.baselineEnergy = clamp(this.lockedBaselineValue ?? this.baselineEnergy, 0, 0.95);
    }
    const bandRiseSeconds = Math.max(6, adaptiveCfg.bandRiseSeconds ?? 10);
    const bandFallSeconds = Math.max(6, adaptiveCfg.bandFallSeconds ?? 8);
    const bandRiseAlpha = (1 - Math.exp(-dt / bandRiseSeconds)) * burstSuppression;
    const bandFallAlpha = 1 - Math.exp(-dt / bandFallSeconds);
    const bandCaptureHeadroom = clamp(adaptiveCfg.bandCaptureHeadroom ?? 0.035, 0.008, 0.12);
    const updateBandFloor = (key, value) => {
      const currentFloor = this.bandNoiseFloor[key] ?? 0.01;
      if (this.baselineLocked) return clamp(currentFloor, 0, 0.95);
      const candidate = Math.min(value, currentFloor + bandCaptureHeadroom);
      const alpha = candidate > currentFloor ? bandRiseAlpha : bandFallAlpha;
      this.bandNoiseFloor[key] = clamp(currentFloor + (candidate - currentFloor) * alpha, 0, 0.95);
      return this.bandNoiseFloor[key];
    };

    const bassFloor = updateBandFloor("bass", scaledBass);
    const lowMidFloor = updateBandFloor("lowMid", scaledLowMid);
    const midsFloor = updateBandFloor("mids", scaledMids);
    const highsFloor = updateBandFloor("highs", scaledHighs);
    const airFloor = updateBandFloor("air", scaledAir);
    const guitarFloor = updateBandFloor("guitar", scaledGuitar);

    this.noiseFloor = this.noiseFloor * 0.995 + this.baselineEnergy * 0.005;

    const floorBias = clamp(adaptiveCfg.bias ?? 0.012, 0.002, 0.05);
    const activeAboveFloor = clamp(adaptiveCfg.activeAboveFloor ?? 0.018, 0.005, 0.08);
    const floorAdjusted = this.baselineEnergy + floorBias;
    const deadZone = clamp(adaptiveCfg.deadZone ?? 0.014, 0.008, 0.03);
    const preGainSignal = clamp(baseEnergyNormalized, 0, 1);
    const postGainSignal = clamp(preGainSignal * tunedGain, 0, 1.5);
    const rmsSignal = Math.max(0, scaledRms - floorAdjusted);
    const floorSignal = preGainSignal * signalFloorMultiplier;
    const signalWithFloor = Math.max(rmsSignal, floorSignal);
    this.trueSignal = signalWithFloor < deadZone ? 0 : signalWithFloor;
    this.activeAboveBaseline = this.trueSignal >= activeAboveFloor;
    const signalCeiling = clamp(adaptiveCfg.signalCeiling ?? 0.2, 0.06, 0.45);
    this.raw.rms = floorSubtractNormalize(signalWithFloor, 0, signalCeiling, deadZone);
    this.raw.energy = this.raw.rms;
    const signalEnergy = this.raw.energy;

    const bandSignalCeiling = clamp(adaptiveCfg.bandSignalCeiling ?? 0.28, 0.08, 0.6);
    this.raw.bass = floorSubtractNormalize(scaledBass, bassFloor + floorBias, bandSignalCeiling, deadZone);
    this.raw.lowMid = floorSubtractNormalize(scaledLowMid, lowMidFloor + floorBias, bandSignalCeiling, deadZone);
    this.raw.mids = floorSubtractNormalize(scaledMids, midsFloor + floorBias, bandSignalCeiling, deadZone);
    this.raw.highs = floorSubtractNormalize(scaledHighs, highsFloor + floorBias, bandSignalCeiling, deadZone);
    this.raw.air = floorSubtractNormalize(scaledAir, airFloor + floorBias, bandSignalCeiling, deadZone);
    this.raw.guitar = floorSubtractNormalize(scaledGuitar, guitarFloor + floorBias, bandSignalCeiling, deadZone);
    const positiveDelta = Math.max(0, this.raw.energy - this.lastEnergy);
    this.raw.onset = clamp((positiveDelta * 5.5 + Math.max(0, this.raw.rms - 0.25) * 0.25) * this.tuning.audioReactivity, 0, 1);
    this.raw.peak = clamp((peakNorm * 0.55 + this.raw.onset * 0.45) * this.tuning.peakIntensity, 0, 1);
    if (!this.activeAboveBaseline) {
      this.raw.onset *= 0.15;
      this.raw.peak *= 0.2;
    }
    const sustainTarget = clamp(
      this.raw.rms * 0.66 +
        this.raw.lowMid * 0.14 +
        this.raw.mids * 0.12 +
        this.raw.guitar * 0.08,
      0,
      1
    );
    const sustainWindowSeconds = 0.52;
    const sustainAttackHz = 1 / Math.max(0.2, sustainWindowSeconds * 0.7);
    const sustainReleaseHz = 1 / Math.max(0.3, sustainWindowSeconds * 1.4);
    this.smooth.sustainEnergy = followEnvelope(
      this.smooth.sustainEnergy,
      sustainTarget,
      sustainAttackHz,
      sustainReleaseHz,
      dt
    );
    const sustainSilenceLift = this.smooth.sustainEnergy * 1.18;
    this.raw.silence = clamp(1 - Math.max(this.raw.energy * 1.6, sustainSilenceLift), 0, 1);
    if (!this.activeAboveBaseline && this.raw.energy < this.tuning.noiseGate) {
      this.raw.energy = 0;
      this.raw.onset = 0;
      this.raw.peak = 0;
      this.raw.silence = 1;
    }
    this.lastEnergy = this.raw.energy;
    const gatedEnergy = this.raw.energy;

    const smoothingMul = clamp(1.2 - (this.tuning.smoothing ?? 0.18), 0.2, 2.0);
    this.smooth.bass = followEnvelope(this.smooth.bass, this.raw.bass, 12 * smoothingMul, 5 * smoothingMul, dt);
    this.smooth.lowMid = followEnvelope(this.smooth.lowMid, this.raw.lowMid, 11 * smoothingMul, 4.5 * smoothingMul, dt);
    this.smooth.mids = followEnvelope(this.smooth.mids, this.raw.mids, 12 * smoothingMul, 5 * smoothingMul, dt);
    this.smooth.highs = followEnvelope(this.smooth.highs, this.raw.highs, 14 * smoothingMul, 6.2 * smoothingMul, dt);
    this.smooth.air = followEnvelope(this.smooth.air, this.raw.air, 14 * smoothingMul, 6.8 * smoothingMul, dt);
    this.smooth.guitar = followEnvelope(this.smooth.guitar, this.raw.guitar, 12 * smoothingMul, 5 * smoothingMul, dt);
    this.smooth.energy = followEnvelope(this.smooth.energy, this.raw.energy, 8.5 * smoothingMul, 2.8 * smoothingMul, dt);
    this.smooth.onset = followEnvelope(this.smooth.onset, this.raw.onset, 28 * smoothingMul, 7 * smoothingMul, dt);
    this.smooth.peak = followEnvelope(this.smooth.peak, this.raw.peak, 24 * smoothingMul, 5 * smoothingMul, dt);
    this.smooth.silence = followEnvelope(this.smooth.silence, this.raw.silence, 6 * smoothingMul, 3 * smoothingMul, dt);

    const safeEnergy = finiteOr(this.smooth.energy, 0);
    const safeOnset = finiteOr(this.smooth.onset, 0);
    const safePeak = finiteOr(this.smooth.peak, 0);
    const safeSustain = finiteOr(this.smooth.sustainEnergy, 0);
    const safeMids = finiteOr(this.smooth.mids, 0);
    const safeHighs = finiteOr(this.smooth.highs, 0);
    const bassDeltaRaw = Math.max(0, this.raw.bass - this.smooth.bass);
    this.pulse.bassDelta = followEnvelope(this.pulse.bassDelta, bassDeltaRaw, 22, 7, dt);
    const onsetSeed = clamp(safeOnset * 0.86 + this.pulse.bassDelta * 0.9 + safePeak * 0.12, 0, 1);
    this.pulse.onsetEnvelope = followEnvelope(this.pulse.onsetEnvelope, onsetSeed, 26, 7, dt);
    const grooveSeed = clamp(
      this.smooth.bass * 0.52 +
        this.smooth.lowMid * 0.2 +
        this.smooth.mids * 0.14 +
        safeOnset * 0.32 +
        this.pulse.bassDelta * 0.16,
      0,
      1
    );
    this.pulse.grooveEnvelope = followEnvelope(this.pulse.grooveEnvelope, grooveSeed, 8.5, 3.4, dt);
    const pulseComposite = clamp(this.pulse.onsetEnvelope * 0.64 + this.pulse.grooveEnvelope * 0.36, 0, 1);
    this.pulse.shortPulse = followEnvelope(this.pulse.shortPulse, pulseComposite, 12, 4.5, dt);
    this.pulse.longPulse = followEnvelope(this.pulse.longPulse, pulseComposite, 2.8, 1.25, dt);
    const musicStructure = this.evaluateMusicStructure({
      dt,
      onset: safeOnset,
      pulse: pulseComposite,
      bass: this.smooth.bass,
      lowMid: this.smooth.lowMid,
      mids: this.smooth.mids,
      highs: this.smooth.highs,
      trueSignal: this.trueSignal,
      activeAboveFloor,
    });
    const structureActive = !!musicStructure.active;
    const confidence = finiteOr(musicStructure.confidence, 0);
    const sustainThreshold = clamp(this.tuning.sustainThreshold ?? Math.max(this.tuning.noiseGate * 0.82, 0.055), 0.02, 0.4);
    const transientLevel = clamp(safeOnset * 0.62 + safePeak * 0.38, 0, 1);
    const transientActive = transientLevel > 0.085;
    const sustainActive = safeSustain > sustainThreshold;
    const signalLevel = clamp(this.trueSignal / Math.max(1e-5, activeAboveFloor * 2.4), 0, 1);
    const activateThreshold = clamp(this.tuning.activateThreshold ?? 0.34, 0.05, 1);
    const deactivateThreshold = clamp(this.tuning.deactivateThreshold ?? 0.2, 0.01, activateThreshold);
    const strongSignal = signalLevel >= activateThreshold;
    if (strongSignal) {
      this.lastStrongSignalAt = now;
    }
    const recentActivityWindowSeconds = 1.6;
    const timeSinceLastStrongSignal = this.lastStrongSignalAt > 0 ? (now - this.lastStrongSignalAt) / 1000 : Infinity;
    const recentActivity = timeSinceLastStrongSignal <= recentActivityWindowSeconds;
    if (this.signalLatchActive) {
      this.signalLatchActive = signalLevel >= deactivateThreshold;
    } else if (strongSignal) {
      this.signalLatchActive = true;
    }
    const signalAboveBaseline = this.activeAboveBaseline && this.signalLatchActive;
    const motionGateTarget = signalAboveBaseline && (sustainActive || recentActivity);
    const motionEnableSeconds = Math.max(0.01, (this.tuning.holdTime ?? 90) / 1000);
    const motionDisableSeconds = Math.max(0.01, (this.tuning.fadeTime ?? 260) / 1000);
    if (motionGateTarget) {
      this.motionEnableHold = Math.min(motionEnableSeconds, this.motionEnableHold + dt);
      if (this.motionEnableHold >= motionEnableSeconds) {
        this.motionEnabled = true;
      }
    } else {
      this.motionEnableHold = Math.max(-motionDisableSeconds, this.motionEnableHold - dt);
      if (this.motionEnableHold <= -motionDisableSeconds) {
        this.motionEnabled = false;
      }
    }
    this.hardSilence = !this.motionEnabled;
    this.motionDecision = {
      signalAboveBaseline,
      sustainActive,
      transientActive,
      recentActivity,
      strongSignal,
      sustainEnergy: safeSustain,
      sustainThreshold,
      transientLevel,
      activateThreshold,
      deactivateThreshold,
      timeSinceLastStrongSignal: Number.isFinite(timeSinceLastStrongSignal) ? timeSinceLastStrongSignal : -1,
    };
    const silenceGate = clamp((1 - this.smooth.silence - 0.08) / 0.28, 0, 1);
    const activityGateTarget = signalAboveBaseline ? clamp(0.35 + confidence * 0.65, 0, 1) : 0;
    this.pulse.motionGate = followEnvelope(this.pulse.motionGate, activityGateTarget, 8, 5.5, dt);
    const activityGate = this.pulse.motionGate;
    let pulseDriveTarget =
      clamp(this.pulse.shortPulse * 0.76 + this.pulse.longPulse * 0.24, 0, 1.3) * silenceGate * activityGate;
    const hardIdle = !this.motionEnabled;
    if (hardIdle) {
      pulseDriveTarget = 0;
      this.pulse.motionGate = 0;
      this.pulse.phaseGate = 0;
    }

    const motionAdvancing = pulseDriveTarget > 0.012;
    this.pulse.phaseGate = followEnvelope(this.pulse.phaseGate, motionAdvancing ? 1 : 0, 20, 10, dt);
    this.motion.pulseDrive = hardIdle ? 0 : followEnvelope(this.motion.pulseDrive, pulseDriveTarget, 15, 4.8, dt);
    this.motion.pulseDrive = clamp(this.motion.pulseDrive, 0, 1.3);
    this.motion.renderSpeed = this.motion.pulseDrive;
    this.motion.speed = this.motion.pulseDrive;
    this.motion.detail = clamp(
      safeMids * 0.08 + safeHighs * 0.11,
      0,
      0.45
    );
    const compressedBurst = clamp(safeOnset * 0.6 + safePeak * 0.4, 0, 1);
    this.motion.burst = clamp(compressedBurst, 0, 1);

    const effectiveDrive = clamp(finiteOr(this.motion.pulseDrive, 0), 0, 1.5);

    this.raw.transport = effectiveDrive;
    this.smooth.transport = followEnvelope(this.smooth.transport, effectiveDrive, 9, 3.2, dt);
    this.smooth.transport = finiteOr(this.smooth.transport, 0);
    const rawTransport = hardIdle ? 0 : clamp(this.smooth.transport, 0, 1);
    const responseCurve = clamp(this.tuning.responseCurve ?? 1.5, 1, 2.5);
    this.transport = clamp(Math.pow(rawTransport, responseCurve), 0, 1);
    const motionScale = clamp(this.tuning.motionScale ?? 0.35, 0, 2);
    const baseFlow = clamp(this.tuning.baseFlow ?? 0.02, 0, 1);
    const maxSpeed = clamp(this.tuning.maxSpeed ?? 0.6, 0.01, 2);
    const finalTransport = this.transport * motionScale;
    const finalMotion = this.motionEnabled ? Math.min(baseFlow + finalTransport, maxSpeed) : 0;
    const phaseSeed = finiteOr(this.motionPhase, 0);
    this.motionPhase = phaseSeed + finalMotion * dt;
    this.transportPhase = this.motionPhase % 1;
    this.transportPhase = finiteOr(this.transportPhase, 0);
    this.motionFrozen = !this.motionEnabled || finalMotion <= 1e-6;

    const signalMix = clamp(this.trueSignal / Math.max(1e-5, signalCeiling), 0, 1);
    const reactiveMix = signalMix;
    const reactiveBass = clamp(this.smooth.bass * reactiveMix, 0, 1);
    const reactiveLowMid = clamp(this.smooth.lowMid * reactiveMix, 0, 1);
    const reactiveMids = clamp(this.smooth.mids * reactiveMix, 0, 1);
    const reactiveHighs = clamp(this.smooth.highs * reactiveMix, 0, 1);
    const reactiveGuitar = clamp(this.smooth.guitar * reactiveMix, 0, 1);
    const reactiveAir = clamp(this.smooth.air * reactiveMix, 0, 1);
    const reactiveOnset = clamp(this.smooth.onset * reactiveMix, 0, 1);
    const reactivePeak = clamp(this.smooth.peak * reactiveMix, 0, 1);
    const reactiveEnergy = clamp(this.smooth.energy * reactiveMix, 0, 1);

    this.debugState = {
      initialized: this.ready,
      live: this.live,
      ctxState: this.ctx?.state ?? "unknown",
      streamActive: (this.stream?.getAudioTracks?.() ?? []).some((track) => track.readyState === "live"),
      fftSize: this.analyser?.fftSize ?? 0,
      freqBinCount: this.analyser?.frequencyBinCount ?? 0,
      firstBins: Array.from(this.freqData.slice(0, 8)).map((v) => Number((v / 255).toFixed(3))),
      rmsRaw: rms,
      bassRaw: rawBass,
      lowMidRaw: rawLowMid,
      midsRaw: rawMids,
      highsRaw: rawHighs,
      observedEnergy,
      normalizedFreqRms,
      preGainSignal,
      postGainSignal,
      finalSignal: this.trueSignal,
      rawEnergy: this.raw.energy,
      signalEnergy,
      gatedEnergy,
      bass: reactiveBass,
      mids: reactiveMids,
      highs: reactiveHighs,
      smoothedEnergy: reactiveEnergy,
      sustainEnergy: safeSustain,
      sustainThreshold,
      pulseDrive: this.motion.pulseDrive,
      energyLevel: reactiveEnergy,
      transport: this.transport,
      transportRaw: rawTransport,
      finalTransport,
      finalMotion,
      motionScale,
      baseFlow,
      maxSpeed,
      onset: reactiveOnset,
      silence: this.smooth.silence,
      motionSpeed: this.motion.speed,
      detailSpeed: this.motion.detail,
      burstSpeed: this.motion.burst,
      motionPhaseAdvancing: motionAdvancing,
      motionEnabled: this.motionEnabled,
      hardSilence: this.hardSilence,
      motionFrozen: this.motionFrozen,
      noiseFloor: this.baselineEnergy,
      trueSignal: this.trueSignal,
      activeAboveBaseline: this.activeAboveBaseline,
      motionDecision: { ...this.motionDecision },
      rhythmConfidence: confidence,
      rhythmActive: structureActive,
      motionTime: this.motionPhase,
      activateThreshold,
      deactivateThreshold,
      holdTimeMs: this.tuning.holdTime ?? 0,
      fadeTimeMs: this.tuning.fadeTime ?? 0,
      baselineLearning: this.baselineLearning,
      baselineLocked: this.baselineLocked,
      lockedBaselineValue: this.lockedBaselineValue ?? 0,
      baselineValue: this.baselineEnergy,
      modeParameters: { ...this.tuning, bassWeight, midsWeight, highsWeight },
    };

    if (CONFIG.audio.debugTransport && now - this.lastDebugAt > 400) {
      this.lastDebugAt = now;
      let analyserProbe = 0;
      if (this.floatTimeData && this.analyser) {
        this.analyser.getFloatTimeDomainData(this.floatTimeData);
        for (let i = 0; i < this.floatTimeData.length; i++) {
          analyserProbe += Math.abs(this.floatTimeData[i]);
        }
        analyserProbe /= Math.max(1, this.floatTimeData.length);
      }
      console.debug("[audio-debug]", {
        initialized: this.debugState.initialized,
        live: this.debugState.live,
        ctxState: this.debugState.ctxState,
        streamActive: this.debugState.streamActive,
        fftSize: this.debugState.fftSize,
        freqBinCount: this.debugState.freqBinCount,
        firstBins: this.debugState.firstBins,
        rmsRaw: Number(this.debugState.rmsRaw.toFixed(6)),
        bassRaw: Number(this.debugState.bassRaw.toFixed(6)),
        lowMidRaw: Number(this.debugState.lowMidRaw.toFixed(6)),
        midsRaw: Number(this.debugState.midsRaw.toFixed(6)),
        highsRaw: Number(this.debugState.highsRaw.toFixed(6)),
        observedEnergy: Number(this.debugState.observedEnergy.toFixed(3)),
        normalizedFreqRms: Number((this.debugState.normalizedFreqRms ?? 0).toFixed(6)),
        preGainSignal: Number((this.debugState.preGainSignal ?? 0).toFixed(6)),
        postGainSignal: Number((this.debugState.postGainSignal ?? 0).toFixed(6)),
        finalSignal: Number((this.debugState.finalSignal ?? 0).toFixed(6)),
        rawEnergy: Number(this.debugState.rawEnergy.toFixed(3)),
        signalEnergy: Number(this.debugState.signalEnergy.toFixed(3)),
        gatedEnergy: Number(this.debugState.gatedEnergy.toFixed(3)),
        bass: Number(this.debugState.bass.toFixed(3)),
        mids: Number(this.debugState.mids.toFixed(3)),
        highs: Number(this.debugState.highs.toFixed(3)),
        smoothedEnergy: Number(this.debugState.smoothedEnergy.toFixed(3)),
        sustainEnergy: Number((this.debugState.sustainEnergy ?? 0).toFixed(3)),
        sustainThreshold: Number((this.debugState.sustainThreshold ?? 0).toFixed(3)),
        motionDecision: this.debugState.motionDecision ?? {},
        transport: Number(this.debugState.transport.toFixed(3)),
        transportRaw: Number((this.debugState.transportRaw ?? 0).toFixed(3)),
        onset: Number(this.debugState.onset.toFixed(3)),
        silence: Number(this.debugState.silence.toFixed(3)),
        noiseFloor: Number(this.debugState.noiseFloor.toFixed(3)),
        trueSignal: Number(this.debugState.trueSignal.toFixed(3)),
        activeAboveBaseline: this.debugState.activeAboveBaseline,
        rhythmConfidence: Number((this.debugState.rhythmConfidence ?? 0).toFixed(3)),
        rhythmActive: !!this.debugState.rhythmActive,
        motionEnabled: this.debugState.motionEnabled,
        hardSilence: this.debugState.hardSilence,
        motionFrozen: this.debugState.motionFrozen,
        analyserProbe: Number(analyserProbe.toFixed(6)),
        binsPopulated: binPopulation,
        timeSample: this.floatTimeData
          ? Array.from(this.floatTimeData.slice(0, 6)).map((v) => Number(v.toFixed(4)))
          : [],
      });
    }

    return {
      bass: reactiveBass,
      lowMid: reactiveLowMid,
      mids: reactiveMids,
      highs: reactiveHighs,
      guitar: reactiveGuitar,
      air: reactiveAir,
      energy: reactiveEnergy,
      energyLevel: reactiveEnergy,
      sustainEnergy: safeSustain,
      sustainThreshold,
      pulseDrive: clamp(this.motion.pulseDrive, 0, 1.5),
      transport: clamp(this.transport, 0, 1),
      finalTransport: clamp(finalTransport, 0, 4),
      finalMotion: clamp(finalMotion, 0, 4),
      motionScale,
      baseFlow,
      maxSpeed,
      transportRaw: clamp(rawTransport, 0, 1),
      renderSpeed: clamp(this.motion.renderSpeed, 0, 1.35),
      onset: reactiveOnset,
      peak: reactivePeak,
      silence: clamp(this.smooth.silence, 0, 1),
      noiseFloor: clamp(this.baselineEnergy, 0, 1),
      trueSignal: clamp(this.trueSignal, 0, 1),
      activeAboveBaseline: this.activeAboveBaseline,
      motionDecision: { ...this.motionDecision },
      motionTime: finiteOr(this.motionPhase, 0),
      motionSpeed: clamp(this.motion.speed, 0, 1.5),
      detailSpeed: clamp(this.motion.detail, 0, 1),
      burstSpeed: clamp(this.motion.burst, 0, 1),
      motionPhaseAdvancing: motionAdvancing,
      motionEnabled: this.motionEnabled,
      hardSilence: this.hardSilence,
      motionFrozen: this.motionFrozen,
      activateThreshold,
      deactivateThreshold,
      holdTimeMs: this.tuning.holdTime ?? 0,
      fadeTimeMs: this.tuning.fadeTime ?? 0,
      baselineLearning: this.baselineLearning,
      baselineLocked: this.baselineLocked,
      lockedBaselineValue: this.lockedBaselineValue ?? 0,
      baselineValue: this.baselineEnergy,
      modeParameters: { ...this.tuning, bassWeight, midsWeight, highsWeight },
    };
  }
}
