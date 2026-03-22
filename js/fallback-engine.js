function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const MODE1_PALETTE_CYCLE_SECONDS = 30;

function palette(t) {
  const r = 0.55 + 0.45 * Math.cos(6.28318 * (t + 0.02));
  const g = 0.52 + 0.48 * Math.cos(6.28318 * (t + 0.34));
  const b = 0.55 + 0.45 * Math.cos(6.28318 * (t + 0.67));
  return [r * 255, g * 255, b * 255];
}

function liquidPalette(t) {
  const stops = [
    [0, 230, 255], // cyan
    [30, 70, 255], // blue
    [245, 26, 255], // magenta
    [150, 30, 240], // purple
    [255, 28, 44], // red
    [255, 102, 0], // orange
    [255, 220, 22], // yellow
  ];
  const x = ((t % 1) + 1) % 1 * stops.length;
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[(i + 1) % stops.length];
  const blended = [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];

  // +30% saturation boost while preserving luminance.
  const lum = blended[0] * 0.2126 + blended[1] * 0.7152 + blended[2] * 0.0722;
  const saturationBoost = 1.3;
  return [
    clamp(lum + (blended[0] - lum) * saturationBoost, 0, 255),
    clamp(lum + (blended[1] - lum) * saturationBoost, 0, 255),
    clamp(lum + (blended[2] - lum) * saturationBoost, 0, 255),
  ];
}

