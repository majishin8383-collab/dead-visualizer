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

vec3 modeLiquid(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float transport){
  float t = u_time * (0.15 + energy * 0.45);
  vec2 warp = vec2(
    fbm(p * 2.5 + vec2(t, -t * 0.6)),
    fbm(p * 2.3 + vec2(-t * 0.4, t * 0.9))
  ) - 0.5;
  warp += 0.24 * vec2(sin(p.y * 5.0 + t * 3.0), cos(p.x * 4.0 - t * 2.1));
  warp *= 1.4 + bass * 1.8;
  vec2 q = p + warp;

  float fluid = fbm(q * (3.2 + mids * 4.8) + transport * 0.18);
  float stream = sin((q.x + q.y) * 7.0 + t * 4.0 + fluid * 8.0);
  float blobs = fbm(q * 7.0 - vec2(t * 1.6, -t * 1.2));

  float hue = fluid * 0.65 + stream * 0.14 + blobs * 0.35 + highs * 0.16;
  vec3 col = palette(hue + uv.x * 0.15 + uv.y * 0.11);
  col *= 0.65 + 1.25 * smoothstep(0.05, 0.95, blobs + stream * 0.2);
  col *= 0.95 + onset * 0.9;

  col.r += 0.18 * bass;
  col.g += 0.12 * highs;
  col.b += 0.24 * mids;
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
  col += bloom * (0.22 + energy * 0.35);

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
