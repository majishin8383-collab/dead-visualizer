const COMMON_GLSL = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_dt;
uniform float u_blackout;
uniform int u_mode;
uniform vec4 u_audioA; // bass, mids, highs, energy
uniform vec4 u_audioB; // onset, peak, transport, silence
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

vec3 modeTunnel(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float peak, float transport){
  vec2 tp = p;
  float t = u_time * 0.45 + transport * 0.06;
  float r = length(tp);
  float a = atan(tp.y, tp.x);

  tp *= rot(0.45 * sin(t * 0.6) + mids * 0.35);
  float radial = 1.0 / max(r, 0.08 + bass * 0.03);
  float tunnel = sin(radial * (8.0 + bass * 18.0) - t * 5.0 + a * 3.0);
  float vort = sin(a * (7.0 + mids * 14.0) + t * 2.4 + tunnel * 2.0);
  float depth = fbm(vec2(radial * 0.75, a * 1.5 + t));

  vec2 feedbackUv = uv;
  float zoom = 1.012 + bass * 0.03 + onset * 0.02;
  feedbackUv = (feedbackUv - 0.5) / zoom + 0.5;
  feedbackUv = (rot(0.003 + mids * 0.022) * (feedbackUv - 0.5)) + 0.5;
  feedbackUv += vec2(sin(t * 0.7), cos(t * 0.6)) * 0.0025 * (1.0 + bass * 2.0);
  vec3 fb = texture(u_feedback, feedbackUv).rgb;

  float hue = depth * 0.7 + vort * 0.17 + tunnel * 0.22;
  vec3 col = palette(hue + r * 0.32 + highs * 0.16);
  col *= 0.45 + 0.95 * smoothstep(-0.8, 0.9, tunnel + depth);
  col += fb * (0.58 + energy * 0.22);
  col *= 1.0 - smoothstep(0.82, 1.3, r) * 0.18;
  col += (0.22 + peak * 0.55) * vec3(1.0, 0.25, 0.62) * smoothstep(0.87, 1.0, onset);

  return max(col, 0.0);
}

vec3 modeFractal(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float peak, float transport){
  vec2 z = p * (1.5 + bass * 0.8);
  vec2 c = vec2(sin(u_time * 0.17), cos(u_time * 0.21)) * (0.28 + mids * 0.28);
  float iter = 0.0;
  float minTrap = 10.0;

  for(int i=0;i<34;i++){
    z = abs(z);
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    z *= rot(0.025 + 0.11 * sin(u_time * 0.2 + float(i) * 0.13 + mids));
    float m = dot(z, z);
    minTrap = min(minTrap, abs(z.x) + abs(z.y));
    if(m > 16.0) break;
    iter += 1.0;
  }

  float normIter = iter / 34.0;
  float bloom = exp(-4.0 * minTrap) * (1.2 + highs * 0.8);
  float petals = sin(atan(p.y, p.x) * (6.0 + mids * 8.0) + transport * 0.1 + bloom * 3.0);

  vec3 col = palette(normIter * 0.6 + petals * 0.08 + bloom * 0.2);
  col *= 0.45 + normIter * 1.25 + bloom * 1.4;
  col += vec3(0.35, 0.05, 0.42) * smoothstep(0.55, 1.0, bloom) * (0.7 + peak);
  col *= 0.95 + onset * 0.55;
  return col;
}

vec3 modeChaos(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float peak, float transport){
  vec3 a = modeLiquid(uv, p * rot(0.2), bass, mids, highs, energy, onset, transport);
  vec3 b = modeTunnel(uv, p * rot(-0.3), bass, mids, highs, energy, onset, peak, transport);
  vec3 c = modeFractal(uv, p * 1.2, bass, mids, highs, energy, onset, peak, transport);

  vec2 dUv = uv + vec2(
    sin(p.y * 7.0 + u_time * 1.8 + highs * 6.0),
    cos(p.x * 8.0 - u_time * 1.6 + mids * 4.0)
  ) * (0.004 + peak * 0.03);
  vec3 fb = texture(u_feedback, dUv).rgb;

  float mixA = 0.33 + bass * 0.24;
  float mixB = 0.36 + mids * 0.2;
  float mixC = 0.31 + highs * 0.26;
  vec3 col = a * mixA + b * mixB + c * mixC;
  col += fb * (0.25 + energy * 0.32);

  float burst = smoothstep(0.65, 1.0, onset + peak * 0.7);
  col += burst * vec3(0.8, 0.2, 0.45) * (0.4 + highs);
  col *= 1.0 + burst * 0.35;
  return col;
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
  col *= 1.0 - u_blackout;
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
  float transport = u_audioB.z;

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
