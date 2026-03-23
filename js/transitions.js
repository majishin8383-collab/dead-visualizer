function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function drawBlackFade(ctx, width, height, amount) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0,0,0,${clamp(amount, 0, 1)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function computeBlackout(silence, energy, blackoutPulse, config) {
  const baseFade = energy > 0.005 ? 0 : 0.02;
  const silenceFade = smoothstep(config.blackout.silenceStart, config.blackout.silenceHard, silence) * 0.88;
  const manualFade = blackoutPulse * 0.92;
  const hardSilence = silence >= config.blackout.silenceHard;
  const fade = hardSilence ? 1 : clamp(baseFade + silenceFade + manualFade, 0, 1);

  return {
    fade,
    hard: hardSilence,
    full: silence > config.blackout.silenceFull,
  };
}
