import { Scene, type SceneVariant } from './base';
import type { Season } from './pond';
import { TAU, clamp, rand, smooth } from './util';

/*
 * 별멍: lying in the grass, looking south from the horizon up past the zenith (Seoul's latitude).
 * The night flows one way, 초저녁 → 한밤 → 새벽 (10 + 20 minutes), and the sky turns with it, so the season's
 * constellations rise on the left (east), cross the middle and lean to the right (west). Any time of night can be held;
 * while held the sky still drifts at the real sky's pace. Now and then one constellation is joined up and named.
 * The bright stars are real (position and magnitude), so is the Milky Way; the faint ones are random.
 * Ported from the Doan board (.doan/assets/star.js).
 */

export type StarPhase = 'dusk' | 'night' | 'dawn';
export const STAR_PHASES: readonly { id: StarPhase; label: string }[] = [
  { id: 'dusk', label: '초저녁' },
  { id: 'night', label: '한밤' },
  { id: 'dawn', label: '새벽' },
];

export interface StarOpts {
  season: Season;
  /** where the night starts */
  phase?: StarPhase;
  /** stay at that time instead of flowing on */
  hold?: boolean;
  fireflies?: boolean;
  /** show a constellation now and then */
  guide?: boolean;
}

interface Constellation { name: string; sub: string; season: Season; lines: readonly (readonly [string, string])[] }

const DEG = Math.PI / 180;
const ease = (x: number) => x * x * (3 - 2 * x);
/** Same seed, same sky (the constellations must not move between visits). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mk(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const LAT = 37.5; // where we lie: about Seoul
const FLOW_TURN = 60; // degrees the sky turns per stretch of night (dusk → night → dawn: 120°, eight hours of real sky)
const REST_TURN = 15 / 3600; // degrees per second while held: the real sky's pace
const FLOW_SECONDS = 600; // dusk → night; night → dawn takes twice as long
const PHASE_POS: Record<StarPhase, number> = { dusk: 0, night: 1, dawn: 2 };
const phaseOf = (pos: number): StarPhase => (pos < 0.66 ? 'dusk' : pos < 1.6 ? 'night' : 'dawn');
const GUIDE_GAP = 40; // seconds between constellations
const GUIDE_HOLD = 8; // seconds a constellation stays named
const ANCHOR = 0.78; // stars at least this bright can be tapped to ask for their constellation
const METEOR_EVERY = 40; // seconds on average between shooting stars
const turnAt = (pos: number) => (pos - 1) * FLOW_TURN;

/* 진짜 별: 이름, 적경(시), 적위(도), 등급, 색(0 푸른빛 · 1 흰빛 · 2 노란빛 · 3 주황빛) */
const NAMED: readonly (readonly [string, number, number, number, number])[] = [
  /* 북쪽: 작은곰 · 북두칠성 · 카시오페이아. 세로 화면에서는 머리 위로 올라왔을 때만 맨 위에 걸려요 */
  ['polaris', 2.53, 89.26, 2.0, 2], ['kochab', 14.845, 74.16, 2.1, 3],
  ['dubhe', 11.062, 61.75, 1.8, 2], ['merak', 11.031, 56.38, 2.4, 1], ['phecda', 11.897, 53.69, 2.4, 1], ['megrez', 12.257, 57.03, 3.3, 1],
  ['alioth', 12.9, 55.96, 1.8, 1], ['mizar', 13.399, 54.93, 2.2, 1], ['alkaid', 13.792, 49.31, 1.9, 0],
  ['caph', 0.153, 59.15, 2.3, 1], ['schedar', 0.675, 56.54, 2.2, 3], ['navi', 0.945, 60.72, 2.2, 0], ['ruchbah', 1.43, 60.24, 2.7, 1], ['segin', 1.907, 63.67, 3.4, 0],
  /* 봄: 목동(아크투루스) · 처녀(스피카) · 사자(레굴루스, 데네볼라) · 왕관 · 사냥개 · 바다뱀 */
  ['arcturus', 14.261, 19.18, -0.05, 3], ['izar', 14.75, 27.07, 2.4, 3], ['muphrid', 13.911, 18.4, 2.7, 2], ['seginus', 14.535, 38.31, 3.0, 1], ['nekkar', 15.032, 40.39, 3.5, 2],
  ['spica', 13.42, -11.16, 1.0, 0], ['porrima', 12.694, -1.45, 2.7, 1], ['vindemiatrix', 13.036, 10.96, 2.8, 2],
  ['regulus', 10.139, 11.97, 1.35, 0], ['denebola', 11.818, 14.57, 2.1, 1], ['algieba', 10.333, 19.84, 2.1, 3], ['zosma', 11.235, 20.52, 2.6, 1],
  ['chertan', 11.237, 15.43, 3.3, 1], ['adhafera', 10.278, 23.42, 3.4, 2], ['algenubi', 9.764, 23.77, 3.0, 2],
  ['alphecca', 15.578, 26.71, 2.2, 1], ['corcaroli', 12.934, 38.32, 2.9, 0], ['alphard', 9.46, -8.66, 2.0, 3],
  /* 여름: 거문고(직녀) · 백조(데네브) · 독수리(견우) · 전갈(안타레스) · 궁수 · 뱀주인 · 용 */
  ['vega', 18.616, 38.78, 0.0, 0], ['sheliak', 18.835, 33.36, 3.5, 1], ['sulafat', 18.982, 32.69, 3.2, 0],
  ['deneb', 20.69, 45.28, 1.25, 1], ['sadr', 20.37, 40.26, 2.2, 2], ['albireo', 19.512, 27.96, 3.1, 3], ['gienah', 20.77, 33.97, 2.5, 2], ['fawaris', 19.75, 45.13, 2.9, 0],
  ['altair', 19.846, 8.87, 0.8, 1], ['tarazed', 19.771, 10.61, 2.7, 3], ['alshain', 19.922, 6.41, 3.7, 2],
  ['antares', 16.49, -26.43, 1.0, 3], ['dschubba', 16.006, -22.62, 2.3, 0], ['acrab', 16.091, -19.81, 2.6, 0], ['alniyat', 16.353, -25.59, 2.9, 0], ['paikauhale', 16.598, -28.22, 2.8, 0],
  ['larawag', 16.836, -34.29, 2.3, 3], ['shaula', 17.56, -37.1, 1.6, 0], ['sargas', 17.622, -43.0, 1.9, 2],
  ['kausaustralis', 18.403, -34.38, 1.85, 0], ['kausmedia', 18.35, -29.83, 2.7, 3], ['kausborealis', 18.466, -25.42, 2.8, 3], ['nunki', 18.921, -26.3, 2.0, 0],
  ['ascella', 19.044, -29.88, 2.6, 1], ['alnasl', 18.097, -30.42, 3.0, 3], ['phisgr', 18.761, -26.99, 3.2, 0],
  ['rasalhague', 17.582, 12.56, 2.1, 1], ['eltanin', 17.943, 51.49, 2.2, 3],
  /* 가을: 페가수스 · 안드로메다 · 페르세우스 · 양 · 고래 · 남쪽물고기(포말하우트) */
  ['markab', 23.079, 15.21, 2.5, 0], ['scheat', 23.063, 28.08, 2.4, 3], ['alpheratz', 0.14, 29.09, 2.1, 0], ['algenib', 0.221, 15.18, 2.8, 0], ['enif', 21.736, 9.88, 2.4, 3],
  ['mirach', 1.162, 35.62, 2.1, 3], ['almach', 2.065, 42.33, 2.1, 3], ['mirfak', 3.405, 49.86, 1.8, 2], ['algol', 3.136, 40.96, 2.1, 0],
  ['hamal', 2.12, 23.46, 2.0, 3], ['sheratan', 1.911, 20.81, 2.6, 1], ['diphda', 0.726, -17.99, 2.0, 3], ['fomalhaut', 22.961, -29.62, 1.2, 1],
  /* 겨울: 오리온 · 큰개(시리우스) · 작은개(프로키온) · 황소(알데바란) · 쌍둥이 · 마차부(카펠라) */
  ['betelgeuse', 5.919, 7.41, 0.5, 3], ['rigel', 5.242, -8.2, 0.15, 0], ['bellatrix', 5.419, 6.35, 1.65, 0], ['saiph', 5.796, -9.67, 2.1, 0],
  ['mintaka', 5.533, -0.3, 2.2, 0], ['alnilam', 5.604, -1.2, 1.7, 0], ['alnitak', 5.679, -1.94, 1.8, 0],
  ['sirius', 6.752, -16.72, -1.46, 0], ['mirzam', 6.378, -17.96, 2.0, 0], ['adhara', 6.977, -28.97, 1.5, 0], ['wezen', 7.14, -26.39, 1.8, 2],
  ['procyon', 7.655, 5.22, 0.4, 2], ['aldebaran', 4.599, 16.51, 0.85, 3], ['elnath', 5.438, 28.61, 1.65, 0],
  ['castor', 7.577, 31.89, 1.6, 1], ['pollux', 7.755, 28.03, 1.15, 3], ['alhena', 6.629, 16.4, 1.9, 1],
  ['capella', 5.278, 46.0, 0.1, 2], ['menkalinan', 5.992, 44.95, 1.9, 1], ['mahasim', 5.995, 37.21, 2.6, 1], ['hassaleh', 4.95, 33.17, 2.7, 3],
];
/* 좀생이별(플레이아데스): 작아서 이을 수는 없고, 오종종 모여 있기만 해요. 적경, 적위, 밝기 */
const CLUSTER: readonly (readonly [number, number, number])[] = [[3.791, 24.11, 0.72], [3.819, 24.05, 0.6], [3.748, 24.11, 0.58], [3.763, 24.37, 0.55], [3.772, 23.95, 0.5], [3.754, 24.47, 0.5], [3.82, 24.14, 0.45]];
/* 별자리 알려 주기에서 보여 주는 것: 이름, 한 줄 설명, 계절, 선(별 이름 쌍) */
const CONSTELLATIONS: readonly Constellation[] = [
  { name: '북두칠성', sub: '큰곰자리의 꼬리와 엉덩이', season: 'spring' as Season, lines: [['alkaid', 'mizar'], ['mizar', 'alioth'], ['alioth', 'megrez'], ['megrez', 'phecda'], ['phecda', 'merak'], ['merak', 'dubhe'], ['dubhe', 'megrez']] },
  { name: '봄의 대곡선', sub: '북두칠성 손잡이를 따라 아크투루스, 스피카로', season: 'spring' as Season, lines: [['alioth', 'mizar'], ['mizar', 'alkaid'], ['alkaid', 'arcturus'], ['arcturus', 'spica']] },
  { name: '목동자리', sub: '주황빛 아크투루스가 발끝이에요', season: 'spring' as Season, lines: [['muphrid', 'arcturus'], ['arcturus', 'izar'], ['izar', 'nekkar'], ['nekkar', 'seginus'], ['seginus', 'arcturus']] },
  { name: '사자자리', sub: '거꾸로 된 물음표가 사자의 머리', season: 'spring' as Season, lines: [['algenubi', 'adhafera'], ['adhafera', 'algieba'], ['algieba', 'regulus'], ['regulus', 'chertan'], ['chertan', 'denebola'], ['denebola', 'zosma'], ['zosma', 'algieba']] },
  { name: '봄의 대삼각형', sub: '아크투루스 · 스피카 · 데네볼라', season: 'spring' as Season, lines: [['arcturus', 'spica'], ['spica', 'denebola'], ['denebola', 'arcturus']] },
  { name: '여름의 대삼각형', sub: '직녀 · 견우 · 데네브', season: 'summer' as Season, lines: [['vega', 'deneb'], ['deneb', 'altair'], ['altair', 'vega']] },
  { name: '백조자리', sub: '은하수를 따라 날아가는 백조', season: 'summer' as Season, lines: [['deneb', 'sadr'], ['sadr', 'albireo'], ['gienah', 'sadr'], ['sadr', 'fawaris']] },
  { name: '거문고자리', sub: '가장 밝은 별이 직녀성이에요', season: 'summer' as Season, lines: [['vega', 'sheliak'], ['sheliak', 'sulafat'], ['sulafat', 'vega']] },
  { name: '독수리자리', sub: '가운데 밝은 별이 견우성이에요', season: 'summer' as Season, lines: [['tarazed', 'altair'], ['altair', 'alshain']] },
  { name: '전갈자리', sub: '붉은 안타레스가 전갈의 심장', season: 'summer' as Season, lines: [['acrab', 'dschubba'], ['dschubba', 'alniyat'], ['alniyat', 'antares'], ['antares', 'paikauhale'], ['paikauhale', 'larawag'], ['larawag', 'sargas'], ['sargas', 'shaula']] },
  { name: '궁수자리', sub: '찻주전자 모양, 은하수의 한가운데', season: 'summer' as Season, lines: [['alnasl', 'kausmedia'], ['kausmedia', 'kausborealis'], ['kausborealis', 'phisgr'], ['phisgr', 'nunki'], ['nunki', 'ascella'], ['ascella', 'phisgr'], ['ascella', 'kausaustralis'], ['kausaustralis', 'alnasl'], ['kausmedia', 'phisgr']] },
  { name: '페가수스 사각형', sub: '가을 하늘의 큰 네모', season: 'autumn' as Season, lines: [['markab', 'scheat'], ['scheat', 'alpheratz'], ['alpheratz', 'algenib'], ['algenib', 'markab'], ['markab', 'enif']] },
  { name: '안드로메다자리', sub: '페가수스 사각형 한 귀퉁이에서 뻗어 나가요', season: 'autumn' as Season, lines: [['alpheratz', 'mirach'], ['mirach', 'almach']] },
  { name: '카시오페이아자리', sub: 'W 모양 다섯 별', season: 'autumn' as Season, lines: [['caph', 'schedar'], ['schedar', 'navi'], ['navi', 'ruchbah'], ['ruchbah', 'segin']] },
  { name: '양자리', sub: '하말과 셰라탄, 작은 두 별', season: 'autumn' as Season, lines: [['hamal', 'sheratan']] },
  { name: '오리온자리', sub: '세 별이 나란한 허리띠의 사냥꾼', season: 'winter' as Season, lines: [['betelgeuse', 'bellatrix'], ['betelgeuse', 'alnitak'], ['bellatrix', 'mintaka'], ['mintaka', 'alnilam'], ['alnilam', 'alnitak'], ['alnitak', 'saiph'], ['mintaka', 'rigel']] },
  { name: '겨울의 대삼각형', sub: '베텔게우스 · 시리우스 · 프로키온', season: 'winter' as Season, lines: [['betelgeuse', 'sirius'], ['sirius', 'procyon'], ['procyon', 'betelgeuse']] },
  { name: '큰개자리', sub: '밤하늘에서 가장 밝은 별, 시리우스', season: 'winter' as Season, lines: [['mirzam', 'sirius'], ['sirius', 'wezen'], ['wezen', 'adhara']] },
  { name: '쌍둥이자리', sub: '카스토르와 폴룩스, 나란한 두 머리', season: 'winter' as Season, lines: [['castor', 'pollux'], ['pollux', 'alhena']] },
  { name: '마차부자리', sub: '노란빛 카펠라가 있는 오각형', season: 'winter' as Season, lines: [['capella', 'menkalinan'], ['menkalinan', 'mahasim'], ['mahasim', 'elnath'], ['elnath', 'hassaleh'], ['hassaleh', 'capella']] },
  { name: '황소자리', sub: '붉은 눈 알데바란과 뿔끝 엘나트', season: 'winter' as Season, lines: [['aldebaran', 'elnath']] },
];

