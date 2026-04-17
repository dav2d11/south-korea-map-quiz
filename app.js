import { MAP_DATA } from "./data/regions.js";

const STORAGE_KEY = "south-korea-map-quiz-v3";
const DEFAULT_WEIGHT = 10;
const MIN_WEIGHT = 2;
const MAX_WEIGHT = 50;
const FORCE_GAP = 4;
const MASTER_STREAK = 3;
const WRONG_HISTORY_LIMIT = 200;

const mapSvg = document.getElementById("quiz-map");
const screenRoot = document.getElementById("screen-root");
const homeButton = document.getElementById("home-button");

const regions = MAP_DATA.regions;
const regionById = new Map(regions.map((region) => [region.id, region]));
const mapPaths = new Map();

const state = {
  mode: null,
  score: 0,
  answered: 0,
  questionIndex: 0,
  currentRegionId: null,
  status: "home",
  wrongRegionId: null,
  feedbackTimer: null,
  installPrompt: null,
};

function normalizeText(value) {
  return value.trim().replace(/\s+/g, "").replace(/[().,/-]/g, "").toLowerCase();
}

function createInitialStats() {
  return Object.fromEntries(
    regions.map((region) => [
      region.id,
      {
        weight: DEFAULT_WEIGHT,
        wrongCount: 0,
        correctStreak: 0,
        lastSeen: null,
        seenCount: 0,
        lastWrongAt: null,
        lastCorrectAt: null,
      },
    ]),
  );
}

function createInitialStore() {
  return {
    stats: createInitialStats(),
    sessionSummary: {
      totalCorrect: 0,
      totalWrong: 0,
      byMode: {
        multiple: { correct: 0, wrong: 0 },
        subjective: { correct: 0, wrong: 0 },
      },
    },
    wrongHistory: [],
  };
}

function sanitizeStore(parsed) {
  const base = createInitialStore();
  if (!parsed || typeof parsed !== "object") {
    return base;
  }

  if (parsed.stats && typeof parsed.stats === "object") {
    for (const [regionId, stat] of Object.entries(base.stats)) {
      if (parsed.stats[regionId]) {
        base.stats[regionId] = { ...stat, ...parsed.stats[regionId] };
      }
    }
  } else {
    for (const [regionId, stat] of Object.entries(base.stats)) {
      if (parsed[regionId]) {
        base.stats[regionId] = { ...stat, ...parsed[regionId] };
      }
    }
  }

  if (parsed.sessionSummary?.byMode) {
    base.sessionSummary = {
      totalCorrect: parsed.sessionSummary.totalCorrect || 0,
      totalWrong: parsed.sessionSummary.totalWrong || 0,
      byMode: {
        multiple: {
          correct: parsed.sessionSummary.byMode.multiple?.correct || 0,
          wrong: parsed.sessionSummary.byMode.multiple?.wrong || 0,
        },
        subjective: {
          correct: parsed.sessionSummary.byMode.subjective?.correct || 0,
          wrong: parsed.sessionSummary.byMode.subjective?.wrong || 0,
        },
      },
    };
  }

  if (Array.isArray(parsed.wrongHistory)) {
    base.wrongHistory = parsed.wrongHistory.slice(0, WRONG_HISTORY_LIMIT);
  }

  return base;
}

