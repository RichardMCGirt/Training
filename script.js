/* eslint-disable no-console */
"use strict";

/* ========================================================================== */
/* Elements + State                                                           */
/* ========================================================================== */

const el = {
  presentationIdInput: document.getElementById("presentationId"),
  slidesEmbed: document.getElementById("slidesEmbed"),
  embedCard: document.getElementById("embedCard"),
  presLabel: document.getElementById("presLabel"), // optional
  quizBox: document.getElementById("quizBox"),
  btnSubmit: document.getElementById("btnSubmit"),
  userEmail: document.getElementById("userEmail"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  counter: document.getElementById("counter"),
  bar: document.getElementById("bar"),
  barInner: document.getElementById("barInner"),
  retryRow: document.getElementById("retryRow"),
  thumbStrip: document.getElementById("thumbStrip"),
  saveStatus: document.getElementById("saveStatus")
};

const state = {
  module: "",
  presentationId: "",
  gasUrl: "",
  slides: [],                // [{ objectId, title }]
  i: 0,
  quizByIndex: {},           // index → quiz
  quizBySlideId: {},         // slideId → quiz
  answers: {}                // questionId → {answer, isCorrect, at}
};

/* ========================================================================== */
/* Utilities                                                                  */
/* ========================================================================== */
function getUserEmail(){
  return (el.userEmail?.value
          || localStorage.getItem('trainingEmail')
          || localStorage.getItem('authEmail')
          || ''
         ).trim();
}

function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function att(s){ return String(s==null?"":s).replace(/"/g, "&quot;"); }

function pulse(msg, kind = "ok"){
  try {
    const node = document.getElementById("saveStatus");
    if (!node) return;
    node.textContent = String(msg||"");
    node.className = `badge ${kind}`;
    setTimeout(() => { try { node.className = "badge"; } catch{} }, 1500);
  } catch {}
}

function baseUrl(t){ return `https://api.airtable.com/v0/${AIR.BASE_ID}/${encodeURIComponent(t)}`; }
function _headers(){
  return {
    Authorization: `Bearer ${AIR.API_KEY}`,
    "Content-Type": "application/json"
  };
}

/* ========================================================================== */
/* BOOTSTRAP                                                                  */
/* ========================================================================== */

document.addEventListener("DOMContentLoaded", boot);

async function boot(){
  // Resolve module
  const params = new URLSearchParams(location.search);
  const modFromUrl = (params.get("module") || "").trim();
  const modFromLS  = (localStorage.getItem("selectedModule") || "").trim();
  state.module = modFromUrl || modFromLS;

  // Guard: if no module, go back to dashboard
  if (!state.module) {
    location.replace("dashboard.html");
    return;
  }

  // Presentation ID from URL param, modules.js mapping, or input
  const pidFromUrl = (params.get("presentationId") || "").trim();
  if (pidFromUrl) {
    state.presentationId = pidFromUrl;
  } else {
    try {
      // try modules.js mapping
      if (window.trainingModules?.getConfigForModule) {
        const cfg = await window.trainingModules.getConfigForModule(state.module);
        state.presentationId = (cfg?.presentationId || "").trim();
      }
    } catch (e) {
      console.warn("[index] trainingModules mapping failed", e);
    }
  }

  // Auto-load if ?reset=1 present or we have a presentationId
  const shouldReset = params.get("reset") === "1";
  if (!state.presentationId) {
    const input = document.getElementById("presentationId");
    if (input) {
      // If missing ID, let user paste or auto-fill from mapping
      if (state.presentationId) input.value = state.presentationId;
    }
  } else {
    try {
      if (shouldReset) {
        // force reload and re-position to first
        await onDeckLoaded(state.presentationId, /* slides */ null);
        const u = new URL(location.href);
        u.searchParams.delete("reset");
        history.replaceState(null, "", u.toString());
      } else {
        await onDeckLoaded(state.presentationId, /* slides */ null);
      }
    } catch (e) {
      console.error("[index] onDeckLoaded failed", e);
      pulse("Failed to load deck", "bad");
      return;
    }
  }

  // On first load, wire email input to localStorage
  (function wireEmailBox(){
    const inputE = document.getElementById("userEmail");
    if (!inputE) return;
    const saved = localStorage.getItem("trainingEmail") || localStorage.getItem("authEmail") || "";
    if (saved) inputE.value = saved;
    else {
      // If no input value and we have an auth email, prefill
      const auth = localStorage.getItem("authEmail");
      if (auth) inputE.value = auth;
    }

    const params = new URLSearchParams(location.search);
    if (!params.get("presentationId")) {
      // if auto-load should run when we already know the deck
      const pid = state.presentationId || "";
      if (pid) {
        window.addEventListener('DOMContentLoaded', () => onLoadDeckClick());
      }
      // keep email in localStorage
      inputE.addEventListener('input', () => localStorage.setItem('trainingEmail', inputE.value.trim()));
    }
  })();
}

/* ========================================================================== */
/* Airtable lookups                                                           */
/* ========================================================================== */

async function fetchModuleConfigFromAirtable(moduleName){
  // Query MODULES_TABLE_ID for a record where LOWER(TRIM({Module})) == moduleName.toLowerCase()
  const url = new URL(baseUrl(AIR.MODULES_TABLE_ID));
  const esc2 = (s) => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("filterByFormula", `LOWER(TRIM({Module}))='${esc2(moduleName.toLowerCase())}'`);
  const res = await fetch(url.toString(), { headers: _headers() });
  if (!res.ok) return null;
  const data = await res.json();
  const rec = (data.records||[])[0];
  return rec ? rec.fields || {} : null;
}

/* ========================================================================== */
/* Google Apps Script (slides list)                                           */
/* ========================================================================== */

async function tryFetchSlidesFromGAS(presentationId){
  // optionally configured by admin (in admin UI)
  if (!state.gasUrl) {
    try {
      const cfg = await fetchModuleConfigFromAirtable(state.module);
      state.gasUrl = (cfg?.GAS || cfg?.["GAS URL"] || "").trim();
    } catch {}
  }
  if (!state.gasUrl) return [];

  try {
    const u = new URL(state.gasUrl);
    u.searchParams.set("mode", "slides");
    u.searchParams.set("presentationId", presentationId);
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error(`GAS fetch failed: ${res.status}`);
    const data = await res.json().catch(()=>({}));
    const slides = Array.isArray(data?.slides) ? data.slides : [];
    return slides.map(s => ({ objectId: s.id, title: s.title || "" })).filter(s => !!s.objectId);
  } catch (e) {
    console.warn("[GAS] slides fetch failed", e);
    return [];
  }
}

/* ========================================================================== */
/* Airtable config                                                            */
/* ========================================================================== */

const AIR = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",

  QUESTIONS_TABLE_ID: "tblbf2TwwlycoVvQq",
  ANSWERS_TABLE_ID: "tblkz5HyZGpgO093S",
  MODULES_TABLE_ID: "tblpvVpIJnkWco25E"
};

/** ⇩⇩⇩ FIELD NAMES YOU CAN CHANGE IF YOUR BASE DIFFERS ⇩⇩⇩ */
/** ⇩⇩⇩ FIELD NAMES YOU CAN CHANGE IF YOUR BASE DIFFERS ⇩⇩⇩ */
const ANSWER_FIELDS = {
  RESULT_FIELD: "Result",                 // Single select: "Right" | "Wrong"
  WRONG_ATTEMPTS_FIELD: "Wrong Attempts", // Number
  CORRECT_ANSWER_FIELD: "Correct Answer", // Text

  TIMESTAMP_FIELD: "Timestamp",           // Date with time
  QUESTION_FIELD: "Question",             // Text (single/long)
  TYPE_FIELD: "Type",                     // Single select or text ("MC" | "FITB"),
  COMPLETED_COUNT_FIELD: "Completed Count" // Number: total distinct correct for this user+deck
}

// ===== Randomization settings (put near your other globals/utils) =====
const RANDOMIZE_QUESTIONS = false;

/* ========================================================================== */
/* Slides embed + thumbnails                                                  */
/* ========================================================================== */

function showEmbed(presentationId, pageObjectId){
  if (!el.slidesEmbed) return;
  const base = `https://docs.google.com/presentation/d/${encodeURIComponent(presentationId)}/embed`;
  const src = pageObjectId
    ? `${base}?slide=id.${encodeURIComponent(pageObjectId)}`
    : base;
  el.slidesEmbed.src = src;
  if (el.embedCard) el.embedCard.style.display = "block";
  if (el.presLabel) el.presLabel.textContent = presentationId;
}

function shuffleInPlace(a){
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===== Fetch questions =====
async function fetchQuestionsFromAirtable(){
  const selectedModule = state.module;

  const url = new URL(qBaseUrl());
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("sort[0][field]", "Order");
  url.searchParams.set("sort[0][direction]", "asc");
  if (selectedModule) {
    const esc = s => String(s).replace(/'/g, "\\'");
    url.searchParams.set(
      "filterByFormula",
      `AND({Active}=1, LOWER(TRIM({Module}))='${esc(selectedModule.toLowerCase())}')`
    );
  } else {
    url.searchParams.set("filterByFormula", "AND({Active}=1)");
  }

  let all = [];
  let offset;
  do {
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: qHeaders() });
    if (!res.ok) throw new Error(`Questions fetch failed: ${res.status}`);
    const data = await res.json();
    all = all.concat(data.records || []);
    offset = data.offset;

    if (offset) {
      const u = new URL(qBaseUrl());
      u.searchParams.set("pageSize", "100");
      u.searchParams.set("sort[0][field]", "Order");
      u.searchParams.set("sort[0][direction]", "asc");
      if (selectedModule) {
        const esc2 = s => String(s).replace(/'/g, "\\'");
        u.searchParams.set(
          "filterByFormula",
          `AND({Active}=1, LOWER(TRIM({Module}))='${esc2(selectedModule.toLowerCase())}')`
        );
      } else {
        u.searchParams.set("filterByFormula", "AND({Active}=1)");
      }
      url.search = u.search;
    }
  } while (offset);

  const quizByIndex = {};
  const quizBySlideId = {};
  const noOrder = [];

  all.forEach(rec => {
    const f = rec.fields || {};
    const order = Number(f["Order"] ?? NaN);

    const optsRaw = (f["Options (JSON)"] || "[]");
    let options = [];
    try { options = Array.isArray(optsRaw) ? optsRaw : JSON.parse(optsRaw); } catch {}

    const fitbRaw = (f["FITB Answers (JSON)"] || "[]");
    let fitbAnswers = [];
    try { fitbAnswers = Array.isArray(fitbRaw) ? fitbRaw : JSON.parse(fitbRaw); } catch {}

    const fitbUseRegex = !!f["FITB Use Regex"];
    const fitbCaseSensitive = !!f["FITB Case Sensitive"];

    const type = String(
      f["Type"] || (options?.length ? "MC" : (fitbAnswers?.length ? "FITB" : "MC"))
    ).toUpperCase();

    const q = {
      questionId: f["QuestionId"] || `q_${rec.id}`,
      question: f["Question"] || "",
      required: !!f["Required"],
      type,
      options: options || [],
      correct: f["Correct"] || "",
      fitbAnswers: fitbAnswers || [],
      fitbUseRegex,
      fitbCaseSensitive
    };

    const slideId = f["Slide ID"] || "";
    if (slideId) {
      quizBySlideId[slideId] = q;
    }

    if (!Number.isNaN(order) && order > 0) {
      let idx = Math.max(0, order - 1);
      while (quizByIndex[idx]) idx++;
      quizByIndex[idx] = q;
    } else {
      noOrder.push(q);
    }
  });

  if (noOrder.length) {
    const start = Math.max(-1, ...Object.keys(quizByIndex).map(k => +k).filter(Number.isFinite)) + 1;
    for (let i = 0; i < noOrder.length; i++) {
      let idx = start + i;
      while (quizByIndex[idx]) idx++;
      quizByIndex[idx] = noOrder[i];
    }
  }

  if (RANDOMIZE_QUESTIONS) {
    const arr = [];
    const max = Math.max(-1, ...Object.keys(quizByIndex).map(k => Number(k)).filter(Number.isFinite));
    for (let i = 0; i <= max; i++) { if (quizByIndex[i]) arr.push(quizByIndex[i]); }
    shuffleInPlace(arr);
    const shuffled = {};
    for (let i = 0; i < arr.length; i++) shuffled[i] = arr[i];
    for (const k of Object.keys(quizByIndex)) delete quizByIndex[k];
    Object.assign(quizByIndex, shuffled);
  }

  state.quizByIndex = quizByIndex;
  state.quizBySlideId = quizBySlideId;
}

/* ========================================================================== */
/* Thumbnails                                                                 */
/* ========================================================================== */

function renderThumbs(){
  if (!el.thumbStrip) return;
  const presId = state.presentationId;
  const slides = state.slides || [];

  if (!slides.length || !presId) {
    el.thumbStrip.innerHTML = "";
    return;
  }

  const items = slides.map((s, idx) => {
    return `<div class="thumb" data-idx="${idx}">
      <div class="thumbLabel">#${idx+1}</div>
    </div>`;
  });
  el.thumbStrip.innerHTML = items.join("");
  el.thumbStrip.querySelectorAll(".thumb").forEach(node => {
    node.addEventListener("click", () => {
      const idx = Number(node.getAttribute("data-idx") || "0");
      if (!Number.isFinite(idx)) return;
      state.i = Math.max(0, Math.min(idx, state.slides.length - 1));
      const pageId = state.slides[state.i]?.objectId || "";
      showEmbed(state.presentationId, pageId);
      render();
    });
  });
}

/* ========================================================================== */
/* Navigation + Render                                                        */
/* ========================================================================== */

function go(delta){
  const n = state.slides.length;
  if (!n) return;
  const next = Math.max(0, Math.min(state.i + delta, n - 1));
  if (next === state.i) return;
  state.i = next;
  const pageId = state.slides[state.i]?.objectId || "";
  showEmbed(state.presentationId, pageId);
  render();
}
if (el.prevBtn) el.prevBtn.addEventListener("click", () => go(-1));
if (el.nextBtn) el.nextBtn.addEventListener("click", () => go(+1));

function render(){
  const total = Math.max(Object.keys(state.quizByIndex).length || 0, state.slides.length);
  const at = Math.min(state.i + 1, Math.max(total, 1));
if (el.counter) el.counter.textContent = `${state.i + 1} / ${total}`;
  if (el.barInner) {
    const pct = total ? Math.round((at*100)/total) : 0;
    el.barInner.style.width = pct + "%";
  }

  // Render current quiz
  const q = currentQuizForIndex(state.i);
  renderQuiz(q);

  // Thumbs
  renderThumbs();

  // Buttons
  if (el.prevBtn) el.prevBtn.disabled = state.i <= 0;
  if (el.nextBtn) el.nextBtn.disabled = state.i >= (state.slides.length - 1);
}

/* ------------------ Helpers for current quiz ------------------------------ */

function qBaseUrl(){ return baseUrl(AIR.QUESTIONS_TABLE_ID); }
function aBaseUrl(){ return baseUrl(AIR.ANSWERS_TABLE_ID); }

function qHeaders(){ return _headers(); }
function aHeaders(){ return _headers(); }

/* ------------------ Quiz selection ---------------------------------------- */
function toggleRetakeVisibilityByEmail(){
  const btn = document.getElementById('retakeQuizBtn');
  if (!btn) return;
  const hasEmail = !!getUserEmail();
  btn.style.display = hasEmail ? 'inline-block' : 'none';
}

function currentQuizForIndex(i){
  const slide = state.slides[i];
  if (!slide) return null;
  const byId = state.quizBySlideId[slide.objectId];
  if (byId) return byId;
  return state.quizByIndex[i] || null;
}

/* ------------------ Render quiz (no prior-answer display) ------------------ */

function renderQuiz(quiz) {
  if (!el.quizBox) return;

  if (!quiz) {
    el.quizBox.innerHTML = `<div class="muted">No question for this slide.</div>`;
    if (el.btnSubmit) el.btnSubmit.disabled = true;
    return;
  }

  if (quiz.type === "MC") {
    const opts = (quiz.options || []).map(o => `
      <label class="opt">
        <input type="radio" name="opt" value="${att(o)}" autocomplete="off"/>
        <div><strong>${esc(o)}</strong></div>
      </label>`).join("");

    el.quizBox.innerHTML = `
      <div><strong>${esc(quiz.question)}</strong> ${quiz.required ? `<span class="req">*</span>` : ""}</div>
      <div class="opts">${opts}</div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="btnSubmit">Submit answer</button>
        <button id="retakeQuizBtn" type="button" class="btn btn-ghost">Retake Quiz</button>
      </div>
    `;
  } else { // FITB
    el.quizBox.innerHTML = `
      <div><strong>${esc(quiz.question)}</strong> ${quiz.required ? `<span class="req">*</span>` : ""}</div>
      <div class="fitb">
        <input type="text" id="fitbInput" placeholder="Type your answer"/>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="btnSubmit">Submit answer</button>
        <button id="retakeQuizBtn" type="button" class="btn btn-ghost">Retake Quiz</button>
      </div>
    `;
  }

  // wire after the HTML exists
  const btn = el.quizBox.querySelector("#btnSubmit");
  if (btn) btn.addEventListener("click", submitAnswer);

  wireRetakeButton();                  // ← move here
  toggleRetakeVisibilityByEmail();     // ← show/hide by email
}


/* ------------------ Answer reading from UI -------------------------------- */

function getUserAnswer(quiz){
  if (!quiz) return "";
  if (quiz.type === "MC") {
    const checked = el.quizBox?.querySelector('input[name="opt"]:checked');
    return checked ? String(checked.value || "") : "";
  } else {
    const inp = el.quizBox?.querySelector("#fitbInput");
    return inp ? String(inp.value || "") : "";
  }
}


function isFitbCorrect(userAnswer, correctAnswers, opts = {}) {
  const { useRegex = false, caseSensitive = false } = opts;
  const userArr = toStrArray(userAnswer);
  const correctArr = toStrArray(correctAnswers);

  if (useRegex) {
    const patterns = correctArr.map(p => {
      try { return new RegExp(p, caseSensitive ? "" : "i"); }
      catch { return null; }
    }).filter(Boolean);

    if (!userArr.length) return false;
    return userArr.every(u => patterns.some(rx => rx.test(String(u||""))));
  }

  const norm = s => (caseSensitive ? String(s||"") : String(s||"").toLowerCase().trim());
  const corrSet = new Set(correctArr.map(norm));

  if (userArr.length === correctArr.length) {
    return userArr.every((u, i) => norm(u) === norm(correctArr[i]));
  } else {
    return userArr.every(u => corrSet.has(norm(u)));
  }
}


function toStrArray(v){
  if (Array.isArray(v)) return v.map(x => String(x ?? ""));
  if (typeof v === "string") {
    // accept JSON array or pipe-delimited
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith("[") && s.endsWith("]")) {
      try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr.map(x => String(x ?? "")) : [s]; }
      catch { return [s]; }
    }
    return s.split("|").map(x => x.trim());
  }
  return [String(v ?? "")];
}

/* ------------------ Save answers (UPSERT with Wrong Attempts) ------------- */

async function onDeckLoaded(presentationId, slidesArray){
  state.presentationId = presentationId;

  // Prefer provided slides; else try GAS; else 1 placeholder
  let slides = (Array.isArray(slidesArray) && slidesArray.length) ? slidesArray : [];
  if (!slides.length) {
    const fromGAS = await tryFetchSlidesFromGAS(presentationId);
    if (fromGAS.length) slides = fromGAS;
  }
  state.slides = slides.length ? slides : [{ objectId: presentationId, title: "Slides Embed" }];

  const firstPage = state.slides[0]?.objectId || "";
  showEmbed(presentationId, firstPage);

  try {
    await fetchQuestionsFromAirtable();
  } catch (e) {
    console.error("Failed to fetch questions:", e);
    pulse("Could not load questions.", "bad");
  }

  ensureSlidesForQuestions();

  if (el.prevBtn) el.prevBtn.disabled = state.i <= 0;
  if (el.nextBtn) el.nextBtn.disabled = state.slides.length <= 1;
  await initQuizAttempt();
wireRetakeButton(); 
  // Load prior answers ONLY to position progress (never to prefill UI)
  try {
    const prior = await loadExistingAnswersForUser(state.presentationId, getUserEmail());
    state.answers = Object.assign({}, prior);
    state.i = nextUnansweredIndex();
    const pageId = state.slides[state.i]?.objectId || "";
    showEmbed(state.presentationId, pageId);
  } catch(e){ console.warn('Resume load failed', e); }

  if (el.btnRetry) {
    el.btnRetry.onclick = () => {
      const pid = state.presentationId || (el.presentationIdInput?.value || "");
      if (!pid) return;
      const url = new URL(location.href);
      url.searchParams.set("presentationId", pid);
      url.searchParams.set("reset", "1");
      location.href = url.toString();
    };
  }

  await recalcAndDisplayProgress({ updateAirtable: false });
  render();
}

/* If another script fires this custom event, we hook in */
document.addEventListener("deck:loaded", (ev) => {
  const { id, slides } = (ev.detail || {});
  
  onDeckLoaded(id, slides);
});

/* Legacy entry point used by index.html / auto-load */
window.onLoadDeckClick = async function(evOrId){
  try{
    const maybeId = typeof evOrId === "string" ? evOrId : "";
    const id = maybeId || (el.presentationIdInput && el.presentationIdInput.value) || "";
    if (!id) {
      console.warn("[deck] No presentationId provided.");
      return;
    }
    await onDeckLoaded(id, /* slides */ null);
    try { document.dispatchEvent(new CustomEvent("deck:loaded", { detail: { id, slides: state.slides } })); } catch {}
  } catch(err){
    console.error("[deck] load failed", err);
  }
};

/* Keyboard navigation */
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") { try { go(-1); } catch{} }
  if (e.key === "ArrowRight") { try { go(+1); } catch{} }
});

