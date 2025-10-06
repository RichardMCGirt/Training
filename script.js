/* ==========================================================================
 * Slides + Airtable Quiz (slideshow + questions)
 * Questions Table: tblpvVpIJnkWco25E (Active=1, Order asc)
 * Answers  Table: tblkz5HyZGpgO093S (UPSERT by UserEmail + QuestionId)
 * Supports Type = "MC" and "FITB"
 * Robust 422 handling + field-name mapping to fit your Answers schema.
 * ========================================================================== */

/* ------------------ Airtable (read-only for questions) --------------------- */
const AIRTABLE_Q = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",
  TABLE_ID: "tblpvVpIJnkWco25E"
};

/* ------------------ Airtable (write: answers log) -------------------------- */
const AIRTABLE_ANS = {
  API_KEY: AIRTABLE_Q.API_KEY,
  BASE_ID: AIRTABLE_Q.BASE_ID,
  TABLE_ID: "tblkz5HyZGpgO093S"
};

/* ------------------ Answers table field mapping ---------------------------- */
/* If your Answers table uses different column names, change them here.
 * Set a key to null to skip writing it.
 */
const ANS_FIELDS = {
  userEmail:        "UserEmail",
  questionId:       "QuestionId",
  presentationId:   "PresentationId",
  slideId:          "Slide ID",
  question:         "Question",        // optional
  answer:           "Answer",
  correctAnswer:    "CorrectAnswer",   // optional
  isCorrect:        "IsCorrect",       // checkbox (preferred). Set to null if you don't have it.
  result:           null,              // Single select "Correct"/"Wrong" (set to "Result" if you use it)
  timestamp:        "Timestamp",       // text or date
  type:             "Type",            // optional text
  wrongAttempts:    "Wrong Attempts",  // optional number
  lastWrongAt:      "Last Wrong At"    // optional date
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
  el.barInner.style.width = Math.max(0, Math.min(100, pct|0)) + "%";
}

/* ------------------ FITB correctness -------------------------------------- */
function isFitbCorrect(userInput, answers, { useRegex=false, caseSensitive=false } = {}){
  if (!Array.isArray(answers)) return false;
  const rawUser = String(userInput ?? "");
  const input = caseSensitive ? rawUser.trim() : rawUser.trim().toLowerCase();

  for (const a of answers) {
    const ans = String(a ?? "");
    if (useRegex) {
      try {
        const flags = caseSensitive ? "" : "i";
        const re = new RegExp(ans, flags);
        if (re.test(rawUser)) return true;
      } catch { /* bad pattern, ignore */ }
    } else {
      const cmp = caseSensitive ? ans.trim() : ans.trim().toLowerCase();
      if (input === cmp) return true;
    }
  }
  return false;
}

/* ------------------ State -------------------------------------------------- */
const state = {
  presentationId: "",
  slides: [],
  i: 0,
  answers: {},
  quizByIndex: {},
  quizBySlideId: {},
};

/* ------------------ Airtable helpers -------------------------------------- */
function qHeaders(){ return { "Authorization": `Bearer ${AIRTABLE_Q.API_KEY}`, "Content-Type": "application/json" }; }
const qBaseUrl = () => `https://api.airtable.com/v0/${AIRTABLE_Q.BASE_ID}/${encodeURIComponent(AIRTABLE_Q.TABLE_ID)}`;

function aHeaders(){ return { "Authorization": `Bearer ${AIRTABLE_ANS.API_KEY}`, "Content-Type": "application/json" }; }
const aBaseUrl = () => `https://api.airtable.com/v0/${AIRTABLE_ANS.BASE_ID}/${encodeURIComponent(AIRTABLE_ANS.TABLE_ID)}`;

function f(name){ return ANS_FIELDS[name]; } // field alias helper