/* 밤 깊이마다 달라지는 값. 바꾸면 3초쯤 걸려 스르르 넘어가요 */

const SKY = 0, GX = 12, GC = 13, GA = 16, STARS = 17, CUT = 18, MILKY = 19, FLIES = 20, GROUND = 21, MOON = 24, VENUS = 25, METEOR = 26;
const NIGHTS: Record<StarPhase, { label: string; v: readonly number[] }> = {
  dusk: {
    label: '초저녁',
    v: [9, 14, 44, 24, 30, 78, 76, 52, 102, 196, 108, 92, /* 하늘: 위 → 지평선 */ 0.84, 255, 150, 96, 0.44, /* 노을 잔빛. 남쪽을 보고 있어서 서쪽이 오른쪽이에요 */
      0.62, 0.36, 0.05, 1, /* 별 · 안 보이는 밝기 · 은하수 · 반딧불이 */ 9, 10, 20, /* 땅 */ 1, 0, 0.6],
  },
  night: {
    label: '한밤',
    v: [2, 4, 11, 5, 9, 24, 10, 19, 44, 23, 40, 70, 0.5, 70, 130, 140, 0.12,
      1, 0, 1, 0.55, 2, 4, 8, 0, 0, 1],
  },
  dawn: {
    label: '새벽',
    v: [10, 20, 50, 28, 52, 98, 92, 124, 160, 226, 190, 168, 0.16, 255, 214, 170, 0.5,
      0.42, 0.52, 0.06, 0, 8, 13, 22, 0, 1, 0.3],
  },
};


/* 은하수: 진짜 은하 적도를 따라 뿌린 빛덩이 · 먼지 띠 · 별가루. 한 번만 만들어서 모든 장면이 같이 써요.
   궁수 쪽(은하 중심)이 가장 밝고 두껍고, 백조 쪽에 밝은 구름이 하나 더 있어요. 백조에서 궁수까지는 가운데가 어둡게 갈라져요.
   겨울 은하수(마차부 · 쌍둥이 쪽)는 훨씬 옅어요 */
