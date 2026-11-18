import type { IconName } from '../icons';
import type { Settings } from '../lib/settings';
import { Aquarium } from './aquarium';
import type { Scene, SceneVariant } from './base';
import { ClockTower } from './clocktower';
import { Fire } from './fire';
import { Pond } from './pond';
import { Rain } from './rain';
import { Sand } from './sand';
import { Sea } from './sea';
import { Star } from './star';
import { Subway } from './subway';
import { Underfoot } from './underfoot';

export type SceneId = 'fire' | 'rain' | 'aquarium' | 'sea' | 'pond' | 'sand' | 'star' | 'clocktower' | 'underfoot' | SubwayId;
export type WaterId = 'aquarium' | 'sea' | 'pond';
export type SnowId = 'clocktower' | 'underfoot';
/** 지하철멍's three seats: 맞은편 창 · 문 앞 · 창가. */
export type SubwayId = 'seat' | 'door' | 'window';
export type GroupId = 'fire' | 'rain' | 'water' | 'sand' | 'star' | 'snow' | 'subway';

export const GROUPS: readonly { id: GroupId; label: string; icon: IconName }[] = [
  { id: 'fire', label: '불멍', icon: 'flame' },
  { id: 'rain', label: '비멍', icon: 'rain' },
  { id: 'water', label: '물멍', icon: 'fish' },
  { id: 'sand', label: '모래멍', icon: 'sand' },
  { id: 'star', label: '별멍', icon: 'star' },
  { id: 'snow', label: '눈멍', icon: 'snow' },
  { id: 'subway', label: '지하철멍', icon: 'subway' },
];

export const WATER: readonly { id: WaterId; label: string }[] = [
  { id: 'aquarium', label: '어항' },
  { id: 'sea', label: '바다' },
  { id: 'pond', label: '연못' },
];

/** 눈멍's two scenes. 시계탑 comes first: it is where 눈멍 opens the first time. */
export const SNOW: readonly { id: SnowId; label: string }[] = [
  { id: 'clocktower', label: '시계탑' },
  { id: 'underfoot', label: '발밑' },
];

/** 지하철멍's three seats. 맞은편 창 comes first: it is where 지하철멍 opens the first time. */
export const SUBWAY: readonly { id: SubwayId; label: string }[] = [
  { id: 'seat', label: '맞은편 창' },
  { id: 'door', label: '문 앞' },
  { id: 'window', label: '창가' },
];

export const SCENE_IDS: readonly SceneId[] = ['fire', 'rain', 'aquarium', 'sea', 'pond', 'sand', 'star', 'clocktower', 'underfoot', 'seat', 'door', 'window'];

export const isWater = (id: SceneId): id is WaterId => id === 'aquarium' || id === 'sea' || id === 'pond';
export const isSnow = (id: SceneId): id is SnowId => id === 'clocktower' || id === 'underfoot';
export const isSubway = (id: SceneId): id is SubwayId => id === 'seat' || id === 'door' || id === 'window';
export const groupOf = (id: SceneId): GroupId => (isWater(id) ? 'water' : isSnow(id) ? 'snow' : isSubway(id) ? 'subway' : id);
export const routeOf = (id: SceneId) =>
  isWater(id) ? `#/water/${id}` : isSnow(id) ? `#/snow/${id}` : isSubway(id) ? `#/subway/${id}` : `#/${id}`;
export const groupRoute = (g: GroupId) => `#/${g}`;

export function createScene(id: SceneId, variant: SceneVariant, s: Settings): Scene {
  switch (id) {
    case 'fire': {
      const fire = new Fire(variant);
      fire.autoTend = s.autoTend;
      return fire;
    }
    case 'rain':
      return new Rain(variant, { intensity: s.rain, thunder: variant === 'full' && s.thunder });
    case 'aquarium':
      return new Aquarium(variant, { moon: variant === 'full' && s.moonlight });
    case 'sea':
      return new Sea(variant, { size: s.wave });
    case 'pond':
      return new Pond(variant, { drizzle: variant === 'full' && s.drizzle, season: s.season });
    case 'sand':
      // the home card is always 노을, part-way through, at a quicker pace, so there is something to watch right away
      return variant === 'card'
        ? new Sand(variant)
        : new Sand(variant, { palette: s.sandPalette, mode: s.sandMode, autoflip: s.sandAutoflip });
    case 'star':
      // the home card is the season outside at midnight, without the constellation names
      return variant === 'card'
        ? new Star(variant, { season: s.starSeason, phase: 'night', hold: true })
        : new Star(variant, { season: s.starSeason, phase: s.starPhase, hold: s.starHold, fireflies: s.starFireflies, guide: s.starGuide });
    case 'clocktower':
      // the home card always shows it gently snowing, with footprints filling in
      return variant === 'card'
        ? new ClockTower(variant, { fall: 0.6, cover: true })
        : new ClockTower(variant, { fall: s.snowFall, cover: s.snowCover });
    case 'underfoot':
      return variant === 'card'
        ? new Underfoot(variant, { fall: 0.6, cover: true })
        : new Underfoot(variant, { fall: s.snowFall, cover: s.snowCover });
    case 'seat':
    case 'door':
    case 'window':
      // the home card is always 축제, seen through the glass with a few handles
      return new Subway(variant, { seat: id, show: variant === 'card' ? 0.6 : s.subwayShow });
  }
}