/* Find existing answer record by (UserEmail & QuestionId) */
async function findAnswerRecord(userEmail, questionId){
  const url = new URL(aBaseUrl());
  const E = s => String(s||"").replace(/'/g, "\\'");
  const fEmail = f("userEmail");
  const fQid   = f("questionId");
  if (!fEmail || !fQid) return null; // cannot filter without both
  url.searchParams.set("filterByFormula", `AND({${fEmail}}='${E(userEmail)}',{${fQid}}='${E(questionId)}')`);
  url.searchParams.set("pageSize", "1");
  const res = await fetch(url.toString(), { headers: aHeaders() });
  if (!res.ok) throw new Error(`Find failed: HTTP ${res.status}`);
  const data = await res.json();
  return (data.records && data.records[0]) ? data.records[0] : null;
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
    const flds = rec.fields || {};
    const order = Number(flds["Order"] ?? NaN);

    // MC fields
    const optsRaw = (flds["Options (JSON)"] || "[]");
    let options = [];
    try { options = Array.isArray(optsRaw) ? optsRaw : JSON.parse(optsRaw); } catch {}

    // FITB fields
    const fitbRaw = (flds["FITB Answers (JSON)"] || "[]");
    let fitbAnswers = [];
    try { fitbAnswers = Array.isArray(fitbRaw) ? fitbRaw : JSON.parse(fitbRaw); } catch {}
    const fitbUseRegex = !!flds["FITB Use Regex"];
    const fitbCaseSensitive = !!flds["FITB Case Sensitive"];

    const type = String(flds["Type"] || (options?.length ? "MC" : (fitbAnswers?.length ? "FITB" : "MC"))).toUpperCase();

    const q = {
      questionId: flds["QuestionId"] || `q_${rec.id}`,
      question: flds["Question"] || "",
      required: !!flds["Required"],
      type,
      options: options || [],
      correct: flds["Correct"] || "",
      fitbAnswers: fitbAnswers || [],
      fitbUseRegex,
      fitbCaseSensitive
    };

    const slideId = flds["Slide ID"] || "";
    if (slideId) quizBySlideId[slideId] = q;

    if (!Number.isNaN(order)) {
      const idx = Math.max(0, order - 1); // 1-based → 0-based
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
  const priorAns = (state.answers[quiz.questionId]?.answer) || "";

  if (quiz.type === "MC") {
    const opts = (quiz.options || [])
      .map(o => {
        const checked = (o === priorAns) ? "checked" : "";
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
    return;
  }

  // FITB
  const value = att(priorAns);
  el.quizBox.innerHTML = `
    <div><strong>${esc(quiz.question)}</strong> ${quiz.required ? `<span class="pill">Required</span>` : ""}</div>
    <div style="margin-top:10px">
      <input id="fitbInput" type="text" placeholder="Type your answer..." value="${value}" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa" />
      <div class="muted" style="font-size:12px;margin-top:6px">
        ${quiz.fitbUseRegex ? "Regex enabled." : "Exact match"} ${quiz.fitbCaseSensitive ? "(case sensitive)" : "(case insensitive)"}.
      </div>
    </div>
  `;
  if (el.btnSubmit) el.btnSubmit.disabled = false;
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

function getUserAnswer(quiz) {
  if (!quiz) return "";
  if (quiz.type === "MC") {
    const x = document.querySelector('input[name="opt"]:checked');
    return x ? x.value : "";
  } else {
    const inp = document.getElementById("fitbInput");
    return inp ? inp.value : "";
  }
}

async function go(delta) {
  const quiz = currentQuizForIndex(state.i);
  if (quiz && quiz.required) {
    const cur = getUserAnswer(quiz).trim();
    const has = !!(state.answers[quiz.questionId]?.answer);
    if (!cur && !has) return pulse("Answer required before continuing.", "warn");
  }

  state.i = clamp(state.i + delta, 0, state.slides.length - 1);

  try {
    const prior = await loadExistingAnswersForUser(
      state.presentationId,
      (el.userEmail?.value || localStorage.getItem('trainingEmail') || '').trim()
    );
    state.answers = Object.assign({}, prior);

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
  const url = new URL(aBaseUrl());
  const E = s => String(s||"").replace(/'/g, "\\'");
  const fEmail = f("userEmail");
  const fPres  = f("presentationId");
  if (!fEmail || !fPres) return {};
  url.searchParams.set("filterByFormula", `AND({${fEmail}}='${E(userEmail)}',{${fPres}}='${E(presentationId)}')`);
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
      u.searchParams.set("pageSize", "100");
      u.searchParams.set("filterByFormula", `AND({${fEmail}}='${E(userEmail)}',{${fPres}}='${E(presentationId)}')`);
      url.search = u.search;
    }
  } while (offset);

  const map = {};
  const fAns  = f("answer");
  const fIC   = f("isCorrect");
  const fRes  = f("result");
  const fQid  = f("questionId");

  for (const r of all) {
    const v = r.fields || {};
    const qid = v[fQid];
    if (!qid) continue;
    const ans = fAns ? v[fAns] : "";
    let isCorrect = false;
    if (fIC && typeof v[fIC] !== "undefined") {
      isCorrect = !!v[fIC];
    } else if (fRes && typeof v[fRes] === "string") {
      isCorrect = String(v[fRes]).toLowerCase() === "correct";
    }
    map[qid] = { answer: ans, isCorrect };
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
  return 0; // all answered: start at beginning
}

function saveLocalProgress(){
  const email = (el.userEmail?.value || "").trim();
  if (!email || !state.presentationId) return;
  const answered = Object.keys(state.answers).length;
  const key = `progress:${email}:${state.presentationId}`;
  localStorage.setItem(key, JSON.stringify({ answered, ts: Date.now() }));
}

/* =================== Upsert with 422 fallback + mapping ==================== */
async function upsertAnswerRecordWithWrongCount(base) {
  const email = (el.userEmail?.value || "").trim();
  if (!email) throw new Error("Missing UserEmail");
  const qid = base.questionId;
  if (!qid) throw new Error("Missing QuestionId");

  const nowIso = new Date().toISOString();
  const isWrong = base.isCorrect === false;

  // Build "full" fields according to mapping
  const full = {};
  if (f("userEmail"))      full[f("userEmail")]      = email;
  if (f("questionId"))     full[f("questionId")]     = qid;
  if (f("presentationId")) full[f("presentationId")] = state.presentationId || "";
  if (f("slideId"))        full[f("slideId")]        = base.slideId || "";
  if (f("question"))       full[f("question")]       = base.question || "";
  if (f("answer"))         full[f("answer")]         = base.answer ?? "";
  if (f("correctAnswer"))  full[f("correctAnswer")]  = base.correctAnswer ?? "";
  if (f("type"))           full[f("type")]           = base.type || "";
  if (f("timestamp"))      full[f("timestamp")]      = nowIso;

  if (f("isCorrect")) full[f("isCorrect")] = !!base.isCorrect;
  if (f("result"))    full[f("result")]    = base.isCorrect ? "Correct" : "Wrong";
  if (f("wrongAttempts")) full[f("wrongAttempts")] = base.wrongAttempts ?? 0;
  if (f("lastWrongAt") && isWrong) full[f("lastWrongAt")] = nowIso;

  // Minimal, very safe fallback
  const minimal = {};
  if (f("userEmail"))      minimal[f("userEmail")]      = email;
  if (f("questionId"))     minimal[f("questionId")]     = qid;
  if (f("presentationId")) minimal[f("presentationId")] = state.presentationId || "";
  if (f("slideId"))        minimal[f("slideId")]        = base.slideId || "";
  if (f("answer"))         minimal[f("answer")]         = base.answer ?? "";
  if (f("timestamp"))      minimal[f("timestamp")]      = nowIso;
  // Prefer result select if isCorrect field is absent
  if (f("isCorrect"))      minimal[f("isCorrect")]      = !!base.isCorrect;
  else if (f("result"))    minimal[f("result")]         = base.isCorrect ? "Correct" : "Wrong";

  const existing = await findAnswerRecord(email, qid);

  async function doCreate(fields) {
    const res = await fetch(aBaseUrl(), {
      method: "POST",
      headers: aHeaders(),
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[Airtable create] HTTP", res.status, body);
      if (res.status === 422) throw new Error("422");
      throw new Error(`Create failed: HTTP ${res.status}`);
    }
    return res.json();
  }

  async function doPatch(id, fields) {
    const res = await fetch(aBaseUrl(), {
      method: "PATCH",
      headers: aHeaders(),
      body: JSON.stringify({ records: [{ id, fields }], typecast: true })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[Airtable update] HTTP", res.status, body);
      if (res.status === 422) throw new Error("422");
      throw new Error(`Update failed: HTTP ${res.status}`);
    }
    return res.json();
  }

  try {
    if (existing) return await doPatch(existing.id, full);
    return await doCreate(full);
  } catch (e) {
    if (e.message !== "422") throw e;
    // retry with minimal
    if (existing) return await doPatch(existing.id, minimal);
    return await doCreate(minimal);
  }
}

/* ------------------ Submit ------------------------------------------------- */
async function submitAnswer() {
  const slide = state.slides[state.i];
  const quiz  = currentQuizForIndex(state.i);
  if (!quiz) return;

  const answerRaw = getUserAnswer(quiz);
  const answer = String(answerRaw || "").trim();
  if (!answer) return pulse("Provide an answer.", "warn");

  // Correctness
  let isCorrect = false;
  if (quiz.type === "MC") {
    isCorrect = !!(quiz.correct && answer === String(quiz.correct).trim());
  } else {
    isCorrect = isFitbCorrect(
      answerRaw,
      quiz.fitbAnswers,
      { useRegex: !!quiz.fitbUseRegex, caseSensitive: !!quiz.fitbCaseSensitive }
    );
  }

  // Update local state & navigate
  state.answers[quiz.questionId] = { answer, isCorrect };
  state.i = nextUnansweredIndex();
  render();

  const payload = {
    slideId: slide?.objectId || "",
    questionId: quiz.questionId,
    question: quiz.question,
    answer,
    correctAnswer: quiz.type === "MC" ? quiz.correct : (quiz.fitbAnswers || []).join(" | "),
    isCorrect,
    type: quiz.type
  };

  // Optional: your custom save (webhook or helper) if present
  try {
    if (typeof upsertAirtableBySlideAndEmail === "function" &&
        window.AIRTABLE_API_KEY && window.AIRTABLE_BASE_ID && window.AIRTABLE_TABLE) {
      await upsertAirtableBySlideAndEmail(payload.slideId, (el.userEmail?.value||"").trim(), {
        PresentationId: state.presentationId,
        "Slide ID": payload.slideId,
        QuestionId: payload.questionId,
        Answer: payload.answer,
        IsCorrect: payload.isCorrect,
        UserEmail: (el.userEmail?.value||"").trim(),
        Timestamp: new Date().toISOString()
      });
    } else if (window.AIRTABLE_WEBHOOK_URL) {
      await fetch(window.AIRTABLE_WEBHOOK_URL, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          ...payload,
          userEmail: (el.userEmail?.value||"").trim(),
          presentationId: state.presentationId,
          timestamp: new Date().toISOString()
        })
      });
    }
  } catch (e) { console.warn("[primary save] failed:", e); }

  // Canonical save → our Answers table (with 422 fallback)
  try {
    await upsertAnswerRecordWithWrongCount(payload);
    pulse("Saved.", "ok");
    saveLocalProgress();
  } catch (err) {
    console.error(err);
    pulse("Save failed.", "bad");
  }
}

/* Wire submit */
if (el.btnSubmit) { el.btnSubmit.removeEventListener("click", submitAnswer); el.btnSubmit.addEventListener("click", submitAnswer); }

/* Ensure virtual slides exist to match ordered questions if needed */
function getQuestionCount(){
  const idxs = Object.keys(state.quizByIndex).map(k => parseInt(k, 10)).filter(n => !Number.isNaN(n));
  return idxs.length ? (Math.max(...idxs) + 1) : 0;
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
  state.slides = (Array.isArray(slidesArray) && slidesArray.length)
    ? slidesArray
    : [{ objectId: presentationId, title: "Slides Embed" }];
  state.i = 0;

  showEmbed(presentationId);

  try { await fetchQuestionsFromAirtable(); }
  catch (e) { console.error("Failed to load questions:", e); pulse("Could not load questions.", "bad"); }

  ensureSlidesForQuestions();

  try {
    const prior = await loadExistingAnswersForUser(
      state.presentationId,
      (el.userEmail?.value||localStorage.getItem('trainingEmail')||'').trim()
    );
    state.answers = Object.assign({}, prior);
  } catch(e){ console.warn('Resume load failed', e); }

  state.i = nextUnansweredIndex();
  render();
}

/* Custom event hook */
document.addEventListener("deck:loaded", (ev) => {
  const { id, slides } = (ev.detail || {});
  onDeckLoaded(id, slides);
});

/* Legacy entry point used by index.html / auto-load */
window.onLoadDeckClick = async function(evOrId){
  try{
    const maybeId = typeof evOrId === "string" ? evOrId : "";
    const id = maybeId || (el.presentationIdInput && el.presentationIdInput.value) || "";
    if (!id) return;
    await onDeckLoaded(id, /* slides */ null);
    try { document.dispatchEvent(new CustomEvent("deck:loaded", { detail: { id, slides: state.slides } })); } catch {}
  } catch(err){
    console.error("[deck] load failed", err);
  }
};

/* Keyboard nav */
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") { try { go(-1); } catch{} }
  if (e.key === "ArrowRight") { try { go(+1); } catch{} }
});
