const COMMON_GLSL = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_motionEnabled;
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
vec3 modeLiquid(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float transport, float transportNorm){
  float motionTime = u_time * transportNorm * u_motionEnabled;
  float t = motionTime * (0.16 + energy * 0.24) + transport * 0.02;
  vec2 globalDrift = vec2(0.08, -0.06) * motionTime + vec2(transport * 0.0024, -transport * 0.0018);
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

  float hueSpin = motionTime * (0.028 + energy * 0.036 + mids * 0.021) + transport * 0.0016;
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

  float shimmer = smoothstep(0.6, 0.95, fbm(q2 * 11.0 + vec2(motionTime * 1.1, -motionTime * 0.95)));
  col += foamCol * shimmer * highs * 0.12;

  float micro = fbm(q2 * 14.5 + vec2(0.78 * motionTime, -0.65 * motionTime)) - 0.5;
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

vec3 neonPalette(float t){
  vec3 cyan = vec3(0.05, 0.92, 1.00);
  vec3 magenta = vec3(0.96, 0.10, 0.94);
  vec3 green = vec3(0.22, 1.00, 0.34);
  vec3 purple = vec3(0.50, 0.15, 1.00);
  vec3 orange = vec3(1.00, 0.42, 0.04);
  float x = fract(t) * 5.0;
  float i = floor(x);
  float f = fract(x);
  vec3 a = (i < 0.5) ? cyan : (i < 1.5) ? magenta : (i < 2.5) ? green : (i < 3.5) ? purple : orange;
  vec3 b = (i < 0.5) ? magenta : (i < 1.5) ? green : (i < 2.5) ? purple : (i < 3.5) ? orange : cyan;
  return mix(a, b, f);
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
  float transportNorm = clamp(u_audioB.z, 0.0, 1.0);
  float transportScale = mix(14.0, 72.0, guitarDrive);
  float transport = transportNorm * transportScale;
  float motionTime = u_time * transportNorm * u_motionEnabled;

  vec3 scene;
  if (u_mode == 1) {
    scene = texture(u_liquid, uv).rgb;
  } else if (u_mode == 2) {
    // dv-120: iterative fractal portal + spiral mandala engine in polar space.
    const float PI = 3.14159265;

    vec2 mp = p;
    float r = length(mp) + 1e-5;
    float a = atan(mp.y, mp.x);

    // Angular repetition in polar domain for mandala symmetry.
    float folds = 10.0 + floor(mids * 6.0);
    float foldAngle = (2.0 * PI) / folds;
    a = abs(mod(a, foldAngle) - 0.5 * foldAngle);
    mp = vec2(cos(a), sin(a)) * r;

    // Recursive zoom in fractal space; bounded looping avoids runaway speed.
    float mode2Speed = (transportNorm * 0.62 + onset * 0.18 + energy * 0.10) * u_motionEnabled;
    float zoom = motionTime * mode2Speed * (0.10 + bass * 0.05 + energy * 0.02);
    float zoomLoop = mod(zoom, 6.0) - 3.0;
    mp *= exp(zoomLoop);

    float burst = exp(-u_burstAge * 3.2) * u_hardTransient;
    float spiral = a + log(r + 1e-4) * (1.6 + bass * 0.8) - motionTime * mode2Speed * (0.12 + bass * 0.06);
    float spiralTwist = 0.22 + mids * 0.28;
    mp = rot(spiral * spiralTwist) * mp;

    float distortAmt = 0.08 + mids * 0.22 + burst * 0.2;
    vec2 q = mp + flowNoise(mp * (1.4 + highs * 0.9) + vec2(0.0, motionTime * 0.035 * mode2Speed)) * distortAmt;

    float trapMin = 1e4;
    float trapAccum = 0.0;
    float petals = 0.0;
    float depthMix = 3.5 + bass * 2.0 + burst * 1.5;

    // REQUIRED recursive fractal construction loop.
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float iterMask = step(fi, depthMix + 2.0);
      vec2 wobble = vec2(
        sin(motionTime * (0.09 + fi * 0.015) + q.y * (1.0 + fi * 0.15)),
        cos(motionTime * (0.08 + fi * 0.018) - q.x * (1.15 + fi * 0.14))
      ) * (0.04 + highs * 0.07);

      q = abs(q + wobble);
      float invDen = max(dot(q, q), 0.06 + 0.03 * bass);
      q = q / invDen - vec2(0.72 + mids * 0.2, 0.66 + bass * 0.16);
      q *= rot(0.09 + fi * (0.028 + mids * 0.012));

      float l = length(q);
      trapMin = min(trapMin, l);
      trapAccum += iterMask * exp(-l * (1.4 + fi * 0.24));
      petals += iterMask * exp(-abs(q.x * q.y) * (6.0 + fi * 0.8));
    }

    float d = length(q);
    float structure = sat(trapAccum * 0.95 + petals * 0.2);
    float centerRegen = exp(-length(mp) * (7.5 - bass * 2.2));
    float portalCore = exp(-trapMin * (8.0 + burst * 5.0));
    float spiralMask = sat(0.5 + 0.5 * sin(spiral * 6.0 + trapAccum * 2.5));

    // Structural color from fractal output (not flat gradients / ring masks).
    float hueDrift = motionTime * mode2Speed * (0.18 + highs * 0.1) + burst * 1.1;
    vec3 col = vec3(
      sin(d * 3.2 + trapAccum * 1.8 + hueDrift),
      sin(d * 2.4 + petals * 1.2 + 2.0 + hueDrift * 0.9),
      sin(d * 4.1 + trapMin * 6.0 + 4.0 + hueDrift * 1.1)
    ) * 0.5 + 0.5;

    vec3 warm = vec3(1.00, 0.22, 0.08);
    vec3 cool = vec3(0.04, 0.84, 1.00);
    vec3 violet = vec3(0.72, 0.10, 1.00);
    vec3 acid = vec3(0.75, 1.00, 0.16);

    col = mix(col, mix(violet, cool, sat(structure)), 0.62);
    col = mix(col, warm, sat(0.25 + burst * 0.55 + onset * 0.25) * sat(petals));
    col = mix(col, acid, highs * 0.16 * spiralMask);

    float edge = sat(structure * 0.8 + centerRegen * 0.45 + spiralMask * 0.3);
    // Remove legacy darkening floor that muted saturated detail in the portal shell.
    col *= 0.26 + edge * 1.24;
    col += centerRegen * mix(violet, cool, 0.5 + 0.5 * sin(motionTime * 0.6 + trapAccum * 1.4));
    col += portalCore * (0.6 + burst * 0.6) * mix(cool, violet, 0.5 + 0.5 * sin(motionTime * 0.9));

    // Match Mode 1 vividness profile: stronger saturation/contrast without changing motion logic.
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, 1.46 + highs * 0.20);
    col = (col - 0.5) * (1.10 + mids * 0.18) + 0.5;
    col *= 1.18 + energy * 0.10;

    float bloomMask = sat(edge * 0.75 + portalCore * 0.45);
    vec3 bloomTint = mix(cool, violet, 0.5 + 0.5 * sin(motionTime * 0.7 + d * 1.2));
    col += bloomTint * bloomMask * (0.06 + highs * 0.03);

    // Keep soft highlight shoulder but reduce damping so Mode 2 matches Mode 1 vibrance.
    col = col / (1.0 + max(col.r, max(col.g, col.b)) * 0.55);
    scene = max(col, 0.0);
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
uniform float u_motionEnabled;
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

vec3 modeLiquid(vec2 p, float bass, float mids, float highs, float energy, float onset, float transport, float transportNorm){
  float motionTime = u_time * transportNorm * u_motionEnabled;
  float t = motionTime * (0.16 + energy * 0.24) + transport * 0.02;
  vec2 globalDrift = vec2(0.08, -0.06) * motionTime + vec2(transport * 0.0024, -transport * 0.0018);
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

  float hueSpin = motionTime * (0.028 + energy * 0.036 + mids * 0.021) + transport * 0.0016;
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

  float shimmer = smoothstep(0.6, 0.95, fbm(q2 * 11.0 + vec2(motionTime * 1.1, -motionTime * 0.95)));
  col += foamCol * shimmer * highs * 0.12;

  float micro = fbm(q2 * 14.5 + vec2(0.78 * motionTime, -0.65 * motionTime)) - 0.5;
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
  float transportNorm = clamp(u_audioB.z, 0.0, 1.0);
  float transportScale = mix(14.0, 72.0, guitarDrive);
  float transport = transportNorm * transportScale;

  outColor = vec4(modeLiquid(p, bass, mids, highs, energy, onset, transport, transportNorm), 1.0);
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

export const MODE_MOTION_SETTINGS = {
  1: { motionScale: 0.35, baseFlow: 0.02 },
  2: { motionScale: 0.2, baseFlow: 0.01 },
  3: { motionScale: 0.4, baseFlow: 0.02 },
  4: { motionScale: 0.5, baseFlow: 0.03 },
};