/* ------------------ Submit + save ----------------------------------------- */

async function submitAnswer() {
  const quiz = currentQuizForIndex(state.i);
  if (!quiz) return;

  const userEmail = getUserEmail();
  if (!userEmail) return pulse("Enter your email to save.", "warn");

  // Read user's answer (string for MC or string/array for FITB)
  const ansRaw = getUserAnswer(quiz);
  if ((ansRaw == null || ansRaw === "" || (Array.isArray(ansRaw) && ansRaw.length === 0)) && quiz.required) {
    return pulse("Answer required.", "warn");
  }

  // correctness
  const type = String(quiz.type || "").toUpperCase();
  let isCorrect;
  if (type === "MC") {
    isCorrect = String(ansRaw ?? "") === String(quiz.correct ?? "");
  } else {
    // pull correct answers from FITB field
    const corrFITB = quiz.fitbAnswers ?? "";
    isCorrect = isFitbCorrect(
      ansRaw,
      corrFITB,
      { useRegex: !!quiz.fitbUseRegex, caseSensitive: !!quiz.fitbCaseSensitive }
    );
  }

  // local progress (do not overwrite a past true)
  const prev = state.answers[quiz.questionId];
  if (!(prev && prev.isCorrect === true)) {
    state.answers[quiz.questionId] = { answer: ansRaw, isCorrect, at: Date.now() };
  }

  // build the "Correct Answer" string per type
  const correctAnswerString = (type === "MC")
    ? String(quiz.correct ?? "")
    : buildCorrectAnswerDisplay(quiz.fitbAnswers ?? "");

  // store-friendly answer string
  const answerForStorage = Array.isArray(ansRaw) ? ansRaw.join(" | ") : String(ansRaw ?? "");

  try {
    await upsertAnswerRecordWithWrongCount({
      userEmail,
      presentationId: state.presentationId,
      questionId: quiz.questionId,
      answer: answerForStorage,
      isCorrect,
      correctAnswer: correctAnswerString,

      // meta you asked to save in tblkz5HyZGpgO093S
      questionText: String(quiz.question || ""),
      type,
      timestamp: new Date().toISOString()
    });

    pulse(isCorrect ? "Saved ✓" : "Incorrect)", isCorrect ? "Correct" : "warn");
    try { await recalcAndDisplayProgress({ updateAirtable: true }); } catch {}
  } catch (e) {
    console.error("Save failed", e);
    pulse("Save failed", "bad");
  }

  // always advance
  if (state.i < state.slides.length - 1) {
    state.i += 1;
    const pageId = state.slides[state.i]?.objectId || "";
    showEmbed(state.presentationId, pageId);
    render();
  } else {
    if (el.retryRow) el.retryRow.style.display = "flex";
  }
}