type Pt = number[];
let GALAXY: { blobs: Pt[]; lanes: Pt[]; dust: [Pt[], Pt[]] } | null = null;
function galaxy() {
  if (GALAXY) return GALAXY;
  const r = rng(77);
  const g3 = () => (r() + r() + r() - 1.5) * 1.16;
  /* 은하 좌표(경도 l, 위도 b)를 적도 좌표의 방향으로 */
  const M = [[-0.0548755604, 0.4941094279, -0.867666149], [-0.8734370902, -0.44482963, -0.1980763734], [-0.4838350155, 0.7469822445, 0.4559837762]];
  const eq = (l: number, b: number) => {
    const x = Math.cos(b * DEG) * Math.cos(l * DEG), y = Math.cos(b * DEG) * Math.sin(l * DEG), z = Math.sin(b * DEG);
    return [M[0][0] * x + M[0][1] * y + M[0][2] * z, M[1][0] * x + M[1][1] * y + M[1][2] * z, M[2][0] * x + M[2][1] * y + M[2][2] * z];
  };
  const off = (l: number) => Math.abs((((l % 360) + 540) % 360) - 180); /* 은하 중심에서 떨어진 경도 */
  const bright = (l: number) => 0.24 + 0.76 * Math.exp(-((off(l) / 58) ** 2)) + 0.26 * Math.exp(-(((l - 76) / 17) ** 2));
  const thick = (l: number) => 4.8 + 5 * Math.exp(-((off(l) / 26) ** 2));
  const pick = () => { for (;;) { const l = r() * 360; if (r() * 1.25 < bright(l)) return l; } };
  const blobs: Pt[] = [], lanes: Pt[] = [], dust: [Pt[], Pt[]] = [[], []];
  for (let i = 0; i < 2300; i++) {
    const l = pick(), wide = thick(l), b = g3() * wide + Math.sin(l * 0.09) * 1.4;
    const core = Math.exp(-(b * b) / (wide * wide * 0.5));
    blobs.push([...eq(l, b), 2.2 + r() * 9, r() < 0.1 ? 0 : core > 0.5 ? 1 : 2, (0.007 + r() * 0.017) * (0.3 + 0.7 * bright(l))]);
  }
  for (let i = 0; i < 640; i++) {
    const rift = r() < 0.7, l = rift ? 6 + r() * 76 : r() * 360;
    const b = (rift ? 2 + 1.8 * Math.sin(l * 0.13 + 0.6) : 2.4 * Math.sin(l * 0.11)) + g3() * 1.6;
    lanes.push([...eq(l, b), 1.1 + r() * 4.2, (0.08 + r() * 0.2) * (rift ? 1 : 0.55)]);
  }
  for (let i = 0; i < 15000; i++) {
    const l = pick();
    dust[r() < 0.3 ? 0 : 1].push([...eq(l, g3() * thick(l) * 1.45), (0.12 + r() * 0.5) * (0.28 + 0.72 * Math.min(1, bright(l))), r() < 0.08 ? 1.6 : 1]);
  }
  return (GALAXY = { blobs, lanes, dust });
}


interface Drift { kind: 'petal' | 'fluff' | 'snow'; per: number; up: number; vx: readonly [number, number]; vy: readonly [number, number]; size: readonly [number, number]; rgb: string; a: number }
interface SeasonLook {
  label: string;
  /** right ascension (hours) due south at midnight: what fills the middle of the screen */
  lst: number;
  tint: readonly [number, number, number];
  gain: number;
  /** twinkle */
  tw: number;
  /** spring's soft haze */
  haze: number;
  /** grass: spacing, min and extra height */
  blade: readonly [number, number, number];
  flies?: boolean;
  snow?: boolean;
  drift: Drift | null;
  /** what goes quiet when the grass is touched (winter: nothing) */
  hushes: boolean;
}
export const STAR_SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
const SEASONS: Record<Season, SeasonLook> = {
  spring: {
    label: '봄', lst: 12.3, tint: [1.05, 1.07, 0.98], gain: 0.9, tw: 0.85, haze: 0.22, hushes: true,
    blade: [2.3, 4, 13], drift: { kind: 'petal', per: 30, up: 300, vx: [10, 24], vy: [6, 14], size: [1.5, 2.6], rgb: '255,214,226', a: 0.9 },
  },
  summer: { label: '여름', lst: 18.3, tint: [1, 1, 1], gain: 1, tw: 1, haze: 0, hushes: true, blade: [2.6, 7, 26], flies: true, drift: null },
  autumn: {
    label: '가을', lst: 0.3, tint: [1.07, 0.96, 1.05], gain: 1.06, tw: 1.1, haze: 0, hushes: true,
    blade: [2.6, 6, 20], drift: { kind: 'fluff', per: 44, up: 240, vx: [12, 26], vy: [-3, 4], size: [0.9, 1.5], rgb: '236,226,204', a: 0.6 },
  },
  winter: {
    label: '겨울', lst: 6.1, tint: [0.8, 0.93, 1.1], gain: 1.12, tw: 1.6, haze: 0, hushes: false, snow: true,
    blade: [9, 5, 15], drift: { kind: 'snow', per: 9, up: 70, vx: [40, 90], vy: [-4, 6], size: [0.7, 1.4], rgb: '236,243,255', a: 0.8 },
  },
};

const TINTS = [[190, 212, 255], [255, 255, 255], [255, 238, 206], [255, 208, 170]] as const;
function glowSprite(c: string) {
  const S = 64, cv = mk(S, S), x = cv.getContext('2d')!;
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(${c},1)`); g.addColorStop(0.09, `rgba(${c},0.78)`);
  g.addColorStop(0.32, `rgba(${c},0.17)`); g.addColorStop(1, `rgba(${c},0)`);
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return cv;
}
let SPRITES: { star: HTMLCanvasElement[]; fly: HTMLCanvasElement; moon: HTMLCanvasElement; gal: HTMLCanvasElement[] } | null = null;
function sprites() {
  if (SPRITES) return SPRITES;
  const moon = mk(64, 64), m = moon.getContext('2d')!;
  m.fillStyle = '#ffe9c6'; m.beginPath(); m.arc(32, 32, 20, 0, TAU); m.fill();
  m.globalCompositeOperation = 'destination-out'; m.beginPath(); m.arc(24, 27, 19, 0, TAU); m.fill();
  const soft = (c: string) => {
    const cv = mk(64, 64), x = cv.getContext('2d')!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${c},1)`); g.addColorStop(1, `rgba(${c},0)`);
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return cv;
  };
  SPRITES = { star: TINTS.map((t) => glowSprite(t.join(','))), fly: glowSprite('214,242,106'), moon, gal: ['255,170,200', '255,230,196', '150,178,255'].map(soft) };
  return SPRITES;
}

interface Blade { x: number; hgt: number; lean: number; ph: number; bud: number }
interface Tail { x: number; hgt: number; dir: number; ph: number; plume: number; vs: number }
interface Fly { hx: number; hy: number; a1: number; f1: number; p1: number; a2: number; f2: number; p2: number; b1: number; g1: number; q1: number; fr: number; ph: number; size: number; ox: number; oy: number; vx: number; vy: number; x: number; y: number }
interface Mote { x: number; y: number; top: number; bottom: number; vx: number; vy: number; size: number; ph: number; spin: number; kx: number; ky: number }
interface Meteor { x: number; y: number; vx: number; vy: number; age: number; dur: number; len: number; wd: number }
interface Guide { c: Constellation; ids: number[]; segs: [number, number][]; t: number; fade: number; auto: boolean; stop: boolean }

export class Star extends Scene {
  season: Season;
  /** 0 dusk → 1 night → 2 dawn */
  pos: number;
  phase: StarPhase;
  hold: boolean;
  fireflies: boolean;
  guideOn: boolean;
  seen = 0;

  private flowLen = FLOW_SECONDS;
  private flowing: boolean;
  /** degrees the sky has turned (follows the night), plus the slow drift while held */
  private sky: number;
  private driftA = 0;
  private turn = 0;
  private top = 134;
  private floor = 0;
  private controls: number | null = null;
  private hz = 0;
  private cx = 0;
  private cy = 0;
  private K = 1;
  private k = 1;
  private sp = 0;
  private cp = 0;
  private ss = 1;
  private at = 0;
  private cL = 1;
  private sL = 0;
  private n = 0;
  private ex = new Float32Array(0);
  private ey = new Float32Array(0);
  private ez = new Float32Array(0);
  private b = new Float32Array(0);
  private tint = new Uint8Array(0);
  private ph = new Float32Array(0);
  private rate = new Float32Array(0);
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private names: Record<string, number> = {};
  private anchors: number[] = [];
  private mw: HTMLCanvasElement | null = null;
  private mwAt = 1e9;
  private readonly cur = new Float32Array(NIGHTS.night.v.length);
  private readonly to = new Float32Array(NIGHTS.night.v.length);
  private far = new Path2D();
  private mid = new Path2D();
  private near = new Path2D();
  private blades: Blade[] = [];
  private tails: Tail[] = [];
  private tree: { segs: number[][]; puffs: number[][] } | null = null;
  private flies: Fly[] = [];
  private drift: Mote[] = [];
  private glints: { x: number; y: number; ph: number; rate: number }[] = [];
  private flyGain: number;
  private meteors: Meteor[] = [];
  private nextMeteor: number;
  private guide: Guide | null = null;
  private guideWait: number;
  private guideLast: Constellation | null = null;
  private guideIdx = 0;
  private hushT = 0;
  private poke: { x: number; t: number } | null = null;
  private swap: { t: number; done: boolean; fn: () => void } | null = null;
  private taperOn = false;
  private taperK = 0;
  /** the star left shining at the very end of the timer */
  private last = -1;

