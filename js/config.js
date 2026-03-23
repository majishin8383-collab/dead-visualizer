export const CONFIG = {
  buildTag: "dv-140-audio-only-motion",
  devControls: {
    enabled: true,
  },
  modes: {
    names: {
      1: "Liquid Tie-Dye",
      2: "Mandala Bloom Fractal",
      3: "Liquid Tie-Dye (3)",
      4: "Liquid Tie-Dye (4)",
    },
    defaultMode: 1,
    autoCycleSeconds: 18,
  },

  // Forward design for rare solo-driven iconography.
  // `enabled` stays false until lead-guitar/solo detection is wired.
  soloEvents: {
    enabled: false,
    baseSpawnChance: 0.015,
    cooldownSeconds: {
      min: 8,
      max: 18,
    },
    gates: {
      soloLeadMin: 0.66,
      peakMin: 0.58,
    },
    pool: [
      {
        id: "lightning_bolt",
        label: "Lightning Bolt Flash",
        weight: 1.0,
        enabled: true,
        lifeSeconds: 0.65,
        fadeInRatio: 0.1,
        holdRatio: 0.38,
      },
      {
        id: "rose_bloom",
        label: "Rose Bloom Apparition",
        weight: 0.72,
        enabled: true,
        lifeSeconds: 1.35,
        fadeInRatio: 0.28,
        holdRatio: 0.62,
      },
      {
        id: "skull",
        label: "Skull Apparition",
        weight: 0.52,
        enabled: true,
        lifeSeconds: 1.1,
        fadeInRatio: 0.2,
        holdRatio: 0.54,
      },
      {
        id: "dancing_skeleton",
        label: "Dancing Skeleton Figure",
        weight: 0.35,
        enabled: true,
        lifeSeconds: 1.45,
        fadeInRatio: 0.24,
        holdRatio: 0.56,
      },
      {
        id: "bear_silhouette",
        label: "Bear-Like Silhouette",
        weight: 0.18,
        enabled: false,
        lifeSeconds: 1.6,
        fadeInRatio: 0.28,
        holdRatio: 0.5,
      },
    ],
  },

  audio: {
    fftSize: 2048,
    smoothingTimeConstant: 0.52,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    debugTransport: true,
    tuning: {
      micSensitivity: 1.0,
      noiseGate: 0.03,
      smoothing: 0.18,
      baselineTransport: 0.12,
      audioReactivity: 1.0,
      peakIntensity: 1.0,
    },
  },

  blackout: {
    silenceStart: 0.72,
    silenceHard: 0.9,
    silenceFull: 0.975,
  },
};
