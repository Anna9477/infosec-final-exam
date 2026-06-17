const STORAGE_KEY = "infosecFinalTrainerState";
const IMPORT_KEY = "infosecFinalTrainerImportedBank";
const CHAPTERS = ["CH08", "CH09", "CH10", "CH11", "CH12", "CH13"];
const LETTERS = ["A", "B", "C", "D"];
const QUICK_COUNTS = [5, 10, 20, 30, 50, 100];

const defaultState = {
  questionStats: {},
  wrongBook: {},
  favorites: [],
  examHistory: [],
  lastPracticeAt: null,
  activeSession: null
};

let bank = { questions: [], chapters: {} };
let questions = [];
let state = loadState();
let timerHandle = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadQuestionBank();
  bindEvents();
  renderChapterSelect();
  renderQuickButtons();
  renderAll();
  showView("dashboard");
}

function loadState() {
  try {
    return { ...structuredClone(defaultState), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadQuestionBank() {
  const imported = localStorage.getItem(IMPORT_KEY);
  if (imported) {
    bank = JSON.parse(imported);
  } else if (window.QUESTION_BANK) {
    bank = window.QUESTION_BANK;
  } else {
    try {
      const response = await fetch("data/questions.json");
      if (!response.ok) throw new Error("questions.json 載入失敗");
      bank = await response.json();
    } catch {
      bank = { questions: [], chapters: {} };
      showLoadWarning("尚未載入題庫。請先執行轉換腳本，或使用右上角匯入 questions.json。");
    }
  }
  questions = Array.isArray(bank.questions) ? bank.questions : [];
  if (!questions.length) {
    showLoadWarning("目前沒有可用題目。請將 Word 檔放入 docs/ 後執行 python scripts/convert_doc_to_json.py。");
  }
}

function showLoadWarning(message) {
  const warning = $("#load-warning");
  warning.textContent = message;
  warning.classList.remove("hidden");
}

function bindEvents() {
  $$(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  $$("[data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.viewJump));
  });

  $("#chapter-order").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    $$("#chapter-order button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  });

  $("#chapter-count-buttons").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    $$("#chapter-count-buttons button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    $("#chapter-custom-count").value = "";
  });

  $("#start-chapter").addEventListener("click", startChapterPractice);
  $("#start-all").addEventListener("click", () => startSession("全部題庫練習", shuffle(questions), "practice"));
  $("#start-custom").addEventListener("click", startCustomQuickPractice);
  $("#start-exam").addEventListener("click", startExam);
  $("#start-wrong").addEventListener("click", startWrongPractice);
  $("#start-favorite").addEventListener("click", startFavoritePractice);
  $("#resume-session").addEventListener("click", resumeSession);
  $("#next-question").addEventListener("click", nextQuestion);
  $("#quit-session").addEventListener("click", quitSession);
  $("#favorite-toggle").addEventListener("click", toggleCurrentFavorite);
  $("#reset-data").addEventListener("click", resetData);
  $("#json-import").addEventListener("change", importQuestionJson);
}

function showView(viewId) {
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${viewId}`).classList.add("active");
  $$(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  $("#view-title").textContent = getViewTitle(viewId);
  if (viewId !== "session-view") stopTimer();
  renderAll();
}

function getViewTitle(viewId) {
  const titles = {
    dashboard: "學習儀表板",
    practice: "練習模式",
    quick: "快速練習",
    exam: "期末考模擬",
    review: "錯題與收藏",
    history: "紀錄分析",
    "session-view": "即時作答",
    "result-view": "完成結果"
  };
  return titles[viewId] || "資安期末刷題";
}

function renderChapterSelect() {
  const select = $("#chapter-select");
  select.innerHTML = CHAPTERS.map((chapter) => {
    const title = chapterLabel(chapter);
    const count = questions.filter((question) => question.chapter === chapter).length;
    return `<option value="${chapter}">${title}（${count} 題）</option>`;
  }).join("");
}

function renderQuickButtons() {
  $("#quick-buttons").innerHTML = QUICK_COUNTS.map((count) => (
    `<button data-count="${count}">${count} 題</button>`
  )).join("");
  $$("#quick-buttons button").forEach((button) => {
    button.addEventListener("click", () => startSession(`快速練習 ${button.dataset.count} 題`, pickRandomQuestions(Number(button.dataset.count)), "quick"));
  });
}

function renderAll() {
  renderDashboard();
  renderReviewCounts();
  renderWeakness();
  renderExamHistory();
}

function renderDashboard() {
  const total = questions.length;
  const statsEntries = Object.values(state.questionStats);
  const completed = statsEntries.filter((item) => item.attempts > 0).length;
  const attempts = statsEntries.reduce((sum, item) => sum + item.attempts, 0);
  const correct = statsEntries.reduce((sum, item) => sum + item.correct, 0);
  const accuracy = attempts ? Math.round((correct / attempts) * 100) : 0;
  const wrongCount = Object.keys(state.wrongBook).length;
  const favoriteCount = state.favorites.length;

  $("#stat-total").textContent = total;
  $("#stat-completed").textContent = completed;
  $("#stat-attempts").textContent = attempts;
  $("#stat-accuracy").textContent = `${accuracy}%`;
  $("#stat-wrong").textContent = wrongCount;
  $("#stat-favorites").textContent = favoriteCount;
  $("#last-practice").textContent = state.lastPracticeAt ? `最近練習：${formatDateTime(state.lastPracticeAt)}` : "尚無練習紀錄";

  const exams = state.examHistory;
  $("#last-exam-score").textContent = exams[0] ? `${exams[0].score} 分` : "--";
  $("#best-score").textContent = exams.length ? `${Math.max(...exams.map((exam) => exam.score))} 分` : "--";
  $("#avg-score").textContent = exams.length ? `${average(exams.map((exam) => exam.score))} 分` : "--";
  $("#avg5-score").textContent = exams.length ? `${average(exams.slice(0, 5).map((exam) => exam.score))} 分` : "--";

  renderPrediction();
  renderProgress();
  renderResumeCard();
}

function renderResumeCard() {
  const card = $("#resume-card");
  const session = state.activeSession;
  if (!session || session.completed) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  $("#resume-detail").textContent = `${session.title}，第 ${session.currentIndex + 1} / ${session.questionIds.length} 題`;
}

function renderProgress() {
  $("#chapter-progress").innerHTML = CHAPTERS.map((chapter) => {
    const chapterQuestions = questions.filter((question) => question.chapter === chapter);
    const completed = chapterQuestions.filter((question) => (state.questionStats[question.id]?.attempts || 0) > 0).length;
    const percent = chapterQuestions.length ? Math.round((completed / chapterQuestions.length) * 100) : 0;
    return `
      <div class="progress-row">
        <strong>${chapterLabel(chapter)}</strong>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        <span>${percent}%</span>
      </div>
    `;
  }).join("");
}

function renderPrediction() {
  const prediction = calculatePrediction();
  $("#pred-safe").textContent = prediction.safe === null ? "--" : `${prediction.safe} 分`;
  $("#pred-normal").textContent = prediction.normal === null ? "--" : `${prediction.normal} 分`;
  $("#pred-optimistic").textContent = prediction.optimistic === null ? "--" : `${prediction.optimistic} 分`;
  $("#prediction-range").textContent = prediction.safe === null ? "累積模擬考後顯示" : `${prediction.safe}～${prediction.optimistic} 分`;
}

function calculatePrediction() {
  const exams = state.examHistory;
  if (!exams.length) return { safe: null, normal: null, optimistic: null };

  const recent5 = average(exams.slice(0, 5).map((exam) => exam.score));
  const recent10 = average(exams.slice(0, 10).map((exam) => exam.score));
  const all = average(exams.map((exam) => exam.score));
  const chapterAccuracy = average(CHAPTERS.map((chapter) => chapterAccuracyPercent(chapter)));
  const wrongPenalty = Math.min(10, Object.keys(state.wrongBook).length / Math.max(1, questions.length) * 20);
  const improvement = improvementScore();
  const normal = clamp(Math.round(recent5 * 0.36 + recent10 * 0.24 + all * 0.18 + chapterAccuracy * 0.18 + improvement * 0.04 - wrongPenalty), 0, 100);
  return {
    safe: clamp(Math.round(normal - 8 - wrongPenalty * 0.45), 0, 100),
    normal,
    optimistic: clamp(Math.round(normal + 7 + improvement * 0.08), 0, 100)
  };
}

function improvementScore() {
  const exams = [...state.examHistory].reverse();
  if (exams.length < 2) return 0;
  const first = average(exams.slice(0, Math.ceil(exams.length / 2)).map((exam) => exam.score));
  const second = average(exams.slice(Math.ceil(exams.length / 2)).map((exam) => exam.score));
  return clamp(second - first, -10, 12);
}

function renderReviewCounts() {
  $("#wrong-count").textContent = `${Object.keys(state.wrongBook).length} 題`;
  $("#favorite-count").textContent = `${state.favorites.length} 題`;
}

function renderWeakness() {
  const rows = CHAPTERS.map((chapter) => ({
    chapter,
    accuracy: chapterAccuracyPercent(chapter),
    attempts: questions.filter((question) => question.chapter === chapter).reduce((sum, question) => sum + (state.questionStats[question.id]?.attempts || 0), 0)
  })).sort((a, b) => a.accuracy - b.accuracy || a.attempts - b.attempts);

  $("#weakness-list").innerHTML = rows.slice(0, 3).map((row, index) => {
    const rank = ["最弱章節", "第二弱章節", "第三弱章節"][index];
    const advice = row.attempts === 0 ? "尚未作答，建議先完成一輪基本練習。" : "建議優先刷本章錯題，再用快速練習混合複習。";
    return `<div class="weak-item"><strong>${rank}：${chapterLabel(row.chapter)}，正確率 ${row.accuracy}%</strong><p>${advice}</p></div>`;
  }).join("");
}

function renderExamHistory() {
  const list = $("#exam-history");
  if (!state.examHistory.length) {
    list.innerHTML = `<div class="history-item"><strong>尚無模擬考紀錄</strong><p>完成一次模擬考後，這裡會保存最近 20 次。</p></div>`;
    return;
  }
  list.innerHTML = state.examHistory.map((exam) => `
    <div class="history-item">
      <strong>${formatDateTime(exam.date)}｜${exam.score} 分</strong>
      <p>答對 ${exam.correct} 題，答錯 ${exam.wrong} 題，正確率 ${exam.accuracy}%，花費 ${formatDuration(exam.duration)}</p>
    </div>
  `).join("");
}

function startChapterPractice() {
  const chapter = $("#chapter-select").value;
  const order = $("#chapter-order .active").dataset.order;
  let selected = questions.filter((question) => question.chapter === chapter);
  if (order === "random") selected = shuffle(selected);
  selected = limitChapterQuestions(selected);
  startSession(`${chapterLabel(chapter)}章節練習`, selected, "practice");
}

function limitChapterQuestions(selected) {
  const customCount = Number($("#chapter-custom-count").value);
  const activeCount = $("#chapter-count-buttons .active").dataset.count;
  if (customCount && customCount > 0) {
    return selected.slice(0, Math.min(customCount, selected.length));
  }
  if (activeCount === "all") return selected;
  return selected.slice(0, Math.min(Number(activeCount), selected.length));
}

function startCustomQuickPractice() {
  const count = Number($("#custom-count").value);
  if (!count || count < 1) return alert("請輸入有效的題數。");
  startSession(`快速練習 ${count} 題`, pickRandomQuestions(count), "quick");
}

function startExam() {
  startSession("期末考模擬", pickRandomQuestions(100), "exam");
}

function startWrongPractice() {
  const selected = Object.keys(state.wrongBook).map(findQuestion).filter(Boolean);
  if (!selected.length) return alert("目前沒有錯題。");
  startSession("錯題本練習", shuffle(selected), "wrong");
}

function startFavoritePractice() {
  const selected = state.favorites.map(findQuestion).filter(Boolean);
  if (!selected.length) return alert("目前沒有收藏題。");
  startSession("收藏題練習", shuffle(selected), "favorite");
}

function startSession(title, selectedQuestions, type) {
  if (!questions.length) return alert("目前沒有題庫，請先轉換或匯入 questions.json。");
  if (!selectedQuestions.length) return alert("沒有符合條件的題目。");
  const unique = dedupeQuestions(selectedQuestions);
  state.activeSession = {
    title,
    type,
    questionIds: unique.map((question) => question.id),
    currentIndex: 0,
    answers: [],
    startedAt: Date.now(),
    elapsedBeforeResume: 0,
    locked: false,
    completed: false
  };
  saveState();
  showView("session-view");
  renderQuestion();
  startTimer();
}

function resumeSession() {
  if (!state.activeSession) return;
  state.activeSession.startedAt = Date.now();
  saveState();
  showView("session-view");
  renderQuestion();
  startTimer();
}

function renderQuestion() {
  const session = state.activeSession;
  if (!session) return;
  const question = findQuestion(session.questionIds[session.currentIndex]);
  if (!question) return;
  const previousAnswer = session.answers[session.currentIndex];

  $("#session-label").textContent = session.title;
  $("#question-title").textContent = question.chapterTitle || chapterLabel(question.chapter);
  $("#question-id").textContent = question.id;
  $("#question-progress-text").textContent = `${session.currentIndex + 1} / ${session.questionIds.length}`;
  $("#question-text").textContent = question.question;
  $("#favorite-toggle").classList.toggle("active", state.favorites.includes(question.id));

  $("#options").innerHTML = LETTERS.map((letter) => `
    <button class="option-btn" data-letter="${letter}">
      <span class="option-letter">${letter}</span>
      <span>${escapeHtml(question.options[letter] || "")}</span>
    </button>
  `).join("");

  $$("#options .option-btn").forEach((button) => {
    button.addEventListener("click", () => answerQuestion(button.dataset.letter));
  });

  $("#feedback").classList.add("hidden");
  $("#next-question").classList.add("hidden");
  session.locked = Boolean(previousAnswer);

  if (previousAnswer) {
    paintAnswer(previousAnswer.selected, previousAnswer.correctAnswer);
    showFeedback(previousAnswer.isCorrect, previousAnswer.correctAnswer);
    $("#next-question").classList.remove("hidden");
  }
  saveState();
}

function answerQuestion(selectedLetter) {
  const session = state.activeSession;
  if (!session || session.locked) return;
  const question = findQuestion(session.questionIds[session.currentIndex]);
  const isCorrect = selectedLetter === question.answer;
  const answer = {
    questionId: question.id,
    selected: selectedLetter,
    correctAnswer: question.answer,
    isCorrect,
    answeredAt: Date.now()
  };

  session.answers[session.currentIndex] = answer;
  session.locked = true;
  updateQuestionStats(question, isCorrect);
  paintAnswer(selectedLetter, question.answer);
  showFeedback(isCorrect, question.answer);
  $("#next-question").classList.remove("hidden");
  state.lastPracticeAt = new Date().toISOString();
  saveState();
  renderAll();
}

function updateQuestionStats(question, isCorrect) {
  const stats = state.questionStats[question.id] || { attempts: 0, correct: 0, wrong: 0, lastAnswered: null };
  stats.attempts += 1;
  stats.lastAnswered = new Date().toISOString();
  if (isCorrect) {
    stats.correct += 1;
    if (state.wrongBook[question.id]) {
      state.wrongBook[question.id].streak = (state.wrongBook[question.id].streak || 0) + 1;
      if (state.wrongBook[question.id].streak >= 2) delete state.wrongBook[question.id];
    }
  } else {
    stats.wrong += 1;
    state.wrongBook[question.id] = { addedAt: new Date().toISOString(), streak: 0 };
  }
  state.questionStats[question.id] = stats;
}

function paintAnswer(selectedLetter, correctLetter) {
  $$("#options .option-btn").forEach((button) => {
    const letter = button.dataset.letter;
    button.classList.add("locked");
    button.disabled = true;
    if (letter === correctLetter) button.classList.add("correct");
    if (letter === selectedLetter && selectedLetter !== correctLetter) button.classList.add("wrong");
  });
}

function showFeedback(isCorrect, correctLetter) {
  const feedback = $("#feedback");
  feedback.textContent = isCorrect ? "答對了，這題已鎖定。" : `答錯了，正確答案是 ${correctLetter}。`;
  feedback.classList.remove("hidden");
}

function nextQuestion() {
  const session = state.activeSession;
  if (!session) return;
  if (session.currentIndex + 1 >= session.questionIds.length) {
    finishSession();
    return;
  }
  session.currentIndex += 1;
  session.locked = false;
  saveState();
  renderQuestion();
}

function finishSession() {
  const session = state.activeSession;
  if (!session) return;
  const duration = currentDuration(session);
  const correct = session.answers.filter((answer) => answer?.isCorrect).length;
  const answered = session.answers.filter(Boolean).length;
  const wrong = answered - correct;
  const accuracy = answered ? Math.round((correct / answered) * 100) : 0;
  const score = Math.round((correct / session.questionIds.length) * 100);

  if (session.type === "exam") {
    state.examHistory.unshift({
      date: new Date().toISOString(),
      score,
      correct,
      wrong,
      accuracy,
      duration
    });
    state.examHistory = state.examHistory.slice(0, 20);
  }

  state.activeSession = null;
  saveState();
  stopTimer();
  showResult(session, correct, wrong, accuracy, score, duration);
}

function showResult(session, correct, wrong, accuracy, score, duration) {
  $("#result-title").textContent = `${session.title}完成`;
  $("#result-rate").textContent = `${accuracy}%`;
  $("#result-correct").textContent = correct;
  $("#result-wrong").textContent = wrong;
  $("#result-time").textContent = formatDuration(duration);
  $("#result-score").textContent = session.type === "exam" ? `${score} 分` : "--";
  showView("result-view");
}

function quitSession() {
  const session = state.activeSession;
  if (!session) return;
  session.elapsedBeforeResume = currentDuration(session);
  session.startedAt = Date.now();
  saveState();
  stopTimer();
  showView("dashboard");
}

function toggleCurrentFavorite() {
  const session = state.activeSession;
  if (!session) return;
  const questionId = session.questionIds[session.currentIndex];
  if (state.favorites.includes(questionId)) {
    state.favorites = state.favorites.filter((id) => id !== questionId);
  } else {
    state.favorites.push(questionId);
  }
  saveState();
  renderQuestion();
  renderAll();
}

function startTimer() {
  stopTimer();
  timerHandle = setInterval(() => {
    const session = state.activeSession;
    if (session) $("#timer").textContent = formatDuration(currentDuration(session));
  }, 500);
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function currentDuration(session) {
  return Math.floor((Date.now() - session.startedAt) / 1000) + (session.elapsedBeforeResume || 0);
}

function pickRandomQuestions(count) {
  return shuffle(questions).slice(0, Math.min(count, questions.length));
}

function dedupeQuestions(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function shuffle(items) {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function findQuestion(id) {
  return questions.find((question) => question.id === id);
}

function chapterLabel(chapter) {
  return bank.chapters?.[chapter] || chapter.replace("CH", "第") + "章";
}

function chapterAccuracyPercent(chapter) {
  const chapterQuestions = questions.filter((question) => question.chapter === chapter);
  const totals = chapterQuestions.reduce((acc, question) => {
    const stats = state.questionStats[question.id];
    if (!stats) return acc;
    acc.attempts += stats.attempts;
    acc.correct += stats.correct;
    return acc;
  }, { attempts: 0, correct: 0 });
  return totals.attempts ? Math.round((totals.correct / totals.attempts) * 100) : 0;
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return 0;
  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function importQuestionJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!Array.isArray(payload.questions)) throw new Error("格式不正確");
      localStorage.setItem(IMPORT_KEY, JSON.stringify(payload));
      bank = payload;
      questions = payload.questions;
      renderChapterSelect();
      renderAll();
      $("#load-warning").classList.add("hidden");
      alert(`已匯入 ${questions.length} 題。`);
    } catch {
      alert("匯入失敗，請確認檔案是 scripts/convert_doc_to_json.py 產生的 questions.json。");
    }
  };
  reader.readAsText(file, "utf-8");
}

function resetData() {
  if (!confirm("確定要清除所有練習紀錄、錯題、收藏與模擬考歷史嗎？題庫不會被刪除。")) return;
  state = structuredClone(defaultState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
  showView("dashboard");
}
