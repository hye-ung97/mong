import type { WoodKind } from '../scenes/fire';
import { seasonNow, type Season } from '../scenes/pond';
import type { SandPalette } from '../scenes/sand';
import type { SceneId, WaterId } from '../scenes/registry';

export interface Settings {
  volume: number;
  muted: boolean;
  /** Per-scene sound mix, layer id → 0..1. */
  mix: Partial<Record<SceneId, Record<string, number>>>;
  rain: number;
  thunder: boolean;
  wave: number;
  drizzle: boolean;
  /** 어항: 달빛 조명. */
  moonlight: boolean;
  /** 연못: the season. Starts as the season outside. */
  season: Season;
  autoTend: boolean;
  wood: WoodKind;
  water: WaterId;
  /** 모래멍: how much sand falls (0.3 · 0.6 · 1), the colour set, and what happens when the frame is full. */
  sandSpeed: number;
  sandPalette: SandPalette;
  sandAutoEmpty: boolean;
  /** 모래멍: tilting the phone bends the stream. Off until the visitor turns it on. */
  sandTilt: boolean;
  /** Last chosen timer in minutes, 0 = no timer. */
  timer: number;
  /** One-time hints already shown. */
  hints: string[];
}

const KEY = 'mong.settings.v1';

const DEFAULTS: Settings = {
  volume: 0.8,
  muted: false,
  mix: {},
  rain: 0.6,
  thunder: false,
  wave: 1,
  drizzle: false,
  moonlight: false,
  season: seasonNow(),
  autoTend: true,
  wood: 'oak',
  water: 'aquarium',
  sandSpeed: 0.6,
  sandPalette: 'sunset',
  sandAutoEmpty: true,
  sandTilt: false,
  timer: 0,
  hints: [],
};

let cache: Settings | null = null;

export function settings(): Settings {
  if (cache) return cache;
  let stored: Partial<Settings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
  } catch {
    stored = {};
  }
  cache = { ...DEFAULTS, ...stored, mix: { ...(stored.mix ?? {}) }, hints: [...(stored.hints ?? [])] };
  return cache;
}

export function save(patch: Partial<Settings>) {
  const next = Object.assign(settings(), patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode or storage full: settings just won't persist
  }
}

export function setMix(id: SceneId, layer: string, value: number) {
  const s = settings();
  save({ mix: { ...s.mix, [id]: { ...(s.mix[id] ?? {}), [layer]: value } } });
}

/** True the first time a hint is asked for; remembers it afterwards. */
export function firstTime(hint: string) {
  const s = settings();
  if (s.hints.includes(hint)) return false;
  save({ hints: [...s.hints, hint] });
  return true;
}
