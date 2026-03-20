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
  const activeFade = 0.08 + (1 - energy) * 0.05;
  const silenceKill = smoothstep(
    config.blackout.silenceStart,
    config.blackout.silenceHard,
    silence
  ) * 0.92;
  const manualKill = blackoutPulse * 0.98;

  return {
    fade: activeFade + silenceKill + manualKill,
    hard: silence > config.blackout.silenceHard,
    full: silence > config.blackout.silenceFull,
  };
}