  constructor(variant: SceneVariant, opts: StarOpts) {
    super(variant);
    this.season = opts.season;
    this.pos = PHASE_POS[opts.phase ?? 'dusk'];
    this.phase = phaseOf(this.pos);
    this.hold = !!opts.hold;
    this.flowing = !this.hold && this.pos < 2;
    this.sky = turnAt(this.pos);
    this.fireflies = opts.fireflies ?? true;
    this.flyGain = this.fireflies ? 1 : 0;
    this.guideOn = variant === 'full' && (opts.guide ?? true);
    this.guideWait = 6;
    this.mix(this.pos, this.cur);
    this.nextMeteor = rand(0.25, 0.7) * this.meteorEvery;
    if (variant === 'card') {
      // the home card: a wide strip of the season's sky above a low ridge
      this.top = 70;
      this.turn = -34;
    }
  }

  private get meteorEvery() {
    return this.variant === 'card' ? 9 : METEOR_EVERY;
  }

  /** Top of the controls (CSS px from the top of the scene); the grass reaches up to just below it. */
  setFloor(y: number | null) {
    this.controls = y;
    if (this.w) this.layout();
  }

  layout() {
    const { w, h } = this;
    const base = this.variant === 'card' ? Math.max(26, h * 0.22) : Math.max(60, h * 0.2);
    this.hz = this.controls !== null ? clamp(this.controls - 34, h * 0.45, h - 40) : h - base;
    this.floor = h - this.hz;
    if (this.variant === 'full') this.top = w > this.hz * 1.2 ? 104 : 134;
    const mid = this.top / 2, rim = this.hz + 8; // the true horizon sits just behind the ridge
    this.cx = w / 2;
    this.cy = rim / 2;
    this.K = rim / 2 / (2 * Math.tan((mid / 2) * DEG)); // px per radian at the centre (stereographic)
    this.k = this.K * DEG;
    this.sp = Math.sin((LAT + mid) * DEG);
    this.cp = Math.cos((LAT + mid) * DEG);
    this.ss = clamp(this.k / 4.4, 0.62, 1.12);
    this.makeStars(rng(20261113));
    this.makeGround();
    this.mw = null;
    this.guide = null;
    this.place();
  }

  /* ---------- the controls ---------- */

  /** Tap the lit time again to stay there (and again to flow on); another time jumps there. Returns what happened. */
  choose(phase: StarPhase): 'hold' | 'flow' | 'jump' {
    if (phase === this.phase) {
      this.hold = !this.hold;
      this.flowing = !this.hold && this.pos < 2;
      this.stat('hold', this.hold ? 1 : 0);
      return this.hold ? 'hold' : 'flow';
    }
    this.goTo(PHASE_POS[phase]);
    return 'jump';
  }

  /** Forward glides there; backward dims for a moment and comes back at that time (the sky never runs backwards). */
  private goTo(pos: number) {
    const land = () => {
      this.pos = pos;
      this.driftA = 0;
      this.sky = turnAt(pos);
      this.mix(pos, this.cur);
      this.setPhase(phaseOf(pos));
      this.place();
    };
    this.hold = false;
    this.stat('hold', 0);
    this.flowing = pos < 2;
    if (pos < this.pos - 0.05) this.swap = { t: 0, done: false, fn: land };
    else {
      this.pos = pos;
      this.driftA = 0;
      this.setPhase(phaseOf(pos));
    }
  }

  private setPhase(p: StarPhase) {
    if (p === this.phase) return;
    this.phase = p;
    this.stat('phase', PHASE_POS[p]);
  }

  /** Dims for a moment, then the next season's sky and ground. */
  setSeason(id: Season) {
    if (id === this.season || this.swap) return;
    this.swap = {
      t: 0, done: false, fn: () => {
        this.season = id;
        this.driftA = 0;
        this.sky = turnAt(this.pos);
        this.guide = null;
        this.guideWait = Math.min(this.guideWait, 2.5);
        this.hushT = 0;
        this.stat('hush', 0);
        this.makeGround();
        this.place();
        this.stat('season', STAR_SEASONS.indexOf(id));
      },
    };
  }

  setFireflies(on: boolean) {
    this.fireflies = on;
  }

  setGuide(on: boolean) {
    this.guideOn = on;
    if (!on && this.guide?.auto) this.guide.stop = true; // the one on show fades away
    if (on) this.guideWait = Math.min(this.guideWait, 2);
  }

  /** After the sleep timer: the faint stars go out first, until one bright star is left. */
  setTaper(on: boolean) {
    this.taperOn = on;
    if (!on) return;
    let best = -1;
    for (const i of this.anchors) if (this.shown(i) && (best < 0 || this.b[i] > this.b[best])) best = i;
    this.last = best;
  }

  /** The grass hushes the bugs; a bright star names its constellation; empty sky drops a shooting star. */
  tap(x: number, y: number) {
    if (y >= this.crest(x) - 4) {
      this.hush(x);
      return;
    }
    const a = this.nearAnchor(x, y, 30);
    if (a >= 0) {
      const c = this.fits().find((f) => f.ids.includes(a));
      if (c) {
        this.showGuide(c, false);
        return;
      }
    }
    this.meteorAt(x, y, true);
  }

  /** A shooting star somewhere in the sky (the Space key). */
  meteor() {
    this.meteorAt(rand(0.2, 0.8) * this.w, rand(0.08, 0.4) * this.hz, false);
  }

  audioState() {
    return {
      pos: this.pos,
      season: STAR_SEASONS.indexOf(this.season),
      hush: this.hushT > 0 ? 1 : 0,
      taper: this.taperK,
    };
  }

  /* ---------- the sky ---------- */

  private mix(pos: number, out: Float32Array) {
    const [a, b, k] = pos <= 1 ? [NIGHTS.dusk.v, NIGHTS.night.v, pos] : [NIGHTS.night.v, NIGHTS.dawn.v, pos - 1];
    for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  }

  private makeStars(r: () => number) {
    const count = clamp(Math.round(60 * this.k * this.k), 500, 3800);
    const first = NAMED.length + CLUSTER.length, n = first + count;
    this.n = n;
    // every star keeps its direction on the sky (a unit vector) and is placed on screen each frame
    this.ex = new Float32Array(n); this.ey = new Float32Array(n); this.ez = new Float32Array(n);
    this.b = new Float32Array(n); this.tint = new Uint8Array(n);
    this.ph = new Float32Array(n); this.rate = new Float32Array(n);
    this.sx = new Float32Array(n); this.sy = new Float32Array(n);
    const put = (i: number, ra: number, dec: number) => {
      const a = ra * 15 * DEG, d = dec * DEG;
      this.ex[i] = Math.cos(d) * Math.cos(a); this.ey[i] = Math.cos(d) * Math.sin(a); this.ez[i] = Math.sin(d);
    };
    this.names = {};
    NAMED.forEach(([name, ra, dec, mag, tint], i) => {
      put(i, ra, dec);
      // magnitude → brightness: 0 mag is 1, 3 mag 0.79; every named star can be tapped
      this.b[i] = clamp(0.93 - (mag - 1) * 0.07, 0.79, 1.06); this.tint[i] = tint;
      this.names[name] = i;
    });
    CLUSTER.forEach(([ra, dec, b], j) => { put(NAMED.length + j, ra, dec); this.b[NAMED.length + j] = b; });
    const lowest = -Math.cos(LAT * DEG) - 0.04; // stars further south never rise here
    for (let i = first; i < n; i++) {
      let z = r() * 2 - 1;
      while (z < lowest) z = r() * 2 - 1;
      const a = r() * TAU, q = Math.sqrt(1 - z * z), x = q * Math.cos(a), y = q * Math.sin(a);
      // random stars stay dimmer than the real ones, and dimmer still beside a constellation, so Orion still looks like Orion
      let b = Math.min(0.86, Math.pow(r(), 3.6));
      if (b > 0.5) {
        for (let j = 0; j < NAMED.length; j++) if (x * this.ex[j] + y * this.ey[j] + z * this.ez[j] > 0.9945) { b = 0.2 + r() * 0.25; break; }
      }
      const u = r();
      this.ex[i] = x; this.ey[i] = y; this.ez[i] = z; this.b[i] = b;
      this.tint[i] = u < 0.3 ? 0 : u < 0.7 ? 1 : u < 0.92 ? 2 : 3;
    }
    for (let i = 0; i < n; i++) { this.ph[i] = r() * TAU; this.rate[i] = 0.7 + r() * 2.4; }
    this.anchors = [];
    for (let i = 0; i < n; i++) if (this.b[i] >= ANCHOR) this.anchors.push(i);
  }

