function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function fract(x) {
  return x - Math.floor(x);
}

function packPixel(data, idx, r, g, b) {
  data[idx] = clamp(r, 0, 255);
  data[idx + 1] = clamp(g, 0, 255);
  data[idx + 2] = clamp(b, 0, 255);
  data[idx + 3] = 255;
}

function paletteSplit(v, center, bubble, grain) {
  const hot = smoothstep(0.72, 1.0, center);
  const left = smoothstep(-1.0, -0.04, v);
  const right = smoothstep(0.04, 1.0, v);
  const ring = smoothstep(0.38, 0.56, bubble) - smoothstep(0.56, 0.72, bubble);

  let r = 6 + left * 185 + hot * 165 + ring * 36;
  let g = 2 + hot * 38 + ring * 8;
  let b = 10 + right * 205 + hot * 178 + ring * 42;

  const darkMask = 1 - smoothstep(0.18, 0.42, center);
  r -= darkMask * 48;
  g -= darkMask * 28;
  b -= darkMask * 42;

  r += grain * 4;
  b += grain * 5;

  return [r, g, b];
}

function paletteAcid(h, band, grain) {
  const rr = 100 + 110 * Math.sin(h + 0.0) + band * 10;
  const gg = 100 + 110 * Math.sin(h + 2.09) + grain * 5;
  const bb = 100 + 110 * Math.sin(h + 4.18) + band * 8;
  return [rr, gg, bb];
}

function paletteMonolith(v, center, bubble, grain) {
  const core = smoothstep(0.74, 1.0, center);
  const mass = smoothstep(0.24, 0.8, v);
  const voidCut = smoothstep(0.58, 0.9, bubble);

  let r = 6 + mass * 165 + core * 125;
  let g = 3 + mass * 48 + core * 70;
  let b = 10 + mass * 95 + core * 120;

  r -= voidCut * 160;
  g -= voidCut * 150;
  b -= voidCut * 145;

  r += grain * 6;
  b += grain * 10;

  return [r, g, b];
}

