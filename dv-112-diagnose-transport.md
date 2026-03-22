# dv-112-diagnose-transport

Diagnosis only. No visual code changes.

## 1) Transport/speed calculation, update, accumulation, and shader application locations

### `js/audio.js`

#### `js/audio.js:35` (transport init)
```js
    this.freqData = null;
    this.timeData = null;

    this.ready = false;
    this.lastEnergy = 0;
    this.transport = 160;
    this.transportPhase = 0;

    this.lastUpdateAt = performance.now();
    this.lastDebugAt = 0;
```

#### `js/audio.js:36` (transport phase init)
```js
    this.timeData = null;

    this.ready = false;
    this.lastEnergy = 0;
    this.transport = 160;
    this.transportPhase = 0;

    this.lastUpdateAt = performance.now();
    this.lastDebugAt = 0;

    // Envelope state (smoothed audio followers, not phase accumulators)
```

#### `js/audio.js:138` (fallback transport output)
```js
        mids: 0,
        highs: 0,
        guitar: 0,
        air: 0,
        energy: 0,
        transport: 160,
        onset: 0,
        peak: 0,
        silence: 1,
      };
    }
```

#### `js/audio.js:175` (envelope follower update)
```js
    this.smooth.lowMid = followEnvelope(this.smooth.lowMid, this.raw.lowMid, 13, 5.5, dt);
    this.smooth.mids = followEnvelope(this.smooth.mids, this.raw.mids, 14, 6, dt);
    this.smooth.highs = followEnvelope(this.smooth.highs, this.raw.highs, 16, 7, dt);
    this.smooth.air = followEnvelope(this.smooth.air, this.raw.air, 18, 8, dt);
    this.smooth.guitar = followEnvelope(this.smooth.guitar, this.raw.guitar, 14, 6, dt);
    this.smooth.energy = followEnergyEnvelope(this.smooth.energy, this.raw.energy, 0.05, 0.85);
    this.smooth.onset = followEnvelope(this.smooth.onset, this.raw.onset, 34, 6, dt);
    this.smooth.peak = followEnvelope(this.smooth.peak, this.raw.peak, 42, 2.8, dt);
    this.smooth.silence = followEnvelope(this.smooth.silence, this.raw.silence, 10, 3.5, dt);

    // Speed is derived fresh from live envelope state every frame (no ratcheting).
```

#### `js/audio.js:183` (speed fresh calculation)
```js
    this.smooth.silence = followEnvelope(this.smooth.silence, this.raw.silence, 10, 3.5, dt);

    // Speed is derived fresh from live envelope state every frame (no ratcheting).
    // Units are phase-cycles per second, guided by musical energy + onsets.
    const highsMotionInfluence = Math.min(this.smooth.highs * 0.1, 0.15);
    this.motion.speed =
      clamp(0.03 + this.smooth.bass * 0.75 + this.smooth.mids * 0.2 + this.smooth.onset * 0.12 + highsMotionInfluence, 0.02, 1.8) *
      0.4;

    // Hard-cut transport in silence so visuals can drop fully to black immediately.
    if (this.smooth.silence > SILENCE_THRESHOLD) {
```

#### `js/audio.js:188` (silence reset gate)
```js
    this.motion.speed =
      clamp(0.03 + this.smooth.bass * 0.75 + this.smooth.mids * 0.2 + this.smooth.onset * 0.12 + highsMotionInfluence, 0.02, 1.8) *
      0.4;

    // Hard-cut transport in silence so visuals can drop fully to black immediately.
    if (this.smooth.silence > SILENCE_THRESHOLD) {
      this.transportPhase = 0;
      this.transport = 0;
    } else {
      // Phase accumulates for animation continuity; exposed transport is normalized phase [0..1].
      this.transportPhase = (this.transportPhase + this.motion.speed * dt) % 1;
```

#### `js/audio.js:193` (transport accumulation)
```js
    if (this.smooth.silence > SILENCE_THRESHOLD) {
      this.transportPhase = 0;
      this.transport = 0;
    } else {
      // Phase accumulates for animation continuity; exposed transport is normalized phase [0..1].
      this.transportPhase = (this.transportPhase + this.motion.speed * dt) % 1;
      this.transport = this.transportPhase;
    }

    if (CONFIG.audio.debugTransport && now - this.lastDebugAt > 500) {
      this.lastDebugAt = now;
```

#### `js/audio.js:194` (transport assignment from phase)
```js
      this.transportPhase = 0;
      this.transport = 0;
    } else {
      // Phase accumulates for animation continuity; exposed transport is normalized phase [0..1].
      this.transportPhase = (this.transportPhase + this.motion.speed * dt) % 1;
      this.transport = this.transportPhase;
    }

    if (CONFIG.audio.debugTransport && now - this.lastDebugAt > 500) {
      this.lastDebugAt = now;
      console.debug("[audio-debug]", {
```

#### `js/audio.js:217` (transport exported)
```js
      mids: clamp(this.smooth.mids, 0, 1),
      highs: clamp(this.smooth.highs, 0, 1),
      guitar: clamp(this.smooth.guitar, 0, 1),
      air: clamp(this.smooth.air, 0, 1),
      energy: clamp(this.smooth.energy, 0, 1),
      transport: clamp(this.transport, 0, 1),
      onset: clamp(this.smooth.onset, 0, 1),
      peak: clamp(this.smooth.peak, 0, 1),
      silence: clamp(this.smooth.silence, 0, 1),
    };
  }
```