if (el.btnSubmit) el.btnSubmit.removeEventListener?.("click", submitAnswer);

/* ------------------ Answer persistence (UPSERT) --------------------------- */
// Count distinct *answered* QuestionIds (any correctness) for this user+deck
async function countDistinctAnsweredForUserPresentation(presentationId, userEmail){
  if (!userEmail || !presentationId) return 0;
  const attempt = Number(state.currentAttempt || 1);

  const url = new URL(aBaseUrl());
  const e = s => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set(
    "filterByFormula",
    `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}',{Attempt}=${attempt})`
  );
  url.searchParams.set("pageSize","100");

  const seen = new Set();
  let offset;
  do{
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: aHeaders() });
    if (!res.ok) throw new Error(`Answers (any) fetch failed: ${res.status}`);
    const data = await res.json();
    for (const r of (data.records||[])){
      const qid = String(r?.fields?.QuestionId||"").trim();
      if (qid) seen.add(qid);
    }
    offset = data.offset;
    if (offset){
      const u = new URL(aBaseUrl());
      u.searchParams.set(
        "filterByFormula",
        `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}',{Attempt}=${attempt})`
      );
      u.searchParams.set("pageSize","100");
      url.search = u.search;
    }
  } while(offset);
  return seen.size;
}

async function recalcAndDisplayProgress({ updateAirtable = false } = {}){
  try{
    ensureProgressBannerElement();
    const txt = document.getElementById("moduleProgressText");
    const bar = document.getElementById("moduleProgressBar");
    const userEmail = getUserEmail();
    const total = getQuestionCount();

    const completed = await countDistinctAnsweredForUserPresentation(state.presentationId, userEmail);

    const pct = total ? Math.round((Math.min(completed,total) * 100)/total) : 0;
    if (txt) txt.textContent = `You have completed ${completed} of ${total} questions (${pct}%).`;
    if (bar) { bar.style.width = pct + "%"; }

    if (updateAirtable){
      try { await updateCompletedCountForUserPresentation(userEmail, state.presentationId, completed); }
      catch(e){ console.warn("Completed Count sync failed", e); }
    }
  } catch(e){
    console.warn("Progress banner update failed", e);
  }
}


