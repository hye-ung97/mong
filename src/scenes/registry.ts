import type { IconName } from '../icons';
import type { Settings } from '../lib/settings';
import { Aquarium } from './aquarium';
import type { Scene, SceneVariant } from './base';
import { Fire } from './fire';
import { Pond } from './pond';
import { Rain } from './rain';
import { Sand } from './sand';
import { Sea } from './sea';
import { Star } from './star';

export type SceneId = 'fire' | 'rain' | 'aquarium' | 'sea' | 'pond' | 'sand' | 'star';
export type WaterId = 'aquarium' | 'sea' | 'pond';
export type GroupId = 'fire' | 'rain' | 'water' | 'sand' | 'star';

export const GROUPS: readonly { id: GroupId; label: string; icon: IconName }[] = [
  { id: 'fire', label: '불멍', icon: 'flame' },
  { id: 'rain', label: '비멍', icon: 'rain' },
  { id: 'water', label: '물멍', icon: 'fish' },
  { id: 'sand', label: '모래멍', icon: 'sand' },
  { id: 'star', label: '별멍', icon: 'star' },
];

export const WATER: readonly { id: WaterId; label: string }[] = [
  { id: 'aquarium', label: '어항' },
  { id: 'sea', label: '바다' },
  { id: 'pond', label: '연못' },
];

export const SCENE_IDS: readonly SceneId[] = ['fire', 'rain', 'aquarium', 'sea', 'pond', 'sand', 'star'];

export const isWater = (id: SceneId): id is WaterId => id === 'aquarium' || id === 'sea' || id === 'pond';
export const groupOf = (id: SceneId): GroupId => (isWater(id) ? 'water' : id);
export const routeOf = (id: SceneId) => (isWater(id) ? `#/water/${id}` : `#/${id}`);
export const groupRoute = (g: GroupId) => (g === 'water' ? '#/water' : `#/${g}`);

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
      // the home card always pours fast in the default colours, so there is something to watch right away
      return variant === 'card'
        ? new Sand(variant, { speed: 1 })
        : new Sand(variant, { speed: s.sandSpeed, palette: s.sandPalette, autoEmpty: s.sandAutoEmpty });
    case 'star':
      // the home card is the season outside at midnight, without the constellation names
      return variant === 'card'
        ? new Star(variant, { season: s.starSeason, phase: 'night', hold: true })
        : new Star(variant, { season: s.starSeason, phase: s.starPhase, hold: s.starHold, fireflies: s.starFireflies, guide: s.starGuide });
  }
}