### `js/visual-engine.js`

#### `js/visual-engine.js:186` (transport to liquid shader)
```js
      );
      gl.uniform4f(
        gl.getUniformLocation(this.liquidProgram, "u_audioB"),
        audio.onset,
        audio.peak,
        audio.transport,
        audio.guitar
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(this.sceneProgram);
```

#### `js/visual-engine.js:221` (transport to scene shader)
```js
      );
      gl.uniform4f(
        gl.getUniformLocation(this.sceneProgram, "u_audioB"),
        audio.onset,
        audio.peak,
        audio.transport,
        audio.guitar
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(this.copyProgram);
```

### `js/modes.js`

#### `js/modes.js:92` (transport used in mode dynamics)
```glsl
  return mix(a, b, f);
}

// Mode 1 liquid engine: kept as source-of-truth renderer.
vec3 modeLiquid(vec2 uv, vec2 p, float bass, float mids, float highs, float energy, float onset, float transport){
  float t = u_time * (0.22 + energy * 0.36) + transport * 0.035;
  vec2 globalDrift = vec2(0.08, -0.06) * u_time + vec2(transport * 0.0024, -transport * 0.0018);
  vec2 base = p * 0.88 + globalDrift;

  vec2 flowLarge = flowNoise(base * 0.62 + vec2(t * 0.10, -t * 0.08));
  vec2 flowMid = flowNoise(base * 1.45 + vec2(-t * 0.24, t * 0.20));
```

#### `js/modes.js:178` and `:179` (scene shader scaling of transport)
```glsl
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
```

#### `js/modes.js:269` (liquid shader transport time term)
```glsl
  vec3 b = liquidPaletteStop(mod(i + 1.0, 8.0));
  return mix(a, b, f);
}

vec3 modeLiquid(vec2 p, float bass, float mids, float highs, float energy, float onset, float transport){
  float t = u_time * (0.22 + energy * 0.36) + transport * 0.035;
  vec2 globalDrift = vec2(0.08, -0.06) * u_time + vec2(transport * 0.0024, -transport * 0.0018);
  vec2 base = p * 0.88 + globalDrift;

  vec2 flowLarge = flowNoise(base * 0.62 + vec2(t * 0.10, -t * 0.08));
  vec2 flowMid = flowNoise(base * 1.45 + vec2(-t * 0.24, t * 0.20));
```

#### `js/modes.js:349` and `:350` (liquid shader scaling of transport)
```glsl
  float mids = u_audioA.y;
  float highs = u_audioA.z;
  float energy = u_audioA.w;
  float onset = u_audioB.x;
  float guitarDrive = clamp(u_audioB.w, 0.0, 1.0);
  float transportScale = mix(24.0, 120.0, guitarDrive);
  float transport = u_audioB.z * transportScale;

  outColor = vec4(modeLiquid(p, bass, mids, highs, energy, onset, transport), 1.0);
}`;
```

## 2) Root-cause assessment against checklist

### Is transport being added to itself each frame?
**Yes, but intentionally through `transportPhase` integration** in `audio.update()`:
- `this.transportPhase = (this.transportPhase + this.motion.speed * dt) % 1;`
- Then `this.transport = this.transportPhase;`

That is explicit frame-to-frame accumulation. It should still reset on silence via the branch above it.

### Is there a `+=` instead of a fresh calculation?
**No direct `+=` for transport or speed** in the transport path.
- `this.motion.speed` is assigned freshly each frame.
- Transport accumulation is done with `a = a + b` style, not `+=`, but behavior is equivalent integration.

### Is envelope follower output being summed rather than replaced?
**For energy smoothing: yes, by design as an IIR follower** (`followEnergyEnvelope`) where decay branch does:
- `current * decay + target * (1 - decay)`

This is smoothing, not runaway summation, and output is clamped `[0,1]`.

### Is there a missing decay that should multiply by `< 1.0`?
**No obvious missing decay in the envelope path** (decay exists in `followEnergyEnvelope`, plus release in `followEnvelope`).

The likely issue is **silence gating not engaging often enough**, because transport reset depends on:
- `if (this.smooth.silence > SILENCE_THRESHOLD)` with `SILENCE_THRESHOLD = 0.3`.

Given `this.raw.silence = clamp(1 - this.raw.energy * 1.55, 0, 1)` and smoothing on silence, quiet passages may not cross `> 0.3` reliably, allowing transport phase to continue integrating.

## 3) Most likely accumulation driver

Primary accumulation point to target in the follow-up fix:
- `js/audio.js:193` (`this.transportPhase = (this.transportPhase + this.motion.speed * dt) % 1;`)

Primary gate controlling whether accumulation stops:
- `js/audio.js:188` (`if (this.smooth.silence > SILENCE_THRESHOLD)`) with threshold constant at `0.3`.

Secondary oddity worth checking in follow-up (not a visual fix, just data sanity):
- Constructor and not-ready return both set `transport: 160`, which is immediately clamped later when running, but can produce misleading debug/HUD states pre-ready.
