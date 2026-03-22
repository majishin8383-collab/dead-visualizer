import { CONFIG } from "./config.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
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
    this.lastFlux = 0;
    this.transport = 0;

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
      return {
        bass: 0,
        lowMid: 0,
        mids: 0,
        highs: 0,
        guitar: 0,
        air: 0,
        energy: 0,
        transport: 0,
        onset: 0,
        peak: 0,
        silence: 1,
      };
    }

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);

    const bass = this.averageRange(28, 130);
    const lowMid = this.averageRange(130, 350);
    const mids = this.averageRange(350, 2200);
    const highs = this.averageRange(2200, 9000);
    const air = this.averageRange(9000, 15000);
    const guitar = this.averageRange(600, 3200);

    const rms = this.computeRms();
    const energyRaw = clamp(0.36 * bass + 0.3 * mids + 0.2 * highs + 0.14 * rms * 2.2, 0, 1.3);
    const flux = Math.max(0, energyRaw - this.lastEnergy);
    const onsetRaw = clamp(flux * 6.5 + Math.max(0, (highs - this.smooth.highs) * 2.8), 0, 1.2);
    const peakRaw = clamp(onsetRaw * 0.7 + flux * 2.4, 0, 1.3);

    this.lastFlux = this.lastFlux * 0.84 + flux * 0.16;
    this.lastEnergy = energyRaw;

    this.smooth.bass = this.smooth.bass * 0.82 + bass * 0.18;
    this.smooth.lowMid = this.smooth.lowMid * 0.84 + lowMid * 0.16;
    this.smooth.mids = this.smooth.mids * 0.82 + mids * 0.18;
    this.smooth.highs = this.smooth.highs * 0.8 + highs * 0.2;
    this.smooth.air = this.smooth.air * 0.76 + air * 0.24;
    this.smooth.guitar = this.smooth.guitar * 0.82 + guitar * 0.18;
    this.smooth.energy = this.smooth.energy * 0.86 + clamp(energyRaw, 0, 1) * 0.14;
    this.smooth.onset = this.smooth.onset * 0.65 + onsetRaw * 0.35;
    this.smooth.peak = Math.max(peakRaw, this.smooth.peak * 0.9);

    this.transport += 0.004 + this.smooth.energy * 0.018 + this.smooth.onset * 0.012;
    const silenceRaw = clamp(1 - this.smooth.energy * 1.55, 0, 1);
    this.smooth.silence = this.smooth.silence * 0.9 + silenceRaw * 0.1;

    return {
      bass: clamp(this.smooth.bass, 0, 1),
      lowMid: clamp(this.smooth.lowMid, 0, 1),
      mids: clamp(this.smooth.mids, 0, 1),
      highs: clamp(this.smooth.highs, 0, 1),
      guitar: clamp(this.smooth.guitar, 0, 1),
      air: clamp(this.smooth.air, 0, 1),
      energy: clamp(this.smooth.energy, 0, 1),
      transport: this.transport,
      onset: clamp(this.smooth.onset, 0, 1),
      peak: clamp(this.smooth.peak, 0, 1),
      silence: clamp(this.smooth.silence, 0, 1),
    };
  }
}
