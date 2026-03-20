import { CONFIG } from "./config.js";
import { drawBlackFade, computeBlackout } from "./transitions.js";
import { renderMode } from "./modes.js";

export class Renderer {
  constructor(canvas, audioEngine, eventsEngine, hudRefs) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.audioEngine = audioEngine;
    this.eventsEngine = eventsEngine;
    this.hudRefs = hudRefs;

    this.width = 0;
    this.height = 0;

    this.mode = CONFIG.modes.defaultMode;
    this.autoMode = false;
    this.autoSwitchTimer = 0;

    this.masterTime = 0;
    this.transportPhase = 0;
    this.transportSpeed = 0.01;

    this.prevCanvas = document.createElement("canvas");
    this.prevCtx = this.prevCanvas.getContext("2d");

    this.fieldCanvas = document.createElement("canvas");
    this.fieldCtx = this.fieldCanvas.getContext("2d", { alpha: false });
    this.fieldW = 240;
    this.fieldH = 135;
    this.fieldImage = null;

    this.running = false;

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.updateHudMode();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.prevCanvas.width = this.width;
    this.prevCanvas.height = this.height;

    const scale = Math.max(
      CONFIG.render.fieldMin,
      Math.min(CONFIG.render.fieldMax, Math.round(this.width / CONFIG.render.fieldDivisor))
    );

    this.fieldW = scale;
    this.fieldH = Math.max(100, Math.round(scale * (this.height / this.width)));
    this.fieldCanvas.width = this.fieldW;
    this.fieldCanvas.height = this.fieldH;
    this.fieldImage = this.fieldCtx.createImageData(this.fieldW, this.fieldH);
  }

  setMode(mode) {
    this.mode = mode;
    this.updateHudMode();
  }

  toggleAutoMode() {
    this.autoMode = !this.autoMode;
    this.autoSwitchTimer = 0;
  }

  updateHudMode() {
    this.hudRefs.modeLabel.textContent = CONFIG.modes.names[this.mode] || "Unknown";
  }

  copyFrameToBuffer() {
    this.prevCtx.clearRect(0, 0, this.width, this.height);
    this.prevCtx.drawImage(this.canvas, 0, 0);
  }

  start() {
    this.running = true;
    this.loop();
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this.loop());

    const audio = this.audioEngine.update();
    const events = this.eventsEngine.update();

    this.transportSpeed = 0.001 + audio.transport * 0.030 + audio.onset * 0.012;
    this.masterTime += 0.016;
    this.transportPhase += this.transportSpeed;

    if (this.autoMode) {
      this.autoSwitchTimer += 0.016 * (0.8 + audio.transport * 1.5);
      if (this.autoSwitchTimer > CONFIG.modes.autoCycleSeconds) {
        this.autoSwitchTimer = 0;
        this.mode = this.mode >= 4 ? 1 : this.mode + 1;
        this.updateHudMode();
      }
    }

    const blackout = computeBlackout(
      audio.silence,
      audio.energy,
      events.blackoutPulse,
      CONFIG
    );

    drawBlackFade(this.ctx, this.width, this.height, blackout.fade);

    renderMode({
      mode: this.mode,
      ctx: this.ctx,
      prevCanvas: this.prevCanvas,
      fieldCanvas: this.fieldCanvas,
      fieldCtx: this.fieldCtx,
      fieldImage: this.fieldImage,
      fieldW: this.fieldW,
      fieldH: this.fieldH,
      width: this.width,
      height: this.height,
      masterTime: this.masterTime,
      transportPhase: this.transportPhase,
      audio,
    });

    if (blackout.hard) {
      drawBlackFade(this.ctx, this.width, this.height, 0.92);
    }
    if (blackout.full) {
      drawBlackFade(this.ctx, this.width, this.height, 1.0);
    }

    this.copyFrameToBuffer();

    this.hudRefs.transportLabel.textContent = audio.transport.toFixed(2);
    this.hudRefs.energyLabel.textContent = audio.energy.toFixed(2);
    this.hudRefs.silenceLabel.textContent = audio.silence.toFixed(2);
  }
}