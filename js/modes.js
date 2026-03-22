const COMMON_GLSL = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_dt;
uniform float u_blackout;
uniform int u_mode;
uniform vec4 u_audioA; // bass, mids, highs, energy
uniform vec4 u_audioB; // onset, peak, transport, guitarDrive
uniform sampler2D u_feedback;

float sat(float x){ return clamp(x, 0.0, 1.0); }
mat2 rot(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.,0.));
  float c = hash(i + vec2(0.,1.));
  float d = hash(i + vec2(1.,1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}

float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for(int i=0;i<6;i++){
    v += noise(p) * a;
    p = p * 2.03 + vec2(17.0, 11.0);
    a *= 0.52;
  }
  return v;
}

vec2 flowNoise(vec2 p){
  float nx = fbm(p + vec2(19.1, -4.7));
  float ny = fbm(p + vec2(-11.4, 23.8));
  return vec2(nx, ny) - 0.5;
}

float curlField(vec2 p){
  float e = 0.12;
  float n1 = fbm(p + vec2(0.0, e));
  float n2 = fbm(p - vec2(0.0, e));
  float n3 = fbm(p + vec2(e, 0.0));
  float n4 = fbm(p - vec2(e, 0.0));
  return (n1 - n2) - (n3 - n4);
}

vec3 palette(float t){
  vec3 a = vec3(0.55, 0.45, 0.50);
  vec3 b = vec3(0.45, 0.50, 0.45);
  vec3 c = vec3(1.00, 1.00, 1.00);
  vec3 d = vec3(0.05, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

vec3 toneMap(vec3 c){
  c = max(c, vec3(0.0));
  c = c / (1.0 + c);
  return pow(c, vec3(0.95));
}

vec3 liquidPaletteStop(float i){
  if(i < 0.5) return vec3(0.00, 0.90, 1.00); // cyan
  if(i < 1.5) return vec3(0.12, 0.28, 1.00); // blue
  if(i < 2.5) return vec3(0.95, 0.10, 1.00); // magenta
  if(i < 3.5) return vec3(0.58, 0.10, 0.95); // purple
  if(i < 4.5) return vec3(1.00, 0.09, 0.18); // red
  if(i < 5.5) return vec3(1.00, 0.38, 0.00); // orange
  if(i < 6.5) return vec3(1.00, 0.88, 0.08); // yellow
  return vec3(0.15, 0.92, 0.34);             // occasional green
}

vec3 liquidPalette(float t){
  float x = fract(t) * 8.0;
  float i = floor(x);
  float f = fract(x);
  vec3 a = liquidPaletteStop(i);
  vec3 b = liquidPaletteStop(mod(i + 1.0, 8.0));
  return mix(a, b, f);
}

vec3 modeLiquid(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float transport){
  float t = u_time * (0.22 + energy * 0.36) + transport * 0.035;

  // Strong baseline drift keeps the mode alive even in calmer passages.
  vec2 globalDrift = vec2(0.08, -0.06) * u_time + vec2(transport * 0.0024, -transport * 0.0018);
  vec2 base = p * 0.88 + globalDrift;

  // Curl-driven turbulence field with layered scales (no periodic stripe drivers).
  vec2 flowLarge = flowNoise(base * 0.62 + vec2(t * 0.10, -t * 0.08));
  vec2 flowMid = flowNoise(base * 1.45 + vec2(-t * 0.24, t * 0.20));
  vec2 flowFine = flowNoise(base * 3.9 + vec2(t * 0.66, -t * 0.61));

  float c1 = curlField(base * 0.95 + vec2(t * 0.15, -t * 0.11));
  float c2 = curlField(base * 1.85 + vec2(-t * 0.34, t * 0.27));
  vec2 curlVec = normalize(vec2(-c1 - c2, c1 - c2) + vec2(1e-4));

  // Pressure folds from bass energy; pushes fluid outward from moving centers.
  vec2 pressureCenterA = vec2(sin(t * 0.43), cos(t * 0.37)) * 0.34;
  vec2 pressureCenterB = vec2(cos(t * 0.31), sin(t * 0.29)) * 0.27;
  vec2 dpA = base - pressureCenterA;
  vec2 dpB = base - pressureCenterB;
  float pA = exp(-dot(dpA, dpA) * (1.8 + bass * 1.7));
  float pB = exp(-dot(dpB, dpB) * (2.1 + bass * 1.2));
  vec2 pressure = normalize(dpA + vec2(1e-4)) * pA * (0.22 + bass * 0.42)
               + normalize(dpB + vec2(1e-4)) * pB * (0.18 + onset * 0.34);

  float turbulence = 0.62 + mids * 0.78 + energy * 0.34;
  vec2 field = flowLarge * 0.95 + flowMid * 0.62 + flowFine * (0.18 + highs * 0.16);
  field += curlVec * (0.44 + mids * 0.52);
  field += pressure;
  field *= turbulence;

  // Semi-Lagrangian advection steps for organic rivers and eddies.
  vec2 q = base;
  q += field * (0.62 + mids * 0.42);
  vec2 q2 = q + flowNoise(q * 1.18 + vec2(t * 0.21, -t * 0.19)) * (0.34 + highs * 0.22);
  q2 += vec2(-flowMid.y, flowMid.x) * (0.18 + mids * 0.24);

  float body = fbm(q2 * (2.0 + mids * 2.1) + vec2(0.0, transport * 0.03));
  float dyeRivers = fbm(q2 * 3.3 + vec2(5.1, -3.7) + flowFine * 0.9);
  float eddies = fbm(q2 * 6.4 - vec2(t * 0.53, -t * 0.47));
  float ridges = 1.0 - abs(fbm(q2 * 4.8 + vec2(8.3, -6.4)) * 2.0 - 1.0);

  float riverMask = smoothstep(0.46, 0.82, dyeRivers + ridges * 0.26);
  float foldMask = smoothstep(0.52, 0.9, body * 0.64 + eddies * 0.36 + bass * 0.18);

  float hueSpin = u_time * (0.028 + energy * 0.036 + mids * 0.021) + transport * 0.0016;
  float bassWarm = smoothstep(0.14, 0.9, bass);
  float warmShift = bassWarm * (0.13 + onset * 0.1);

  float baseT = body * 0.42 + hueSpin;
  float riverT = dyeRivers * (0.55 + mids * 0.24) + hueSpin * 1.16 + eddies * 0.14;
  float foamT = ridges * 0.4 + hueSpin * 1.85 + highs * 0.2;

  vec3 baseCol = liquidPalette(baseT + warmShift);
  vec3 riverCol = liquidPalette(riverT + warmShift * 1.45 + mids * 0.05);
  vec3 foamCol = liquidPalette(foamT + warmShift * 2.1);

  vec3 col = mix(baseCol, riverCol, riverMask * (0.52 + mids * 0.22));
  col = mix(col, foamCol, foldMask * (0.22 + highs * 0.18));

  // High-frequency sparkle without linear banding.
  float shimmer = smoothstep(0.6, 0.95, fbm(q2 * 11.0 + vec2(u_time * 1.7, -u_time * 1.5)));
  col += foamCol * shimmer * highs * 0.12;

  float micro = fbm(q2 * 14.5 + vec2(1.2 * u_time, -1.0 * u_time)) - 0.5;
  col *= 0.9 + body * 0.56 + micro * 0.16;

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, 1.54 + 0.24 * mids);
  col = (col - 0.5) * (1.2 + 0.27 * mids + bassWarm * 0.2) + 0.5;
  col *= 1.0 + onset * 0.15;
  col = min(col, vec3(1.15));
  return max(col, 0.0);
}

vec2 mirrorWrap(vec2 uv){
  return abs(fract(uv) * 2.0 - 1.0);
}

vec3 neonSwirlPalette(float t){
  vec3 c0 = vec3(0.00, 1.00, 1.00); // cyan
  vec3 c1 = vec3(1.00, 0.10, 0.95); // magenta
  vec3 c2 = vec3(1.00, 0.95, 0.05); // yellow
  vec3 c3 = vec3(1.00, 0.10, 0.20); // red
  vec3 c4 = vec3(0.10, 1.00, 0.28); // green

  float x = fract(t) * 5.0;
  float i = floor(x);
  float f = fract(x);
  vec3 a = (i < 0.5) ? c0 : (i < 1.5) ? c1 : (i < 2.5) ? c2 : (i < 3.5) ? c3 : c4;
  float ni = mod(i + 1.0, 5.0);
  vec3 b = (ni < 0.5) ? c0 : (ni < 1.5) ? c1 : (ni < 2.5) ? c2 : (ni < 3.5) ? c3 : c4;
  return mix(a, b, f);
}

vec3 feedbackSwirl(vec2 uv, float bass, float mids, float highs, float energy, float onset, float zoomBoost, float spinBoost){
  float spin = mix(0.003, 0.008, sat(bass * 0.95 + energy * 0.4 + onset * 0.5)) + spinBoost;
  float zoom = mix(0.995, 0.98, sat(energy * 0.8 + bass * 0.55)) - zoomBoost;

  vec2 center = vec2(
    0.5 + 0.12 * sin(u_time * 0.11) + 0.06 * sin(u_time * 0.043),
    0.5 + 0.10 * cos(u_time * 0.09) + 0.05 * cos(u_time * 0.051)
  );

  vec2 q = uv - center;
  q = rot(spin) * q;
  q /= max(zoom, 0.90);
  q += vec2(sin(u_time * 0.61), cos(u_time * 0.54)) * (0.002 + bass * 0.004);

  vec2 baseUv = mirrorWrap(q + center);
  float ca = 0.0015 + highs * 0.008;
  vec2 axis = vec2(cos(u_time * 0.6), sin(u_time * 0.6)) * ca;

  vec3 fb;
  fb.r = texture(u_feedback, mirrorWrap(baseUv + axis)).r;
  fb.g = texture(u_feedback, baseUv).g;
  fb.b = texture(u_feedback, mirrorWrap(baseUv - axis)).b;

  float grainA = noise(baseUv * u_resolution * 0.63 + u_time * 15.7);
  float grainB = noise((baseUv.yx + 0.13) * u_resolution * 0.81 - u_time * 12.9);
  float grain = (grainA + grainB - 1.0) * (0.08 + highs * 0.07 + energy * 0.05);

  vec2 warpUv = baseUv + flowNoise((baseUv - 0.5) * 3.6 + vec2(u_time * 0.43, -u_time * 0.39)) * (0.018 + mids * 0.035);
  vec3 src = modeLiquid(warpUv, (warpUv * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0), bass, mids, highs, energy, onset, u_audioB.z * 120.0);

  float hueField = fbm((baseUv - 0.5) * 6.5 + vec2(-u_time * 0.21, u_time * 0.25));
  vec3 neon = neonSwirlPalette(hueField + u_time * 0.07 + mids * 0.25);

  vec3 col = mix(src, fb, 0.58 + energy * 0.3);
  col = mix(col, col * neon, 0.46 + highs * 0.22);
  col += neon * (0.08 + onset * 0.16);
  col += grain;
  col *= 1.02 + energy * 0.2;
  return max(col, 0.0);
}

vec3 modeTunnel(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float peak, float transport){
  float bassAmt = clamp(bass, 0.0, 1.0);
  float zoomFactor = max(0.9, 0.988 - bassAmt * 0.008);
  float rotationSpeed = max(0.001, 0.005 + bassAmt * 0.015);
  float angle = u_time * 60.0 * rotationSpeed;

  vec2 q = uv - 0.5;
  q = rot(angle) * q;
  q /= zoomFactor;
  vec2 feedbackUv = mirrorWrap(q + 0.5);

  vec2 chromaOffset = vec2(0.003, 0.001);
  vec3 prev;
  prev.r = texture(u_feedback, mirrorWrap(feedbackUv + chromaOffset)).r;
  prev.g = texture(u_feedback, feedbackUv).g;
  prev.b = texture(u_feedback, mirrorWrap(feedbackUv - chromaOffset)).b;

  vec2 liquidUv = uv + flowNoise(p * 2.5 + vec2(u_time * 0.33, -u_time * 0.29)) * (0.01 + mids * 0.02 + highs * 0.01);
  vec3 fresh = modeLiquid(liquidUv, p, bass, mids, highs, energy, onset, transport);

  float dyeField = fbm((feedbackUv - 0.5) * 5.8 + vec2(-u_time * 0.2, u_time * 0.22));
  vec3 dye = neonSwirlPalette(dyeField + u_time * 0.1 + onset * 0.28 + peak * 0.16);
  vec3 tintedFresh = fresh * mix(vec3(1.0), dye, 0.42 + highs * 0.1);

  vec3 col = prev * 0.88 + tintedFresh * 0.12;
  col += dye * (0.04 + onset * 0.08 + highs * 0.03);

  float contrast = 1.25 + energy * 0.35 + peak * 0.15;
  col = (col - 0.5) * contrast + 0.5;
  col = max(col - vec3(0.035), 0.0);
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), 0.0);
  return max(col, 0.0);
}