function buildCorrectAnswerDisplay(fitbAnswers){
  try {
    const arr = Array.isArray(fitbAnswers) ? fitbAnswers : JSON.parse(String(fitbAnswers||"[]"));
    if (!Array.isArray(arr)) return String(fitbAnswers||"");
    return arr.join(" | ");
  } catch { return String(fitbAnswers||""); }
}

async function upsertAnswerRecordWithWrongCount({
  userEmail,
  presentationId,
  questionId,
  answer,
  isCorrect,
  correctAnswer,
  questionText,
  type,
  timestamp
}){
  const attempt = Number(state.currentAttempt || 1);

  // 1) Look up existing record for this (user, deck, question, attempt)
  const url = new URL(aBaseUrl());
  const e = s => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set("filterByFormula",
    `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}',{QuestionId}='${e(questionId)}',{Attempt}=${attempt})`
  );
  url.searchParams.set("pageSize", "1");

  const getRes = await fetch(url.toString(), { headers: aHeaders() });
  if (!getRes.ok) throw new Error(`Lookup failed: ${getRes.status} ${await getRes.text().catch(()=>"(no body)")}`);
  const data = await getRes.json().catch(()=>({}));
  const existing = (data.records || [])[0];

  if (existing) {
    const f = existing.fields || {};
    const existingIsCorrect = !!f.IsCorrect;

    let wrongAttempts = Number(f[ANSWER_FIELDS.WRONG_ATTEMPTS_FIELD] || 0);
    if (!isCorrect) wrongAttempts = Number.isFinite(wrongAttempts) ? wrongAttempts + 1 : 1;

    const resultStr = (existingIsCorrect || isCorrect) ? "Right" : "Wrong";

    const patchFields = {
      Answer: answer,
      [ANSWER_FIELDS.CORRECT_ANSWER_FIELD]: correctAnswer,
      [ANSWER_FIELDS.WRONG_ATTEMPTS_FIELD]: wrongAttempts,
      IsCorrect: existingIsCorrect ? true : !!isCorrect,
      [ANSWER_FIELDS.RESULT_FIELD]: resultStr,
      Attempt: attempt, // NEW

      [ANSWER_FIELDS.TIMESTAMP_FIELD]: timestamp,
      [ANSWER_FIELDS.QUESTION_FIELD]: questionText,
      [ANSWER_FIELDS.TYPE_FIELD]: type
    };

    const patchRes = await fetch(aBaseUrl(), {
      method: "PATCH",
      headers: aHeaders(),
      body: JSON.stringify({ records: [{ id: existing.id, fields: patchFields }] })
    });
    if (!patchRes.ok) throw new Error(`Patch failed: ${patchRes.status} ${await patchRes.text().catch(()=>"(no body)")}`);
    return;
  }

  // 2) Create record if not found (for this attempt)
  const createFields = {
    UserEmail: userEmail,
    PresentationId: presentationId,
    QuestionId: questionId,
    Answer: answer,
    IsCorrect: !!isCorrect,
    [ANSWER_FIELDS.CORRECT_ANSWER_FIELD]: correctAnswer,
    [ANSWER_FIELDS.WRONG_ATTEMPTS_FIELD]: (!isCorrect ? 1 : 0),
    [ANSWER_FIELDS.RESULT_FIELD]: isCorrect ? "Right" : "Wrong",
    Attempt: attempt, // NEW

    [ANSWER_FIELDS.TIMESTAMP_FIELD]: timestamp,
    [ANSWER_FIELDS.QUESTION_FIELD]: questionText,
    [ANSWER_FIELDS.TYPE_FIELD]: type
  };

  const res = await fetch(aBaseUrl(), {
    method: "POST",
    headers: aHeaders(),
    body: JSON.stringify({ records: [{ fields: createFields }] })
  });
  if (!res.ok) throw new Error(`Create failed: ${res.status} ${await res.text().catch(()=>"(no body)")}`);
}


