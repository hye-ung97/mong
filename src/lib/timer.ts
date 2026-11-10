import { audio } from '../audio/engine';

export type TimerPhase = 'off' | 'running' | 'fading' | 'ended';

const FADE_MAX = 3 * 60_000; // start fading 3 minutes before the end
const FADE_FLOOR = 0.12; // level reached at the end of the fade
const END_FADE = 60; // seconds to silence after the end

/** Sleep timer: fades the sound out near the end, then tells the scene it's over. */
class SleepTimer {
  phase: TimerPhase = 'off';
  minutes = 0;
  private startedAt = 0;
  private endsAt = 0;
  private interval = 0;
  private readonly listeners = new Set<() => void>();

  get remaining() {
    return this.phase === 'off' ? 0 : Math.max(0, this.endsAt - Date.now());
  }

  /** Minutes since the timer was first started (extensions included). */
  get elapsedMinutes() {
    return Math.max(1, Math.round((Date.now() - this.startedAt) / 60_000));
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  /** 0 minutes = no timer. */
  start(minutes: number) {
    this.stopTicking();
    this.minutes = minutes;
    audio.resetFade(1);
    if (!minutes) {
      this.phase = 'off';
      this.notify();
      return;
    }
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + minutes * 60_000;
    this.phase = 'running';
    this.startTicking();
    this.notify();
  }

  extend(minutes: number) {
    if (this.phase === 'off') {
      this.start(minutes);
      return;
    }
    this.endsAt = Date.now() + minutes * 60_000;
    this.phase = 'running';
    audio.resetFade(2);
    this.startTicking();
    this.notify();
  }

  clear() {
    if (this.phase === 'off' && !this.minutes) return;
    this.stopTicking();
    this.phase = 'off';
    this.minutes = 0;
    audio.resetFade(1);
    this.notify();
  }

  private startTicking() {
    this.stopTicking();
    this.interval = window.setInterval(() => this.tick(), 1000);
  }

  private stopTicking() {
    if (this.interval) window.clearInterval(this.interval);
    this.interval = 0;
  }

  private tick() {
    const left = this.remaining;
    const fadeLen = Math.min(FADE_MAX, (this.endsAt - this.startedAt) * 0.3);
    if (this.phase === 'running' && left <= fadeLen) {
      this.phase = 'fading';
      audio.fadeTo(FADE_FLOOR, left / 1000);
    }
    if (left <= 0 && this.phase !== 'ended') {
      this.phase = 'ended';
      this.stopTicking();
      audio.fadeTo(0, END_FADE);
    }
    this.notify();
  }
}

export const timer = new SleepTimer();

export const formatClock = (ms: number) => {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};
