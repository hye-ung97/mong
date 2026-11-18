import type { WoodKind } from '../scenes/fire';
import { seasonNow, type Season } from '../scenes/pond';
import { DEFAULT_PALETTE, isSandMode, isSandPalette, type SandMode, type SandPalette } from '../scenes/sand';
import type { StarPhase } from '../scenes/star';
import type { SnowSky } from '../scenes/tree';
import type { GroupId, SceneId, SnowId, SubwayId, WaterId } from '../scenes/registry';

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
  /** 모래멍 (모래시계): the sand's colour, how long one run takes, and whether 15분 · 30분 turn over again when done. */
  sandPalette: SandPalette;
  sandMode: SandMode;
  sandAutoflip: boolean;
  /** 별멍: the season (starts as the season outside), where the night starts, whether it stays there, fireflies, naming constellations. */
  starSeason: Season;
  starPhase: StarPhase;
  starHold: boolean;
  starFireflies: boolean;
  starGuide: boolean;
  /** 눈멍: the scene last seen (starts at 나무), how hard it snows (0.3 · 0.6 · 1), whether new snow fills footprints. */
  snow: SnowId;
  snowFall: number;
  snowCover: boolean;
  /** 눈멍 · 나무: the sky. `auto` follows the local hour (해 질 녘 · 달밤 · 새벽). */
  snowSky: SnowSky;
  /** 지하철멍: the seat last taken (starts at 맞은편 창) and how many fireworks go up (0.3 · 0.6 · 1). */
  subway: SubwayId;
  subwayShow: number;
  /** Last chosen timer in minutes, 0 = no timer. */
  timer: number;
  /** Toss mini app: the day (local, 2026-11-17) each 멍 was opened with an ad. Open until that day ends. */
  unlocked: Partial<Record<GroupId, string>>;
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
  sandPalette: DEFAULT_PALETTE,
  sandMode: 'loop',
  sandAutoflip: false,
  starSeason: seasonNow(),
  starPhase: 'dusk',
  starHold: false,
  starFireflies: true,
  starGuide: true,
  snow: 'tree',
  snowFall: 0.6,
  snowCover: true,
  snowSky: 'auto',
  subway: 'seat',
  subwayShow: 0.6,
  timer: 0,
  unlocked: {},
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
  cache = {
    ...DEFAULTS,
    ...stored,
    mix: { ...(stored.mix ?? {}) },
    unlocked: { ...(stored.unlocked ?? {}) },
    hints: [...(stored.hints ?? [])],
  };
  migrateSand(cache);
  migrateSnow(cache);
  return cache;
}

/**
 * 모래멍 became an hourglass (2026-11): the old colour sets map to the nearest new one (노을 → 노을, 바다 → 바다;
 * 숲 and 사탕 have none and fall back to 노을), and the pouring settings (speed, auto-empty, phone tilt) are dropped.
 */
const OLD_SAND_PALETTES: Record<string, SandPalette> = { sunset: 'dusk', ocean: 'sea' };
function migrateSand(s: Settings) {
  const raw = s as unknown as Record<string, unknown>;
  const pal = raw.sandPalette;
  if (!isSandPalette(pal)) s.sandPalette = (typeof pal === 'string' && OLD_SAND_PALETTES[pal]) || DEFAULT_PALETTE;
  if (!isSandMode(raw.sandMode)) s.sandMode = DEFAULTS.sandMode;
  if (typeof raw.sandAutoflip !== 'boolean') s.sandAutoflip = DEFAULTS.sandAutoflip;
  for (const old of ['sandSpeed', 'sandAutoEmpty', 'sandTilt']) delete raw[old];
}

/** 눈멍 settings saved by an older version. */
function migrateSnow(s: Settings) {
  // 눈멍's first scene was 시계탑 ('clocktower') until 나무 took its place. The mix carries over:
  // 먼 전차 becomes 먼 기차, and 시계탑 종 is gone
  const mix = s.mix as Record<string, Record<string, number> | undefined>;
  if ((s.snow as string) === 'clocktower') s.snow = 'tree';
  if (mix.clocktower) {
    mix.tree ??= mix.clocktower;
    delete mix.clocktower;
  }
  for (const id of ['tree', 'underfoot'] as const) {
    const m = mix[id];
    if (!m || !('tram' in m || 'bell' in m)) continue;
    const { tram, bell: _bell, ...rest } = m;
    mix[id] = tram !== undefined && rest.train === undefined ? { ...rest, train: tram } : rest;
  }
  if (!['auto', 'dusk', 'moon', 'dawn'].includes(s.snowSky)) s.snowSky = 'auto';
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
