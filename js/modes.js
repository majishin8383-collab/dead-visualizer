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
uniform sampler2D u_liquid;
uniform float u_transientPulse;
uniform float u_hardTransient;
uniform float u_burstAge;

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
  return vec3(0.15, 0.92, 0.34);
}

vec3 liquidPalette(float t){
  float x = fract(t) * 8.0;
  float i = floor(x);
  float f = fract(x);
  vec3 a = liquidPaletteStop(i);
  vec3 b = liquidPaletteStop(mod(i + 1.0, 8.0));
  return mix(a, b, f);
}

// Mode 1 liquid engine: kept as source-of-truth renderer.
vec3 modeLiquid(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float transport){
  float t = u_time * (0.22 + energy * 0.36) + transport * 0.035;
  vec2 globalDrift = vec2(0.08, -0.06) * u_time + vec2(transport * 0.0024, -transport * 0.0018);
  vec2 base = p * 0.88 + globalDrift;

  vec2 flowLarge = flowNoise(base * 0.62 + vec2(t * 0.10, -t * 0.08));
  vec2 flowMid = flowNoise(base * 1.45 + vec2(-t * 0.24, t * 0.20));
  vec2 flowFine = flowNoise(base * 3.9 + vec2(t * 0.66, -t * 0.61));

  float c1 = curlField(base * 0.95 + vec2(t * 0.15, -t * 0.11));
  float c2 = curlField(base * 1.85 + vec2(-t * 0.34, t * 0.27));
  vec2 curlVec = normalize(vec2(-c1 - c2, c1 - c2) + vec2(1e-4));

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

vec3 finalize(vec3 col, float blackout){
  col = toneMap(col);
  col *= (1.0 - blackout);
  return max(col, 0.0);
}

vec2 rotateAroundCenter(vec2 uv, float angle){
  vec2 centered = uv - 0.5;
  centered = rot(angle) * centered;
  return centered + 0.5;
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
  float guitarDrive = clamp(u_audioB.w, 0.0, 1.0);
  float transportScale = mix(24.0, 120.0, guitarDrive);
  float transport = u_audioB.z * transportScale;

  vec3 scene;
  if (u_mode == 1) {
    scene = texture(u_liquid, uv).rgb;
  } else if (u_mode == 2) {
    const int MAX_ITER = 128;

    float zoomSpeed = 0.075;
    float loopPhase = fract(u_time * zoomSpeed);
    float zoom = mix(2.35, 0.32, pow(loopPhase, 1.45));

    vec2 z0 = (uv - 0.5) * zoom;
    z0.x *= u_resolution.x / u_resolution.y;
    float angle = u_time * 0.025;
    z0 = rot(angle) * z0;
    float sector = 6.28318 / 6.0;
    float mandalaA = atan(z0.y, z0.x);
    float mandalaR = length(z0);
    mandalaA = mod(mandalaA, sector);
    mandalaA = abs(mandalaA - sector * 0.5);
    z0 = mandalaR * vec2(cos(mandalaA), sin(mandalaA));

    vec2 julia = vec2(
      0.7885 * cos(u_time * 0.1),
      0.7885 * sin(u_time * 0.13)
    );
    julia += vec2(mids * 0.1, mids * -0.08);

    vec2 z = z0;
    float iter = 0.0;
    float orbitTrap = 10.0;
    float filament = 0.0;
    for(int i = 0; i < MAX_ITER; i++){
      if(dot(z, z) > 4.0) break;
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + julia;
      orbitTrap = min(orbitTrap, length(z + vec2(0.35, -0.22)));
      filament += exp(-6.0 * abs(z.x * z.y)) * 0.015;
      iter += 1.0;
    }

    float zz = max(dot(z, z), 1.0001);
    float smoothIter = iter - log2(log2(zz)) + 4.0;
    float t = clamp(smoothIter / float(MAX_ITER), 0.0, 1.0);

    float hueShift = u_time * 0.1 + highs * 0.3;
    float trapGlow = exp(-orbitTrap * 7.0);
    float branch = atan(z.y, z.x) * 0.15915494 + 0.5;
    float paletteT = hueShift + t * 0.45 + branch * 0.35 + trapGlow * 0.5 + filament;
    vec3 baseCol = 0.5 + 0.5 * cos(6.28318 * (paletteT + vec3(0.0, 0.33, 0.67)));
    baseCol = pow(baseCol, vec3(0.8));
    baseCol *= 1.4;

    float insideMask = smoothstep(float(MAX_ITER) - 1.0, float(MAX_ITER), iter);
    vec3 deepBlack = vec3(0.003, 0.004, 0.012);
    vec3 col = mix(baseCol, deepBlack, insideMask);

    float boundary = smoothstep(0.08, 0.95, trapGlow + filament + t * 0.3) * (1.0 - insideMask);
    vec3 accent = vec3(0.06, 0.95, 1.0) * (0.6 + 0.4 * sin(paletteT * 6.28318 + 1.2))
                + vec3(1.0, 0.14, 0.84) * (0.4 + 0.6 * sin(paletteT * 6.28318 + 3.7))
                + vec3(0.22, 1.0, 0.34) * (0.35 + 0.65 * sin(paletteT * 6.28318 + 5.1))
                + vec3(1.0, 0.42, 0.04) * (0.3 + 0.7 * sin(paletteT * 6.28318 + 2.4));
    col += accent * boundary * (0.18 + trapGlow * 0.55);

    float energyPulse = 1.0 + energy * 0.45 + 0.08 * sin(u_time * 7.0 + iter * 0.08);
    scene = min(col * energyPulse, vec3(1.2));
  } else if (u_mode == 3) {
    scene = texture(u_liquid, uv).rgb;
  } else {
    scene = texture(u_liquid, uv).rgb;
  }

  float blackoutGain = u_blackout;
  outColor = vec4(finalize(scene, blackoutGain), 1.0);
}`;

const LIQUID_FRAGMENT_GLSL = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_audioA;
uniform vec4 u_audioB;

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

vec3 liquidPaletteStop(float i){
  if(i < 0.5) return vec3(0.00, 0.90, 1.00);
  if(i < 1.5) return vec3(0.12, 0.28, 1.00);
  if(i < 2.5) return vec3(0.95, 0.10, 1.00);
  if(i < 3.5) return vec3(0.58, 0.10, 0.95);
  if(i < 4.5) return vec3(1.00, 0.09, 0.18);
  if(i < 5.5) return vec3(1.00, 0.38, 0.00);
  if(i < 6.5) return vec3(1.00, 0.88, 0.08);
  return vec3(0.15, 0.92, 0.34);
}

vec3 liquidPalette(float t){
  float x = fract(t) * 8.0;
  float i = floor(x);
  float f = fract(x);
  vec3 a = liquidPaletteStop(i);
  vec3 b = liquidPaletteStop(mod(i + 1.0, 8.0));
  return mix(a, b, f);
}

vec3 modeLiquid(vec2 p, float bass, float mids, float highs, float energy, float onset, float transport){
  float t = u_time * (0.22 + energy * 0.36) + transport * 0.035;
  vec2 globalDrift = vec2(0.08, -0.06) * u_time + vec2(transport * 0.0024, -transport * 0.0018);
  vec2 base = p * 0.88 + globalDrift;

  vec2 flowLarge = flowNoise(base * 0.62 + vec2(t * 0.10, -t * 0.08));
  vec2 flowMid = flowNoise(base * 1.45 + vec2(-t * 0.24, t * 0.20));
  vec2 flowFine = flowNoise(base * 3.9 + vec2(t * 0.66, -t * 0.61));

  float c1 = curlField(base * 0.95 + vec2(t * 0.15, -t * 0.11));
  float c2 = curlField(base * 1.85 + vec2(-t * 0.34, t * 0.27));
  vec2 curlVec = normalize(vec2(-c1 - c2, c1 - c2) + vec2(1e-4));

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

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;

  float bass = u_audioA.x;
  float mids = u_audioA.y;
  float highs = u_audioA.z;
  float energy = u_audioA.w;
  float onset = u_audioB.x;
  float guitarDrive = clamp(u_audioB.w, 0.0, 1.0);
  float transportScale = mix(24.0, 120.0, guitarDrive);
  float transport = u_audioB.z * transportScale;

  outColor = vec4(modeLiquid(p, bass, mids, highs, energy, onset, transport), 1.0);
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
  liquidFragment: LIQUID_FRAGMENT_GLSL,
  sceneFragment: COMMON_GLSL,
  copyFragment: COPY_FRAGMENT_GLSL,
};