/* ------------------ Resume / prior answers (for positioning only) --------- */

async function loadExistingAnswersForUser(presentationId, userEmail){
  if (!userEmail) return {};
  const attempt = Number(state.currentAttempt || 1);

  const url = new URL(aBaseUrl());
  const e = s => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set(
    "filterByFormula",
    `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}',{Attempt}=${attempt})`
  );
  url.searchParams.set("pageSize", "100");

  let all = [];
  let offset;
  do {
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: aHeaders() });
    if (!res.ok) throw new Error(`Answers fetch failed: ${res.status}`);
    const data = await res.json();
    all = all.concat(data.records || []);
    offset = data.offset;

    if (offset){
      const u = new URL(aBaseUrl());
      u.searchParams.set(
        "filterByFormula",
        `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}',{Attempt}=${attempt})`
      );
      u.searchParams.set("pageSize", "100");
      url.search = u.search;
    }
  } while (offset);

  const map = {};
  for (const r of all) {
    const f = r.fields || {};
    if (f.QuestionId) {
      map[f.QuestionId] = { answer: f.Answer, isCorrect: !!f.IsCorrect, recordId: r.id };
    }
  }
  return map;
}

async function initQuizAttempt() {
  const userEmail = getUserEmail();
  if (!userEmail || !state.presentationId) {
    console.warn("initQuizAttempt: missing userEmail or presentationId");
    state.currentAttempt = 1;
    return 1;
  }

  // Try to restore previous attempt for this user+deck
  const key = `attempt:${userEmail}:${state.presentationId}`;
  const stored = Number(localStorage.getItem(key) || 0);
  if (stored) {
    state.currentAttempt = stored;
    return stored;
  }

  // Otherwise allocate a new one and remember it
  const next = await getNextAttemptNumber(userEmail, state.presentationId);
  state.currentAttempt = next;
  localStorage.setItem(key, String(next));
  return next;
}




