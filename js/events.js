import { CONFIG } from "./config.js";

const SOLO_ICON_TYPES = Object.freeze({
  LIGHTNING_BOLT: "lightning_bolt",
  ROSE_BLOOM: "rose_bloom",
  SKULL: "skull",
  DANCING_SKELETON: "dancing_skeleton",
  BEAR_SILHOUETTE: "bear_silhouette",
});

const DEFAULT_SOLO_EVENT_STATE = Object.freeze({
  active: false,
  type: null,
  progress: 0,
  opacity: 0,
  dissolve: 0,
  worldAnchor: [0.5, 0.5],
  triggerEnergy: 0,
  triggerPeak: 0,
});

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function pickWeightedRandom(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const target = Math.random() * total;
  let walk = 0;

  for (const item of items) {
    walk += item.weight;
    if (target <= walk) return item;
  }

  return items[items.length - 1];
}

export class EventsEngine {
  constructor() {
    this.blackoutPulse = 0;

    // Future-facing solo iconography event state.
    // This is intentionally data-only for now: render integration arrives with solo detection.
    this.solo = {
      cooldown: 0,
      elapsed: 0,
      current: null,
      event: { ...DEFAULT_SOLO_EVENT_STATE },
    };
  }

  triggerBlackoutPulse() {
    this.blackoutPulse = 1;
  }

  maybeTriggerSoloEvent(audio) {
    if (!CONFIG.soloEvents.enabled) return;
    if (!audio) return;
    if (this.solo.event.active || this.solo.cooldown > 0) return;

    const soloLead = audio.soloLead ?? audio.guitar ?? 0;
    const hasSoloSignal = soloLead > CONFIG.soloEvents.gates.soloLeadMin;
    const hasPeakSignal = audio.peak > CONFIG.soloEvents.gates.peakMin;

    if (!hasSoloSignal || !hasPeakSignal) return;

    const chanceBoost = clamp(
      (soloLead - CONFIG.soloEvents.gates.soloLeadMin) * 0.55 +
        (audio.peak - CONFIG.soloEvents.gates.peakMin) * 0.8,
      0,
      0.75
    );
    const spawnChance = CONFIG.soloEvents.baseSpawnChance + chanceBoost;

    if (Math.random() > spawnChance) return;

    const pool = CONFIG.soloEvents.pool.filter((item) => item.enabled);
    if (!pool.length) return;

    const picked = pickWeightedRandom(pool);
    this.solo.current = picked;
    this.solo.elapsed = 0;
    this.solo.event = {
      active: true,
      type: picked.id,
      progress: 0,
      opacity: 0,
      dissolve: 0,
      worldAnchor: [Math.random() * 0.8 + 0.1, Math.random() * 0.55 + 0.2],
      triggerEnergy: audio.energy,
      triggerPeak: audio.peak,
    };
  }

  updateSoloEvent(dt, audio) {
    const cfg = CONFIG.soloEvents;
    this.solo.cooldown = Math.max(0, this.solo.cooldown - dt);

    if (!cfg.enabled) {
      this.solo.event = { ...DEFAULT_SOLO_EVENT_STATE };
      return;
    }

    this.maybeTriggerSoloEvent(audio);

    if (!this.solo.event.active || !this.solo.current) return;

    this.solo.elapsed += dt;
    const life = this.solo.current.lifeSeconds;
    const t = clamp(this.solo.elapsed / life, 0, 1);

    const fadeInEnd = this.solo.current.fadeInRatio;
    const holdEnd = this.solo.current.holdRatio;

    let opacity = 1;
    if (t <= fadeInEnd) {
      opacity = fadeInEnd <= 0 ? 1 : clamp(t / fadeInEnd, 0, 1);
    } else if (t > holdEnd) {
      opacity = clamp(1 - (t - holdEnd) / Math.max(1e-5, 1 - holdEnd), 0, 1);
    }

    this.solo.event.progress = t;
    this.solo.event.opacity = opacity;
    this.solo.event.dissolve = 1 - opacity;

    if (t >= 1) {
      this.solo.event = { ...DEFAULT_SOLO_EVENT_STATE };
      this.solo.current = null;
      this.solo.cooldown = cfg.cooldownSeconds.min + Math.random() * (cfg.cooldownSeconds.max - cfg.cooldownSeconds.min);
    }
  }

  update(audio, dt = 1 / 60) {
    this.blackoutPulse = Math.max(0, this.blackoutPulse - 0.045);
    this.updateSoloEvent(dt, audio);

    return {
      blackoutPulse: this.blackoutPulse,
      soloEvent: this.solo.event,
      soloCooldown: this.solo.cooldown,
      // Keep symbol catalog exposed so shaders/UI can map IDs to silhouettes later.
      soloIconTypes: SOLO_ICON_TYPES,
    };
  }
}