function loadStore() {
  try {
    return sanitizeStore(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return createInitialStore();
  }
}

let store = loadStore();
let stats = store.stats;

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function resetStore() {
  store = createInitialStore();
  stats = store.stats;
  saveStore();
}

function clearFeedbackTimer() {
  if (state.feedbackTimer) {
    clearTimeout(state.feedbackTimer);
    state.feedbackTimer = null;
  }
}

function countMastered() {
  return regions.filter((region) => stats[region.id].correctStreak >= MASTER_STREAK).length;
}

function averageWeight() {
  const total = regions.reduce((sum, region) => sum + stats[region.id].weight, 0);
  return (total / regions.length).toFixed(1);
}

function getWrongRate() {
  const total = store.sessionSummary.totalCorrect + store.sessionSummary.totalWrong;
  if (total === 0) {
    return "0.0";
  }
  return ((store.sessionSummary.totalWrong / total) * 100).toFixed(1);
}

function getMostMissedRegions(limit = 8) {
  return regions
    .filter((region) => stats[region.id].wrongCount > 0)
    .sort((a, b) => {
      const diff = stats[b.id].wrongCount - stats[a.id].wrongCount;
      if (diff !== 0) {
        return diff;
      }
      return a.fullName.localeCompare(b.fullName, "ko");
    })
    .slice(0, limit);
}

function formatDateTime(isoString) {
  if (!isoString) {
    return "-";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildMap() {
  mapSvg.setAttribute("viewBox", MAP_DATA.viewBox);
  mapSvg.innerHTML = "";

  for (const region of regions) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", region.path);
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("class", "map-region is-muted");
    path.setAttribute("data-region-id", region.id);
    path.setAttribute("aria-label", region.fullName);
    mapPaths.set(region.id, path);
    mapSvg.appendChild(path);
  }
}

function setActiveRegion(regionId) {
  for (const [id, path] of mapPaths) {
    path.classList.toggle("is-active", id === regionId);
    path.classList.toggle("is-muted", id !== regionId);
  }
}

function getCandidatePool() {
  return regions.filter((region) => {
    const stat = stats[region.id];
    return stat.correctStreak < MASTER_STREAK || stat.weight > MIN_WEIGHT;
  });
}

function weightedChoice(candidates) {
  const totalWeight = candidates.reduce((sum, region) => sum + stats[region.id].weight, 0);
  let target = Math.random() * totalWeight;

  for (const region of candidates) {
    target -= stats[region.id].weight;
    if (target <= 0) {
      return region;
    }
  }

  return candidates.at(-1) || null;
}

function pickNextRegion() {
  const pool = getCandidatePool();
  const lastRegionId = state.currentRegionId;

  const available = pool.filter((region) => region.id !== lastRegionId);
  const stale = available
    .filter((region) => {
      const lastSeen = stats[region.id].lastSeen;
      return lastSeen === null || state.questionIndex - lastSeen >= FORCE_GAP;
    })
    .sort((a, b) => stats[b.id].weight - stats[a.id].weight);

  if (stale.length > 0) {
    return stale[0];
  }

  return weightedChoice(available.length > 0 ? available : pool);
}

function recordWrongAttempt(region, submittedAnswer = "") {
  const entry = {
    regionId: region.id,
    regionName: region.name,
    province: region.province,
    fullName: region.fullName,
    mode: state.mode,
    submittedAnswer,
    at: new Date().toISOString(),
  };

  store.wrongHistory = [entry, ...store.wrongHistory].slice(0, WRONG_HISTORY_LIMIT);
}

function updateStats(regionId, isCorrect, submittedAnswer = "") {
  const stat = stats[regionId];
  const region = regionById.get(regionId);
  stat.seenCount += 1;
  stat.lastSeen = state.questionIndex;

  if (isCorrect) {
    stat.correctStreak += 1;
    stat.lastCorrectAt = new Date().toISOString();
    if (state.mode) {
      store.sessionSummary.totalCorrect += 1;
      store.sessionSummary.byMode[state.mode].correct += 1;
    }

    if (stat.correctStreak === 1 && stat.wrongCount > 0) {
      stat.weight = Math.max(MIN_WEIGHT, stat.weight - 5);
    } else if (stat.correctStreak === 2) {
      stat.weight = Math.max(MIN_WEIGHT, stat.weight - 8);
    } else if (stat.correctStreak >= 3) {
      stat.weight = Math.max(MIN_WEIGHT, stat.weight - 10);
    }
  } else {
    stat.wrongCount += 1;
    stat.correctStreak = 0;
    stat.lastWrongAt = new Date().toISOString();
    stat.weight = Math.min(MAX_WEIGHT, stat.weight + 15);
    if (state.mode) {
      store.sessionSummary.totalWrong += 1;
      store.sessionSummary.byMode[state.mode].wrong += 1;
    }
    if (region) {
      recordWrongAttempt(region, submittedAnswer);
    }
  }

  saveStore();
}

function formatRegionLabel(region) {
  return `${region.province} ${region.name}`;
}

function buildChoices(answerRegion) {
  const sameProvince = answerRegion.sameProvinceNearby
    .map((regionId) => regionById.get(regionId))
    .filter(Boolean)
    .slice(0, 2);

  const chosen = new Map([[answerRegion.id, answerRegion]]);
  for (const candidate of sameProvince) {
    chosen.set(candidate.id, candidate);
  }

  const others = regions
    .filter((region) => region.id !== answerRegion.id && !chosen.has(region.id))
    .sort((a, b) => stats[b.id].weight - stats[a.id].weight || a.fullName.localeCompare(b.fullName, "ko"));

  for (const candidate of others) {
    chosen.set(candidate.id, candidate);
    if (chosen.size >= 4) {
      break;
    }
  }

  return Array.from(chosen.values())
    .slice(0, 4)
    .sort(() => Math.random() - 0.5);
}

function allMastered() {
  return regions.every((region) => stats[region.id].correctStreak >= MASTER_STREAK);
}

function nextQuestion() {
  clearFeedbackTimer();

  if (allMastered()) {
    state.status = "complete";
    state.currentRegionId = null;
    render();
    setActiveRegion(null);
    return;
  }

  const region = pickNextRegion();
  if (!region) {
    state.status = "complete";
    render();
    return;
  }

  state.currentRegionId = region.id;
  state.wrongRegionId = null;
  state.status = "question";
  state.questionIndex += 1;
  setActiveRegion(region.id);
  render();
}

function startGame(mode) {
  clearFeedbackTimer();
  state.mode = mode;
  state.score = 0;
  state.answered = 0;
  state.questionIndex = 0;
  state.currentRegionId = null;
  state.wrongRegionId = null;
  nextQuestion();
}

function goHome() {
  clearFeedbackTimer();
  state.mode = null;
  state.score = 0;
  state.answered = 0;
  state.questionIndex = 0;
  state.currentRegionId = null;
  state.wrongRegionId = null;
  state.status = "home";
  setActiveRegion(null);
  render();
}

function showWrongNote() {
  clearFeedbackTimer();
  state.status = "wrong-note";
  setActiveRegion(null);
  render();
}

function handleCorrect(region) {
  updateStats(region.id, true);
  state.score += 1;
  state.answered += 1;
  state.status = "correct";
  render();
  state.feedbackTimer = window.setTimeout(() => {
    nextQuestion();
  }, 700);
}

function handleWrong(region, submittedAnswer = "") {
  updateStats(region.id, false, submittedAnswer);
  state.answered += 1;
  state.status = "wrong";
  state.wrongRegionId = region.id;
  render();
}

function submitSubjective() {
  const input = document.getElementById("subjective-answer");
  const region = regionById.get(state.currentRegionId);
  if (!input || !region) {
    return;
  }

  const rawAnswer = input.value.trim();
  const userAnswer = normalizeText(rawAnswer);
  if (!userAnswer) {
    input.focus();
    return;
  }

  const isCorrect = region.acceptedAnswers.includes(userAnswer);
  if (isCorrect) {
    handleCorrect(region);
  } else {
    handleWrong(region, rawAnswer);
  }
}

async function installApp() {
  if (!state.installPrompt) {
    return;
  }

  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  render();
}

function renderHome() {
  const mastered = countMastered();
  const masteryPercent = ((mastered / regions.length) * 100).toFixed(1);
  const mostMissed = getMostMissedRegions(5);

  screenRoot.innerHTML = `
    <div class="stack">
      <section class="hero">
        <h2>모드를 선택하세요</h2>
        <p>휴대폰 브라우저에서도 바로 사용할 수 있게 화면을 단순화했고, 틀린 문제는 오답노트에 저장됩니다. 설치 가능한 브라우저에서는 홈 화면에 추가해서 앱처럼 실행할 수 있습니다.</p>
      </section>
      <section class="stats-grid">
        <article class="stat-card">
          <div class="label">전체 시군구</div>
          <div class="value">${regions.length}</div>
        </article>
        <article class="stat-card">
          <div class="label">마스터 완료</div>
          <div class="value">${mastered}</div>
        </article>
        <article class="stat-card">
          <div class="label">오답률</div>
          <div class="value">${getWrongRate()}%</div>
        </article>
        <article class="stat-card">
          <div class="label">저장된 오답</div>
          <div class="value">${store.wrongHistory.length}</div>
        </article>
      </section>
      <div class="progress"><span style="width:${masteryPercent}%"></span></div>
      <section class="mode-buttons">
        <button class="primary-button" type="button" data-action="start-multiple">객관식 시작</button>
        <button class="secondary-button" type="button" data-action="start-subjective">주관식 시작</button>
      </section>
      <section class="mobile-actions">
        <button class="secondary-button" type="button" data-action="open-wrong-note">오답노트 보기</button>
        ${
          state.installPrompt
            ? '<button class="ghost-button" type="button" data-action="install-app">폰에 설치</button>'
            : ""
        }
      </section>
      <section class="message">
        <strong>출제 규칙</strong>
        <p class="subtle">4문제 이상 안 나온 시군구는 우선 출제하고, 오답은 가중치를 높여 다시 만나게 합니다. 객관식 오답 선지는 같은 시도 내 가까운 시군구를 우선 포함합니다.</p>
      </section>
      <section class="message">
        <strong>자주 틀린 지역</strong>
        ${
          mostMissed.length > 0
            ? `<div class="list-table compact">
              ${mostMissed
                .map(
                  (region) => `
                    <div class="list-row">
                      <div>
                        <strong>${formatRegionLabel(region)}</strong>
                        <p class="subtle">최근 오답 ${formatDateTime(stats[region.id].lastWrongAt)}</p>
                      </div>
                      <span class="pill">${stats[region.id].wrongCount}회</span>
                    </div>
                  `,
                )
                .join("")}
            </div>`
            : '<p class="subtle">아직 저장된 오답이 없습니다.</p>'
        }
      </section>
      <div class="action-row">
        <button class="ghost-button" type="button" data-action="reset-stats">학습 기록 초기화</button>
      </div>
    </div>
  `;
}

function renderQuestion() {
  const region = regionById.get(state.currentRegionId);
  if (!region) {
    renderHome();
    return;
  }

  const scoreText = `${state.score} / ${state.answered}`;
  const badges = `
    <div class="badge-row">
      <span class="badge">점수 ${scoreText}</span>
      <span class="badge">현재 모드 ${state.mode === "multiple" ? "객관식" : "주관식"}</span>
      <span class="badge">가중치 ${stats[region.id].weight}</span>
    </div>
  `;

  if (state.mode === "multiple") {
    const choices = buildChoices(region);
    screenRoot.innerHTML = `
      <div class="stack">
        ${badges}
        <section class="message">
          <strong>객관식</strong>
          <p class="subtle">빨간색으로 표시된 시군구를 고르세요.</p>
        </section>
        <section class="choice-grid">
          ${choices
            .map(
              (choice) => `
                <button class="choice-button" type="button" data-choice-id="${choice.id}">
                  ${formatRegionLabel(choice)}
                </button>
              `,
            )
            .join("")}
        </section>
        <button class="ghost-button" type="button" data-action="open-wrong-note">오답노트</button>
      </div>
    `;

    for (const button of screenRoot.querySelectorAll("[data-choice-id]")) {
      button.addEventListener("click", () => {
        const choiceRegion = regionById.get(button.dataset.choiceId);
        if (!choiceRegion) {
          return;
        }
        if (choiceRegion.id === region.id) {
          handleCorrect(region);
        } else {
          handleWrong(region, formatRegionLabel(choiceRegion));
        }
      });
    }
    return;
  }

  screenRoot.innerHTML = `
    <div class="stack">
      ${badges}
      <section class="message">
        <strong>주관식</strong>
        <p class="subtle">시군구 이름을 입력하세요. 예시: 서울특별시 강남구 또는 강남구</p>
      </section>
      <section class="input-wrap">
        <input id="subjective-answer" class="answer-input" type="text" placeholder="정답 입력" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <button class="primary-button" type="button" data-action="submit-answer">제출</button>
      </section>
      <button class="ghost-button" type="button" data-action="open-wrong-note">오답노트</button>
    </div>
  `;

  const input = document.getElementById("subjective-answer");
  input?.focus();
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitSubjective();
    }
  });
  screenRoot.querySelector("[data-action='submit-answer']")?.addEventListener("click", submitSubjective);
}

