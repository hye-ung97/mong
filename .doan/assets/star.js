/* mong — 별멍 시안용 장면 (Doan 보드 전용). 코드(src/scenes)에는 아직 없어요.
   풀밭에 누워 남쪽 지평선부터 머리 위 너머까지 올려다본 하늘 (서울쯤의 위도).
   밤은 초저녁 → 한밤 → 새벽으로 한 방향으로만 흘러요(10분 + 20분). 그동안 별자리는 왼쪽(동)에서 떠서 오른쪽(서)으로 흘러가요.
   어느 때든 머물 수 있고, 머무는 동안에는 진짜 하늘의 빠르기로 아주 느리게 흘러요(한 시간에 15도). 뒤로 돌아갈 때는 잠깐 어두워졌다 밝아져요.
   오리온 · 여름의 대삼각형 · 북두칠성 · 페가수스 같은 밝은 별은 진짜 자리와 진짜 밝기고, 나머지 별은 무작위예요.
   은하수도 진짜 길을 따라 백조에서 궁수까지 흘러요.
   별자리 알려 주기: 가끔 그 계절의 별자리 하나를 선으로 이어 이름을 보여 주고, 흐려지면 한참 뒤 다른 별자리를 보여 줘요.
   손대는 법: 밝은 별을 누르면 그 별자리를 바로 알려 줘요 · 빈 하늘을 누르면 별똥별 · 풀밭을 누르면 벌레가 숨죽여요.
   <canvas data-star> 하나가 장면 하나. 같은 .screen 안의 [data-star-act] 버튼이 장면을 조작해요.
     data-season="spring|summer|autumn|winter"  계절 (기본 summer). 한밤에 남쪽 하늘 가운데 오는 별자리, 풀밭, 날리는 것, 상태 줄 문구가 바뀌어요
     data-night="dusk|night|dawn"  밤 깊이: 초저녁 · 한밤 · 새벽 (기본 night)
     data-flow="600"               초저녁이 한밤이 되는 데 걸리는 시간(초). 한밤에서 새벽은 그 두 배. 없으면 그 자리에 멈춰 있어요 (보드의 정지 화면용)
     data-flow-loop="6"            새벽에 닿은 뒤 n초 있다가, 잠깐 어두워졌다 초저녁부터 다시 (설명용)
     data-hold                     지금 때에 머무는 중 (켜진 버튼에 핀이 붙어요)
     data-guide="40"               별자리를 하나 보여 주고 다음 별자리까지 쉬는 시간(초). 0 이면 안 보여 줘요
     data-guide-off                별자리 알려 주기를 끈 채로 시작 ([data-star-act="guide"] 버튼으로 켜고 꺼요)
     data-fireflies="off"          반딧불이 끄고 시작 (여름에만 있어요)
     data-floor="170"              풀밭 높이(px). 조작 버튼이 놓이는 자리
     data-top="134"                화면 맨 위에 걸리는 하늘 높이(도). 90이 머리 꼭대기. 세로 화면은 134, 가로 화면은 104가 기본이에요
     data-turn="-20"               구도를 맞추려고 하늘을 더 돌려 둔 각도(도). 음수면 더 이른 하늘
     data-cx="0.5"                 정남쪽이 놓이는 가로 자리 (비율)
     data-meteor="40"              별똥별이 떨어지는 평균 간격(초). 보드에서는 잘 보이게 짧게 줘요
     data-seen="3"                 처음부터 세어 둔 별똥별 수
     data-auto-hush="6"            n초마다 손가락이 풀밭을 건드려요 (설명용)
   확인용: 주소에 ?warm=5 를 붙이면 모든 장면이 5초 지난 모습으로 시작해요. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const ease = (x) => x * x * (3 - 2 * x);
  /* 같은 씨앗이면 같은 하늘이 나오게 (화면마다 별자리가 달라지면 안 되니까) */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  const LAT = 37.5; /* 올려다보는 곳의 위도. 서울쯤이에요 */
  const FLOW_TURN = 60; /* 때 하나를 지나는 동안 하늘이 흘러가는 각도(도). 초저녁 → 한밤 → 새벽에 120도, 진짜 하늘로 여덟 시간어치예요 */
  const REST_TURN = 15 / 3600; /* 머무는 동안 하늘이 흘러가는 속도(도/초). 한 시간에 15도, 진짜 하늘과 같은 빠르기예요 */
  const FLOW_SECONDS = 600; /* 초저녁이 한밤이 되는 데 걸리는 시간. 한밤에서 새벽은 그 두 배 (실제 값. 보드는 data-flow 로 줄여서 보여 줘요) */
  const BOARD_FLOW = 20; /* 보드에서 버튼을 눌렀을 때는 이만큼 빨리 흘러요 */
  const PHASE_POS = { dusk: 0, night: 1, dawn: 2 }; /* 밤의 흐름에서 때마다의 자리 */
  const phaseOf = (pos) => (pos < 0.66 ? 'dusk' : pos < 1.6 ? 'night' : 'dawn'); /* 상태 줄과 버튼이 넘어가는 곳 */
  const GUIDE_GAP = 40; /* 별자리 하나를 보여 주고 다음 별자리까지 쉬는 시간(초) */
  const ANCHOR = 0.78; /* 이보다 밝은 별은 눌러서 별자리를 물어볼 수 있어요 */
  const DEG = Math.PI / 180;

  /* 진짜 별: 이름, 적경(시), 적위(도), 등급, 색(0 푸른빛 · 1 흰빛 · 2 노란빛 · 3 주황빛) */
  const NAMED = [
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
  const CLUSTER = [[3.791, 24.11, 0.72], [3.819, 24.05, 0.6], [3.748, 24.11, 0.58], [3.763, 24.37, 0.55], [3.772, 23.95, 0.5], [3.754, 24.47, 0.5], [3.82, 24.14, 0.45]];
  /* 별자리 알려 주기에서 보여 주는 것: 이름, 한 줄 설명, 계절, 선(별 이름 쌍) */
  const CONSTELLATIONS = [
    { name: '북두칠성', sub: '큰곰자리의 꼬리와 엉덩이', season: 'spring', lines: [['alkaid', 'mizar'], ['mizar', 'alioth'], ['alioth', 'megrez'], ['megrez', 'phecda'], ['phecda', 'merak'], ['merak', 'dubhe'], ['dubhe', 'megrez']] },
    { name: '봄의 대곡선', sub: '북두칠성 손잡이를 따라 아크투루스, 스피카로', season: 'spring', lines: [['alioth', 'mizar'], ['mizar', 'alkaid'], ['alkaid', 'arcturus'], ['arcturus', 'spica']] },
    { name: '목동자리', sub: '주황빛 아크투루스가 발끝이에요', season: 'spring', lines: [['muphrid', 'arcturus'], ['arcturus', 'izar'], ['izar', 'nekkar'], ['nekkar', 'seginus'], ['seginus', 'arcturus']] },
    { name: '사자자리', sub: '거꾸로 된 물음표가 사자의 머리', season: 'spring', lines: [['algenubi', 'adhafera'], ['adhafera', 'algieba'], ['algieba', 'regulus'], ['regulus', 'chertan'], ['chertan', 'denebola'], ['denebola', 'zosma'], ['zosma', 'algieba']] },
    { name: '봄의 대삼각형', sub: '아크투루스 · 스피카 · 데네볼라', season: 'spring', lines: [['arcturus', 'spica'], ['spica', 'denebola'], ['denebola', 'arcturus']] },
    { name: '여름의 대삼각형', sub: '직녀 · 견우 · 데네브', season: 'summer', lines: [['vega', 'deneb'], ['deneb', 'altair'], ['altair', 'vega']] },
    { name: '백조자리', sub: '은하수를 따라 날아가는 백조', season: 'summer', lines: [['deneb', 'sadr'], ['sadr', 'albireo'], ['gienah', 'sadr'], ['sadr', 'fawaris']] },
    { name: '거문고자리', sub: '가장 밝은 별이 직녀성이에요', season: 'summer', lines: [['vega', 'sheliak'], ['sheliak', 'sulafat'], ['sulafat', 'vega']] },
    { name: '독수리자리', sub: '가운데 밝은 별이 견우성이에요', season: 'summer', lines: [['tarazed', 'altair'], ['altair', 'alshain']] },
    { name: '전갈자리', sub: '붉은 안타레스가 전갈의 심장', season: 'summer', lines: [['acrab', 'dschubba'], ['dschubba', 'alniyat'], ['alniyat', 'antares'], ['antares', 'paikauhale'], ['paikauhale', 'larawag'], ['larawag', 'sargas'], ['sargas', 'shaula']] },
    { name: '궁수자리', sub: '찻주전자 모양, 은하수의 한가운데', season: 'summer', lines: [['alnasl', 'kausmedia'], ['kausmedia', 'kausborealis'], ['kausborealis', 'phisgr'], ['phisgr', 'nunki'], ['nunki', 'ascella'], ['ascella', 'phisgr'], ['ascella', 'kausaustralis'], ['kausaustralis', 'alnasl'], ['kausmedia', 'phisgr']] },
    { name: '페가수스 사각형', sub: '가을 하늘의 큰 네모', season: 'autumn', lines: [['markab', 'scheat'], ['scheat', 'alpheratz'], ['alpheratz', 'algenib'], ['algenib', 'markab'], ['markab', 'enif']] },
    { name: '안드로메다자리', sub: '페가수스 사각형 한 귀퉁이에서 뻗어 나가요', season: 'autumn', lines: [['alpheratz', 'mirach'], ['mirach', 'almach']] },
    { name: '카시오페이아자리', sub: 'W 모양 다섯 별', season: 'autumn', lines: [['caph', 'schedar'], ['schedar', 'navi'], ['navi', 'ruchbah'], ['ruchbah', 'segin']] },
    { name: '양자리', sub: '하말과 셰라탄, 작은 두 별', season: 'autumn', lines: [['hamal', 'sheratan']] },
    { name: '오리온자리', sub: '세 별이 나란한 허리띠의 사냥꾼', season: 'winter', lines: [['betelgeuse', 'bellatrix'], ['betelgeuse', 'alnitak'], ['bellatrix', 'mintaka'], ['mintaka', 'alnilam'], ['alnilam', 'alnitak'], ['alnitak', 'saiph'], ['mintaka', 'rigel']] },
    { name: '겨울의 대삼각형', sub: '베텔게우스 · 시리우스 · 프로키온', season: 'winter', lines: [['betelgeuse', 'sirius'], ['sirius', 'procyon'], ['procyon', 'betelgeuse']] },
    { name: '큰개자리', sub: '밤하늘에서 가장 밝은 별, 시리우스', season: 'winter', lines: [['mirzam', 'sirius'], ['sirius', 'wezen'], ['wezen', 'adhara']] },
    { name: '쌍둥이자리', sub: '카스토르와 폴룩스, 나란한 두 머리', season: 'winter', lines: [['castor', 'pollux'], ['pollux', 'alhena']] },
    { name: '마차부자리', sub: '노란빛 카펠라가 있는 오각형', season: 'winter', lines: [['capella', 'menkalinan'], ['menkalinan', 'mahasim'], ['mahasim', 'elnath'], ['elnath', 'hassaleh'], ['hassaleh', 'capella']] },
    { name: '황소자리', sub: '붉은 눈 알데바란과 뿔끝 엘나트', season: 'winter', lines: [['aldebaran', 'elnath']] },
  ];

  /* 밤 깊이마다 달라지는 값. 바꾸면 3초쯤 걸려 스르르 넘어가요 */
  const SKY = 0, GX = 12, GC = 13, GA = 16, STARS = 17, CUT = 18, MILKY = 19, FLIES = 20, GROUND = 21, MOON = 24, VENUS = 25, METEOR = 26;
  const NIGHTS = {
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

  /* 계절마다 달라지는 것.
     lst: 한밤에 정남쪽에 오는 적경(시). 봄엔 북두칠성에서 스피카까지, 여름엔 대삼각형과 궁수, 가을엔 페가수스, 겨울엔 오리온이 화면 가운데에 와요
     tint: 하늘빛에 곱하는 값 · gain: 별 밝기 · tw: 별이 떨리는 정도 · haze: 봄밤의 옅은 안개 (흐린 별과 은하수가 묻혀요)
     drift: 바람에 날리는 것. 여름에는 그 자리에 반딧불이가 있어요 */
  const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
  const SEASONS = {
    spring: {
      label: '봄', lst: 12.3, tint: [1.05, 1.07, 0.98], gain: 0.9, tw: 0.85, haze: 0.22,
      sound: '개구리 소리', hush: '쉿, 개구리가 숨죽였어요',
      blade: [2.3, 4, 13], drift: { kind: 'petal', per: 30, up: 300, vx: [10, 24], vy: [6, 14], size: [1.5, 2.6], rgb: '255,214,226', a: 0.9 },
    },
    summer: {
      label: '여름', lst: 18.3, tint: [1, 1, 1], gain: 1, tw: 1, haze: 0,
      sound: '풀벌레 소리', hush: '쉿, 풀벌레가 숨죽였어요',
      blade: [2.6, 7, 26], flies: true, drift: null,
    },
    autumn: {
      label: '가을', lst: 0.3, tint: [1.07, 0.96, 1.05], gain: 1.06, tw: 1.1, haze: 0,
      sound: '귀뚜라미 소리', hush: '쉿, 귀뚜라미가 숨죽였어요',
      blade: [2.6, 6, 20], drift: { kind: 'fluff', per: 44, up: 240, vx: [12, 26], vy: [-3, 4], size: [0.9, 1.5], rgb: '236,226,204', a: 0.6 },
    },
    winter: {
      label: '겨울', lst: 6.1, tint: [0.8, 0.93, 1.1], gain: 1.12, tw: 1.6, haze: 0,
      sound: '겨울바람 소리', hush: null, snow: true,
      blade: [9, 5, 15], drift: { kind: 'snow', per: 9, up: 70, vx: [40, 90], vy: [-4, 6], size: [0.7, 1.4], rgb: '236,243,255', a: 0.8 },
    },
  };
  /* 밤 깊이마다 하늘이 돌아가 있는 자리(도). 초저녁엔 그 계절의 별자리가 동쪽에서 막 오르고, 새벽엔 서쪽으로 기울어요 */
  const turnAt = (pos) => (pos - 1) * FLOW_TURN; /* 밤의 흐름 자리마다 하늘이 돌아가 있는 각도. 한밤이 0 */

  const TINTS = [[190, 212, 255], [255, 255, 255], [255, 238, 206], [255, 208, 170]];
  function glow(c) {
    const S = 64, cv = mk(S, S), x = cv.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, `rgba(${c},1)`); g.addColorStop(0.09, `rgba(${c},0.78)`);
    g.addColorStop(0.32, `rgba(${c},0.17)`); g.addColorStop(1, `rgba(${c},0)`);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    return cv;
  }
  let SPRITES = null;
  function sprites() {
    if (SPRITES) return SPRITES;
    const moon = mk(64, 64), m = moon.getContext('2d');
    m.fillStyle = '#ffe9c6'; m.beginPath(); m.arc(32, 32, 20, 0, TAU); m.fill();
    m.globalCompositeOperation = 'destination-out'; m.beginPath(); m.arc(24, 27, 19, 0, TAU); m.fill();
    const soft = (c) => {
      const cv = mk(64, 64), x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, `rgba(${c},1)`); g.addColorStop(1, `rgba(${c},0)`);
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return cv;
    };
    SPRITES = { star: TINTS.map((t) => glow(t.join(','))), fly: glow('214,242,106'), moon, gal: ['255,170,200', '255,230,196', '150,178,255'].map(soft) };
    return SPRITES;
  }

  /* 은하수: 진짜 은하 적도를 따라 뿌린 빛덩이 · 먼지 띠 · 별가루. 한 번만 만들어서 모든 장면이 같이 써요.
     궁수 쪽(은하 중심)이 가장 밝고 두껍고, 백조 쪽에 밝은 구름이 하나 더 있어요. 백조에서 궁수까지는 가운데가 어둡게 갈라져요.
     겨울 은하수(마차부 · 쌍둥이 쪽)는 훨씬 옅어요 */
  let GALAXY = null;
  function galaxy() {
    if (GALAXY) return GALAXY;
    const r = rng(77), g3 = () => (r() + r() + r() - 1.5) * 1.16;
    /* 은하 좌표(경도 l, 위도 b)를 적도 좌표의 방향으로 */
    const M = [[-0.0548755604, 0.4941094279, -0.867666149], [-0.8734370902, -0.44482963, -0.1980763734], [-0.4838350155, 0.7469822445, 0.4559837762]];
    const eq = (l, b) => {
      const x = Math.cos(b * DEG) * Math.cos(l * DEG), y = Math.cos(b * DEG) * Math.sin(l * DEG), z = Math.sin(b * DEG);
      return [M[0][0] * x + M[0][1] * y + M[0][2] * z, M[1][0] * x + M[1][1] * y + M[1][2] * z, M[2][0] * x + M[2][1] * y + M[2][2] * z];
    };
    const off = (l) => Math.abs((((l % 360) + 540) % 360) - 180); /* 은하 중심에서 떨어진 경도 */
    const bright = (l) => 0.24 + 0.76 * Math.exp(-((off(l) / 58) ** 2)) + 0.26 * Math.exp(-(((l - 76) / 17) ** 2));
    const thick = (l) => 4.8 + 5 * Math.exp(-((off(l) / 26) ** 2));
    const pick = () => { for (;;) { const l = r() * 360; if (r() * 1.25 < bright(l)) return l; } };
    const blobs = [], lanes = [], dust = [[], []];
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

  class Stars {
    constructor(canvas) {
      const d = canvas.dataset;
      this.canvas = canvas;
      this.screen = canvas.closest('.screen') || canvas.closest('.card');
      this.w = canvas.clientWidth || 390;
      this.h = canvas.clientHeight || 844;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(this.w * this.dpr);
      canvas.height = Math.round(this.h * this.dpr);
      this.ctx = canvas.getContext('2d');
      this.visible = true;
      const { w, h } = this;

      this.floor = d.floor !== undefined ? Number(d.floor) : Math.round(h * 0.2);
      this.hz = h - this.floor; /* 지평선 */
      /* 누워서 남쪽 지평선부터 머리 위 너머까지 올려다본 하늘. top 은 화면 맨 위에 걸리는 높이(도)예요. 90이 머리 꼭대기 */
      this.top = Number(d.top) || (w > this.hz * 1.2 ? 104 : 134);
      const mid = this.top / 2, rim = this.hz + 8; /* 진짜 지평선은 능선 바로 뒤에 있어요 */
      this.cx = w * (Number(d.cx) || 0.5);
      this.cy = rim / 2;
      this.K = rim / 2 / (2 * Math.tan((mid / 2) * DEG)); /* 화면 가운데에서 1라디안이 몇 px 인지 (평사 도법이라 가장자리로 갈수록 조금씩 커져요) */
      this.k = this.K * DEG; /* 1도가 몇 px 인지 */
      this.sp = Math.sin((LAT + mid) * DEG); this.cp = Math.cos((LAT + mid) * DEG);
      this.ss = clamp(this.k / 4.4, 0.62, 1.12); /* 하늘이 작게 보이는 화면에서는 별도 작게 */
      this.season = SEASONS[d.season] ? d.season : 'summer';
      this.turn = Number(d.turn) || 0;
      this.t = 0;

      this.makeStars(rng(Number(d.seed) || 20261113));
      this.makeGround();

      /* 밤은 한 줄로 흘러요. pos 0 초저녁 → 1 한밤 → 2 새벽 */
      this.pos = PHASE_POS[NIGHTS[d.night] ? d.night : 'night'];
      this.night = phaseOf(this.pos);
      this.cur = new Float32Array(NIGHTS.night.v.length);
      this.to = new Float32Array(this.cur.length);
      this.mix(this.pos, this.cur);
      this.flowLen = Number(d.flow) || 0;
      this.flowLoop = Number(d.flowLoop) || 0;
      this.hold = d.hold !== undefined; /* 지금 때에 머무는 중 */
      this.flowing = this.flowLen > 0 && !this.hold && this.pos < 2;
      this.loopT = 0;
      /* 하늘이 돌아가 있는 자리(도). 밤의 흐름을 따라가고, 머무는 동안의 느린 흐름이 그 위에 쌓여요 */
      this.sky = turnAt(this.pos);
      this.driftA = 0;
      this.mw = null; this.mwAt = 1e9;
      this.fliesOn = d.fireflies !== 'off';
      this.flyGain = this.fliesOn ? 1 : 0;

      this.meteors = [];
      this.meteorEvery = Number(d.meteor) || 40;
      this.nextMeteor = rand(0.25, 0.7) * this.meteorEvery;
      this.seen = Number(d.seen) || 0;

      /* 별자리 알려 주기 */
      this.guideGap = d.guide !== undefined ? Number(d.guide) : GUIDE_GAP;
      this.guideOn = d.guideOff === undefined; /* 끄면 저절로는 안 보여 줘요. 밝은 별을 누르면 그때만 알려 줘요 */
      this.guide = null;
      this.guideWait = this.guideGap ? Math.min(this.guideGap, Number(d.guideFirst) || 2) : 1e9;
      this.guideLast = null;
      this.guideIdx = 0;
      this.hushT = 0;
      this.poke = null;
      this.swap = null; /* 계절을 바꾸거나 밤을 되돌리는 중: 잠깐 어두워졌다가 밝아져요 */
      this.userT = 0; /* 손댄 뒤 한동안 설명용 손가락은 쉬어요 */
      this.finger = this.screen && this.screen.querySelector('[data-star-finger]');
      this.autoHush = Number(d.autoHush) || 0;
      this.demo = { phase: 'wait', t: 1.6, chain: null, i: 0, p: 0 };

      this.place();
      this.syncUi();
    }

    makeStars(r) {
      const count = clamp(Math.round(60 * this.k * this.k), 500, 3800);
      const first = NAMED.length + CLUSTER.length, n = first + count;
      this.n = n;
      /* 별마다 하늘의 방향(적도 좌표의 단위 벡터)을 갖고 있다가, 그릴 때마다 지금 화면 자리로 옮겨요 */
      this.ex = new Float32Array(n); this.ey = new Float32Array(n); this.ez = new Float32Array(n);
      this.b = new Float32Array(n); this.tint = new Uint8Array(n);
      this.ph = new Float32Array(n); this.rate = new Float32Array(n);
      this.sx = new Float32Array(n); this.sy = new Float32Array(n);
      const put = (i, ra, dec) => {
        const a = ra * 15 * DEG, d = dec * DEG;
        this.ex[i] = Math.cos(d) * Math.cos(a); this.ey[i] = Math.cos(d) * Math.sin(a); this.ez[i] = Math.sin(d);
      };
      this.names = {};
      NAMED.forEach(([name, ra, dec, mag, tint], i) => {
        put(i, ra, dec);
        /* 등급을 밝기로: 0등급이 1, 3등급이 0.79. 이름 있는 별은 모두 이을 수 있게 가장 어두워도 0.79 */
        this.b[i] = clamp(0.93 - (mag - 1) * 0.07, 0.79, 1.06); this.tint[i] = tint;
        this.names[name] = i;
      });
      CLUSTER.forEach(([ra, dec, b], j) => { put(NAMED.length + j, ra, dec); this.b[NAMED.length + j] = b; });
      const lowest = -Math.cos(LAT * DEG) - 0.04; /* 이보다 남쪽 별은 지평선 위로 올라오지 않아요 */
      for (let i = first; i < n; i++) {
        let z = r() * 2 - 1;
        while (z < lowest) z = r() * 2 - 1;
        const a = r() * TAU, q = Math.sqrt(1 - z * z), x = q * Math.cos(a), y = q * Math.sin(a);
        /* 무작위 별은 진짜 별보다 밝지 않게, 진짜 별자리 가까이에서는 더 어둡게. 그래야 오리온이 오리온으로 보여요 */
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

    /* 은하수는 따로 한 장에 그려 두고, 하늘이 반 픽셀쯤 움직일 때마다 다시 그려요. 빛덩이 2,000여 개를 매번 그리지 않으려고요 */
    drawGalaxy() {
      const { w, cx, cy, K, k, sp, cp, cL, sL } = this, lh = Math.round(this.hz + 40);
      if (!this.mw) this.mw = mk(w, lh);
      const x = this.mw.getContext('2d'), G = galaxy(), SP = sprites();
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
      x.clearRect(0, 0, w, lh);
      const each = (list, fn) => {
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

    crest(x) { return this.hz + 16 + 8 * Math.sin(x * 0.0105 + 0.8) + 4 * Math.sin(x * 0.027 + 2.1); }
    gust(x) { return 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * 0.21 + x * 0.002)); }

    /* 능선은 어느 계절이나 같고, 그 위에 자라는 것과 날리는 것이 계절마다 달라요 */
    makeGround() {
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
      /* 가까운 능선 위의 나무 덤불 */
      for (let x = r() * 60; x < w; x += 60 + r() * 130) {
        const m = 2 + Math.floor(r() * 3);
        for (let j = 0; j < m; j++) {
          const cx = x + j * (7 + r() * 5), rad = 5 + r() * 7;
          const cy = hz - 6 - (9 * Math.sin(cx * 0.0093 + 3.1) + 5 * Math.sin(cx * 0.0217 + 1.0)) - rad * 0.5;
          mid.moveTo(cx + rad, cy); mid.arc(cx, cy, rad, 0, TAU);
        }
      }
      this.far = far; this.mid = mid; this.near = near;

      r = rng(4107 + 31 * (SEASON_ORDER.indexOf(this.season) + 1));
      /* 풀: 봄엔 짧은 새 풀과 들꽃, 여름엔 길게 자란 풀, 가을엔 조금 누운 풀, 겨울엔 눈 위로 삐져나온 마른 줄기 */
      const [gap, h0, h1] = S.blade;
      const vs = clamp(hz / 560, 0.5, 1); /* 작은 화면(비교 칸, 홈 카드)에서는 강아지풀과 억새도 같이 작아져요 */
      this.blades = [];
      for (let x = 0; x < w; x += gap) {
        const u = r();
        this.blades.push({ x: x + r() * Math.max(2, gap), hgt: h0 + u * u * h1, lean: r() - 0.5, ph: r() * TAU, bud: this.season === 'spring' && r() < 0.15 ? 1 + Math.floor(r() * 2) : 0 });
      }
      /* 여름엔 강아지풀이 가장자리에, 가을엔 억새가 들판 가득 서요 */
      this.tails = [];
      if (this.season === 'summer') {
        const m = Math.max(4, Math.round(w / 70));
        for (let i = 0; i < m; i++) {
          const u = r(), v = r() * r() * 0.42;
          this.tails.push({ x: (u < 0.5 ? v : 1 - v) * w, hgt: (44 + r() * 52) * vs, dir: r() < 0.5 ? -1 : 1, ph: r() * TAU, plume: 0, vs });
        }
      } else if (this.season === 'autumn') {
        const m = Math.max(5, Math.round(w / (30 * vs)));
        for (let i = 0; i < m; i++) this.tails.push({ x: r() * w, hgt: (50 + r() * r() * 96) * vs, dir: 1, ph: r() * TAU, plume: (15 + r() * 12) * vs, vs });
      }
      /* 봄엔 꽃이 핀 나무, 겨울엔 눈 얹힌 빈 가지 */
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
      /* 바람에 날리는 것: 봄 꽃잎 · 가을 억새 솜털 · 겨울 눈가루 */
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
      /* 눈밭에 비친 별빛 */
      this.glints = [];
      if (S.snow) {
        const m = Math.round(w / 9);
        for (let i = 0; i < m; i++) {
          const x = r() * w;
          this.glints.push({ x, y: this.crest(x) + 5 + r() * r() * Math.max(10, this.floor - 20), ph: r() * TAU, rate: 0.5 + r() * 1.4 });
        }
      }
    }

    makeTree(r) {
      const x = this.w * 0.15, base = this.crest(x) + 6, H = clamp(this.hz * 0.27, 46, 190);
      const segs = [], tips = [];
      const grow = (x0, y0, ang, len, wd, depth) => {
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

    setSeason(id) {
      this.season = id;
      /* 어두워진 사이에 그 계절의 하늘로 돌려 놓아요 */
      this.driftA = 0;
      this.sky = turnAt(this.pos);
      this.guide = null; this.guideWait = Math.min(this.guideWait, 2.5);
      this.makeGround();
      this.place();
      this.hushT = 0;
      if (this.screen) this.screen.classList.remove('is-hush');
      this.syncUi();
    }

    /* 밤의 흐름 자리 pos 의 하늘빛 · 별 · 소리 값 */
    mix(pos, out) {
      const [a, b, k] = pos <= 1 ? [NIGHTS.dusk.v, NIGHTS.night.v, pos] : [NIGHTS.night.v, NIGHTS.dawn.v, pos - 1];
      for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * k;
    }

    /* 밤의 흐름에서 pos 로 옮겨요. 앞으로 가면 스르륵, 뒤로 가면 잠깐 어두워졌다가 그 자리에서 밝아져요 */
    goTo(pos) {
      if (!this.flowLen) this.flowLen = BOARD_FLOW;
      const land = () => {
        this.pos = pos; this.driftA = 0;
        this.sky = turnAt(pos); this.mix(pos, this.cur);
        this.night = phaseOf(pos); this.place(); this.syncUi();
      };
      this.hold = false;
      this.flowing = pos < 2;
      this.loopT = 0;
      if (pos < this.pos - 0.05) this.swap = { t: 0, done: false, fn: land };
      else { this.pos = pos; this.driftA = 0; this.night = phaseOf(pos); }
      this.syncUi();
    }

    /* 별마다 지금 화면 어디에 있는지. 남쪽을 보고 누운 눈에 비친 하늘이라, 하늘이 돌면 별은 왼쪽(동)에서 떠서 오른쪽(서)으로 져요 */
    place() {
      this.at = SEASONS[this.season].lst * 15 + this.sky + this.turn; /* 지금 정남쪽에 와 있는 적경(도) */
      const cL = Math.cos(this.at * DEG), sL = Math.sin(this.at * DEG);
      const { sp, cp, cx, cy, K, ex, ey, ez, sx, sy } = this;
      this.cL = cL; this.sL = sL;
      for (let i = 0; i < this.n; i++) {
        const a = ex[i] * cL + ey[i] * sL, cf = sp * a - cp * ez[i]; /* cf: 보는 방향 쪽으로 얼마나 와 있는지 */
        if (cf < -0.3) { sx[i] = -9999; sy[i] = -9999; continue; }
        const m = (2 / (1 + cf)) * K;
        sx[i] = cx + (ex[i] * sL - ey[i] * cL) * m;
        sy[i] = cy - (cp * a + sp * ez[i]) * m;
      }
    }

    shown(i) { return this.sx[i] > 6 && this.sx[i] < this.w - 6 && this.sy[i] > 6 && this.sy[i] < this.crest(this.sx[i]) - 30; }

    nearAnchor(x, y, radius, skip) {
      let best = -1, bd = radius * radius;
      for (const i of this.anchors) {
        if (i === skip || !this.shown(i)) continue;
        const dx = this.sx[i] - x, dy = this.sy[i] - y, dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = i; }
      }
      return best;
    }

    meteorAt(x, y, tapped) {
      const s = Math.sqrt(clamp(this.w / 390, 0.5, 2.2));
      const right = tapped ? x < this.w / 2 : Math.random() < 0.5;
      const a = rand(0.35, 1.0);
      const sp = rand(560, 860) * s;
      this.meteors.push({ x, y, vx: Math.cos(a) * sp * (right ? 1 : -1), vy: Math.sin(a) * sp, age: 0, dur: rand(0.55, 0.9), len: rand(110, 200) * s, wd: Math.random() < 0.25 ? 2.3 : 1.5 });
      this.seen++;
      this.syncStat();
    }

    /* 풀밭을 건드리면: 풀이 눕고, 반딧불이와 날리던 것이 흩어지고, 벌레와 개구리가 숨죽여요. 겨울엔 숨죽일 벌레가 없어서 눈가루만 일어요 */
    hush(x) {
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
      if (!SEASONS[this.season].hush) return;
      this.hushT = 2.8;
      if (this.screen) this.screen.classList.add('is-hush');
    }

    action(name, value) {
      if (name === 'night' && NIGHTS[value]) {
        if (value === this.night) {
          /* 켜진 때를 한 번 더 누르면 거기 머물고, 또 누르면 다시 흘러가요 */
          this.hold = !this.hold;
          if (!this.flowLen) this.flowLen = BOARD_FLOW;
          this.flowing = !this.hold && this.pos < 2;
          this.toast(this.hold ? `${NIGHTS[value].label}에 머물러요` : this.pos < 2 ? '다시 흘러가요' : '새벽이 밝았어요');
        } else this.goTo(PHASE_POS[value]);
      } else if (name === 'fireflies') this.fliesOn = !this.fliesOn;
      else if (name === 'guide') {
        this.guideOn = !this.guideOn;
        if (!this.guideOn && this.guide && this.guide.auto) this.guide.stop = true; /* 보여 주던 별자리는 스르륵 흐려져요 */
        if (this.guideOn) this.guideWait = Math.min(this.guideWait, 2);
        this.toast(this.guideOn ? '별자리를 알려 줄게요' : '별자리 알려 주기를 껐어요');
      }
      else if (name === 'season' && !this.swap) {
        const to = SEASON_ORDER[(SEASON_ORDER.indexOf(this.season) + 1) % SEASON_ORDER.length];
        this.swap = { t: 0, done: false, fn: () => this.setSeason(to) };
      }
      else if (name === 'meteor') this.meteorAt(rand(0.2, 0.8) * this.w, rand(0.08, 0.4) * this.hz, false);
      this.userT = 5;
      this.syncUi();
    }

    toast(text) {
      const sc = this.screen;
      if (!sc || !sc.classList.contains('screen')) return;
      let el = sc.querySelector('.star-toast');
      if (!el) {
        el = document.createElement('div');
        el.className = 'ui toast glass star-toast';
        el.innerHTML = '<span class="dot"></span><span></span>';
        sc.appendChild(el);
      }
      el.lastChild.textContent = text;
      el.classList.add('show');
      clearTimeout(this.toastT);
      this.toastT = setTimeout(() => el.classList.remove('show'), 2400);
    }

    syncStat() {
      if (this.screen) this.screen.querySelectorAll('[data-stat="meteors"]').forEach((e) => { e.textContent = `${this.seen}개`; });
    }

    syncUi() {
      const sc = this.screen;
      if (!sc) return;
      const S = SEASONS[this.season];
      const put = (key, text) => sc.querySelectorAll(`[data-stat="${key}"]`).forEach((e) => { e.textContent = text; });
      sc.dataset.season = this.season; /* 반딧불이 버튼은 여름에만 보여요 (star.css) */
      sc.querySelectorAll('[data-star-act="night"]').forEach((b) => {
        b.classList.toggle('on', b.dataset.value === this.night);
        b.classList.toggle('held', this.hold && b.dataset.value === this.night); /* 머무는 중이면 켜진 버튼에 핀이 붙어요 */
      });
      sc.querySelectorAll('[data-star-act="fireflies"]').forEach((b) => b.classList.toggle('on', this.fliesOn));
      sc.querySelectorAll('[data-star-act="guide"]').forEach((b) => { b.classList.toggle('on', this.guideOn); b.setAttribute('aria-pressed', String(this.guideOn)); });
      put('night', NIGHTS[this.night].label);
      put('season', S.label);
      put('sound', S.sound);
      if (S.hush) put('hush', S.hush);
      this.syncStat();
    }

    pointer(kind, x, y) {
      if (kind !== 'down') return;
      this.userT = 7;
      if (this.demo.phase !== 'wait') { this.demo.phase = 'wait'; this.demo.t = this.autoHush; }
      if (y >= this.crest(x) - 4) { this.hush(x); return; }
      /* 밝은 별을 누르면 그 별이 든 별자리를 바로 알려 줘요 */
      const a = this.nearAnchor(x, y, 30, -1);
      if (a >= 0) {
        const c = this.fits().find((c) => c.ids.includes(a));
        if (c) { this.showGuide(c); return; }
      }
      this.meteorAt(x, y, true);
    }

    /* 지금 화면에 통째로 들어와 있는 별자리들. 그 계절 것이 앞에 와요 */
    fits() {
      const out = [];
      const ok = (i) => this.sx[i] > 24 && this.sx[i] < this.w - 24 && this.sy[i] > 120 && this.sy[i] < this.crest(this.sx[i]) - 34;
      for (const c of CONSTELLATIONS) {
        if (!c.ids) {
          c.ids = [...new Set(c.lines.flat())].map((n) => this.names[n]);
          c.segs = c.lines.map(([a, b]) => [this.names[a], this.names[b]]);
        }
        if (c.ids.every(ok)) out.push(c);
      }
      return out.sort((p, q) => (q.season === this.season) - (p.season === this.season));
    }

    showGuide(c) {
      this.guide = { c, t: 0, fade: 0 };
      this.guideLast = c;
      this.guideWait = this.guideGap || 1e9;
    }

    /* 한 번에 하나씩: 선을 하나씩 이어 그리고, 이름을 띄우고, 한참 보여 준 뒤 흐려져요. 다음은 쉬었다가 다른 별자리 */
    stepGuide(dt) {
      const g = this.guide;
      if (g) {
        g.t += dt;
        const drawn = g.c.segs.length * 0.5 + 0.4;
        if (g.t > drawn + 8 || g.stop) g.fade += dt / 1.8;
        if (g.fade >= 1) this.guide = null;
        return;
      }
      if (!this.guideGap || !this.guideOn) return;
      this.guideWait -= dt;
      if (this.guideWait > 0) return;
      const list = this.fits().filter((c) => c !== this.guideLast);
      const own = list.filter((c) => c.season === this.season);
      const pick = own.length ? own : list;
      if (!pick.length) { this.guideWait = 3; return; }
      this.showGuide(pick[this.guideIdx++ % pick.length]);
      this.guide.auto = true;
    }

    setFinger(on, x, y, press) {
      if (!this.finger) return;
      this.finger.style.opacity = on ? 1 : 0;
      if (on) this.finger.style.transform = `translate(${x}px, ${y}px) scale(${press ? 0.86 : 1})`;
    }

    /* 설명용: 손가락이 가끔 풀밭을 건드려요 */
    stepDemo(dt) {
      const d = this.demo;
      if (this.userT > 0) { this.setFinger(false); return; }
      d.t -= dt;
      const x = this.w * 0.52, y = this.crest(x) + 44;
      if (d.phase === 'wait' && d.t <= 0) { d.phase = 'press'; d.t = 1.3; }
      else if (d.phase === 'press') {
        this.setFinger(true, x, y, d.t < 0.9 && d.t > 0.6);
        if (d.t < 0.9 && !d.done) { d.done = true; this.hush(x); }
        if (d.t <= 0) { this.setFinger(false); d.done = false; d.phase = 'wait'; d.t = this.autoHush; }
      }
    }

    step(dt) {
      this.t += dt;

      /* 밤의 흐름: 초저녁 → 한밤(10분) → 새벽(20분)으로 한 방향으로만 흘러요. 머물기를 켜면 그 자리에 서고, 새벽에 닿으면 거기 머물러요 */
      if (this.flowing && !this.swap) { /* 되돌아가는 중(어두워진 사이)에는 흐름을 멈춰 둬요 */
        this.pos = Math.min(2, this.pos + dt / (this.pos < 1 ? this.flowLen : this.flowLen * 2));
        if (this.pos >= 2) { this.flowing = false; this.loopT = this.flowLoop; }
      } else if (this.loopT > 0 && !this.swap) {
        this.loopT -= dt;
        if (this.loopT <= 0) this.goTo(0); /* 설명용 되풀이: 잠깐 어두워졌다가 초저녁부터 */
      }
      if (phaseOf(this.pos) !== this.night) { this.night = phaseOf(this.pos); this.syncUi(); }
      this.mix(this.pos, this.to);
      const cur = this.cur, to = this.to, f = 1 - Math.exp(-dt * 1.1);
      for (let i = 0; i < cur.length; i++) cur[i] += (to[i] - cur[i]) * f;
      /* 하늘: 흐르는 동안에는 밤과 같이 눈에 보이게, 머무는 동안에는 진짜 하늘처럼 아주 느리게 쉬지 않고 흘러요.
         앞으로 건너뛰면 하늘빛과 같은 빠르기로 스르륵 따라가요 */
      if (!this.flowing) this.driftA += REST_TURN * dt;
      this.sky += (turnAt(this.pos) + this.driftA - this.sky) * f;
      this.place();
      this.flyGain += ((this.fliesOn ? 1 : 0) - this.flyGain) * Math.min(1, dt * 2);
      if (this.userT > 0) this.userT -= dt;

      if (this.swap) {
        const sw = this.swap;
        sw.t += dt;
        if (!sw.done && sw.t >= 0.45) { sw.done = true; sw.fn(); }
        if (sw.t >= 1.4) this.swap = null;
      }

      this.nextMeteor -= dt * cur[METEOR];
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
        p.x += (p.vx * g * g * 1.6 + p.kx) * dt;
        p.y += (p.vy + 5 * Math.sin(t * p.spin + p.ph) + p.ky) * dt;
        p.kx *= damp; p.ky = p.ky * damp + 60 * dt * (p.ky < -1 ? 1 : 0);
        if (p.x > this.w + 12) { p.x = -10; p.y = p.top + Math.random() * (p.bottom - p.top); }
        if (p.y > p.bottom) p.y = p.top;
        else if (p.y < p.top - 60) p.y = p.bottom;
      }

      this.stepGuide(dt);

      if (this.hushT > 0) {
        this.hushT -= dt;
        if (this.hushT <= 0 && this.screen) this.screen.classList.remove('is-hush');
      }
      if (this.autoHush) this.stepDemo(dt);
    }

    draw() {
      const { ctx, w, h, hz, cur, t } = this;
      const SP = sprites(), S = SEASONS[this.season], T = S.tint;
      const rgb = (i, a) => `rgba(${Math.min(255, cur[i] * T[0]) | 0},${Math.min(255, cur[i + 1] * T[1]) | 0},${Math.min(255, cur[i + 2] * T[2]) | 0},${a === undefined ? 1 : a})`;
      /* 꽃 · 억새 · 눈처럼 밝은 것이 받는 빛. 한밤엔 어둑하고 초저녁과 새벽엔 환해요 */
      const pale = 0.42 + 0.58 * clamp(((cur[SKY + 6] + cur[SKY + 7] + cur[SKY + 8]) / 3 - 10) / 90, 0, 1);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      /* 하늘 */
      let g = ctx.createLinearGradient(0, 0, 0, hz + 20);
      g.addColorStop(0, rgb(SKY)); g.addColorStop(0.45, rgb(SKY + 3)); g.addColorStop(0.82, rgb(SKY + 6)); g.addColorStop(1, rgb(SKY + 9));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      /* 은하수 */
      const mw = cur[MILKY] * (1 - S.haze * 1.8);
      if (mw > 0.01) {
        if (!this.mw || Math.abs(this.at - this.mwAt) > 0.1) this.drawGalaxy();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = mw;
        ctx.drawImage(this.mw, 0, 0);
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
      const gain = cur[STARS] * S.gain, cut = cur[CUT] + S.haze * 0.4, { sx, sy, b: B } = this;
      const flare = [], ss = this.ss;
      let lastTint = -1;
      for (let i = 0; i < this.n; i++) {
        const x = sx[i], y = sy[i];
        if (x < -12 || x > w + 12 || y < -12 || y > hz + 40) continue;
        const b = B[i];
        let a = cut > 0.01 ? smooth(cut - 0.12, cut + 0.1, b) : 1;
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
        c.segs.forEach(([a, b], i) => {
          const p = clamp((g.t - i * 0.5) / 0.55, 0, 1);
          if (p <= 0) return;
          const dx = sx[b] - sx[a], dy = sy[b] - sy[a], len = Math.hypot(dx, dy);
          if (len < 6) return;
          const gap = Math.min(7, len * 0.28); /* 짧은 선(독수리자리 같은)도 보이게, 별 가까이에서 덜 비워요 */
          const ux = dx / len, uy = dy / len, e = ease(p), L = gap + (len - gap * 2) * e;
          ctx.globalAlpha = 0.6 * fa * sk;
          ctx.beginPath(); ctx.moveTo(sx[a] + ux * gap, sy[a] + uy * gap); ctx.lineTo(sx[a] + ux * L, sy[a] + uy * L); ctx.stroke();
        });
        const la = smooth(c.segs.length * 0.5, c.segs.length * 0.5 + 0.9, g.t) * fa;
        if (la > 0.01) {
          let x0 = 1e9, x1 = -1e9, y1 = -1e9, y0 = 1e9;
          for (const i of c.ids) { x0 = Math.min(x0, sx[i]); x1 = Math.max(x1, sx[i]); y0 = Math.min(y0, sy[i]); y1 = Math.max(y1, sy[i]); }
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
      const mixc = (k) => `rgb(${(sk[0] + (G[0] - sk[0]) * k) | 0},${(sk[1] + (G[1] - sk[1]) * k) | 0},${(sk[2] + (G[2] - sk[2]) * k) | 0})`;
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
      const sway = (x, ph) => {
        let s = (2.2 * Math.sin(t * 0.9 + x * 0.013 + ph * 0.6) + 1.2 * Math.sin(t * 2.3 + x * 0.05 + ph)) * this.gust(x);
        if (pt < 4) {
          const dx = x - pk.x, tt = pt - Math.abs(dx) / 420;
          if (tt > 0) s += (dx >= 0 ? 1 : -1) * 9 * Math.exp(-Math.abs(dx) / 110) * Math.cos(9 * tt) * Math.exp(-2.2 * tt);
        }
        return s;
      };
      const buds = [];
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
        const D = S.drift;
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

  const scenes = [];
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__star.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    const warm = Math.min(120, Number(new URLSearchParams(location.search).get('warm')) || 0);
    document.querySelectorAll('canvas[data-star]').forEach((c) => {
      const sc = new Stars(c);
      c.__star = sc;
      scenes.push(sc);
      for (let k = 0; k < warm * 30; k++) sc.step(1 / 30);
      sc.draw();
      if (io) io.observe(c);
      const at = (e) => {
        const r = c.getBoundingClientRect();
        return [(e.clientX - r.left) * (sc.w / r.width), (e.clientY - r.top) * (sc.h / r.height)];
      };
      c.addEventListener('pointerdown', (e) => {
        if (c.setPointerCapture) { try { c.setPointerCapture(e.pointerId); } catch (_) { /* 캡처가 안 되는 환경은 그대로 둬요 */ } }
        sc.pointer('down', ...at(e));
      });
      c.addEventListener('pointermove', (e) => sc.pointer('move', ...at(e)));
      c.addEventListener('pointerup', () => sc.pointer('up'));
      c.addEventListener('pointercancel', () => sc.pointer('up'));
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-star-act]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-star]');
      if (c && c.__star) c.__star.action(b.dataset.starAct, b.dataset.value);
    });
    let last = 0;
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (!last) { last = now; return; }
      const elapsed = (now - last) / 1000;
      if (elapsed < 1 / 31) return;
      last = now;
      const dt = Math.min(elapsed, 0.05);
      for (const sc of scenes) {
        if (!sc.visible) continue;
        sc.step(dt);
        sc.draw();
      }
    };
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