function nextUnansweredIndex(){
  const maxIdx = Object.keys(state.quizByIndex).map(k=>parseInt(k,10)).filter(n=>!Number.isNaN(n));
  const total = maxIdx.length ? Math.max(...maxIdx)+1 : state.slides.length;
  for (let i = 0; i < total; i++){
    const q = currentQuizForIndex(i);
    if (!q) continue;
    const has = !!(state.answers[q.questionId]);
    if (!has) return i;
  }
  return Math.max(0, total - 1);
}
async function getOrCreateAttemptNumber(userEmail, presentationId) {
  const e = s => String(s || "").replace(/'/g, "\\'");
  const url = new URL(aBaseUrl());
  url.searchParams.set(
    "filterByFormula",
    `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}')`
  );
  url.searchParams.set("pageSize", "100");

  const res = await fetch(url.toString(), { headers: aHeaders() });
  if (!res.ok) throw new Error("Failed to fetch attempts");
  const data = await res.json();
  const attempts = new Set();

  (data.records || []).forEach(r => {
    const a = Number(r?.fields?.Attempt || 1);
    if (!isNaN(a)) attempts.add(a);
  });

  const maxAttempt = attempts.size ? Math.max(...attempts) : 0;
  return maxAttempt + 1; // next attempt number
}

function getQuestionCount(){
  const idxs = Object.keys(state.quizByIndex).map(k => parseInt(k, 10)).filter(n => !Number.isNaN(n));
  const byIndexCount = idxs.length ? (Math.max(...idxs) + 1) : 0; // <-- fix spread
  return Math.max(byIndexCount, 0);
}


/* ------------------ Progress banner + Completed Count syncing ------------- */

function ensureProgressBannerElement(){
  if (document.getElementById("moduleProgress")) return;
  const wrap = document.querySelector(".wrap") || document.body;
  const box = document.createElement("div");
  box.id = "moduleProgress";
  box.style.margin = "12px 0 8px";
  box.style.padding = "10px 12px";
  box.style.border = "1px solid #e5e7eb";
  box.style.borderRadius = "10px";
  box.style.background = "#f9fafb";
  box.innerHTML = `
    <div id="moduleProgressText" class="muted" style="margin-bottom:6px">Loading progress…</div>
    <div style="height:8px;background:#eee;border-radius:6px;overflow:hidden">
      <i id="moduleProgressBar" style="display:block;height:8px;width:0%"></i>
    </div>
  `;
  wrap.insertBefore(box, wrap.querySelector(".controls") || wrap.firstChild);
}

async function countDistinctCorrectForUserPresentation(presentationId, userEmail){
  if (!userEmail || !presentationId) return 0;
  const url = new URL(aBaseUrl());
  const e = s => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set("filterByFormula", `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}',{IsCorrect}=1)`);
  url.searchParams.set("pageSize","100");
  const seen = new Set();
  let offset;
  do{
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: aHeaders() });
    if (!res.ok) throw new Error(`Answers (correct) fetch failed: ${res.status}`);
    const data = await res.json();
    for (const r of (data.records||[])){
      const qid = String(r?.fields?.QuestionId||"").trim();
      if (qid) seen.add(qid);
    }
    offset = data.offset;
    if (offset){
      const u = new URL(aBaseUrl());
      u.searchParams.set("filterByFormula", `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}',{IsCorrect}=1)`);
      u.searchParams.set("pageSize","100");
      url.search = u.search;
    }
  } while(offset);
  return seen.size;
}