function renderCorrect() {
  const region = regionById.get(state.currentRegionId);
  screenRoot.innerHTML = `
    <div class="stack">
      <div class="badge-row">
        <span class="badge">점수 ${state.score} / ${state.answered}</span>
      </div>
      <section class="message success">
        <strong>정답</strong>
        <p>${region ? formatRegionLabel(region) : ""}</p>
        <p class="subtle">다음 문제로 자동 이동합니다.</p>
      </section>
    </div>
  `;
}

function renderWrong() {
  const region = regionById.get(state.wrongRegionId);
  if (!region) {
    renderHome();
    return;
  }

  screenRoot.innerHTML = `
    <div class="stack">
      <div class="badge-row">
        <span class="badge">점수 ${state.score} / ${state.answered}</span>
        <span class="badge">오답 누적 ${stats[region.id].wrongCount}</span>
      </div>
      <section class="message error">
        <strong>오답</strong>
        <p>정답은 <b>${formatRegionLabel(region)}</b> 입니다.</p>
        <p class="subtle">오답노트에 자동 저장했습니다.</p>
      </section>
      <div class="action-row">
        <button class="secondary-button" type="button" data-action="retry">다시하기</button>
        <button class="ghost-button" type="button" data-action="open-wrong-note">오답노트</button>
        <button class="ghost-button" type="button" data-action="home">메인화면</button>
      </div>
    </div>
  `;

  screenRoot.querySelector("[data-action='retry']")?.addEventListener("click", () => {
    state.currentRegionId = state.wrongRegionId;
    state.status = "question";
    setActiveRegion(state.currentRegionId);
    render();
  });
}

