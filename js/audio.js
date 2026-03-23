import { CONFIG } from "./config.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
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

    this.lastUpdateAt = performance.now();
    this.lastDebugAt = 0;

    this.noiseFloor = 0.01;
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
      speed: 0,
      detail: 0,
      burst: 0,
    };
    this.tuning = {
      ...CONFIG.audio.tuning,
    };

    this.debugState = {
      initialized: false,
      live: false,
      rawEnergy: 0,
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

  update() {
    const now = performance.now();
    const dt = clamp((now - this.lastUpdateAt) / 1000, 1 / 240, 0.1);
    this.lastUpdateAt = now;

    if (!this.ready || !this.analyser || !this.freqData || !this.timeData) {
      this.transportPhase = (this.transportPhase + dt * 0.12) % 1;
      const idle = {
        bass: 0.05,
        lowMid: 0.05,
        mids: 0.07,
        highs: 0.08,
        guitar: 0.04,
        air: 0.07,
        energy: 0.08,
        transport: this.transportPhase,
        onset: 0.01,
        peak: 0.01,
        silence: 0.85,
      };
      this.debugState = {
        initialized: this.ready,
        live: this.live,
        rawEnergy: idle.energy,
        bass: idle.bass,
        mids: idle.mids,
        highs: idle.highs,
        smoothedEnergy: idle.energy,
        transport: idle.transport,
        onset: idle.onset,
        silence: idle.silence,
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

    this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005;

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

    this.raw.energy = clamp(
      this.raw.bass * 0.34 +
        this.raw.lowMid * 0.16 +
        this.raw.mids * 0.22 +
        this.raw.highs * 0.1 +
        this.raw.rms * 0.3,
      0,
      1
    );

    const positiveDelta = Math.max(0, this.raw.energy - this.lastEnergy);
    this.raw.onset = clamp((positiveDelta * 5.5 + Math.max(0, this.raw.rms - 0.25) * 0.25) * this.tuning.audioReactivity, 0, 1);
    this.raw.peak = clamp((peakNorm * 0.55 + this.raw.onset * 0.45) * this.tuning.peakIntensity, 0, 1);
    this.raw.silence = clamp(1 - this.raw.energy * 1.35 - this.raw.rms * 0.35, 0, 1);
    if (this.raw.energy < this.tuning.noiseGate) {
      this.raw.energy = 0;
      this.raw.onset = 0;
      this.raw.peak = 0;
      this.raw.silence = 1;
    }
    this.lastEnergy = this.raw.energy;

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

    const motionFloor = Math.max(0, this.tuning.baselineTransport);
    const reactivity = Math.max(0, this.tuning.audioReactivity);
    const peakIntensity = Math.max(0, this.tuning.peakIntensity);
    const easedEnergy = Math.pow(clamp(this.smooth.energy, 0, 1), 1.85);
    const easedBass = Math.pow(clamp(this.smooth.bass, 0, 1), 1.65);
    const easedOnset = Math.pow(clamp(this.smooth.onset, 0, 1), 1.4);
    const easedPeak = Math.pow(clamp(this.smooth.peak, 0, 1), 2.2);
    const easedMids = Math.pow(clamp(this.smooth.mids, 0, 1), 1.25);
    const easedHighs = Math.pow(clamp(this.smooth.highs, 0, 1), 1.35);

    const reactiveBase =
      easedEnergy * 0.38 * reactivity +
      easedBass * 0.28 * reactivity +
      easedOnset * 0.26 * reactivity;
    const burstResponse = easedPeak * (0.3 + 0.5 * peakIntensity);
    const compressedReactive = reactiveBase / (1 + reactiveBase * 1.6);
    const compressedBurst = burstResponse / (1 + burstResponse * 1.2);

    this.motion.speed = clamp(
      motionFloor + compressedReactive * 0.9 + compressedBurst * 0.45,
      0,
      1.5
    );
    this.motion.detail = clamp(
      motionFloor * 0.08 + easedMids * 0.08 + easedHighs * 0.11,
      0,
      0.45
    );
    this.motion.burst = clamp(compressedBurst, 0, 1);

    const silent = this.smooth.silence > 0.96;
    const effectiveDrive = silent ? motionFloor * 0.08 : this.motion.speed;
    this.transportPhase = (this.transportPhase + effectiveDrive * dt * 0.95) % 1;

    this.raw.transport = effectiveDrive;
    this.smooth.transport = followEnvelope(this.smooth.transport, effectiveDrive, 9, 3.2, dt);
    this.transport = this.transportPhase;

    this.debugState = {
      initialized: this.ready,
      live: this.live,
      rawEnergy: this.raw.energy,
      bass: this.smooth.bass,
      mids: this.smooth.mids,
      highs: this.smooth.highs,
      smoothedEnergy: this.smooth.energy,
      transport: this.transport,
      onset: this.smooth.onset,
      silence: this.smooth.silence,
      motionSpeed: this.motion.speed,
      detailSpeed: this.motion.detail,
      burstSpeed: this.motion.burst,
    };

    if (CONFIG.audio.debugTransport && now - this.lastDebugAt > 400) {
      this.lastDebugAt = now;
      console.debug("[audio-debug]", {
        initialized: this.debugState.initialized,
        live: this.debugState.live,
        rawEnergy: Number(this.debugState.rawEnergy.toFixed(3)),
        bass: Number(this.debugState.bass.toFixed(3)),
        mids: Number(this.debugState.mids.toFixed(3)),
        highs: Number(this.debugState.highs.toFixed(3)),
        smoothedEnergy: Number(this.debugState.smoothedEnergy.toFixed(3)),
        transport: Number(this.debugState.transport.toFixed(3)),
        onset: Number(this.debugState.onset.toFixed(3)),
        silence: Number(this.debugState.silence.toFixed(3)),
      });
    }

    return {
      bass: clamp(this.smooth.bass, 0, 1),
      lowMid: clamp(this.smooth.lowMid, 0, 1),
      mids: clamp(this.smooth.mids, 0, 1),
      highs: clamp(this.smooth.highs, 0, 1),
      guitar: clamp(this.smooth.guitar, 0, 1),
      air: clamp(this.smooth.air, 0, 1),
      energy: clamp(this.smooth.energy, 0, 1),
      transport: clamp(this.transport, 0, 1),
      onset: clamp(this.smooth.onset, 0, 1),
      peak: clamp(this.smooth.peak, 0, 1),
      silence: clamp(this.smooth.silence, 0, 1),
      motionSpeed: clamp(this.motion.speed, 0, 1.5),
      detailSpeed: clamp(this.motion.detail, 0, 1),
      burstSpeed: clamp(this.motion.burst, 0, 1),
    };
  }
}