function drawCenterBloom(ctx, width, height, audio) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const r = Math.min(width, height) * (0.05 + audio.onset * 0.015 + audio.transport * 0.01);

  const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 2.4);
  g.addColorStop(0, `rgba(255,255,255,0.95)`);
  g.addColorStop(0.2, `rgba(255,245,255,${0.40 + audio.onset * 0.18})`);
  g.addColorStop(0.55, `rgba(130,120,255,${0.12 + audio.guitar * 0.08})`);
  g.addColorStop(1, `rgba(0,0,0,0)`);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBubbleRing(ctx, width, height, masterTime, transportPhase, audio, accent = "cream") {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const count = 110;
  const radius = Math.min(width, height) * (0.16 + audio.transport * 0.05);

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const jitter = Math.sin(a * 7 + transportPhase * 3.0) * 14 + Math.cos(a * 11 - masterTime * 0.9) * 7;
    const rr = radius + jitter + audio.onset * 16;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;

    const size = 1 + (i % 4) * 1.0 + audio.guitar * 1.4;
    if (accent === "cream") {
      ctx.fillStyle = `rgba(${180 + (i % 16)}, ${175 + (i % 16)}, ${170 + (i % 16)}, ${0.08 + audio.air * 0.04})`;
    } else {
      const hue = a * 3 + masterTime * 1.2;
      const col = paletteAcid(hue, 0.5, audio.air);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.08 + audio.air * 0.04})`;
    }

    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function drawFeedback(ctx, prevCanvas, width, height, masterTime, transportPhase, audio, options = {}) {
  const zoom = options.zoom ?? (1.008 + audio.transport * 0.016 + audio.onset * 0.008);
  const rotation = options.rotation ?? ((audio.guitar - audio.lowMid) * 0.010 + Math.sin(masterTime * 0.25) * 0.0015);
  const alpha = options.alpha ?? 0.84;
  const blur = options.blur ?? (0.4 + audio.air * 0.8);
  const sat = options.sat ?? (1.15 + audio.energy * 0.6);
  const contrast = options.contrast ?? (1.08 + audio.bass * 0.16);
  const offsetX = options.offsetX ?? (Math.sin(transportPhase * 1.1) * width * 0.002);
  const offsetY = options.offsetY ?? (Math.cos(transportPhase * 1.0) * height * 0.002);

  ctx.save();
  ctx.translate(width * 0.5 + offsetX, height * 0.5 + offsetY);
  ctx.rotate(rotation);
  ctx.scale(zoom, zoom);
  ctx.translate(-width * 0.5, -height * 0.5);
  ctx.globalAlpha = alpha;
  ctx.filter = `blur(${blur}px) saturate(${sat}) contrast(${contrast})`;
  ctx.drawImage(prevCanvas, 0, 0, width, height);
  ctx.restore();
  ctx.filter = "none";
  ctx.globalAlpha = 1;
}

function drawMirrorSlices(ctx, prevCanvas, width, height, transportPhase, slices = 8, alpha = 0.16, rotateSpeed = 0.05) {
  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  const angle = (Math.PI * 2) / slices;

  for (let i = 0; i < slices; i++) {
    ctx.save();
    ctx.rotate(i * angle + transportPhase * rotateSpeed);
    if (i % 2) ctx.scale(1, -1);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(width * 0.9, -height * 0.22);
    ctx.lineTo(width * 0.9, height * 0.22);
    ctx.closePath();
    ctx.clip();

    ctx.translate(-width * 0.5, -height * 0.5);
    ctx.globalAlpha = alpha;
    ctx.drawImage(prevCanvas, 0, 0, width, height);
    ctx.restore();
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawSpiralWedges(ctx, width, height, transportPhase, audio, strength = 1) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const layers = 20;
  const baseR = Math.min(width, height) * 0.05;
  const maxR = Math.max(width, height) * 0.56;

  ctx.save();
  ctx.translate(cx, cy);

  for (let i = 0; i < layers; i++) {
    const p = i / layers;
    const r = lerp(baseR, maxR, p) * (1 + audio.transport * 0.06);
    const a0 = transportPhase * (0.85 + strength * 0.45) + p * 4.3;
    const a1 = a0 + 0.14 + audio.onset * 0.08;
    const hue = p * Math.PI * 2 + transportPhase * 1.8;

    const col = paletteAcid(hue, p, audio.air);
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.04 + (1 - p) * 0.08})`;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, a0, a1);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawMonolithShadows(ctx, width, height, transportPhase, audio) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const blobs = 5;

  ctx.save();
  ctx.globalCompositeOperation = "multiply";

  for (let i = 0; i < blobs; i++) {
    const a = transportPhase * (0.35 + i * 0.06) + i * 1.25;
    const x = cx + Math.cos(a) * (120 + i * 42 + audio.transport * 60);
    const y = cy + Math.sin(a * 0.9) * (90 + i * 35 + audio.guitar * 45);
    const r = 90 + i * 30 + audio.energy * 60;

    const g = ctx.createRadialGradient(x, y, r * 0.08, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,0.75)`);
    g.addColorStop(0.5, `rgba(10,0,20,0.42)`);
    g.addColorStop(1, `rgba(0,0,0,0)`);

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function renderField(fieldCtx, fieldImage, fieldW, fieldH, masterTime, transportPhase, audio, paletteMode) {
  const data = fieldImage.data;
  const t = masterTime;
  const w = fieldW;
  const h = fieldH;
  const cx = 0.5;
  const cy = 0.5;

  for (let y = 0; y < h; y++) {
    const ny = y / h;
    const py = ny - cy;

    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const px = nx - cx;
      const idx = (y * w + x) * 4;

      const r = Math.sqrt(px * px + py * py);
      const a = Math.atan2(py, px);

      const swirl =
        Math.sin(a * 4.0 + r * 18.0 - transportPhase * (7.0 + audio.transport * 10.0)) * 0.32 +
        Math.cos(a * 7.0 - r * 13.0 + t * 2.0) * 0.22 +
        Math.sin((px * 9.0 + py * 7.0) + t * (0.5 + audio.guitar * 0.7)) * 0.16 +
        Math.cos((px * 14.0 - py * 10.0) - t * (0.45 + audio.transport * 0.65)) * 0.11;

      const worm =
        Math.sin(px * 22.0 + Math.sin(t * 0.35) * 1.7) *
        Math.cos(py * 20.0 - Math.cos(t * 0.27) * 1.7) * 0.18;

      const field = swirl + worm - r * (1.0 + audio.transport * 0.22);

      const centerGlow =
        1.0 - clamp(r * (2.3 - audio.onset * 0.18), 0, 1);

      const bubble =
        Math.sin(field * 9.0 + t * 0.55) * 0.5 + 0.5;

      const grain =
        fract(Math.sin((x * 12.9898 + y * 78.233 + t * 21.17)) * 43758.5453);

      if (paletteMode === "split") {
        const splitField =
          Math.sin(px * 5.0 - t * 0.52) -
          Math.cos(py * 4.6 + t * 0.48) +
          Math.sin(a * 2.8 + r * 8.0 - transportPhase * 1.4) * 0.26;

        const col = paletteSplit(splitField * 0.5, centerGlow, bubble, grain);
        packPixel(data, idx, col[0], col[1], col[2]);
      } else if (paletteMode === "acid") {
        const hue =
          a * 1.8 +
          r * (15.0 + audio.transport * 8.0) -
          transportPhase * (4.0 + audio.onset * 6.0) +
          field * 2.0;

        const band =
          Math.sin(r * 30.0 - transportPhase * 5.2 + a * 6.0) * 0.5 + 0.5;

        const col = paletteAcid(hue, band, grain);
        packPixel(data, idx, col[0], col[1], col[2]);
      } else {
        const col = paletteMonolith(field * 0.5 + 0.5, centerGlow, bubble, grain);
        packPixel(data, idx, col[0], col[1], col[2]);
      }
    }
  }

  fieldCtx.putImageData(fieldImage, 0, 0);
}

function drawFieldScaled(ctx, fieldCanvas, width, height, alpha = 1, filter = "none") {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.filter = filter;
  ctx.drawImage(fieldCanvas, 0, 0, width, height);
  ctx.restore();
  ctx.filter = "none";
  ctx.globalAlpha = 1;
}

export function renderMode({
  mode,
  ctx,
  prevCanvas,
  fieldCanvas,
  fieldCtx,
  fieldImage,
  fieldW,
  fieldH,
  width,
  height,
  masterTime,
  transportPhase,
  audio,
}) {
  if (mode === 1) {
    renderField(fieldCtx, fieldImage, fieldW, fieldH, masterTime, transportPhase, audio, "split");
    drawFieldScaled(
      ctx,
      fieldCanvas,
      width,
      height,
      0.92,
      `blur(${0.3 + audio.air * 0.5}px) saturate(${1.05 + audio.energy * 0.22}) contrast(${1.12 + audio.bass * 0.10})`
    );
    drawCenterBloom(ctx, width, height, audio);
    drawBubbleRing(ctx, width, height, masterTime, transportPhase, audio, "cream");
    drawFeedback(ctx, prevCanvas, width, height, masterTime, transportPhase, audio, {
      zoom: 1.003 + audio.transport * 0.006,
      rotation: Math.sin(masterTime * 0.22) * 0.001,
      alpha: 0.22,
      blur: 0.35,
      sat: 1.02,
      contrast: 1.04,
    });
    return;
  }

  if (mode === 2) {
    renderField(fieldCtx, fieldImage, fieldW, fieldH, masterTime, transportPhase, audio, "acid");
    drawFeedback(ctx, prevCanvas, width, height, masterTime, transportPhase, audio, {
      zoom: 1.014 + audio.transport * 0.024 + audio.onset * 0.014,
      rotation: 0.002 + Math.sin(masterTime * 0.28) * 0.004,
      alpha: 0.88,
      blur: 0.55 + audio.air * 0.55,
      sat: 1.25 + audio.energy * 0.42,
      contrast: 1.14 + audio.bass * 0.14,
    });
    drawFieldScaled(ctx, fieldCanvas, width, height, 0.18, `blur(${0.4 + audio.air * 0.5}px) saturate(${1.24 + audio.energy * 0.22}) contrast(1.06)`);
    drawSpiralWedges(ctx, width, height, transportPhase, audio, 1.0);
    drawMirrorSlices(ctx, prevCanvas, width, height, transportPhase, 8, 0.06 + audio.onset * 0.04, 0.05);
    drawCenterBloom(ctx, width, height, audio);
    return;
  }

  if (mode === 3) {
    renderField(fieldCtx, fieldImage, fieldW, fieldH, masterTime, transportPhase, audio, "split");
    drawFeedback(ctx, prevCanvas, width, height, masterTime, transportPhase, audio, {
      zoom: 1.010 + audio.transport * 0.010,
      rotation: -0.0015 + Math.sin(masterTime * 0.20) * 0.0025,
      alpha: 0.62,
      blur: 0.35 + audio.air * 0.3,
      sat: 1.08 + audio.energy * 0.14,
      contrast: 1.08,
    });
    drawMirrorSlices(ctx, prevCanvas, width, height, transportPhase, 10, 0.16 + audio.energy * 0.04, 0.035);
    drawMirrorSlices(ctx, prevCanvas, width, height, transportPhase, 14, 0.08 + audio.onset * 0.04, -0.055);
    drawFieldScaled(ctx, fieldCanvas, width, height, 0.10, `blur(0.4px) saturate(1.04)`);
    drawCenterBloom(ctx, width, height, audio);
    drawBubbleRing(ctx, width, height, masterTime, transportPhase, audio, "cream");
    return;
  }

  renderField(fieldCtx, fieldImage, fieldW, fieldH, masterTime, transportPhase, audio, "monolith");
  drawFieldScaled(
    ctx,
    fieldCanvas,
    width,
    height,
    0.80,
    `blur(${0.5 + audio.air * 0.4}px) saturate(${0.92 + audio.energy * 0.10}) contrast(${1.18 + audio.bass * 0.12})`
  );
  drawMonolithShadows(ctx, width, height, transportPhase, audio);
  drawCenterBloom(ctx, width, height, audio);
  drawFeedback(ctx, prevCanvas, width, height, masterTime, transportPhase, audio, {
    zoom: 1.004 + audio.transport * 0.005,
    rotation: 0.0008 + Math.sin(masterTime * 0.17) * 0.0009,
    alpha: 0.18,
    blur: 0.45,
    sat: 0.98,
    contrast: 1.08,
  });
}