export class FallbackEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
  }

  resize(width, height) {
    this.canvas.width = Math.max(1, width);
    this.canvas.height = Math.max(1, height);
  }

  render({ mode, time, audio, blackout }) {
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(0, 0, w, h);

    if (mode === 1) this.renderLiquid(ctx, w, h, time, audio);
    else if (mode === 2) this.renderTunnel(ctx, w, h, time, audio);
    else if (mode === 3) this.renderFractal(ctx, w, h, time, audio);
    else this.renderChaos(ctx, w, h, time, audio);

    if (blackout > 0) {
      ctx.fillStyle = `rgba(0,0,0,${clamp(blackout, 0, 1)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  renderLiquid(ctx, w, h, time, audio) {
    const cells = 44;
    const cw = w / cells;
    const ch = h / cells;
    const driftX = time * 0.04;
    const driftY = -time * 0.03;
    const palettePhase = time / MODE1_PALETTE_CYCLE_SECONDS;
    const hueSpin = palettePhase + time * (audio.energy * 0.012 + audio.mids * 0.008);
    const bassWarm = clamp((audio.bass - 0.15) / 0.7, 0, 1);

    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) {
        const x = gx * cw;
        const y = gy * ch;
        const nx = gx / cells - 0.5;
        const ny = gy / cells - 0.5;
        const zone = clamp(
          0.5 +
            0.5 *
              Math.sin((nx + driftX * 0.2) * 3.1 + Math.cos((ny - driftY * 0.24) * 2.8)),
          0,
          1
        );

        const flowX =
          Math.sin((nx + driftX) * 4.2 + Math.cos((ny - driftY) * 2.6) * 1.9) +
          Math.cos((ny + driftY * 0.8) * 6.1 + time * 0.7);
        const flowY =
          Math.cos((ny + driftY) * 4.6 + Math.sin((nx + driftX) * 2.4) * 2.1) -
          Math.sin((nx - driftX * 0.7) * 5.2 - time * 0.63);
        const swirl = Math.sin((nx - ny) * 8.0 + time * (1.2 + audio.mids * 2.1));
        const bassPulse = Math.sin(Math.hypot(nx + 0.2, ny - 0.12) * 16 - time * 7.5) * audio.bass;

        const advX = nx + flowX * 0.08 * (0.4 + zone + audio.mids * 0.7) + bassPulse * 0.05;
        const advY = ny + flowY * 0.08 * (0.4 + zone + audio.mids * 0.7) + bassPulse * 0.05;
        const vein = Math.sin(advX * 14.0 + advY * 10.0 + time * 2.3 + swirl * 1.5);
        const eddy = Math.sin(advX * 4.8 - advY * 5.3 + time * 0.82);
        const detail = zone * 0.5 + swirl * 0.28 + eddy * 0.22;
        const warmShift = bassWarm * (0.11 + audio.onset * 0.08);
        const baseT = detail * 0.34 + hueSpin + vein * 0.06;
        const midT = detail * (0.6 + audio.mids * 0.35) + time * (0.05 + audio.mids * 0.08);
        const highT = detail * 0.12 + hueSpin * 1.6 + audio.highs * 0.2 + Math.sin(time * 0.9 + advX * 2.0) * 0.03;
        const [bR, bG, bB] = liquidPalette(baseT + warmShift);
        const [mR, mG, mB] = liquidPalette(midT + warmShift * 1.5);
        const [hR, hG, hB] = liquidPalette(highT + warmShift * 2.1);

        const veinEdge = Math.abs(((detail * (5.6 + audio.mids * 2.6)) % 1 + 1) % 1 - 0.5) * 2;
        const thinVein = clamp((veinEdge - 0.84) / 0.14, 0, 1) * clamp((zone - 0.2) / 0.8, 0, 1);
        const shimmer = clamp((Math.sin((advX + advY) * 24 + time * 7.0) * 0.5 + 0.5 - 0.5) * 2, 0, 1) * audio.highs;
        const satBoost = 1.34 + audio.mids * 0.28;

        let r = (bR * 0.55 + mR * 0.34 + hR * (0.11 + audio.highs * 0.08)) / 255;
        let g = (bG * 0.55 + mG * 0.34 + hG * (0.11 + audio.highs * 0.08)) / 255;
        let b = (bB * 0.55 + mB * 0.34 + hB * (0.11 + audio.highs * 0.08)) / 255;

        r = r * satBoost + thinVein * (0.25 + bassWarm * 0.2) + shimmer * 0.08;
        g = g * satBoost - thinVein * 0.1 + shimmer * 0.05;
        b = b * satBoost + thinVein * 0.15 + shimmer * 0.08;

        const contrast = 1.22 + bassWarm * 0.2;
        r = clamp((r - 0.5) * contrast + 0.5, 0, 0.96);
        g = clamp((g - 0.5) * contrast + 0.5, 0, 0.96);
        b = clamp((b - 0.5) * contrast + 0.5, 0, 0.96);
        r *= 255;
        g *= 255;
        b *= 255;
        const a = 0.58 + zone * 0.24 + audio.bass * 0.2;
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`;
        ctx.fillRect(x, y, cw + 1, ch + 1);
      }
    }
  }

  renderTunnel(ctx, w, h, time, audio) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const rings = 92;

    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < rings; i++) {
      const p = i / rings;
      const rr = (1 - p) * Math.max(w, h) * (0.75 + audio.bass * 0.3);
      const th = 3 + (1 - p) * 12;
      const a = time * (0.8 + audio.mids * 2.5) + p * 16;
      const x = Math.cos(a) * rr * 0.08;
      const y = Math.sin(a * 1.2) * rr * 0.08;
      const [r, g, b] = palette(p + time * 0.1 + audio.highs * 0.2);
      ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.05 + (1 - p) * 0.35})`;
      ctx.lineWidth = th;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderFractal(ctx, w, h, time, audio) {
    const branches = 8;
    const depth = 5 + Math.floor(audio.peak * 3);

    const drawBranch = (x, y, len, angle, level) => {
      if (level <= 0 || len < 2) return;
      const x2 = x + Math.cos(angle) * len;
      const y2 = y + Math.sin(angle) * len;
      const [r, g, b] = palette(level * 0.11 + time * 0.07 + audio.highs * 0.2);
      ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.22 + level * 0.07})`;
      ctx.lineWidth = Math.max(1, level * 0.9);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const spread = 0.35 + audio.mids * 0.55;
      drawBranch(x2, y2, len * 0.75, angle + spread, level - 1);
      drawBranch(x2, y2, len * 0.75, angle - spread, level - 1);
    };

    for (let i = 0; i < branches; i++) {
      const a = (i / branches) * Math.PI * 2 + time * 0.11;
      drawBranch(w * 0.5, h * 0.5, Math.min(w, h) * 0.16 * (1 + audio.bass * 0.5), a, depth);
    }
  }

  renderChaos(ctx, w, h, time, audio) {
    this.renderLiquid(ctx, w, h, time * 1.2, audio);
    ctx.globalCompositeOperation = "screen";
    this.renderTunnel(ctx, w, h, time * 1.45, audio);
    ctx.globalCompositeOperation = "lighter";
    this.renderFractal(ctx, w, h, time * 1.7, audio);
    ctx.globalCompositeOperation = "source-over";
  }
}