function renderWrongNote() {
  const topMissed = getMostMissedRegions(10);
  const recentHistory = store.wrongHistory.slice(0, 20);

  screenRoot.innerHTML = `
    <div class="stack">
      <section class="hero">
        <h2>오답노트</h2>
        <p>틀린 문제는 기기 안에 저장됩니다. 최근 오답과 자주 틀린 지역을 여기서 다시 볼 수 있습니다.</p>
      </section>
      <section class="stats-grid">
        <article class="stat-card">
          <div class="label">저장된 오답</div>
          <div class="value">${store.wrongHistory.length}</div>
        </article>
        <article class="stat-card">
          <div class="label">총 오답</div>
          <div class="value">${store.sessionSummary.totalWrong}</div>
        </article>
        <article class="stat-card">
          <div class="label">객관식 오답</div>
          <div class="value">${store.sessionSummary.byMode.multiple.wrong}</div>
        </article>
        <article class="stat-card">
          <div class="label">주관식 오답</div>
          <div class="value">${store.sessionSummary.byMode.subjective.wrong}</div>
        </article>
      </section>
      <section class="message">
        <strong>자주 틀린 지역</strong>
        ${
          topMissed.length
            ? `<div class="list-table">
              ${topMissed
                .map(
                  (region) => `
                    <div class="list-row">
                      <div>
                        <strong>${formatRegionLabel(region)}</strong>
                        <p class="subtle">가중치 ${stats[region.id].weight} · 최근 오답 ${formatDateTime(stats[region.id].lastWrongAt)}</p>
                      </div>
                      <span class="pill">${stats[region.id].wrongCount}회</span>
                    </div>
                  `,
                )
                .join("")}
            </div>`
            : '<p class="subtle">아직 오답 데이터가 없습니다.</p>'
        }
      </section>
      <section class="message">
        <strong>최근 오답</strong>
        ${
          recentHistory.length
            ? `<div class="list-table">
              ${recentHistory
                .map(
                  (entry) => `
                    <div class="list-row">
                      <div>
                        <strong>${entry.fullName}</strong>
                        <p class="subtle">${entry.mode === "multiple" ? "객관식" : "주관식"} · ${formatDateTime(entry.at)}</p>
                        ${
                          entry.submittedAnswer
                            ? `<p class="subtle">내 답: ${entry.submittedAnswer}</p>`
                            : ""
                        }
                      </div>
                    </div>
                  `,
                )
                .join("")}
            </div>`
            : '<p class="subtle">최근 오답 기록이 없습니다.</p>'
        }
      </section>
      <div class="action-row">
        <button class="secondary-button" type="button" data-action="home">메인화면</button>
        <button class="ghost-button" type="button" data-action="reset-stats">기록 초기화</button>
      </div>
    </div>
  `;
}

