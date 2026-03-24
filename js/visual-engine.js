import { SHADERS } from "./modes.js";

function compileShader(gl, type, source, stageName) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "unknown compile error";
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed (${stageName}): ${info}`);
  }
  return shader;
}

function createProgram(gl, vertexSrc, fragmentSrc, label) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc, `${label}:vertex`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc, `${label}:fragment`);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Program link failed (${label}): ${info}`);
  }
  return program;
}

function createRenderTexture(gl, width, height, label) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer is incomplete (${label}), status=${status}`);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, width, height };
}

export class VisualEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });

    if (!this.gl) {
      throw new Error("WebGL2 is unavailable in this browser.");
    }

    this.liquidProgram = createProgram(this.gl, SHADERS.vertex, SHADERS.liquidFragment, "liquid");
    this.sceneProgram = createProgram(this.gl, SHADERS.vertex, SHADERS.sceneFragment, "scene");
    this.copyProgram = createProgram(this.gl, SHADERS.vertex, SHADERS.copyFragment, "copy");

    this.quadVao = this.gl.createVertexArray();
    const quadVbo = this.gl.createBuffer();
    this.gl.bindVertexArray(this.quadVao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, quadVbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), this.gl.STATIC_DRAW);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.bindVertexArray(null);

    this.targets = { ping: null, pong: null, liquid: null };
    this.modeFailure = new Set();
    this.energyHistory = [];
    this.burstAge = 10;
    this.hardTransientFrames = 0;
    this.activeMode = 1;
    this.lastRenderDiagAt = 0;

    this.resize(canvas.width || window.innerWidth, canvas.height || window.innerHeight);
  }

  resize(width, height) {
    const gl = this.gl;
    this.canvas.width = Math.max(1, width);
    this.canvas.height = Math.max(1, height);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.targets.ping = createRenderTexture(gl, this.canvas.width, this.canvas.height, "ping");
    this.targets.pong = createRenderTexture(gl, this.canvas.width, this.canvas.height, "pong");
    this.targets.liquid = createRenderTexture(gl, this.canvas.width, this.canvas.height, "liquid");

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.ping.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.pong.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.liquid.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    console.info("[render-debug] resize", {
      width: this.canvas.width,
      height: this.canvas.height,
      framebuffer: "complete",
    });
  }

  swapTargets() {
    const temp = this.targets.ping;
    this.targets.ping = this.targets.pong;
    this.targets.pong = temp;
  }

  clearFeedbackBuffers() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.ping.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.pong.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  setMode(mode) {
    const previousMode = this.activeMode;
    this.activeMode = mode;
    if (previousMode === 2 && mode !== 2) {
      this.clearFeedbackBuffers();
    }
  }

  updateTransientState(energy, dt) {
    this.energyHistory.push(energy);
    if (this.energyHistory.length > 30) this.energyHistory.shift();

    let rollingAvg = energy;
    if (this.energyHistory.length > 0) {
      const sum = this.energyHistory.reduce((acc, v) => acc + v, 0);
      rollingAvg = sum / this.energyHistory.length;
    }

    const transientPulse =
      rollingAvg > 0.0001 && energy > rollingAvg * 1.5
        ? Math.min(1, energy / (rollingAvg * 1.5) - 1.0 + 0.25)
        : 0;
    if (transientPulse > 0) {
      this.burstAge = 0;
      if (energy > rollingAvg * 2.2) {
        this.hardTransientFrames = 1;
      }
    } else {
      this.burstAge += dt;
    }

    const hardTransient = this.hardTransientFrames > 0 ? 1 : 0;
    if (this.hardTransientFrames > 0) this.hardTransientFrames -= 1;

    return { transientPulse, hardTransient, burstAge: this.burstAge };
  }

  renderDirectToScreen(mode, time, motionEnabled, dt, blackout, audio, transientState) {
    const gl = this.gl;
    const safeMode = this.modeFailure.has(mode) ? 1 : mode;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.sceneProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.targets.pong?.tex || null);
    gl.uniform1i(gl.getUniformLocation(this.sceneProgram, "u_feedback"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.targets.liquid?.tex || null);
    gl.uniform1i(gl.getUniformLocation(this.sceneProgram, "u_liquid"), 1);

    gl.uniform2f(gl.getUniformLocation(this.sceneProgram, "u_resolution"), this.canvas.width, this.canvas.height);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_time"), time);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_motionEnabled"), motionEnabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_dt"), dt);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_blackout"), Math.min(0.92, blackout));
    gl.uniform1i(gl.getUniformLocation(this.sceneProgram, "u_mode"), safeMode);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_transientPulse"), transientState.transientPulse);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_hardTransient"), transientState.hardTransient);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_burstAge"), transientState.burstAge);
    gl.uniform4f(gl.getUniformLocation(this.sceneProgram, "u_audioA"), audio.bass, audio.mids, audio.highs, audio.energy);
    gl.uniform4f(gl.getUniformLocation(this.sceneProgram, "u_audioB"), audio.onset, audio.peak, audio.transport, audio.guitar);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render(params) {
    const { mode, time, motionEnabled, dt, blackout, audio, events } = params;

    const transientState = this.updateTransientState(audio.energy, dt);

    const gl = this.gl;
    const safeMode = this.modeFailure.has(mode) ? 1 : mode;

    void events;

    try {
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.quadVao);

      gl.useProgram(this.liquidProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.liquid.fbo);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.uniform2f(gl.getUniformLocation(this.liquidProgram, "u_resolution"), this.canvas.width, this.canvas.height);
      gl.uniform1f(gl.getUniformLocation(this.liquidProgram, "u_time"), time);
      gl.uniform1f(gl.getUniformLocation(this.liquidProgram, "u_motionEnabled"), motionEnabled ? 1 : 0);
      gl.uniform4f(gl.getUniformLocation(this.liquidProgram, "u_audioA"), audio.bass, audio.mids, audio.highs, audio.energy);
      gl.uniform4f(gl.getUniformLocation(this.liquidProgram, "u_audioB"), audio.onset, audio.peak, audio.transport, audio.guitar);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(this.sceneProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.ping.fbo);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.targets.pong.tex);
      gl.uniform1i(gl.getUniformLocation(this.sceneProgram, "u_feedback"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.targets.liquid.tex);
      gl.uniform1i(gl.getUniformLocation(this.sceneProgram, "u_liquid"), 1);

      gl.uniform2f(gl.getUniformLocation(this.sceneProgram, "u_resolution"), this.canvas.width, this.canvas.height);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_time"), time);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_motionEnabled"), motionEnabled ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_dt"), dt);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_blackout"), Math.min(0.95, blackout));
      gl.uniform1i(gl.getUniformLocation(this.sceneProgram, "u_mode"), safeMode);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_transientPulse"), transientState.transientPulse);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_hardTransient"), transientState.hardTransient);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_burstAge"), transientState.burstAge);
      gl.uniform4f(gl.getUniformLocation(this.sceneProgram, "u_audioA"), audio.bass, audio.mids, audio.highs, audio.energy);
      gl.uniform4f(gl.getUniformLocation(this.sceneProgram, "u_audioB"), audio.onset, audio.peak, audio.transport, audio.guitar);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(this.copyProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.targets.ping.tex);
      gl.uniform1i(gl.getUniformLocation(this.copyProgram, "u_tex"), 0);
      gl.uniform2f(gl.getUniformLocation(this.copyProgram, "u_resolution"), this.canvas.width, this.canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      this.swapTargets();

      const now = performance.now();
      if (now - this.lastRenderDiagAt > 1200) {
        this.lastRenderDiagAt = now;
        console.debug("[render-debug] passes", {
          mode: safeMode,
          modeRenderPassActive: true,
          finalPresentationPassActive: true,
          viewport: `${this.canvas.width}x${this.canvas.height}`,
        });
      }
    } catch (err) {
      this.modeFailure.add(mode);
      console.error(`Mode ${mode} render failed; attempting direct screen fallback.`, err);
      try {
        this.renderDirectToScreen(mode, time, motionEnabled, dt, blackout, audio, transientState);
      } catch (directErr) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0.02, 0.02, 0.03, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        console.error(`Direct fallback render failed for mode ${mode}.`, directErr);
        throw directErr;
      }
    }
  }
}
