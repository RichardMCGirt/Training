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
  i: 0,                      // current index
  answers: {},               // { [questionId]: { answer, isCorrect, at } }
  quizByIndex: {},           // filled from Airtable
  quizBySlideId: {},         // filled from Airtable
  retake: new URLSearchParams(location.search).get("reset") === "1"
};

/* ========================================================================== */
/* Small utils                                                                */
/* ========================================================================== */

function esc(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }
function att(s){ return String(s ?? "").replace(/"/g, "&quot;"); }
function pulse(msg, kind="ok"){
  try{
    if (!el.saveStatus) return;
    el.saveStatus.textContent = msg || "";
    el.saveStatus.className = (kind === "ok" ? "muted" : (kind === "warn" ? "muted warn" : "muted bad"));
    setTimeout(() => { if (el.saveStatus && el.saveStatus.textContent === msg) el.saveStatus.textContent = ""; }, 2000);
  } catch {}
}

/* ========================================================================== */
/* Airtable config + helpers                                                  */
/* ========================================================================== */

const AIR = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",

  // Questions table (Active questions, filtered by Module)
  QUESTIONS_TABLE_ID: "tblbf2TwwlycoVvQq",

  // Answers table (if you log submissions here; same table ok)
  ANSWERS_TABLE_ID: "tblpvVpIJnkWco25E",

  // NEW: Module → { PresentationId, GasUrl } mapping table
  // fields: Module (text), PresentationId (text), GasUrl (text)
  MODULES_TABLE_ID: "tblpvVpIJnkWco25E"
};

function _headers(){
  return { "Authorization": `Bearer ${AIR.API_KEY}`, "Content-Type": "application/json" };
}
const baseUrl = (t) => `https://api.airtable.com/v0/${AIR.BASE_ID}/${encodeURIComponent(t)}`;

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
  localStorage.setItem("selectedModule", state.module);

  // Resolve presentation from URL first
  const pidFromUrl = (params.get("presentationId") || "").trim();
  state.presentationId = pidFromUrl;

  // Prepare UI area
  if (el.quizBox) el.quizBox.innerHTML = `<div class="muted">Loading deck for <strong>${esc(state.module)}</strong>…</div>`;

  // If no presentationId provided, look it up from MODULES table by Module
  if (!state.presentationId) {
    try {
      const cfg = await fetchModuleConfigFromAirtable(state.module);
      state.presentationId = (cfg.presentationId || "").trim();
      state.gasUrl = (cfg.gasUrl || "").trim();
    } catch (e) {
      console.warn("[index] module config lookup failed", e);
    }
  } else {
    // We still might want the GasUrl even if PID came from URL
    try {
      const cfg = await fetchModuleConfigFromAirtable(state.module);
      state.gasUrl = (cfg.gasUrl || "").trim();
    } catch {}
  }

  // Expose GAS endpoint for thumbnail + slide metadata fetches
  if (state.gasUrl) {
    try { window.GAS_ENDPOINT = state.gasUrl; } catch {}
  }

  // If still no PID, show friendly message
  if (!state.presentationId) {
    if (el.quizBox) {
      el.quizBox.innerHTML = `
        <div class="muted">No deck is configured for <strong>${esc(state.module)}</strong>.</div>
        <div class="row" style="margin-top:10px">
          <button class="btn" onclick="location.href='dashboard.html'">Back to Dashboard</button>
        </div>
      `;
    }
    return;
  }

  // Set input and auto-load deck
  if (el.presentationIdInput) el.presentationIdInput.value = state.presentationId;
  try {
    await onLoadDeckClick(state.presentationId);
  } catch (e) {
    console.error("[index] onLoadDeckClick failed", e);
    if (el.quizBox) {
      el.quizBox.innerHTML = `
        <div class="muted">Could not load the deck for <strong>${esc(state.module)}</strong>.</div>
        <div class="row" style="margin-top:10px">
          <button class="btn" onclick="location.href='dashboard.html'">Back to Dashboard</button>
        </div>
      `;
    }
  }
}

/* ========================================================================== */
/* Airtable lookups                                                           */
/* ========================================================================== */