async function updateCompletedCountForUserPresentation(userEmail, presentationId, completedCount){
  if (!userEmail || !presentationId) return;
  // fetch all records for this user+deck (we'll PATCH the Completed Count field)
  const allIds = [];
  const url = new URL(aBaseUrl());
  const e = s => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set("filterByFormula", `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}')`);
  url.searchParams.set("pageSize","100");
  let offset;
  do{
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: aHeaders() });
    if (!res.ok) throw new Error(`Answers (for patch) fetch failed: ${res.status}`);
    const data = await res.json();
    for (const r of (data.records||[])){
      if (r.id) allIds.push(r.id);
    }
    offset = data.offset;
    if (offset){
      const u = new URL(aBaseUrl());
      u.searchParams.set("filterByFormula", `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}')`);
      u.searchParams.set("pageSize","100");
      url.search = u.search;
    }
  } while(offset);

  if (!allIds.length) return;

  // Batch patch (Airtable allows up to 10 per request for PATCH)
  for (let i = 0; i < allIds.length; i += 10){
    const batch = allIds.slice(i, i+10).map(id => ({
      id,
      fields: { [ANSWER_FIELDS.COMPLETED_COUNT_FIELD]: Number(completedCount)||0 }
    }));
    const res = await fetch(aBaseUrl(), {
      method: "PATCH",
      headers: aHeaders(),
      body: JSON.stringify({ records: batch })
    });
    if (!res.ok){
      console.warn("Completed Count PATCH failed:", res.status, await res.text().catch(()=>"(no body)"));
      break;
    }
  }
}

