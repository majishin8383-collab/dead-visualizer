import { SHADERS } from "./modes.js";

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${info}`);
  }
  return shader;
}

function createProgram(gl, vertexSrc, fragmentSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${info}`);
  }
  return program;
}

function createRenderTexture(gl, width, height) {
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

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Framebuffer is incomplete");
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

    this.sceneProgram = createProgram(this.gl, SHADERS.vertex, SHADERS.sceneFragment);
    this.copyProgram = createProgram(this.gl, SHADERS.vertex, SHADERS.copyFragment);

    this.quadVao = this.gl.createVertexArray();
    const quadVbo = this.gl.createBuffer();
    this.gl.bindVertexArray(this.quadVao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, quadVbo);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      this.gl.STATIC_DRAW
    );
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.bindVertexArray(null);

    this.targets = { ping: null, pong: null };
    this.modeFailure = new Set();

    this.resize(canvas.width || window.innerWidth, canvas.height || window.innerHeight);
  }

  resize(width, height) {
    const gl = this.gl;
    this.canvas.width = Math.max(1, width);
    this.canvas.height = Math.max(1, height);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.targets.ping = createRenderTexture(gl, this.canvas.width, this.canvas.height);
    this.targets.pong = createRenderTexture(gl, this.canvas.width, this.canvas.height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.ping.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.pong.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  swapTargets() {
    const temp = this.targets.ping;
    this.targets.ping = this.targets.pong;
    this.targets.pong = temp;
  }

  render(params) {
    const {
      mode,
      time,
      dt,
      blackout,
      audio,
    } = params;

    const gl = this.gl;
    const safeMode = this.modeFailure.has(mode) ? 1 : mode;

    try {
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.quadVao);

      gl.useProgram(this.sceneProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.ping.fbo);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.targets.pong.tex);
      gl.uniform1i(gl.getUniformLocation(this.sceneProgram, "u_feedback"), 0);

      gl.uniform2f(gl.getUniformLocation(this.sceneProgram, "u_resolution"), this.canvas.width, this.canvas.height);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_time"), time);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_dt"), dt);
      gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "u_blackout"), blackout);
      gl.uniform1i(gl.getUniformLocation(this.sceneProgram, "u_mode"), safeMode);
      gl.uniform4f(
        gl.getUniformLocation(this.sceneProgram, "u_audioA"),
        audio.bass,
        audio.mids,
        audio.highs,
        audio.energy
      );
      gl.uniform4f(
        gl.getUniformLocation(this.sceneProgram, "u_audioB"),
        audio.onset,
        audio.peak,
        audio.transport,
        audio.silence
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(this.copyProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.targets.ping.tex);
      gl.uniform1i(gl.getUniformLocation(this.copyProgram, "u_tex"), 0);
      gl.uniform2f(gl.getUniformLocation(this.copyProgram, "u_resolution"), this.canvas.width, this.canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      this.swapTargets();
    } catch (err) {
      this.modeFailure.add(mode);
      console.error(`Mode ${mode} render failed, switching to fallback`, err);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      throw err;
    }
  }
}
