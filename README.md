# mong · 멍때리기 좋은 곳

불멍 · 비멍 · 물멍(어항 · 바다 · 연못). 소리를 켜고 아무 생각 없이 바라보는 사이트예요. 모바일부터 데스크톱까지 반응형이에요.

## 실행

```bash
npm install
npm run dev       # 개발 서버
npm run build     # 타입 검사 + dist/ 빌드
npm run preview   # 빌드 결과 미리보기
```

Node 20.11 이상에서 동작해요. 빌드 결과(`dist/`)는 정적 파일이라 어디에나 올릴 수 있어요. 주소는 해시(`#/fire`)를 써서 서버에 별도 라우팅 설정이 필요 없어요.

## 주소

| 주소 | 장면 |
|---|---|
| `#/` | 홈 |
| `#/fire` | 불멍 |
| `#/rain` | 비멍 |
| `#/water` | 물멍 (마지막에 본 장면, 처음엔 어항) |
| `#/water/aquarium` · `#/water/sea` · `#/water/pond` | 어항 · 바다 · 연못 |

## 구조

```
src/
  app.ts               라우팅, 화면 전환
  views/
    home-view.ts       홈: 움직이는 미리보기 카드 3장
    scene-view.ts      장면 화면: 도크, 소리·타이머 시트, 장작 트레이, 몰입 모드, 타이머 종료, 단축키
  scenes/              Canvas 2D 장면 (fire, rain, aquarium, sea, pond) + 공용 루프(host.ts)
  audio/
    engine.ts          AudioContext, 장면 간 크로스페이드, 홈 미리듣기, 타이머 페이드
    assets.ts          녹음 불러오기, 소리 안에서 ‘탁’·충돌 지점 찾기
    loop.ts            녹음 하나로 끝없이 이어지는 배경 소리 (무작위 구간 + 크로스페이드)
    sounds/            장면별 소리 (불멍은 녹음, 비멍·물멍은 합성)
  lib/                 설정 저장(localStorage), 슬립 타이머, 화면 꺼짐 방지, 전체화면
  styles/              tokens.css(디자인 토큰), app.css
```

## 소리

- **불멍**: 실제 녹음(CC0, `public/sounds/fire/`, 출처는 `public/sounds/CREDITS.md`). 모닥불 녹음 100초를 무작위 구간으로 이어 붙여(3초 크로스페이드) 반복이 티 나지 않게 하고, 불 세기에 따라 볼륨과 밝기가 바뀌어요. 같은 녹음에서 찾아낸 ‘탁’ 소리를 불 세기만큼 더하고, 장작을 넣으면 화면에서 장작이 닿는 순간에 맞춰 장작 소리(녹음된 세 가지 중 하나), 1.5초 뒤 불 붙는 소리가 나요.
- **비멍 · 물멍**: 아직 Web Audio 합성. 장면 상태를 따라가요(번개 1~2초 뒤 천둥, 바다는 화면 파도와 같은 시계).

브라우저는 사용자가 한 번 누르기 전에는 소리를 못 내요. 홈에서 카드를 누르면 바로 소리가 나고, 링크로 바로 들어오면 ‘탭해서 소리 켜기’ 안내가 떠요.

## 디자인

Doan 보드 `.doan/canvases/mong.html`에 시안이 있고, 각 화면이 구현 파일과 연결돼 있어요(`data-doan-implements`).