/* ------------------ Ensure slide list at least covers questions ----------- */

function ensureSlidesForQuestions(){
  // If we have more questions than slides, ensure we can navigate by index
  const qCount = Object.keys(state.quizByIndex||{}).length;
  if (!state.slides || !state.slides.length) {
    state.slides = [];
  }
  while (state.slides.length < qCount) {
    state.slides.push({ objectId: state.presentationId, title: `Q${state.slides.length+1}`});
  }
}
// --- Attempt helpers ---------------------------------------------------------

async function getNextAttemptNumber(userEmail, presentationId) {
  const e = s => String(s || "").replace(/'/g, "\\'");
  const url = new URL(aBaseUrl());
  url.searchParams.set(
    "filterByFormula",
    `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}')`
  );
  url.searchParams.set("pageSize", "100");

  let maxAttempt = 0;
  let offset;
  do {
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: aHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch attempts: ${res.status}`);
    const data = await res.json();
    for (const r of (data.records || [])) {
      const a = Number(r?.fields?.Attempt || 1);
      if (!Number.isNaN(a) && a > maxAttempt) maxAttempt = a;
    }
    offset = data.offset;
    if (offset) {
      const u = new URL(aBaseUrl());
      u.searchParams.set(
        "filterByFormula",
        `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}')`
      );
      u.searchParams.set("pageSize", "100");
      url.search = u.search;
    }
  } while (offset);

  return maxAttempt + 1;
}



// --- Retake: start new attempt, clear local state, re-render -----------------
(function hideRetakeUntilEmail(){
  const btn = document.getElementById('retakeQuizBtn');
  if (!btn) return;
  const hasEmail = !!getUserEmail();
  btn.style.display = hasEmail ? 'inline-block' : 'none';
})();

async function startNewAttempt() {
  const userEmail = getUserEmail();
  if (!userEmail) {
    pulse("Enter your email to retake.", "warn");
    return;
  }
  try {
 const next = await getNextAttemptNumber(userEmail, state.presentationId);
 state.currentAttempt = next;
 localStorage.setItem(`attempt:${userEmail}:${state.presentationId}`, String(next));            // bumps Attempt
    state.answers = {};                     // clear in-memory map
    state.i = 0;                            // go back to first question
    clearCurrentQuestionUISelections();     // remove any radio/inputs currently selected
 const pageId = state.slides[0]?.objectId || "";
 showEmbed(state.presentationId, pageId);
 render();   
    await recalcAndDisplayProgress({ updateAirtable: true }); // progress -> 0/Total
    pulse(`New attempt started (#${state.currentAttempt}). Good luck!`, "info");
  } catch (e) {
    console.error("startNewAttempt failed", e);
    pulse("Could not start a new attempt. Please try again.", "error");
  }
}

// Utility to clear current question inputs safely (MC + FITB)
function clearCurrentQuestionUISelections() {
  try {
    // clear radios
    document.querySelectorAll('input[type="radio"][name="mcOption"]').forEach(r => { r.checked = false; });
    // clear FITB text input(s)
    document.querySelectorAll('input[data-fitb], textarea[data-fitb]').forEach(i => { i.value = ""; });
    // if you use a specific id for FITB, clear it too:
    const fitb = document.getElementById('fitbInput');
    if (fitb) fitb.value = "";
  } catch (e) {
    console.warn("clearCurrentQuestionUISelections skipped:", e);
  }
}

// --- Wire the button (call this once after DOM is ready / deck loaded) -------

function wireRetakeButton() {
  const btn = document.getElementById('retakeQuizBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const ok = confirm("Start a new attempt? Your prior attempts are kept for history, and this run will be Attempt #" + (Number(state.currentAttempt||0)+1) + ".");
    if (!ok) return;
    await startNewAttempt();
  });
}
