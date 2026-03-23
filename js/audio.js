import { CONFIG } from "./config.js";

const SILENCE_THRESHOLD = 0.3;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function followEnvelope(current, target, attackHz, releaseHz, dt) {
  const rise = target > current;
  const rate = rise ? attackHz : releaseHz;
  const alpha = 1 - Math.exp(-rate * dt);
  return current + (target - current) * alpha;
}

function followEnergyEnvelope(current, target, attack = 0.05, decay = 0.85) {
  if (target > current) {
    return clamp(current + (target - current) * attack, 0, 1);
  }
  return clamp(current * decay + target * (1 - decay), 0, 1);
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
    this.lastEnergy = 0;
    this.transport = 160;
    this.transportPhase = 0;

    this.lastUpdateAt = performance.now();
    this.lastDebugAt = 0;

    // Envelope state (smoothed audio followers, not phase accumulators)
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
    };

    // Frame-local raw features (live values before smoothing)
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
    };

    // Motion state: speed is recomputed fresh per frame.
    this.motion = {
      speed: 0,
    };
  }

  async start() {
    if (this.ready && this.ctx && this.ctx.state !== "closed") {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    this.analyser.smoothingTimeConstant = CONFIG.audio.smoothingTimeConstant;

    this.source.connect(this.analyser);

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);

    this.lastUpdateAt = performance.now();
    this.lastDebugAt = this.lastUpdateAt;
    this.ready = true;
  }

  averageRange(minHz, maxHz) {
    if (!this.analyser || !this.freqData) return 0;
    const nyquist = this.ctx.sampleRate / 2;
    const n = this.freqData.length;
    const min = clamp(Math.floor((minHz / nyquist) * n), 0, n - 1);
    const max = clamp(Math.ceil((maxHz / nyquist) * n), min + 1, n);

    let sum = 0;
    for (let i = min; i < max; i++) sum += this.freqData[i];
    return (sum / (max - min)) / 255;
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

  update() {
    if (!this.ready || !this.analyser) {
      const now = performance.now();
      const dt = clamp((now - this.lastUpdateAt) / 1000, 1 / 240, 0.1);
      this.lastUpdateAt = now;
      this.transportPhase = (this.transportPhase + dt * 0.08) % 1;
      return {
        bass: 0.08,
        lowMid: 0.06,
        mids: 0.1,
        highs: 0.14,
        guitar: 0.04,
        air: 0.1,
        energy: 0.12,
        transport: this.transportPhase,
        onset: 0.02,
        peak: 0.04,
        silence: 0.08,
      };
    }

    const now = performance.now();
    const dt = clamp((now - this.lastUpdateAt) / 1000, 1 / 240, 0.1);
    this.lastUpdateAt = now;

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);

    this.raw.bass = clamp(this.averageRange(28, 200), 0, 1);
    this.raw.lowMid = clamp(this.averageRange(130, 350), 0, 1);
    this.raw.mids = clamp(this.averageRange(200, 2000), 0, 1);
    this.raw.highs = clamp(this.averageRange(2000, 9000), 0, 1);
    this.raw.air = clamp(this.averageRange(9000, 15000), 0, 1);
    this.raw.guitar = clamp(this.averageRange(600, 3200), 0, 1);

    const rms = this.computeRms();
    this.raw.energy = clamp(0.5 * this.raw.bass + 0.35 * this.raw.mids + 0.15 * rms * 2.2, 0, 1);

    const flux = Math.max(0, this.raw.energy - this.lastEnergy);
    this.raw.onset = clamp(flux * 6.5, 0, 1);
    this.raw.peak = clamp(this.raw.onset * 0.7 + flux * 2.4, 0, 1);
    this.raw.silence = clamp(1 - this.raw.energy * 1.55, 0, 1);
    this.lastEnergy = this.raw.energy;

    // Smoothed envelopes with explicit attack/release behavior.
    this.smooth.bass = followEnvelope(this.smooth.bass, this.raw.bass, 14, 6, dt);
    this.smooth.lowMid = followEnvelope(this.smooth.lowMid, this.raw.lowMid, 13, 5.5, dt);
    this.smooth.mids = followEnvelope(this.smooth.mids, this.raw.mids, 14, 6, dt);
    this.smooth.highs = followEnvelope(this.smooth.highs, this.raw.highs, 16, 7, dt);
    this.smooth.air = followEnvelope(this.smooth.air, this.raw.air, 18, 8, dt);
    this.smooth.guitar = followEnvelope(this.smooth.guitar, this.raw.guitar, 14, 6, dt);
    this.smooth.energy = followEnergyEnvelope(this.smooth.energy, this.raw.energy, 0.05, 0.85);
    this.smooth.onset = followEnvelope(this.smooth.onset, this.raw.onset, 34, 6, dt);
    this.smooth.peak = followEnvelope(this.smooth.peak, this.raw.peak, 42, 2.8, dt);
    this.smooth.silence = followEnvelope(this.smooth.silence, this.raw.silence, 10, 3.5, dt);

    // Speed is derived fresh from live envelope state every frame (no ratcheting).
    // Units are normalized intensity, guided by musical transients.
    const highsMotionInfluence = Math.min(this.smooth.highs * 0.1, 0.15);
    this.motion.speed =
      clamp(0.03 + this.smooth.bass * 0.75 + this.smooth.mids * 0.2 + this.smooth.onset * 0.12 + highsMotionInfluence, 0.02, 1.8) *
      0.4;

    // Build transport directly from rhythmic content (no frame-to-frame accumulation).
    const rhythmicTransport = clamp(this.smooth.onset * 0.72 + this.smooth.peak * 0.2 + this.smooth.bass * 0.18, 0, 1);

    // Hard-cut transport in silence so visuals can drop fully to black immediately.
    if (this.smooth.silence > SILENCE_THRESHOLD) {
      this.transportPhase = 0;
      this.transport = 0;
      this.motion.speed = 0;
    } else {
      // Keep phase/debug channel aligned to transport intensity to avoid apparent self-acceleration.
      this.transportPhase = rhythmicTransport;
      this.transport = rhythmicTransport;
    }

    if (CONFIG.audio.debugTransport && now - this.lastDebugAt > 500) {
      this.lastDebugAt = now;
      console.debug("[audio-debug]", {
        rawEnergy: Number(this.raw.energy.toFixed(3)),
        smoothedEnergy: Number(this.smooth.energy.toFixed(3)),
        speed: Number(this.motion.speed.toFixed(3)),
        transport: Number(this.transport.toFixed(3)),
        transportPhase: Number(this.transportPhase.toFixed(3)),
        onset: Number(this.smooth.onset.toFixed(3)),
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
    };
  }
}
