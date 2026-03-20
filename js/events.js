export class EventsEngine {
  constructor() {
    this.blackoutPulse = 0;
  }

  triggerBlackoutPulse() {
    this.blackoutPulse = 1;
  }

  update() {
    this.blackoutPulse = Math.max(0, this.blackoutPulse - 0.045);
    return {
      blackoutPulse: this.blackoutPulse,
    };
  }
}