  /** Where every star is on screen now. Lying facing south, a turning sky rises on the left (east) and sets on the right (west). */
  private place() {
    this.at = SEASONS[this.season].lst * 15 + this.sky + this.turn; // right ascension due south (degrees)
    const cL = Math.cos(this.at * DEG), sL = Math.sin(this.at * DEG);
    const { sp, cp, cx, cy, K, ex, ey, ez, sx, sy } = this;
    this.cL = cL; this.sL = sL;
    for (let i = 0; i < this.n; i++) {
      const a = ex[i] * cL + ey[i] * sL, cf = sp * a - cp * ez[i];
      if (cf < -0.3) { sx[i] = -9999; sy[i] = -9999; continue; }
      const m = (2 / (1 + cf)) * K;
      sx[i] = cx + (ex[i] * sL - ey[i] * cL) * m;
      sy[i] = cy - (cp * a + sp * ez[i]) * m;
    }
  }

  /** The Milky Way lives on its own canvas and is redrawn whenever the sky has moved half a pixel or so. */
  private drawGalaxy() {
    const { w, cx, cy, K, k, sp, cp, cL, sL, dpr } = this, lh = Math.round(this.hz + 40);
    if (!this.mw) this.mw = mk(w * dpr, lh * dpr);
    const x = this.mw.getContext('2d')!, G = galaxy(), SP = sprites();
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    x.clearRect(0, 0, w, lh);
    const each = (list: Pt[], fn: (p: Pt, px: number, py: number, scale: number) => void) => {
      for (let i = 0; i < list.length; i++) {
        const p = list[i], a = p[0] * cL + p[1] * sL, cf = sp * a - cp * p[2];
        if (cf < -0.2) continue;
        const m = 2 / (1 + cf), px = cx + (p[0] * sL - p[1] * cL) * m * K, py = cy - (cp * a + sp * p[2]) * m * K;
        if (px < -70 || px > w + 70 || py < -70 || py > lh + 70) continue;
        fn(p, px, py, m * k);
      }
    };
    x.globalCompositeOperation = 'lighter';
    each(G.blobs, (p, px, py, scale) => { const R = p[3] * scale; x.globalAlpha = p[5]; x.drawImage(SP.gal[p[4]], px - R, py - R, R * 2, R * 2); });
    x.globalCompositeOperation = 'destination-out';
    each(G.lanes, (p, px, py, scale) => { const R = p[3] * scale; x.globalAlpha = p[4]; x.drawImage(SP.gal[1], px - R, py - R, R * 2, R * 2); });
    x.globalCompositeOperation = 'lighter';
    G.dust.forEach((list, c) => {
      x.fillStyle = c ? 'rgb(214,226,255)' : 'rgb(255,236,210)';
      each(list, (p, px, py) => { x.globalAlpha = p[3]; x.fillRect(px, py, p[4], p[4]); });
    });
    this.mwAt = this.at;
  }

  private shown(i: number) {
    return this.sx[i] > 6 && this.sx[i] < this.w - 6 && this.sy[i] > 6 && this.sy[i] < this.crest(this.sx[i]) - 30;
  }

