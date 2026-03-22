function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function palette(t) {
  const r = 0.55 + 0.45 * Math.cos(6.28318 * (t + 0.02));
  const g = 0.52 + 0.48 * Math.cos(6.28318 * (t + 0.34));
  const b = 0.55 + 0.45 * Math.cos(6.28318 * (t + 0.67));
  return [r * 255, g * 255, b * 255];
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

    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) {
        const x = gx * cw;
        const y = gy * ch;
        const nx = gx / cells;
        const ny = gy / cells;
        const flow =
          Math.sin((nx + time * 0.13) * 9 + Math.cos((ny - time * 0.17) * 7)) +
          Math.cos((ny + time * 0.15) * 10 + Math.sin((nx + time * 0.09) * 8));
        const hue = nx * 0.22 + ny * 0.32 + flow * 0.08 + audio.highs * 0.18;
        const [r, g, b] = palette(hue);
        const a = 0.65 + audio.bass * 0.35;
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