function renderComplete() {
  screenRoot.innerHTML = `
    <div class="stack">
      <section class="message success">
        <strong>완료</strong>
        <p>모든 시군구가 3연속 정답 기준에 도달했습니다.</p>
        <p class="subtle">최종 점수는 ${state.score} / ${state.answered} 입니다.</p>
      </section>
      <div class="action-row">
        <button class="primary-button" type="button" data-action="start-multiple">객관식 다시 시작</button>
        <button class="secondary-button" type="button" data-action="start-subjective">주관식 다시 시작</button>
        <button class="ghost-button" type="button" data-action="open-wrong-note">오답노트</button>
        <button class="ghost-button" type="button" data-action="home">메인화면</button>
      </div>
    </div>
  `;
}

function bindGlobalButtons() {
  screenRoot.querySelector("[data-action='start-multiple']")?.addEventListener("click", () => startGame("multiple"));
  screenRoot.querySelector("[data-action='start-subjective']")?.addEventListener("click", () => startGame("subjective"));
  screenRoot.querySelector("[data-action='reset-stats']")?.addEventListener("click", () => {
    resetStore();
    render();
  });
  screenRoot.querySelector("[data-action='home']")?.addEventListener("click", goHome);
  screenRoot.querySelector("[data-action='open-wrong-note']")?.addEventListener("click", showWrongNote);
  screenRoot.querySelector("[data-action='install-app']")?.addEventListener("click", () => {
    installApp();
  });
}

function render() {
  switch (state.status) {
    case "question":
      renderQuestion();
      break;
    case "correct":
      renderCorrect();
      break;
    case "wrong":
      renderWrong();
      break;
    case "wrong-note":
      renderWrongNote();
      break;
    case "complete":
      renderComplete();
      break;
    default:
      renderHome();
      break;
  }

  bindGlobalButtons();
}

function registerPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    render();
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    render();
  });
}

homeButton.addEventListener("click", goHome);

buildMap();
registerPwa();
goHome();
