export const CONFIG = {
  modes: {
    names: {
      1: "Liquid Split",
      2: "Heavy Feedback Tunnel",
      3: "Mirror Chamber",
      4: "Monolith Bloom",
    },
    defaultMode: 1,
    autoCycleSeconds: 24,
  },

  audio: {
    fftSize: 2048,
    smoothingTimeConstant: 0.68,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },

  render: {
    fieldMin: 180,
    fieldMax: 340,
    fieldDivisor: 6.5,
  },

  blackout: {
    silenceStart: 0.46,
    silenceHard: 0.84,
    silenceFull: 0.92,
  },
};