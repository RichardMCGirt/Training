
/* ==========================================================================
 * Slides + Airtable Quiz (slideshow + questions)
 * Questions Table: tblpvVpIJnkWco25E (Active=1, Order asc)
 * Answers  Table: tblkz5HyZGpgO093S (UPSERT by UserEmail + QuestionId)
 * ========================================================================== */

/* ------------------ Airtable (read-only for questions) --------------------- */
const AIRTABLE_Q = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",
  TABLE_ID: "tblpvVpIJnkWco25E"
};

/* ------------------ Airtable (write: answers log) -------------------------- */
const AIRTABLE_ANS = {
  API_KEY: AIRTABLE_Q.API_KEY,          // same PAT
  BASE_ID: AIRTABLE_Q.BASE_ID,          // same base (change if needed)
  TABLE_ID: "tblkz5HyZGpgO093S"         // answers table
};

/* ------------------ DOM references ---------------------------------------- */
const el = {
  embedCard: document.getElementById("embedCard"),
  slidesEmbed: document.getElementById("slidesEmbed"),
  presentationIdInput: document.getElementById("presentationId"),
  presLabel: document.getElementById("presLabel"),
  quizBox: document.getElementById("quizBox"),
  btnSubmit: document.getElementById("btnSubmit"),
  saveStatus: document.getElementById("saveStatus"),
  userEmail: document.getElementById("userEmail"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  counter: document.getElementById("counter"),
  bar: document.getElementById("bar"),
  barInner: document.getElementById("barInner"),
};

/* ------------------ Utils -------------------------------------------------- */
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function esc(s) { return String(s || "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;","&gt;":">","\"":"&quot;","'":"&#39;"}[m])); }
function att(s) { return esc(s).replace(/"/g, "&quot;"); }
function pulse(msg, cls="warn"){
  if (!el.saveStatus) return;
  el.saveStatus.textContent = msg;
  el.saveStatus.className = cls;
  setTimeout(() => { el.saveStatus.textContent = ""; el.saveStatus.className = "muted"; }, 1800);
}
function setProgress(pct){
  if (!el.barInner) return;
  const n = Math.max(0, Math.min(100, pct|0));
  el.barInner.style.width = n + "%";
}

/* ------------------ State -------------------------------------------------- */
const state = {
  presentationId: "",
  slides: [],            // [{objectId, title}, ...] – minimal for quiz mapping
  i: 0,
  answers: {},           // { questionId: {answer,isCorrect} }
  quizByIndex: {},       // 0-based index → quiz
  quizBySlideId: {},     // slide.objectId → quiz
};

/* ------------------ Airtable helpers -------------------------------------- */
function qHeaders(){ return { "Authorization": `Bearer ${AIRTABLE_Q.API_KEY}`, "Content-Type": "application/json" }; }
const qBaseUrl = () => `https://api.airtable.com/v0/${AIRTABLE_Q.BASE_ID}/${encodeURIComponent(AIRTABLE_Q.TABLE_ID)}`;

function aHeaders(){ return { "Authorization": `Bearer ${AIRTABLE_ANS.API_KEY}`, "Content-Type": "application/json" }; }
const aBaseUrl = () => `https://api.airtable.com/v0/${AIRTABLE_ANS.BASE_ID}/${encodeURIComponent(AIRTABLE_ANS.TABLE_ID)}`;

/* Find existing answer record by (UserEmail & QuestionId) */
async function findAnswerRecord(userEmail, questionId){
  const url = new URL(aBaseUrl());
  // Escape quotes in formula values
  const e = s => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set("filterByFormula", `AND({UserEmail}='${e(userEmail)}',{QuestionId}='${e(questionId)}')`);
  url.searchParams.set("pageSize", "1");
  const res = await fetch(url.toString(), { headers: aHeaders() });
  if (!res.ok) throw new Error(`Find failed: HTTP ${res.status}`);
  const data = await res.json();
  return (data.records && data.records[0]) ? data.records[0] : null;
}

/* Upsert into answers: update if exists, else create */
async function upsertAnswerRecord(fields){
  const existing = await findAnswerRecord(fields.UserEmail, fields.QuestionId);
  if (existing) {
    const res = await fetch(aBaseUrl(), {
      method: "PATCH",
      headers: aHeaders(),
      body: JSON.stringify({ records: [{ id: existing.id, fields }], typecast: true })
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>"" );
      throw new Error(`Update failed: HTTP ${res.status} ${t}`);
    }
    return res.json();
  } else {
    const res = await fetch(aBaseUrl(), {
      method: "POST",
      headers: aHeaders(),
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>"" );
      throw new Error(`Create failed: HTTP ${res.status} ${t}`);
    }
    return res.json();
  }
}

/* ------------------ Fetch Questions from Airtable ------------------------- */
async function fetchQuestionsFromAirtable() {
  const url = new URL(qBaseUrl());
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("sort[0][field]", "Order");
  url.searchParams.set("sort[0][direction]", "asc");
  url.searchParams.set("filterByFormula", "AND({Active}=1)");

  let all = [];
  let offset;
  do {
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: qHeaders() });
    if (!res.ok) throw new Error(`Airtable fetch failed: ${res.status}`);
    const data = await res.json();
    all = all.concat(data.records || []);
    offset = data.offset;

    if (offset) {
      const u = new URL(qBaseUrl());
      u.searchParams.set("pageSize", "100");
      u.searchParams.set("sort[0][field]", "Order");
      u.searchParams.set("sort[0][direction]", "asc");
      u.searchParams.set("filterByFormula", "AND({Active}=1)");
      url.search = u.search;
    }
  } while (offset);

  const quizByIndex = {};
  const quizBySlideId = {};

  all.forEach(rec => {
    const f = rec.fields || {};
    const order = Number(f["Order"] ?? NaN);
    const optsRaw = (f["Options (JSON)"] || "[]");
    let options = [];
    try { options = Array.isArray(optsRaw) ? optsRaw : JSON.parse(optsRaw); } catch {}

    const q = {
      questionId: f["QuestionId"] || `q_${rec.id}`,
      question: f["Question"] || "",
      options: options || [],
      correct: f["Correct"] || "",
      required: !!f["Required"],
    };

    const slideId = f["Slide ID"] || "";
    if (slideId) quizBySlideId[slideId] = q;

    if (!Number.isNaN(order)) {
      const idx = Math.max(0, order - 1); // Airtable 1-based → UI 0-based
      quizByIndex[idx] = q;
    }
  });

  state.quizByIndex = quizByIndex;
  state.quizBySlideId = quizBySlideId;
}

