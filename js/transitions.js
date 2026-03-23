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

export function computeBlackout(silence, silenceTimer, blackoutPulse, config) {
  const manualFade = blackoutPulse * 0.92;
  const holdSeconds = Math.max(0, config.blackout.holdSeconds ?? 0.8);
  const fadeSeconds = Math.max(0.01, config.blackout.fadeSeconds ?? 1.35);
  const safeSilenceTimer = Math.max(0, silenceTimer);
  const fadeProgress =
    safeSilenceTimer <= holdSeconds ? 0 : clamp((safeSilenceTimer - holdSeconds) / fadeSeconds, 0, 1);
  const silenceFade = smoothstep(0, 1, fadeProgress);
  const hardSilence = silence >= config.blackout.silenceHard || silenceFade >= 0.995;
  const fade = hardSilence ? 1 : clamp(silenceFade + manualFade, 0, 1);

  return {
    fade,
    hard: hardSilence,
    full: silence > config.blackout.silenceFull,
    silenceTimer: safeSilenceTimer,
  };
}