vec2 kaleidoUv(vec2 uv, vec2 center, float segments, float angle){
  vec2 p = uv - center;
  float r = length(p);
  float a = atan(p.y, p.x) + angle;
  float sector = 6.28318530718 / segments;
  a = mod(a, sector);
  a = abs(a - sector * 0.5);
  vec2 kp = vec2(cos(a), sin(a)) * r;
  return kp + center;
}

vec3 modeFractal(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float peak, float transport){
  float segMix = step(0.5, fract(transport * 1.7 + u_time * 0.05));
  float segments = mix(6.0, 8.0, segMix);

  vec2 drift = vec2(
    0.09 * sin(u_time * 0.13 + bass * 1.7),
    0.08 * cos(u_time * 0.11 + mids * 1.9)
  );
  vec2 center = vec2(0.5) + drift;

  float pulse = 1.0 + (bass * 0.06 + peak * 0.1) * sin(u_time * 6.283 + transport * 6.283);
  vec2 zuv = (uv - center) / pulse + center;
  float angle = u_time * (0.07 + mids * 0.4) + transport * 1.6;
  vec2 kuv = kaleidoUv(zuv, center, segments, angle);

  vec2 kpn = (kuv * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 pull = (kuv - center) * (0.012 + energy * 0.022);
  vec2 feedbackUv = mirrorWrap(kuv - pull);

  vec3 src = modeLiquid(kuv + flowNoise(kpn * 2.2 + vec2(u_time * 0.22, -u_time * 0.21)) * 0.012, kpn, bass, mids, highs, energy, onset, transport);
  vec3 fb = texture(u_feedback, feedbackUv).rgb;

  vec3 col = mix(src, fb, 0.26 + energy * 0.38);
  float mandala = fbm(kpn * 5.2 + vec2(-u_time * 0.4, u_time * 0.35));
  col *= 1.0 + mandala * 0.3;
  col = mix(col, col * neonSwirlPalette(mandala + u_time * 0.12), 0.35 + highs * 0.2);
  col += neonSwirlPalette(mandala + 0.23) * (0.08 + onset * 0.11);

  return max(col, 0.0);
}

vec3 modeChaos(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float peak, float transport){
  float transient = sat(onset * 0.9 + peak * 1.2);
  float burst = smoothstep(0.42, 0.95, transient);

  vec2 distort = vec2(
    sin((uv.y + u_time * 0.6) * (8.0 + energy * 14.0)),
    cos((uv.x - u_time * 0.55) * (7.0 + energy * 13.0))
  ) * (0.004 + energy * 0.03 + burst * 0.015);

  vec3 base = feedbackSwirl(uv + distort, bass, mids, highs, energy, onset, burst * 0.05, burst * 0.003);

  vec2 px = 1.0 / u_resolution;
  float bloomRadius = (1.8 + burst * 18.0) * (1.0 + transient * 0.6);
  vec3 bloom = vec3(0.0);
  float wsum = 0.0;
  for(int x=-3;x<=3;x++){
    for(int y=-3;y<=3;y++){
      vec2 off = vec2(float(x), float(y)) * px * bloomRadius;
      float w = exp(-dot(off, off) * (22.0 - burst * 9.0));
      vec3 s = texture(u_feedback, mirrorWrap(uv + off)).rgb;
      bloom += s * w;
      wsum += w;
    }
  }
  bloom /= max(wsum, 1e-4);

  float flashGate = step(0.86, transient) * step(0.85, fract(u_time * 60.0));
  vec3 inv = vec3(1.0) - base;

  float tempPhase = 0.5 + 0.5 * sin(u_time * 8.0 + bass * 10.0 + burst * 7.0);
  vec3 warm = vec3(1.1, 0.95, 0.82);
  vec3 cool = vec3(0.82, 0.95, 1.12);
  vec3 temp = mix(warm, cool, tempPhase);

  vec3 col = base;
  col += bloom * (0.25 + burst * 0.75);
  col = mix(col, inv, flashGate);
  col *= temp;
  col += neonSwirlPalette(transport + u_time * 0.11) * burst * 0.12;

  // Extra highlight compression for show-state peaks (white clipping forbidden).
  col = col / (1.0 + col * (0.85 + burst * 0.8));
  return max(col, 0.0);
}

vec3 postProcess(vec2 uv, vec3 scene, float bass, float mids, float highs, float energy, float onset){
  vec2 px = 1.0 / u_resolution;
  float ca = 0.001 + highs * 0.004;
  vec3 caCol;
  caCol.r = texture(u_feedback, uv + vec2(ca, 0.0)).r;
  caCol.g = scene.g;
  caCol.b = texture(u_feedback, uv - vec2(ca, 0.0)).b;

  vec3 bloom = vec3(0.0);
  for(int x=-2;x<=2;x++){
    for(int y=-2;y<=2;y++){
      vec2 o = vec2(float(x), float(y)) * px * (2.0 + bass * 4.0);
      vec3 s = texture(u_feedback, uv + o).rgb;
      float l = max(max(s.r, s.g), s.b);
      bloom += s * smoothstep(0.45, 1.2, l);
    }
  }
  bloom /= 25.0;

  vec3 col = mix(scene, caCol, 0.20 + highs * 0.25);
  float bloomMix = (u_mode == 1) ? (0.12 + energy * 0.18) : (0.22 + energy * 0.35);
  col += bloom * bloomMix;

  float vignette = smoothstep(1.2, 0.28, length((uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0)));
  col *= mix(0.76, 1.0, vignette);

  col = toneMap(col);
  float blackoutGain = (u_mode == 2) ? (1.0 - u_blackout * 0.97) : (1.0 - u_blackout);
  col *= blackoutGain;
  col *= (0.95 + onset * 0.08);
  return col;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;

  float bass = u_audioA.x;
  float mids = u_audioA.y;
  float highs = u_audioA.z;
  float energy = u_audioA.w;
  float onset = u_audioB.x;
  float peak = u_audioB.y;
  float guitarDrive = clamp(u_audioB.w, 0.0, 1.0);
  float transportScale = mix(24.0, 120.0, guitarDrive);
  float transport = u_audioB.z * transportScale;

  vec3 scene;
  if (u_mode == 1) {
    scene = modeLiquid(uv, p, bass, mids, highs, energy, onset, transport);
  } else if (u_mode == 2) {
    scene = modeTunnel(uv, p, bass, mids, highs, energy, onset, peak, transport);
  } else if (u_mode == 3) {
    scene = modeFractal(uv, p, bass, mids, highs, energy, onset, peak, transport);
  } else {
    scene = modeChaos(uv, p, bass, mids, highs, energy, onset, peak, transport);
  }

  outColor = vec4(postProcess(uv, scene, bass, mids, highs, energy, onset), 1.0);
}`;

const VERTEX_GLSL = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const COPY_FRAGMENT_GLSL = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  outColor = texture(u_tex, uv);
}`;

export const SHADERS = {
  vertex: VERTEX_GLSL,
  sceneFragment: COMMON_GLSL,
  copyFragment: COPY_FRAGMENT_GLSL,
};
