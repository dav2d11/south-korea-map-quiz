# 남한 시군구 지도 퀴즈

브라우저에서 바로 실행되는 정적 웹앱입니다. 대한민국 시군구 경계를 SVG로 렌더링하고, 객관식/주관식 퀴즈, 오답노트 저장, 모바일 대응 화면, 설치 가능한 PWA 구성을 제공합니다.

현재 데이터는 일반구를 부모 시로 통합한 `최신 229개 시군구` 기준입니다. 수능 한국지리처럼 기초지자체 단위 학습에 맞추기 위해 일반구 분할 데이터는 사용하지 않습니다.

## 실행

1. `cd /Users/an-yuchan/south-korea-map-quiz`
2. `node scripts/build-map-data.mjs`
3. `python3 -m http.server 4173`
4. 브라우저에서 `http://localhost:4173`

## GitHub Pages 배포

1. GitHub에서 새 저장소를 만듭니다.
2. 아래 명령으로 현재 폴더를 올립니다.

```bash
cd /Users/an-yuchan/south-korea-map-quiz
git add .
git commit -m "Initial map quiz app"
git remote add origin https://github.com/사용자이름/저장소이름.git
git push -u origin main
```

3. GitHub 저장소의 `Settings > Pages`로 이동합니다.
4. `Build and deployment` 에서 `Source` 를 `Deploy from a branch` 로 선택합니다.
5. 브랜치는 `main`, 폴더는 `/ (root)` 로 선택하고 저장합니다.
6. 배포 주소는 보통 `https://사용자이름.github.io/저장소이름/` 형태입니다.

정적 사이트라서 별도 서버 없이 바로 배포됩니다.

## 추가 기능

- 휴대폰 화면에 맞춘 버튼 크기와 단일 열 레이아웃
- `localStorage` 기반 오답노트 저장
- 최근 오답, 자주 틀린 지역, 모드별 오답 수 집계
- `manifest.webmanifest` 와 `sw.js` 기반 설치형 웹앱(PWA)

## 데이터 원본

- 공개 저장소 `statgarten/maps` 의 SGIS 기반 행정경계 JSON을 사용합니다.
- 빌드 스크립트는 `/Users/an-yuchan/.tmp-statgarten-maps/json` 을 읽어 `data/regions.js` 를 생성합니다.

## 학습 알고리즘

- 기본 가중치 `10`
- 오답 시 `+15`, 최대 `50`
- 오답 후 첫 정답 시 `-5`
- 연속 정답 2회 시 `-8`
- 연속 정답 3회 이상 시 `-10`, 최소 `2`
- 4문제 이상 안 나온 시군구는 우선 출제
- 직전 문제와 같은 시군구는 제외
