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

function normalizeBand(v, floor = 0.02, ceiling = 0.36) {
  return clamp((v - floor) / Math.max(1e-5, ceiling - floor), 0, 1);
}

function computePeakNorm(freqData) {
  if (!freqData || freqData.length === 0) return 0;
  let peak = 0;
  for (let i = 0; i < freqData.length; i++) {
    if (freqData[i] > peak) peak = freqData[i];
  }
  return peak / 255;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;

    this.freqData = null;
    this.timeData = null;

    this.ready = false;
    this.live = false;
    this.lastEnergy = 0;

    this.transport = 0;
    this.transportPhase = 0;
    this.motionPhase = 0;
    this.motionEnabled = false;
    this.hardSilence = true;
    this.motionFrozen = true;
    this.signalActive = false;
    this.music = {
      active: false,
      confidence: 0,
      hold: 0,
      history: [],
      prevSpectrum: null,
    };

    this.lastUpdateAt = performance.now();
    this.lastDebugAt = 0;

    this.noiseFloor = 0.01;
    this.baselineEnergy = 0.02;
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
      guitar: 0,
      air: 0,
      transport: 0,
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

    this.debugState = {
      initialized: false,
      live: false,
      observedEnergy: 0,
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
      motionPhaseAdvancing: false,
      motionEnabled: false,
      hardSilence: true,
      motionFrozen: true,
      signalActive: false,
      rhythmConfidence: 0,
      musicActive: false,
      noiseFloor: 0,
      trueSignal: 0,
      activeAboveBaseline: false,
      motionTime: 0,
    };
  }

  async start() {
    if (this.ready && this.ctx && this.ctx.state !== "closed") {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      this.live = true;
      this.debugState.initialized = true;
      this.debugState.live = true;
      return;
    }

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: CONFIG.audio.echoCancellation,
        noiseSuppression: CONFIG.audio.noiseSuppression,
        autoGainControl: CONFIG.audio.autoGainControl,
      },
      video: false,
    });

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = CONFIG.audio.fftSize;
    this.analyser.smoothingTimeConstant = this.tuning.smoothing;

    this.source.connect(this.analyser);

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);

    this.lastUpdateAt = performance.now();
    this.lastDebugAt = this.lastUpdateAt;
    this.ready = true;
    this.live = true;
    this.debugState.initialized = true;
    this.debugState.live = true;
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
    if (this.analyser) {
      this.analyser.smoothingTimeConstant = clamp(this.tuning.smoothing, 0, 0.95);
    }
  }

  getTuning() {
    return { ...this.tuning };
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
        signalActive: false,
        rhythmConfidence: 0,
        musicActive: false,
      };
      this.debugState = {
        initialized: this.ready,
        live: this.live,
        observedEnergy: 0,
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
        onset: idle.onset,
        silence: idle.silence,
        motionPhaseAdvancing: false,
        motionEnabled: false,
        hardSilence: true,
        motionFrozen: true,
        signalActive: false,
        rhythmConfidence: 0,
        musicActive: false,
        noiseFloor: 0,
        trueSignal: 0,
        activeAboveBaseline: false,
        motionTime: 0,
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

    const baseEnergy =
      rawBass * 0.36 +
      rawLowMid * 0.2 +
      rawMids * 0.24 +
      rawHighs * 0.1 +
      rms * 0.95 +
      peakNorm * 0.1;

    const targetGain = clamp(0.45 / Math.max(0.06, baseEnergy), 0.9, 2.8);
    this.calibratedGain = followEnvelope(this.calibratedGain, targetGain, 1.6, 0.5, dt);
    const tunedGain = this.calibratedGain * this.tuning.micSensitivity;

    this.raw.bass = normalizeBand(rawBass * tunedGain, 0.03, 0.82);
    this.raw.lowMid = normalizeBand(rawLowMid * tunedGain, 0.03, 0.78);
    this.raw.mids = normalizeBand(rawMids * tunedGain, 0.03, 0.8);
    this.raw.highs = normalizeBand(rawHighs * tunedGain, 0.02, 0.75);
    this.raw.air = normalizeBand(rawAir * tunedGain, 0.02, 0.75);
    this.raw.guitar = normalizeBand(rawGuitar * tunedGain, 0.03, 0.8);
    this.raw.rms = normalizeBand(rms * tunedGain, this.noiseFloor * 0.85, 0.4);

    const observedEnergy = clamp(
      this.raw.bass * 0.34 +
        this.raw.lowMid * 0.16 +
        this.raw.mids * 0.22 +
        this.raw.highs * 0.1 +
        this.raw.rms * 0.3,
      0,
      1
    );

    const adaptiveCfg = CONFIG.audio.adaptiveNoiseFloor ?? {};
    const floorRiseSeconds = Math.max(6, adaptiveCfg.riseSeconds ?? 9);
    const floorFallSeconds = Math.max(6, adaptiveCfg.fallSeconds ?? 7);
    const riseAlpha = 1 - Math.exp(-dt / floorRiseSeconds);
    const fallAlpha = 1 - Math.exp(-dt / floorFallSeconds);
    const captureHeadroom = clamp(adaptiveCfg.captureHeadroom ?? 0.03, 0.005, 0.08);
    const floorCandidate = Math.min(observedEnergy, this.baselineEnergy + captureHeadroom);
    const burstSuppression = clamp(adaptiveCfg.burstRiseSuppress ?? 0.12, 0.02, 1);
    const floorAlpha = floorCandidate > this.baselineEnergy ? riseAlpha * burstSuppression : fallAlpha;
    this.baselineEnergy = clamp(
      this.baselineEnergy + (floorCandidate - this.baselineEnergy) * floorAlpha,
      0,
      0.95
    );
    this.noiseFloor = this.noiseFloor * 0.995 + this.baselineEnergy * 0.005;

    const floorBias = clamp(adaptiveCfg.bias ?? 0.012, 0.002, 0.05);
    const activeAboveFloor = clamp(adaptiveCfg.activeAboveFloor ?? 0.018, 0.005, 0.08);
    const floorAdjusted = this.baselineEnergy + floorBias;
    this.trueSignal = Math.max(0, observedEnergy - floorAdjusted);
    this.activeAboveBaseline = this.trueSignal >= activeAboveFloor;
    const signalCeiling = clamp(adaptiveCfg.signalCeiling ?? 0.2, 0.06, 0.45);
    this.raw.energy = clamp(this.trueSignal / signalCeiling, 0, 1);
    const signalEnergy = this.raw.energy;
    const signalActiveEnter = Math.max(activeAboveFloor * 1.2, 0.02);
    const signalActiveExit = Math.max(activeAboveFloor * 0.7, 0.012);
    if (this.trueSignal >= signalActiveEnter) {
      this.signalActive = true;
    } else if (this.trueSignal <= signalActiveExit) {
      this.signalActive = false;
    }

    const positiveDelta = Math.max(0, this.raw.energy - this.lastEnergy);
    this.raw.onset = clamp((positiveDelta * 5.5 + Math.max(0, this.raw.rms - 0.25) * 0.25) * this.tuning.audioReactivity, 0, 1);
    this.raw.peak = clamp((peakNorm * 0.55 + this.raw.onset * 0.45) * this.tuning.peakIntensity, 0, 1);
    if (!this.activeAboveBaseline) {
      this.raw.onset *= 0.15;
      this.raw.peak *= 0.2;
    }
    this.raw.silence = clamp(1 - this.raw.energy * 1.6, 0, 1);
    if (!this.activeAboveBaseline && this.raw.energy < this.tuning.noiseGate) {
      this.raw.energy = 0;
      this.raw.onset = 0;
      this.raw.peak = 0;
      this.raw.silence = 1;
    }
    this.lastEnergy = this.raw.energy;
    const gatedEnergy = this.raw.energy;

    const smoothingMul = clamp(1.2 - this.tuning.smoothing, 0.2, 2.0);
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
    this.motionEnabled = this.signalActive && musicStructure.active;
    this.hardSilence = !this.motionEnabled;
    const silenceGate = clamp((1 - this.smooth.silence - 0.08) / 0.28, 0, 1);
    const activityGateTarget = this.activeAboveBaseline ? 1 : 0;
    this.pulse.motionGate = followEnvelope(this.pulse.motionGate, activityGateTarget, 8, 5.5, dt);
    const activityGate = this.pulse.motionGate;
    let pulseDriveTarget =
      clamp(this.pulse.shortPulse * 0.76 + this.pulse.longPulse * 0.24, 0, 1.3) * silenceGate * activityGate;
    const hardIdle = this.hardSilence;
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
    const phaseSeed = finiteOr(this.motionPhase, 0);
    this.motionPhase = hardIdle ? phaseSeed : phaseSeed + effectiveDrive * this.pulse.phaseGate * dt;
    this.motionFrozen = hardIdle || effectiveDrive <= 1e-6 || this.pulse.phaseGate <= 1e-6;
    this.transportPhase = this.motionPhase % 1;
    this.transportPhase = finiteOr(this.transportPhase, 0);

    this.raw.transport = effectiveDrive;
    this.smooth.transport = followEnvelope(this.smooth.transport, effectiveDrive, 9, 3.2, dt);
    this.smooth.transport = finiteOr(this.smooth.transport, 0);
    this.transport = hardIdle ? 0 : clamp(this.smooth.transport, 0, 1);

    const signalMix = clamp(this.trueSignal / Math.max(1e-5, signalCeiling), 0, 1);
    const reactiveMix = hardIdle ? 0 : signalMix;
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
      observedEnergy,
      rawEnergy: this.raw.energy,
      signalEnergy,
      gatedEnergy,
      bass: reactiveBass,
      mids: reactiveMids,
      highs: reactiveHighs,
      smoothedEnergy: reactiveEnergy,
      pulseDrive: this.motion.pulseDrive,
      energyLevel: reactiveEnergy,
      transport: this.transport,
      onset: reactiveOnset,
      silence: this.smooth.silence,
      motionSpeed: this.motion.speed,
      detailSpeed: this.motion.detail,
      burstSpeed: this.motion.burst,
      motionPhaseAdvancing: motionAdvancing,
      motionEnabled: this.motionEnabled,
      hardSilence: this.hardSilence,
      motionFrozen: this.motionFrozen,
      signalActive: this.signalActive,
      rhythmConfidence: this.music.confidence,
      musicActive: this.music.active,
      noiseFloor: this.baselineEnergy,
      trueSignal: this.trueSignal,
      activeAboveBaseline: this.activeAboveBaseline,
      motionTime: this.motionPhase,
    };

    if (CONFIG.audio.debugTransport && now - this.lastDebugAt > 400) {
      this.lastDebugAt = now;
      console.debug("[audio-debug]", {
        initialized: this.debugState.initialized,
        live: this.debugState.live,
        observedEnergy: Number(this.debugState.observedEnergy.toFixed(3)),
        rawEnergy: Number(this.debugState.rawEnergy.toFixed(3)),
        signalEnergy: Number(this.debugState.signalEnergy.toFixed(3)),
        gatedEnergy: Number(this.debugState.gatedEnergy.toFixed(3)),
        bass: Number(this.debugState.bass.toFixed(3)),
        mids: Number(this.debugState.mids.toFixed(3)),
        highs: Number(this.debugState.highs.toFixed(3)),
        smoothedEnergy: Number(this.debugState.smoothedEnergy.toFixed(3)),
        transport: Number(this.debugState.transport.toFixed(3)),
        onset: Number(this.debugState.onset.toFixed(3)),
        silence: Number(this.debugState.silence.toFixed(3)),
        noiseFloor: Number(this.debugState.noiseFloor.toFixed(3)),
        trueSignal: Number(this.debugState.trueSignal.toFixed(3)),
        activeAboveBaseline: this.debugState.activeAboveBaseline,
        motionEnabled: this.debugState.motionEnabled,
        hardSilence: this.debugState.hardSilence,
        motionFrozen: this.debugState.motionFrozen,
        signalActive: this.debugState.signalActive,
        rhythmConfidence: Number(this.debugState.rhythmConfidence.toFixed(3)),
        musicActive: this.debugState.musicActive,
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
      pulseDrive: clamp(this.motion.pulseDrive, 0, 1.5),
      transport: clamp(this.transport, 0, 1),
      renderSpeed: clamp(this.motion.renderSpeed, 0, 1.35),
      onset: reactiveOnset,
      peak: reactivePeak,
      silence: clamp(this.smooth.silence, 0, 1),
      noiseFloor: clamp(this.baselineEnergy, 0, 1),
      trueSignal: clamp(this.trueSignal, 0, 1),
      activeAboveBaseline: this.activeAboveBaseline,
      motionTime: finiteOr(this.motionPhase, 0),
      motionSpeed: clamp(this.motion.speed, 0, 1.5),
      detailSpeed: clamp(this.motion.detail, 0, 1),
      burstSpeed: clamp(this.motion.burst, 0, 1),
      motionPhaseAdvancing: motionAdvancing,
      motionEnabled: this.motionEnabled,
      hardSilence: this.hardSilence,
      motionFrozen: this.motionFrozen,
      signalActive: this.signalActive,
      rhythmConfidence: this.music.confidence,
      musicActive: this.music.active,
    };
  }
}
