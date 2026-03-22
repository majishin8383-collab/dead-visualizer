export const CONFIG = {
  buildTag: "dv-101A",
  modes: {
    names: {
      1: "Liquid Tie-Dye",
      2: "Feedback Tunnel",
      3: "Fractal Bloom",
      4: "Chaos",
    },
    defaultMode: 1,
    autoCycleSeconds: 18,
  },

  audio: {
    fftSize: 2048,
    smoothingTimeConstant: 0.64,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },

  blackout: {
    silenceStart: 0.5,
    silenceHard: 0.87,
    silenceFull: 0.95,
  },
};