async function fetchModuleConfigFromAirtable(moduleName){
  // Query MODULES_TABLE_ID for a record where LOWER(TRIM({Module})) == moduleName.toLowerCase()
  const url = new URL(baseUrl(AIR.MODULES_TABLE_ID));
  const esc = (s) => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("filterByFormula", `LOWER(TRIM({Module}))='${esc(moduleName.toLowerCase())}'`);

  const res = await fetch(url.toString(), { headers: _headers() });
  if (!res.ok) {
    const body = await res.text().catch(()=>"(no body)");
    throw new Error(`Module config fetch failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  const rec = (data.records || [])[0];
  if (!rec) return { presentationId: "", gasUrl: "" };

  const f = rec.fields || {};
  return {
    presentationId: String(f.PresentationId || "").trim(),
    gasUrl: String(f.GasUrl || "").trim()
  };
}

/* ========================================================================== */
/* Slides: thumbnails + embed                                                 */
/* ========================================================================== */

async function tryFetchSlidesFromGAS(presentationId){
  try {
    const base = (window.GAS_ENDPOINT || "").trim();
    if (!base) return [];
    const url = new URL(base);
    if (!url.searchParams.has("fn")) url.searchParams.set("fn", "slides");
    url.searchParams.set("id", presentationId);
    const res = await fetch(url.toString(), { credentials: "omit" });
    if (!res.ok) return [];
    const json = await res.json().catch(()=>null);
    const arr = Array.isArray(json?.slides) ? json.slides : (Array.isArray(json) ? json : []);
    return arr
      .map(s => ({ objectId: String(s.objectId||"").trim(), title: String(s.title||"").trim() }))
      .filter(s => s.objectId);
  } catch {
    return [];
  }
}

function slideThumbUrl(presId, pageObjectId){
  const id = encodeURIComponent(presId);
  const pid = encodeURIComponent(pageObjectId);
  return `https://docs.google.com/presentation/d/${id}/export/png?id=${id}&pageid=${pid}`;
}

function embedUrl(presId, pageObjectId){
  const base = `https://docs.google.com/presentation/d/${encodeURIComponent(presId)}/embed?start=false&loop=false&delayms=3000`;
  return pageObjectId ? `${base}#slide=id.${encodeURIComponent(pageObjectId)}` : base;
}

function showEmbed(presId, optionalPageId){
  if (!el.slidesEmbed || !el.embedCard) return;
  const id = (presId || "").trim();
  if (!id) return;
  const url = embedUrl(id, optionalPageId);
  el.slidesEmbed.setAttribute("src", url);
  el.embedCard.style.display = "block";
  if (el.presLabel) el.presLabel.textContent = id;
}

/* ========================================================================== */
/* Questions: fetch + map                                                     */
/* ========================================================================== */

const qBaseUrl = () => baseUrl(AIR.QUESTIONS_TABLE_ID);
const aBaseUrl = () => baseUrl(AIR.ANSWERS_TABLE_ID);

function qHeaders(){ return _headers(); }
function aHeaders(){ return _headers(); }

async function fetchQuestionsFromAirtable(){
  const selectedModule = state.module;

  const url = new URL(qBaseUrl());
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("sort[0][field]", "Order");
  url.searchParams.set("sort[0][direction]", "asc");
  if (selectedModule) {
    const esc = s => String(s).replace(/'/g, "\\'");
    url.searchParams.set("filterByFormula", `AND({Active}=1, LOWER(TRIM({Module}))='${esc(selectedModule.toLowerCase())}')`);
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
        u.searchParams.set("filterByFormula", `AND({Active}=1, LOWER(TRIM({Module}))='${esc2(selectedModule.toLowerCase())}')`);
      } else {
        u.searchParams.set("filterByFormula", "AND({Active}=1)");
      }
      url.search = u.search;
    }
  } while (offset);

  const quizByIndex = {};
  const quizBySlideId = {};

  all.forEach(rec => {
    const f = rec.fields || {};
    const order = Number(f["Order"] ?? NaN);

    // Parse MC options
    const optsRaw = (f["Options (JSON)"] || "[]");
    let options = [];
    try { options = Array.isArray(optsRaw) ? optsRaw : JSON.parse(optsRaw); } catch {}

    // Parse FITB answers
    const fitbRaw = (f["FITB Answers (JSON)"] || "[]");
    let fitbAnswers = [];
    try { fitbAnswers = Array.isArray(fitbRaw) ? fitbRaw : JSON.parse(fitbRaw); } catch {}
    const fitbUseRegex = !!f["FITB Use Regex"];
    const fitbCaseSensitive = !!f["FITB Case Sensitive"];

    const type = String(f["Type"] || (options?.length ? "MC" : (fitbAnswers?.length ? "FITB" : "MC"))).toUpperCase();

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
    if (slideId) quizBySlideId[slideId] = q;

    if (!Number.isNaN(order)) {
      const idx = Math.max(0, order - 1);
      quizByIndex[idx] = q;
    }
  });

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

  el.thumbStrip.innerHTML = slides.map((s, idx) => {
    const src = slideThumbUrl(presId, s.objectId);
    const title = s.title || `Slide ${idx+1}`;
    const isActive = idx === state.i ? " active" : "";
    return `
      <div class="thumb${isActive}" data-idx="${idx}" title="${esc(title)}">
        <img loading="lazy" src="${att(src)}" alt="${esc(title)}"/>
        <div class="cap">${esc(title)}</div>
      </div>
    `;
  }).join("");

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
  if (el.counter) el.counter.textContent = `${at} / ${total}`;
  if (el.barInner) {
    const pct = total ? Math.round((at*100)/total) : 0;
    el.barInner.style.width = pct + "%";
  }

  renderQuiz(currentQuizForIndex(state.i));

  if (el.prevBtn) el.prevBtn.disabled = state.i <= 0;
  if (el.nextBtn) el.nextBtn.disabled = state.i >= (state.slides.length - 1);

  renderThumbs();
  saveLocalProgress();
}

/* ------------------ Quiz selection ---------------------------------------- */

function currentQuizForIndex(i){
  const slide = state.slides[i];
  if (!slide) return null;
  const byId = state.quizBySlideId[slide.objectId];
  if (byId) return byId;
  return state.quizByIndex[i] || null;
}

/* ------------------ Render quiz ------------------------------------------- */

function renderQuiz(quiz) {
  if (!el.quizBox) return;

  if (!quiz) {
    el.quizBox.innerHTML = `<div class="muted">No question for this slide.</div>`;
    if (el.btnSubmit) el.btnSubmit.disabled = true;
    return;
  }

  const priorAns = state.retake ? "" : (state.answers[quiz.questionId]?.answer || "");

  if (quiz.type === "MC") {
    const opts = (quiz.options || [])
      .map(o => {
        const checked = (!state.retake && o === priorAns) ? "checked" : "";
        return `<label class="opt">
          <input type="radio" name="opt" value="${att(o)}" ${checked} autocomplete="off"/>
          <div><strong>${esc(o)}</strong></div>
        </label>`;
      })
      .join("");

    el.quizBox.innerHTML = `
      <div><strong>${esc(quiz.question)}</strong> ${quiz.required ? `<span class="pill">Required</span>` : ""}</div>
      <div>${opts || `<div class="muted">No options set.</div>`}</div>
    `;
    if (el.btnSubmit) el.btnSubmit.disabled = !(quiz.options && quiz.options.length);
    if (el.saveStatus) el.saveStatus.textContent = "";
    return;
  }

  // FITB
  const valueAttr = state.retake ? "" : att(priorAns);
  el.quizBox.innerHTML = `
    <div><strong>${esc(quiz.question)}</strong> ${quiz.required ? `<span class="pill">Required</span>` : ""}</div>
    <div class="row" style="margin-top:8px">
      <input id="fitb" placeholder="Type your answer" value="${valueAttr}" autocomplete="off"/>
    </div>
  `;
  if (el.btnSubmit) el.btnSubmit.disabled = false;
  if (el.saveStatus) el.saveStatus.textContent = "";
}

function getUserAnswer(quiz){
  if (!quiz) return "";
  if (quiz.type === "MC") {
    const picked = document.querySelector('input[name="opt"]:checked');
    return picked ? picked.value : "";
  }
  const input = document.getElementById("fitb");
  return input ? input.value.trim() : "";
}

function isFitbCorrect(ans, answers, { useRegex=false, caseSensitive=false }={}){
  const hay = caseSensitive ? ans : ans.toLowerCase();
  const pool = (answers||[]).map(a=> caseSensitive ? String(a||"") : String(a||"").toLowerCase());
  if (!useRegex) return pool.includes(hay);
  try {
    return pool.some(p => {
      const m = p.match(/^\/(.*)\/([gimsuy]*)$/);
      const rx = m ? new RegExp(m[1], m[2]) : new RegExp(p);
      return rx.test(ans);
    });
  } catch { return false; }
}

/* ------------------ Save answers ------------------------------------------ */

async function upsertAnswerRecordWithWrongCount(baseFields){
  // simple append (create); adjust to your schema as needed
  const res = await fetch(aBaseUrl(), {
    method: "POST",
    headers: aHeaders(),
    body: JSON.stringify({ records: [{ fields: baseFields }], typecast: true })
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status} ${await res.text().catch(()=>"(no body)")}`);
}

async function loadExistingAnswersForUser(presentationId, userEmail){
  if (!userEmail) return {};
  const url = new URL(aBaseUrl());
  const e = s => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set("filterByFormula", `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}')`);
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
    if (offset) {
      const u = new URL(aBaseUrl());
      u.searchParams.set("filterByFormula", `AND({UserEmail}='${e(userEmail)}',{PresentationId}='${e(presentationId)}')`);
      u.searchParams.set("pageSize", "100");
      url.search = u.search;
    }
  } while (offset);

  const map = {};
  for (const r of all) {
    const f = r.fields || {};
    if (f.QuestionId) {
      map[f.QuestionId] = { answer: f.Answer, isCorrect: !!f.IsCorrect };
    }
  }
  return map;
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
  return 0;
}