/* ------------------ Slideshow (embed) ------------------------------------- */
function showEmbed(presId){
  if (!el.slidesEmbed || !el.embedCard) return;
  const id = (presId || "").trim();
  if (!id) return;
  const url = `https://docs.google.com/presentation/d/${encodeURIComponent(id)}/embed?start=false&loop=false&delayms=3000`;
  el.slidesEmbed.setAttribute("src", url);
  el.embedCard.style.display = "block";
  if (el.presLabel) el.presLabel.textContent = id;
}

/* ------------------ Quiz rendering ---------------------------------------- */
function currentQuizForIndex(i){
  const slide = state.slides[i];
  if (!slide) return null;
  const byId = state.quizBySlideId[slide.objectId];
  if (byId) return byId;
  return state.quizByIndex[i] || null;
}

function renderQuiz(quiz) {
  if (!el.quizBox) return;
  if (!quiz) {
    el.quizBox.innerHTML = `<div class="muted">No question for this slide.</div>`;
    if (el.btnSubmit) el.btnSubmit.disabled = true;
    return;
  }
  const selected = (state.answers[quiz.questionId]?.answer) || "";
  const opts = (quiz.options || [])
    .map(o => {
      const checked = (o === selected) ? "checked" : "";
      return `<label class="opt">
        <input type="radio" name="opt" value="${att(o)}" ${checked}/>
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
}

/* ------------------ Render + navigation ----------------------------------- */
function render(){
  renderQuiz(currentQuizForIndex(state.i));
  if (el.counter) el.counter.textContent = `${state.i+1} / ${state.slides.length}`;
  if (el.prevBtn) el.prevBtn.disabled = state.i <= 0;
  if (el.nextBtn) el.nextBtn.disabled = state.i >= state.slides.length - 1;
  const pct = state.slides.length ? Math.round(((state.i+1) / state.slides.length) * 100) : 0;
  setProgress(pct);
}

function getChoice() {
  const x = document.querySelector('input[name="opt"]:checked');
  return x ? x.value : "";
}
async function go(delta) {
  const quiz = currentQuizForIndex(state.i);
  if (quiz && quiz.required) {
    const cur = getChoice();
    const has = !!(state.answers[quiz.questionId]?.answer);
    if (!cur && !has) return pulse("Answer required before continuing.", "warn");
  }

  // move first
  state.i = clamp(state.i + delta, 0, state.slides.length - 1);

  try {
    // refresh prior answers (optional)
    const prior = await loadExistingAnswersForUser(
      state.presentationId,
      (el.userEmail?.value || localStorage.getItem('trainingEmail') || '').trim()
    );
    state.answers = Object.assign({}, prior);

    // only jump forward if we landed on an already-answered slide
    const q = currentQuizForIndex(state.i);
    if (q && state.answers[q.questionId]) {
      const next = nextUnansweredIndex();
      if (next > state.i) state.i = next;
    }
  } catch (e) {
    console.warn('Resume load failed', e);
  }

  render();
}

if (el.prevBtn) el.prevBtn.addEventListener("click", () => { go(-1); });
if (el.nextBtn) el.nextBtn.addEventListener("click", () => { go(+1); });




/* ---------- Resume logic: load prior answers and jump to next unanswered --- */
async function loadExistingAnswersForUser(presentationId, userEmail){
  if (!userEmail) return {};
  // Query answers table for this user + presentation
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
  // Prefer ordered questions
  const maxIdx = Object.keys(state.quizByIndex).map(k=>parseInt(k,10)).filter(n=>!Number.isNaN(n));
  const total = maxIdx.length ? Math.max(...maxIdx)+1 : state.slides.length;
  for (let i = 0; i < total; i++){
    const q = currentQuizForIndex(i);
    if (!q) continue;
    const has = !!(state.answers[q.questionId]);
    if (!has) return i;
  }
  return 0; // all answered: start at beginning
}

function saveLocalProgress(){
  const email = (el.userEmail?.value || "").trim();
  if (!email || !state.presentationId) return;
  // Count answered among ordered questions
  const maxIdx = Object.keys(state.quizByIndex).map(k=>parseInt(k,10)).filter(n=>!Number.isNaN(n));
  const total = maxIdx.length ? Math.max(...maxIdx)+1 : 0;
  const answered = Object.keys(state.answers).length;
  const key = `progress:${email}:${state.presentationId}`;
  localStorage.setItem(key, JSON.stringify({ answered, total, ts: Date.now() }));
}


/* ------------------ Submit & UPSERT --------------------------------------- */
async function submitAnswer() {
  const slide = state.slides[state.i];
  const quiz = currentQuizForIndex(state.i);
  if (!quiz) return;
  const answer = getChoice();
  if (!answer) return pulse("Choose an option.", "warn");
  const isCorrect = !!(quiz.correct && answer.trim() === quiz.correct.trim());

  // Save locally and ADVANCE IMMEDIATELY
  state.answers[quiz.questionId] = { answer, isCorrect };
  // Advance right away (no delay) for faster UX
  state.i = clamp(state.i + 1, 0, state.slides.length - 1);
    try {
    // Load previous answers for resume
    const prior = await loadExistingAnswersForUser(state.presentationId, (el.userEmail?.value||localStorage.getItem('trainingEmail')||'').trim());
    state.answers = Object.assign({}, prior);
  } catch(e){ console.warn('Resume load failed', e); }

  // If there is prior progress, jump to first unanswered
  state.i = nextUnansweredIndex();

  render();

  // Build payload
  const payload = {
    userEmail: (el.userEmail?.value || "").trim(),
    presentationId: state.presentationId,
    slideId: slide.objectId,
    questionId: quiz.questionId,
    question: quiz.question,
    answer,
    correctAnswer: quiz.correct,
    isCorrect,
    result: isCorrect ? "Correct" : "Wrong",
    timestamp: new Date().toISOString()
  };

  // Optional: keep your existing save path if present (best-effort)
  try {
    if (typeof upsertAirtableBySlideAndEmail === "function" && window.AIRTABLE_API_KEY && window.AIRTABLE_BASE_ID && window.AIRTABLE_TABLE) {
      await upsertAirtableBySlideAndEmail(payload.slideId, payload.userEmail, {
        PresentationId: payload.presentationId,
        "Slide ID": payload.slideId,
        QuestionId: payload.questionId,
        Answer: payload.answer,
        IsCorrect: payload.isCorrect,
        UserEmail: payload.userEmail,
        Timestamp: payload.timestamp
      });
    } else if (window.AIRTABLE_WEBHOOK_URL) {
      await fetch(window.AIRTABLE_WEBHOOK_URL, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
    }
  } catch (e) {
    console.warn("[primary save] failed:", e);
  }

  // UPSERT into answers table on (UserEmail, QuestionId)
  try {
    await upsertAnswerRecord({
      UserEmail: payload.userEmail,
      PresentationId: payload.presentationId,
      "Slide ID": payload.slideId,
      QuestionId: payload.questionId,
      Question: payload.question,
      Answer: payload.answer,
      CorrectAnswer: payload.correctAnswer,
      IsCorrect: payload.isCorrect,        // checkbox (bool)
      Result: payload.result,              // single select: Correct | Wrong
      Timestamp: payload.timestamp
    });
    pulse("Saved.", "ok"); saveLocalProgress();
  } catch (err) {
    console.error(err);
    pulse("Save failed.", "bad");
  }
}
if (el.btnSubmit) el.btnSubmit.addEventListener("click", submitAnswer);


/* Ensure slide list is at least as long as the number of questions (by Order) */
function getQuestionCount(){
  // Determine highest index in quizByIndex, then +1
  const idxs = Object.keys(state.quizByIndex).map(k => parseInt(k, 10)).filter(n => !Number.isNaN(n));
  const byIndexCount = idxs.length ? (Math.max(...idxs) + 1) : 0;
  // If many slideId-mapped questions but no corresponding slides, fall back to byIndexCount
  return Math.max(byIndexCount, 0);
}
function ensureSlidesForQuestions(){
  const need = getQuestionCount();
  if (!Array.isArray(state.slides)) state.slides = [];
  // If we only had the embed fallback (1 item) and there are multiple questions, synthesize virtual slides
  while (state.slides.length < need) {
    const i = state.slides.length;
    state.slides.push({ objectId: `virtual_${i+1}`, title: `Question ${i+1}` });
  }
}
/* ------------------ Deck load integration --------------------------------- */
async function onDeckLoaded(presentationId, slidesArray){
  state.presentationId = presentationId;
  state.slides = (Array.isArray(slidesArray) && slidesArray.length)
    ? slidesArray
    : [{ objectId: presentationId, title: "Slides Embed" }]; // minimal 1-slide fallback
  state.i = 0;

  showEmbed(presentationId);

  try {
    await fetchQuestionsFromAirtable();
  } catch (e) {
    console.error("Failed to fetch questions:", e);
    pulse("Could not load questions.", "bad");
  }

  // NEW: grow slides list to match number of ordered questions when we don't have real slides
  ensureSlidesForQuestions();

  if (el.prevBtn) el.prevBtn.disabled = state.i <= 0;
  if (el.nextBtn) el.nextBtn.disabled = state.slides.length <= 1;

    try {
    // Load previous answers for resume
    const prior = await loadExistingAnswersForUser(state.presentationId, (el.userEmail?.value||localStorage.getItem('trainingEmail')||'').trim());
    state.answers = Object.assign({}, prior);
  } catch(e){ console.warn('Resume load failed', e); }

  // If there is prior progress, jump to first unanswered
  state.i = nextUnansweredIndex();

  render();
}

/* If another script fires this custom event, we hook in */
document.addEventListener("deck:loaded", (ev) => {
  const { id, slides } = (ev.detail || {});
  onDeckLoaded(id, slides);
});

/* ------------------ Legacy entry point used by index.html / auto-load ------ */
window.onLoadDeckClick = async function(evOrId){
  try{
    const maybeId = typeof evOrId === "string" ? evOrId : "";
    const id = maybeId || (el.presentationIdInput && el.presentationIdInput.value) || "";
    if (!id) {
      console.warn("[deck] No presentationId provided.");
      return;
    }
    await onDeckLoaded(id, /* slides */ null);

    try {
      document.dispatchEvent(new CustomEvent("deck:loaded", { detail: { id, slides: state.slides } }));
    } catch {}
  } catch(err){
    console.error("[deck] load failed", err);
  }
};

/* Keyboard navigation convenience */
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") { try { go(-1); } catch{} }
  if (e.key === "ArrowRight") { try { go(+1); } catch{} }
});
