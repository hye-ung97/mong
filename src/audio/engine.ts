import { settings } from '../lib/settings';
import type { SceneEventData } from '../scenes/base';
import type { SceneId } from '../scenes/registry';
import { SceneSound, type LayerDef, type SoundContext } from './sound';
import { FIRE_LAYERS, FireSound } from './sounds/fire';
import { RAIN_LAYERS, RainSound } from './sounds/rain';
import { AQUARIUM_LAYERS, AquariumSound, POND_LAYERS, PondSound, SEA_LAYERS, SeaSound } from './sounds/water';
import { loadBuffer, releaseBuffer } from './assets';
import { makeNoise, type NoiseKind } from './synth';

type SoundClass = new (env: SoundContext, defs: readonly LayerDef[], mix?: Record<string, number>) => SceneSound;

const SOUNDS: Record<SceneId, { layers: readonly LayerDef[]; make: SoundClass }> = {
  fire: { layers: FIRE_LAYERS, make: FireSound },
  rain: { layers: RAIN_LAYERS, make: RainSound },
  aquarium: { layers: AQUARIUM_LAYERS, make: AquariumSound },
  sea: { layers: SEA_LAYERS, make: SeaSound },
  pond: { layers: POND_LAYERS, make: PondSound },
};

export const layersOf = (id: SceneId) => SOUNDS[id].layers;

interface Playing {
  id: SceneId;
  sound: SceneSound;
  bus: GainNode;
}

const LOOKAHEAD = 1.5; // seconds of random events scheduled ahead (survives background-tab timer throttling)
const CROSSFADE = 1.4;
const PREVIEW_LEVEL = 0.35;

/**
 * All sound goes through here: one scene sound at a time (cross-faded), plus an optional quiet
 * preview for the home screen. Browsers only allow audio after a tap, so `unlock` must be called
 * from a pointer or key handler.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private env: SoundContext | null = null;
  private master!: GainNode;
  private fader!: GainNode;
  private current: Playing | null = null;
  private preview: Playing | null = null;
  private wanted: SceneId | null = null;
  private tickTimer = 0;
  private offset = 0;
  private readonly listeners = new Set<() => void>();

  get ready() {
    return this.ctx?.state === 'running';
  }

  get muted() {
    return settings().muted;
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  /** Call from a user gesture. Safe to call often. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      // iOS: play through the silent switch like a media app
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
      const ctx = new Ctx({ latencyHint: 'playback' });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      this.master = ctx.createGain();
      this.fader = ctx.createGain();
      this.fader.connect(this.master).connect(comp).connect(ctx.destination);
      this.applyVolume(0);
      const noise = {} as Record<NoiseKind, AudioBuffer>;
      for (const kind of ['white', 'pink', 'brown'] as const) noise[kind] = makeNoise(ctx, kind);
      this.env = { ctx, noise, wallOffset: () => this.offset, load: (url) => loadBuffer(ctx, url), release: releaseBuffer };
      ctx.addEventListener('statechange', () => {
        if (this.ready) this.startWanted();
        this.notify();
      });
    }
    const ctx = this.ctx;
    // a one-sample silent buffer inside the gesture unlocks iOS Safari
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start(0);
    if (ctx.state !== 'running') void ctx.resume();
    else this.startWanted();
    if (!this.tickTimer) this.tickTimer = window.setInterval(() => this.tick(), 250);
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ts = ctx.getOutputTimestamp?.();
    this.offset = ts?.performanceTime && ts.contextTime !== undefined
      ? ts.performanceTime / 1000 - ts.contextTime
      : performance.now() / 1000 - ctx.currentTime;
    const until = ctx.currentTime + LOOKAHEAD;
    this.current?.sound.schedule(until);
    this.preview?.sound.schedule(until);
  }

  private create(id: SceneId, level: number): Playing {
    const ctx = this.ctx!;
    const def = SOUNDS[id];
    const sound = new def.make(this.env!, def.layers, settings().mix[id]);
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    sound.out.connect(bus).connect(this.fader);
    sound.start();
    sound.schedule(ctx.currentTime + LOOKAHEAD);
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(level, ctx.currentTime + CROSSFADE);
    return { id, sound, bus };
  }

  private release(p: Playing | null, fade = CROSSFADE) {
    if (!p || !this.ctx) return;
    const now = this.ctx.currentTime;
    p.bus.gain.cancelScheduledValues(now);
    p.bus.gain.setValueAtTime(p.bus.gain.value, now);
    p.bus.gain.linearRampToValueAtTime(0.0001, now + fade);
    window.setTimeout(() => {
      p.sound.dispose();
      p.bus.disconnect();
    }, (fade + 0.2) * 1000);
  }

  private startWanted() {
    if (!this.ready || !this.wanted || this.current?.id === this.wanted) return;
    this.stopPreview();
    this.release(this.current);
    this.current = this.create(this.wanted, 1);
  }

  /** The scene sound to play (starts as soon as audio is unlocked). */
  play(id: SceneId) {
    this.wanted = id;
    this.startWanted();
  }

  stop(fade = CROSSFADE) {
    this.wanted = null;
    this.release(this.current, fade);
    this.current = null;
  }

  /** The playing scene sound, if it is `id`. */
  sound(id: SceneId) {
    return this.current?.id === id ? this.current.sound : null;
  }

  update(id: SceneId, state: Record<string, number>) {
    this.sound(id)?.update(state);
  }

  event(id: SceneId, name: string, data?: SceneEventData) {
    if (this.ready) this.sound(id)?.event(name, data);
  }

  setLayer(id: SceneId, layer: string, value: number) {
    this.sound(id)?.setLayer(layer, value);
  }

  /** Quiet preview while hovering a home card (only once audio is already unlocked). */
  startPreview(id: SceneId) {
    if (!this.ready || this.current) return;
    if (this.preview?.id === id) return;
    this.release(this.preview, 0.6);
    this.preview = this.create(id, PREVIEW_LEVEL);
  }

  stopPreview() {
    this.release(this.preview, 0.6);
    this.preview = null;
  }

  private applyVolume(time = 0.15) {
    if (!this.ctx) return;
    const s = settings();
    const v = s.muted ? 0 : s.volume;
    this.master.gain.setTargetAtTime(v * v, this.ctx.currentTime, time || 0.001);
  }

  refreshVolume() {
    this.applyVolume();
    this.notify();
  }

  /** Sleep-timer fade, independent of the volume setting. */
  fadeTo(level: number, seconds: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const g = this.fader.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(Math.max(0.0001, level), now + Math.max(0.05, seconds));
  }

  resetFade(seconds = 2) {
    this.fadeTo(1, seconds);
  }

  suspend() {
    void this.ctx?.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
}

export const audio = new AudioEngine();