function getQuestionCount(){
  const idxs = Object.keys(state.quizByIndex).map(k => parseInt(k, 10)).filter(n => !Number.isNaN(n));
  const byIndexCount = idxs.length ? (Math.max(...idxs) + 1) : 0;
  return Math.max(byIndexCount, 0);
}

function ensureSlidesForQuestions(){
  const need = getQuestionCount();
  if (!Array.isArray(state.slides)) state.slides = [];
  while (state.slides.length < need) {
    const i = state.slides.length;
    state.slides.push({ objectId: `virtual_${i+1}`, title: `Question ${i+1}` });
  }
}

/* ------------------ Deck load integration --------------------------------- */

async function onDeckLoaded(presentationId, slidesArray){
  state.presentationId = presentationId;

  // Prefer provided slides; else try GAS; else 1 placeholder
  let slides = (Array.isArray(slidesArray) && slidesArray.length) ? slidesArray : [];
  if (!slides.length) {
    const fromGAS = await tryFetchSlidesFromGAS(presentationId);
    if (fromGAS.length) slides = fromGAS;
  }
  state.slides = slides.length ? slides : [{ objectId: presentationId, title: "Slides Embed" }];
  state.i = 0;

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

  if (state.retake) {
    state.answers = {};
  } else {
    try {
      const prior = await loadExistingAnswersForUser(
        state.presentationId,
        (el.userEmail?.value||localStorage.getItem('trainingEmail')||'').trim()
      );
      state.answers = Object.assign({}, prior);
      state.i = nextUnansweredIndex();
      const pageId = state.slides[state.i]?.objectId || "";
      showEmbed(state.presentationId, pageId);
    } catch(e){ console.warn('Resume load failed', e); }
  }

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

async function submitAnswer(){
  const quiz = currentQuizForIndex(state.i);
  if (!quiz) return;

  const userEmail = (el.userEmail?.value || localStorage.getItem('trainingEmail') || '').trim();
  if (!userEmail) return pulse("Enter your email to save.", "warn");

  const ans = getUserAnswer(quiz);
  if (!ans && quiz.required) return pulse("Answer required.", "warn");

  let isCorrect = true;
  if (quiz.type === "MC") {
    isCorrect = ans === quiz.correct;
  } else {
    isCorrect = isFitbCorrect(ans, quiz.fitbAnswers, { useRegex: quiz.fitbUseRegex, caseSensitive: quiz.fitbCaseSensitive });
  }

  if (!state.retake) {
    const prev = state.answers[quiz.questionId];
    if (!(prev && prev.isCorrect === true)) {
      state.answers[quiz.questionId] = { answer: ans, isCorrect, at: Date.now() };
    }
  }

  const baseFields = {
    UserEmail: userEmail,
    PresentationId: state.presentationId,
    QuestionId: quiz.questionId,
    Answer: ans,
    IsCorrect: !!isCorrect
  };
  try {
    await upsertAnswerRecordWithWrongCount(baseFields);
    pulse(isCorrect ? "Saved ✓" : "Saved (wrong)", isCorrect ? "ok" : "warn");
  } catch (e) {
    console.error(e);
    pulse("Save failed", "bad");
  }

  if (state.i < state.slides.length - 1) {
    state.i += 1;
    const pageId = state.slides[state.i]?.objectId || "";
    showEmbed(state.presentationId, pageId);
    render();
  } else {
    if (el.retryRow) el.retryRow.style.display = "flex";
  }
}
if (el.btnSubmit) el.btnSubmit.addEventListener("click", submitAnswer);

/* ------------------ Local progress ---------------------------------------- */

function saveLocalProgress(){
  const email = (el.userEmail?.value || "").trim();
  if (!email || !state.presentationId) return;
  const answered = Object.keys(state.answers).length;
  const total = getQuestionCount();
  const key = `progress:${email}:${state.presentationId}`;
  localStorage.setItem(key, JSON.stringify({ answered, total, ts: Date.now() }));
}