  private nearAnchor(x: number, y: number, radius: number) {
    let best = -1, bd = radius * radius;
    for (const i of this.anchors) {
      if (!this.shown(i)) continue;
      const dx = this.sx[i] - x, dy = this.sy[i] - y, dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = i; }
    }
    return best;
  }

  private meteorAt(x: number, y: number, tapped: boolean) {
    const s = Math.sqrt(clamp(this.w / 390, 0.5, 2.2));
    const right = tapped ? x < this.w / 2 : Math.random() < 0.5;
    const a = rand(0.35, 1.0);
    const sp = rand(560, 860) * s;
    this.meteors.push({ x, y, vx: Math.cos(a) * sp * (right ? 1 : -1), vy: Math.sin(a) * sp, age: 0, dur: rand(0.55, 0.9), len: rand(110, 200) * s, wd: Math.random() < 0.25 ? 2.3 : 1.5 });
    if (this.variant !== 'full') return;
    this.seen++;
    this.stat('meteors', this.seen);
    this.emit('meteor');
  }

  /* ---------- naming constellations ---------- */

  /** Constellations wholly on screen now, the season's own first. */
  private fits() {
    const ok = (i: number) => this.sx[i] > 24 && this.sx[i] < this.w - 24 && this.sy[i] > 120 && this.sy[i] < this.crest(this.sx[i]) - 34;
    const out: { c: Constellation; ids: number[]; segs: [number, number][] }[] = [];
    for (const c of CONSTELLATIONS) {
      const ids = [...new Set(c.lines.flat())].map((nm) => this.names[nm]);
      if (ids.every(ok)) out.push({ c, ids, segs: c.lines.map(([a, b]) => [this.names[a], this.names[b]] as [number, number]) });
    }
    return out.sort((p, q) => Number(q.c.season === this.season) - Number(p.c.season === this.season));
  }

  private showGuide(f: { c: Constellation; ids: number[]; segs: [number, number][] }, auto: boolean) {
    this.guide = { ...f, t: 0, fade: 0, auto, stop: false };
    this.guideLast = f.c;
    this.guideWait = GUIDE_GAP;
    if (!auto) this.emit('guide');
  }

  /** One at a time: the lines are drawn one by one, the name appears, it stays a while and fades; then a pause and a different one. */
  private stepGuide(dt: number) {
    const g = this.guide;
    if (g) {
      g.t += dt;
      if (g.t > g.segs.length * 0.5 + 0.4 + GUIDE_HOLD || g.stop) g.fade += dt / 1.8;
      if (g.fade >= 1) this.guide = null;
      return;
    }
    if (!this.guideOn || this.swap || this.taperOn) return;
    this.guideWait -= dt;
    if (this.guideWait > 0) return;
    const list = this.fits().filter((f) => f.c !== this.guideLast);
    const own = list.filter((f) => f.c.season === this.season);
    const pick = own.length ? own : list;
    if (!pick.length) { this.guideWait = 3; return; }
    this.showGuide(pick[this.guideIdx++ % pick.length], true);
  }

  /* ---------- the ground ---------- */

  private crest(x: number) { return this.hz + 16 + 8 * Math.sin(x * 0.0105 + 0.8) + 4 * Math.sin(x * 0.027 + 2.1); }
  private gust(x: number) { return 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * 0.21 + x * 0.002)); }

  /** The ridges are the same all year; what grows on them and what drifts in the wind changes with the season. */
  private makeGround() {
    const { w, h, hz } = this, S = SEASONS[this.season];
    let r = rng(4107);
    const far = new Path2D(), mid = new Path2D(), near = new Path2D();
    far.moveTo(-10, h); mid.moveTo(-10, h); near.moveTo(-10, h);
    for (let x = -10; x <= w + 10; x += 5) {
      far.lineTo(x, hz - 30 - (16 * Math.sin(x * 0.0061 + 0.5) + 9 * Math.sin(x * 0.0137 + 2.0) + 4 * Math.sin(x * 0.033 + 4.0)));
      mid.lineTo(x, hz - 6 - (9 * Math.sin(x * 0.0093 + 3.1) + 5 * Math.sin(x * 0.0217 + 1.0)));
      near.lineTo(x, this.crest(x));
    }
    far.lineTo(w + 10, h); mid.lineTo(w + 10, h); near.lineTo(w + 10, h);
    far.closePath(); mid.closePath(); near.closePath();
    for (let x = r() * 60; x < w; x += 60 + r() * 130) { // bushes on the near ridge
      const m = 2 + Math.floor(r() * 3);
      for (let j = 0; j < m; j++) {
        const cx = x + j * (7 + r() * 5), rad = 5 + r() * 7;
        const cy = hz - 6 - (9 * Math.sin(cx * 0.0093 + 3.1) + 5 * Math.sin(cx * 0.0217 + 1.0)) - rad * 0.5;
        mid.moveTo(cx + rad, cy); mid.arc(cx, cy, rad, 0, TAU);
      }
    }
    this.far = far; this.mid = mid; this.near = near;

    r = rng(4107 + 31 * (STAR_SEASONS.indexOf(this.season) + 1));
    // spring: short new grass and wild flowers · summer: tall grass · autumn: grass leaning over · winter: dry stalks through the snow
    const [gap, h0, h1] = S.blade;
    const vs = clamp(hz / 560, 0.5, 1); // small screens get smaller foxtails and silver grass
    this.blades = [];
    for (let x = 0; x < w; x += gap) {
      const u = r();
      this.blades.push({ x: x + r() * Math.max(2, gap), hgt: h0 + u * u * h1, lean: r() - 0.5, ph: r() * TAU, bud: this.season === 'spring' && r() < 0.15 ? 1 + Math.floor(r() * 2) : 0 });
    }
    this.tails = [];
    if (this.season === 'summer') { // foxtails along the edges
      const m = Math.max(4, Math.round(w / 70));
      for (let i = 0; i < m; i++) {
        const u = r(), v = r() * r() * 0.42;
        this.tails.push({ x: (u < 0.5 ? v : 1 - v) * w, hgt: (44 + r() * 52) * vs, dir: r() < 0.5 ? -1 : 1, ph: r() * TAU, plume: 0, vs });
      }
    } else if (this.season === 'autumn') { // a field of silver grass
      const m = Math.max(5, Math.round(w / (30 * vs)));
      for (let i = 0; i < m; i++) this.tails.push({ x: r() * w, hgt: (50 + r() * r() * 96) * vs, dir: 1, ph: r() * TAU, plume: (15 + r() * 12) * vs, vs });
    }
    // spring: a tree in blossom · winter: bare branches with snow on them
    this.tree = this.season === 'spring' || this.season === 'winter' ? this.makeTree(r) : null;

    this.flies = [];
    if (S.flies) {
      const f = clamp(Math.round(w / 36), 6, 24);
      for (let i = 0; i < f; i++) {
        this.flies.push({
          hx: r() * w, hy: hz - 120 + r() * (120 + this.floor * 0.3),
          a1: 14 + r() * 30, f1: 0.1 + r() * 0.25, p1: r() * TAU, a2: 5 + r() * 9, f2: 0.5 + r() * 0.7, p2: r() * TAU,
          b1: 8 + r() * 18, g1: 0.12 + r() * 0.22, q1: r() * TAU,
          fr: 0.9 + r() * 0.8, ph: r() * TAU, size: 0.7 + r() * 0.6,
          ox: 0, oy: 0, vx: 0, vy: 0, x: 0, y: 0,
        });
      }
    }
    // in the wind: spring petals · autumn silver-grass down · winter snow dust
    this.drift = [];
    const D = S.drift;
    if (D) {
      const top = Math.max(40, hz - D.up), bottom = h - 8;
      const m = clamp(Math.round(w / D.per), 4, 150);
      for (let i = 0; i < m; i++) {
        this.drift.push({
          x: r() * w, y: top + r() * (bottom - top), top, bottom,
          vx: D.vx[0] + r() * (D.vx[1] - D.vx[0]), vy: D.vy[0] + r() * (D.vy[1] - D.vy[0]),
          size: D.size[0] + r() * (D.size[1] - D.size[0]), ph: r() * TAU, spin: 0.6 + r() * 1.6, kx: 0, ky: 0,
        });
      }
    }
    this.glints = []; // starlight on the snow
    if (S.snow) {
      const m = Math.round(w / 9);
      for (let i = 0; i < m; i++) {
        const x = r() * w;
        this.glints.push({ x, y: this.crest(x) + 5 + r() * r() * Math.max(10, this.floor - 20), ph: r() * TAU, rate: 0.5 + r() * 1.4 });
      }
    }
  }

  private makeTree(r: () => number) {
    const x = this.w * 0.15, base = this.crest(x) + 6, H = clamp(this.hz * 0.27, 46, 190);
    const segs: number[][] = [], tips: number[][] = [];
    const grow = (x0: number, y0: number, ang: number, len: number, wd: number, depth: number) => {
      const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      segs.push([x0, y0, x1, y1, wd]);
      if (depth <= 2) tips.push([x1, y1, depth]);
      if (!depth) return;
      const n = depth > 2 ? 2 : 2 + (r() < 0.45 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * (0.62 + r() * 0.3);
        grow(x1, y1, ang + spread + (r() - 0.5) * 0.3, len * (0.6 + r() * 0.18), Math.max(0.7, wd * 0.6), depth - 1);
      }
    };
    grow(x, base, -Math.PI / 2 + 0.1, H * 0.36, Math.max(2.2, H * 0.042), 4);
    const puffs = tips.map(([tx, ty, dp]) => [tx + (r() - 0.5) * 8, ty + (r() - 0.5) * 8, (5 + r() * 7) * (H / 170) * (dp ? 1.25 : 1), r()]);
    return { segs, puffs };
  }

  /** Touching the grass: it bends away, fireflies and drifting things scatter, the bugs and frogs go quiet. Winter has no bugs, only snow dust. */
  private hush(x: number) {
    this.poke = { x, t: this.t };
    for (const f of this.flies) {
      const dx = f.x - x, kk = Math.exp(-Math.abs(dx) / 170);
      f.vx += (dx >= 0 ? 1 : -1) * rand(30, 90) * kk;
      f.vy -= rand(50, 150) * kk;
    }
    for (const p of this.drift) {
      const dx = p.x - x, kk = Math.exp(-Math.abs(dx) / 110);
      p.kx += (dx >= 0 ? 1 : -1) * rand(20, 80) * kk;
      p.ky -= rand(40, 130) * kk;
    }
    this.emit('hush', { x: x / this.w });
    if (!SEASONS[this.season].hushes) return;
    this.hushT = 2.8;
    this.stat('hush', 1);
  }

  /* ---------- time ---------- */

  step(dt: number) {
    this.t += dt;
    // the night flows one way and rests at dawn; held, it stays put
    if (this.flowing && !this.swap) {
      this.pos = Math.min(2, this.pos + dt / (this.pos < 1 ? this.flowLen : this.flowLen * 2));
      if (this.pos >= 2) this.flowing = false;
    }
    this.setPhase(phaseOf(this.pos));
    this.mix(this.pos, this.to);
    const cur = this.cur, to = this.to, f = 1 - Math.exp(-dt * 1.1);
    for (let i = 0; i < cur.length; i++) cur[i] += (to[i] - cur[i]) * f;
    // flowing, the sky moves with the night; held, it keeps drifting at the real sky's pace; a jump forward glides there
    if (!this.flowing) this.driftA += REST_TURN * dt;
    this.sky += (turnAt(this.pos) + this.driftA - this.sky) * f;
    this.place();
    this.flyGain += ((this.fireflies ? 1 : 0) - this.flyGain) * Math.min(1, dt * 2);
    this.taperK = this.taperOn ? Math.min(1, this.taperK + dt / 45) : Math.max(0, this.taperK - dt / 3);

    if (this.swap) {
      const sw = this.swap;
      sw.t += dt;
      if (!sw.done && sw.t >= 0.45) { sw.done = true; sw.fn(); }
      if (sw.t >= 1.4) this.swap = null;
    }

    this.nextMeteor -= dt * cur[METEOR] * (1 - this.taperK);
    if (this.nextMeteor <= 0) {
      this.nextMeteor = rand(0.6, 1.4) * this.meteorEvery;
      this.meteorAt(rand(0.12, 0.88) * this.w, rand(0.06, 0.42) * this.hz, false);
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.age += dt;
      if (m.age > m.dur) this.meteors.splice(i, 1);
    }

    const t = this.t;
    for (const fl of this.flies) {
      fl.vx += (-fl.ox * 1.4 - fl.vx * 1.6) * dt; fl.vy += (-fl.oy * 1.4 - fl.vy * 1.6) * dt;
      fl.ox += fl.vx * dt; fl.oy += fl.vy * dt;
      fl.x = fl.hx + fl.a1 * Math.sin(t * fl.f1 + fl.p1) + fl.a2 * Math.sin(t * fl.f2 + fl.p2) + fl.ox;
      fl.y = fl.hy + fl.b1 * Math.sin(t * fl.g1 + fl.q1) + 6 * Math.sin(t * 1.7 + fl.p2) + fl.oy;
    }
    const damp = Math.exp(-dt * 2.2);
    for (const p of this.drift) {
      const g = this.gust(p.x);
      p.x += (p.vx * g * g * 1.6 + p.kx) * dt * this.motion;
      p.y += (p.vy + 5 * Math.sin(t * p.spin + p.ph) + p.ky) * dt * this.motion;
      p.kx *= damp; p.ky = p.ky * damp + 60 * dt * (p.ky < -1 ? 1 : 0);
      if (p.x > this.w + 12) { p.x = -10; p.y = p.top + Math.random() * (p.bottom - p.top); }
      if (p.y > p.bottom) p.y = p.top;
      else if (p.y < p.top - 60) p.y = p.bottom;
    }

    this.stepGuide(dt);
    if (this.hushT > 0) {
      this.hushT -= dt;
      if (this.hushT <= 0) this.stat('hush', 0);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w, h, hz, cur, t } = this;
    const SP = sprites(), S = SEASONS[this.season], T = S.tint;
    const rgb = (i: number, a?: number) => `rgba(${Math.min(255, cur[i] * T[0]) | 0},${Math.min(255, cur[i + 1] * T[1]) | 0},${Math.min(255, cur[i + 2] * T[2]) | 0},${a === undefined ? 1 : a})`;
    /* 꽃 · 억새 · 눈처럼 밝은 것이 받는 빛. 한밤엔 어둑하고 초저녁과 새벽엔 환해요 */
    const pale = 0.42 + 0.58 * clamp(((cur[SKY + 6] + cur[SKY + 7] + cur[SKY + 8]) / 3 - 10) / 90, 0, 1);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    /* 하늘 */
    let g = ctx.createLinearGradient(0, 0, 0, hz + 20);
    g.addColorStop(0, rgb(SKY)); g.addColorStop(0.45, rgb(SKY + 3)); g.addColorStop(0.82, rgb(SKY + 6)); g.addColorStop(1, rgb(SKY + 9));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    /* 은하수 */
    const mw = cur[MILKY] * (1 - S.haze * 1.8) * (1 - this.taperK);
    if (mw > 0.01) {
      if (!this.mw || Math.abs(this.at - this.mwAt) > 0.1) this.drawGalaxy();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = mw;
      ctx.drawImage(this.mw!, 0, 0, w, this.mw!.height / this.dpr);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    /* 지평선 가까이에서는 은하수가 공기에 묻혀요 */
    g = ctx.createLinearGradient(0, hz - 190, 0, hz + 10);
    g.addColorStop(0, rgb(SKY + 6, 0)); g.addColorStop(0.55, rgb(SKY + 6, 0.5)); g.addColorStop(1, rgb(SKY + 9, 0.9));
    ctx.fillStyle = g; ctx.fillRect(0, hz - 190, w, 210);

    /* 지평선의 빛: 초저녁엔 서쪽(오른쪽) 노을, 새벽엔 동쪽(왼쪽) */
    const gr = Math.max(w * 0.8, 320);
    ctx.save();
    ctx.translate(cur[GX] * w, hz + 10); ctx.scale(1, 0.5);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
    g.addColorStop(0, rgb(GC, cur[GA])); g.addColorStop(0.5, rgb(GC, cur[GA] * 0.3)); g.addColorStop(1, rgb(GC, 0));
    ctx.fillStyle = g; ctx.fillRect(-gr, -gr, gr * 2, gr * 2);
    ctx.restore();

    /* 별 */
    const taper = this.taperK, gain = cur[STARS] * S.gain, cut = cur[CUT] + S.haze * 0.4, { sx, sy, b: B } = this;
    const flare: number[] = [], ss = this.ss;
    let lastTint = -1;
    for (let i = 0; i < this.n; i++) {
      const x = sx[i], y = sy[i];
      if (x < -12 || x > w + 12 || y < -12 || y > hz + 40) continue;
      const b = B[i];
      let a = cut > 0.01 ? smooth(cut - 0.12, cut + 0.1, b) : 1;
      if (taper > 0) a *= smooth(taper * 1.12 - 0.08, taper * 1.12, b) || (i === this.last ? 1 : 0);
      if (a < 0.02) continue;
      const low = clamp((hz - y) / 150, 0, 1); /* 지평선 가까이는 흐리고 더 떨려요 */
      const tw = Math.max(0.25, 1 - S.tw * ((0.16 + 0.3 * (1 - low)) * (0.5 + 0.5 * Math.sin(t * this.rate[i] + this.ph[i])) + 0.08 * (0.5 + 0.5 * Math.sin(t * this.rate[i] * 2.63 + this.ph[i] * 1.7))));
      a *= gain * tw * (0.3 + 0.7 * low);
      const ti = this.tint[i];
      if (ti !== lastTint) { ctx.fillStyle = `rgb(${TINTS[ti]})`; lastTint = ti; }
      if (b < 0.35) {
        ctx.globalAlpha = Math.min(1, a * (0.3 + b));
        ctx.fillRect(x, y, 1, 1);
      } else if (b < ANCHOR) {
        ctx.globalAlpha = Math.min(1, a * (0.4 + 0.5 * b));
        const s = (0.5 + b * 0.7) * Math.max(0.8, ss);
        ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
      } else {
        const gs = (13 + (b - ANCHOR) * 72) * ss;
        ctx.globalAlpha = Math.min(1, a * 0.9);
        ctx.drawImage(SP.star[ti], x - gs / 2, y - gs / 2, gs, gs);
        ctx.globalAlpha = Math.min(1, a * 1.15);
        ctx.beginPath(); ctx.arc(x, y, (1.3 + (b - ANCHOR) * 4) * ss, 0, TAU); ctx.fill();
        if (b > 0.88) flare.push(x, y, (5 + (b - 0.88) * 80) * tw * ss, Math.min(1, a));
      }
    }
    if (flare.length) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
      for (let i = 0; i < flare.length; i += 4) {
        const x = flare[i], y = flare[i + 1], L = flare[i + 2];
        ctx.globalAlpha = flare[i + 3] * 0.34;
        ctx.beginPath(); ctx.moveTo(x - L, y); ctx.lineTo(x + L, y); ctx.moveTo(x, y - L); ctx.lineTo(x, y + L); ctx.stroke();
      }
    }

    /* 초저녁 서쪽(오른쪽)의 초승달, 새벽 동쪽(왼쪽)의 샛별 */
    if (cur[MOON] > 0.02) {
      const mx = w * 0.8, my = hz - Math.max(70, hz * 0.2), ms = clamp(w / 390, 0.6, 1.4);
      ctx.globalAlpha = cur[MOON] * 0.3;
      ctx.drawImage(SP.star[2], mx - 60 * ms, my - 60 * ms, 120 * ms, 120 * ms);
      ctx.globalAlpha = cur[MOON];
      ctx.save(); ctx.translate(mx, my); ctx.rotate(-0.5);
      ctx.drawImage(SP.moon, -21 * ms, -21 * ms, 42 * ms, 42 * ms);
      ctx.restore();
    }
    if (cur[VENUS] > 0.02) {
      const vx = w * 0.24, vy = hz - Math.max(64, hz * 0.17), a = cur[VENUS] * (0.9 + 0.1 * Math.sin(t * 2.1));
      ctx.globalAlpha = a; ctx.drawImage(SP.star[1], vx - 20, vy - 20, 40, 40);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(vx, vy, 2.1, 0, TAU); ctx.fill();
      ctx.globalAlpha = a * 0.4; ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(vx - 13, vy); ctx.lineTo(vx + 13, vy); ctx.moveTo(vx, vy - 13); ctx.lineTo(vx, vy + 13); ctx.stroke();
    }

    /* 별자리 알려 주기. 선은 별에 닿기 전에 멈춰요 (성도처럼). 선이 다 이어지면 이름이 떠요 */
    if (this.guide) {
      const g = this.guide, c = g.c, fa = 1 - ease(clamp(g.fade, 0, 1)), sk = clamp((cur[STARS] - 0.3) / 0.5, 0.45, 1);
      ctx.strokeStyle = 'rgb(248,239,182)'; ctx.lineCap = 'round'; ctx.lineWidth = 1.15;
      g.segs.forEach(([a, b], i) => {
        const p = clamp((g.t - i * 0.5) / 0.55, 0, 1);
        if (p <= 0) return;
        const dx = sx[b] - sx[a], dy = sy[b] - sy[a], len = Math.hypot(dx, dy);
        if (len < 6) return;
        const gap = Math.min(7, len * 0.28); /* 짧은 선(독수리자리 같은)도 보이게, 별 가까이에서 덜 비워요 */
        const ux = dx / len, uy = dy / len, e = ease(p), L = gap + (len - gap * 2) * e;
        ctx.globalAlpha = 0.6 * fa * sk;
        ctx.beginPath(); ctx.moveTo(sx[a] + ux * gap, sy[a] + uy * gap); ctx.lineTo(sx[a] + ux * L, sy[a] + uy * L); ctx.stroke();
      });
      const la = smooth(g.segs.length * 0.5, g.segs.length * 0.5 + 0.9, g.t) * fa;
      if (la > 0.01) {
        let x0 = 1e9, x1 = -1e9, y1 = -1e9, y0 = 1e9;
        for (const i of g.ids) { x0 = Math.min(x0, sx[i]); x1 = Math.max(x1, sx[i]); y0 = Math.min(y0, sy[i]); y1 = Math.max(y1, sy[i]); }
        const below = y1 + 34 < hz - 30, lx = clamp((x0 + x1) / 2, 90, w - 90), ly = below ? y1 + 26 : y0 - 32;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 8;
        ctx.globalAlpha = la; ctx.fillStyle = 'rgb(250,243,200)';
        ctx.font = '700 14px "Pretendard Variable", Pretendard, -apple-system, sans-serif';
        ctx.fillText(c.name, lx, ly);
        ctx.globalAlpha = la * 0.78; ctx.fillStyle = 'rgb(236,232,222)';
        ctx.font = '500 11.5px "Pretendard Variable", Pretendard, -apple-system, sans-serif';
        ctx.fillText(c.sub, lx, ly + 18);
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      }
      ctx.globalAlpha = 1;
    }

    /* 별똥별 */
    if (this.meteors.length) {
      ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (const m of this.meteors) {
        const p = m.age / m.dur, env = smooth(0, 0.12, p) * (1 - smooth(0.5, 1, p));
        const hx = m.x + m.vx * m.age, hy = m.y + m.vy * m.age;
        const sp = Math.hypot(m.vx, m.vy), tl = Math.min(m.len, sp * m.age);
        const tx = hx - (m.vx / sp) * tl, ty = hy - (m.vy / sp) * tl;
        g = ctx.createLinearGradient(hx, hy, tx, ty);
        g.addColorStop(0, `rgba(255,255,255,${env})`); g.addColorStop(0.3, `rgba(200,224,255,${env * 0.45})`); g.addColorStop(1, 'rgba(160,200,255,0)');
        ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = m.wd;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.globalAlpha = env; const hs = 12 * m.wd;
        ctx.drawImage(SP.star[1], hx - hs / 2, hy - hs / 2, hs, hs);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    /* 봄밤의 옅은 안개: 지평선 가까운 별이 묻혀요 */
    if (S.haze) {
      g = ctx.createLinearGradient(0, hz - 280, 0, hz + 20);
      g.addColorStop(0, rgb(SKY + 9, 0)); g.addColorStop(1, rgb(SKY + 9, S.haze * 1.7));
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, hz - 280, w, 300);
    }

    /* 먼 산, 가까운 능선, 풀밭. 겨울엔 눈이 덮여 하늘빛을 받아요 */
    const sk = [Math.min(255, cur[SKY + 6] * T[0]), Math.min(255, cur[SKY + 7] * T[1]), Math.min(255, cur[SKY + 8] * T[2])];
    const G = S.snow ? [sk[0] * 0.9 + 30, sk[1] * 0.9 + 30, sk[2] * 0.9 + 28] : [cur[GROUND], cur[GROUND + 1], cur[GROUND + 2]];
    const mixc = (k: number) => `rgb(${(sk[0] + (G[0] - sk[0]) * k) | 0},${(sk[1] + (G[1] - sk[1]) * k) | 0},${(sk[2] + (G[2] - sk[2]) * k) | 0})`;
    const ground = `rgb(${G[0] | 0},${G[1] | 0},${G[2] | 0})`;
    const dark = S.snow ? 'rgb(15,14,20)' : ground; /* 눈밭 위에서는 줄기와 가지가 검게 서요 */
    const deep = S.snow ? 0.6 : 0.5;
    ctx.globalAlpha = 1;
    ctx.fillStyle = mixc(0.66); ctx.fill(this.far);
    ctx.fillStyle = mixc(0.86); ctx.fill(this.mid);

    if (this.tree) {
      ctx.strokeStyle = dark; ctx.lineCap = 'round';
      for (const [x0, y0, x1, y1, wd] of this.tree.segs) {
        ctx.lineWidth = wd;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      if (S.snow) {
        ctx.strokeStyle = 'rgb(226,234,248)'; ctx.globalAlpha = 0.75 * pale;
        for (const [x0, y0, x1, y1, wd] of this.tree.segs) {
          if (wd < 1 || Math.abs(x1 - x0) < Math.abs(y1 - y0) * 0.55) continue;
          ctx.lineWidth = Math.max(1, wd * 0.5);
          ctx.beginPath(); ctx.moveTo(x0, y0 - wd * 0.5); ctx.lineTo(x1, y1 - wd * 0.5); ctx.stroke();
        }
      } else {
        for (const [bx, by, br, u] of this.tree.puffs) {
          ctx.fillStyle = u < 0.5 ? 'rgb(255,214,228)' : 'rgb(255,232,238)';
          ctx.globalAlpha = (0.26 + 0.3 * u) * pale;
          ctx.beginPath(); ctx.arc(bx + Math.sin(t * 0.5 + u * 9) * 0.8 * this.gust(bx), by, br, 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    g = ctx.createLinearGradient(0, hz, 0, h);
    g.addColorStop(0, ground); g.addColorStop(1, `rgb(${(G[0] * deep) | 0},${(G[1] * deep) | 0},${(G[2] * deep) | 0})`);
    ctx.fillStyle = g; ctx.fill(this.near);

    if (this.glints.length) {
      ctx.fillStyle = '#fff';
      for (const gl of this.glints) {
        const s = Math.sin(t * gl.rate + gl.ph);
        if (s < 0.55) continue;
        ctx.globalAlpha = Math.pow((s - 0.55) / 0.45, 2) * 0.7 * pale;
        ctx.fillRect(gl.x, gl.y, 1.3, 1.3);
      }
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = dark; ctx.lineCap = 'round';
    const pk = this.poke, pt = pk ? t - pk.t : 9;
    const sway = (x: number, ph: number) => {
      let s = (2.2 * Math.sin(t * 0.9 + x * 0.013 + ph * 0.6) + 1.2 * Math.sin(t * 2.3 + x * 0.05 + ph)) * this.gust(x);
      if (pk && pt < 4) {
        const dx = x - pk.x, tt = pt - Math.abs(dx) / 420;
        if (tt > 0) s += (dx >= 0 ? 1 : -1) * 9 * Math.exp(-Math.abs(dx) / 110) * Math.cos(9 * tt) * Math.exp(-2.2 * tt);
      }
      return s;
    };
    const buds: number[] = [];
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass ? 1.7 : 1.1;
      ctx.beginPath();
      for (const bl of this.blades) {
        if ((bl.hgt > 20) !== !!pass) continue;
        const by = this.crest(bl.x) + 2, s = sway(bl.x, bl.ph) * (bl.hgt / 22);
        const tx = bl.x + bl.lean * bl.hgt * 0.5 + s, ty = by - bl.hgt;
        ctx.moveTo(bl.x, by);
        ctx.quadraticCurveTo(bl.x + bl.lean * bl.hgt * 0.12, by - bl.hgt * 0.6, tx, ty);
        if (bl.bud) buds.push(tx, ty, bl.bud);
      }
      ctx.stroke();
    }
    /* 봄 들꽃 */
    for (let i = 0; i < buds.length; i += 3) {
      ctx.fillStyle = buds[i + 2] === 1 ? 'rgb(255,250,236)' : 'rgb(255,232,150)';
      ctx.globalAlpha = 0.8 * pale;
      ctx.beginPath(); ctx.arc(buds[i], buds[i + 1], 1.35, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const tl of this.tails) {
      const by = this.crest(tl.x) + 2, s = sway(tl.x, tl.ph) * (tl.hgt / 26);
      const tx = tl.x + tl.dir * tl.hgt * 0.16 + s, ty = by - tl.hgt;
      ctx.strokeStyle = dark; ctx.globalAlpha = 1; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(tl.x, by); ctx.quadraticCurveTo(tl.x, by - tl.hgt * 0.7, tx, ty); ctx.stroke();
      if (tl.plume) {
        /* 억새 이삭: 바람 부는 쪽으로 누운 옅은 깃털 */
        const L = tl.plume, ex = tx + tl.dir * L + s * 0.5, ey = ty + L * 0.4;
        ctx.strokeStyle = 'rgb(228,216,192)';
        ctx.globalAlpha = 0.5 * pale; ctx.lineWidth = 4.2 * tl.vs;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + tl.dir * L * 0.55 + s * 0.3, ty - L * 0.2, ex, ey); ctx.stroke();
        ctx.globalAlpha = 0.34 * pale; ctx.lineWidth = 2 * tl.vs;
        ctx.beginPath();
        ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + tl.dir * L * 0.4 + s * 0.3, ty - L * 0.42, ex - tl.dir * L * 0.2, ey - L * 0.5);
        ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + tl.dir * L * 0.5, ty + L * 0.12, ex - tl.dir * L * 0.25, ey + L * 0.24);
        ctx.stroke();
      } else {
        ctx.lineWidth = 4.6 * tl.vs;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + tl.dir * 8 * tl.vs + s * 0.4, ty - 1, tx + tl.dir * 15 * tl.vs + s * 0.6, ty + 8 * tl.vs); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    /* 바람에 날리는 것 */
    if (this.drift.length) {
      const D = S.drift!;
      ctx.fillStyle = `rgb(${D.rgb})`;
      for (const p of this.drift) {
        const gg = this.gust(p.x);
        if (D.kind === 'petal') {
          ctx.globalAlpha = D.a * pale * (0.55 + 0.45 * Math.sin(t * p.spin + p.ph) ** 2);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t * p.spin + p.ph);
          ctx.beginPath(); ctx.ellipse(0, 0, p.size * 1.5, p.size * 0.8, 0, 0, TAU); ctx.fill();
          ctx.restore();
        } else {
          /* 눈가루는 바람이 셀 때, 그리고 건드려서 일어났을 때 잘 보여요 */
          ctx.globalAlpha = Math.min(1, D.a * pale * (D.kind === 'snow' ? 0.25 + 0.75 * gg * gg + Math.min(1.6, Math.hypot(p.kx, p.ky) / 45) : 0.6 + 0.4 * Math.sin(t * p.spin + p.ph)));
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    /* 반딧불이 (여름) */
    const fg = cur[FLIES] * this.flyGain;
    if (this.flies.length && fg > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      const n = this.flies.length;
      for (let i = 0; i < n; i++) {
        const fl = this.flies[i];
        const on = clamp(fg * n - i, 0, 1);
        const s = Math.sin(t * fl.fr + fl.ph);
        const a = (s > 0 ? Math.pow(s, 1.5) : 0) * on;
        if (a < 0.02) continue;
        const gs = 22 * fl.size;
        ctx.globalAlpha = a * 0.85;
        ctx.drawImage(SP.fly, fl.x - gs / 2, fl.y - gs / 2, gs, gs);
        ctx.globalAlpha = a; ctx.fillStyle = 'rgb(240,255,170)';
        ctx.beginPath(); ctx.arc(fl.x, fl.y, 1.2, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    /* 계절을 바꾸는 동안 잠깐 어두워져요 */
    if (this.swap) {
      const sw = this.swap, dim = sw.t < 0.45 ? sw.t / 0.45 : 1 - (sw.t - 0.45) / 0.95;
      ctx.globalAlpha = ease(clamp(dim, 0, 1));
      ctx.fillStyle = 'rgb(2,3,8)'; ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;
  }
}
