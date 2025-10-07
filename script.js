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
  btnRetry: document.getElementById("btnRetry"),
  retryRow: document.getElementById("retryRow"),
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
      } catch { /* ignore bad pattern */ }
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
// Retake mode: when index.html is opened with ?reset=1 we don't prefill prior answers or prior progress
const params = new URLSearchParams(location.search);
state.retake = (params.get('reset') === '1'); // true = do NOT show prior selections/inputs or resume progress

/* ------------------ Airtable helpers -------------------------------------- */
function qHeaders(){ return { "Authorization": `Bearer ${AIRTABLE_Q.API_KEY}`, "Content-Type": "application/json" }; }
const qBaseUrl = () => `https://api.airtable.com/v0/${AIRTABLE_Q.BASE_ID}/${encodeURIComponent(AIRTABLE_Q.TABLE_ID)}`;

function aHeaders(){ return { "Authorization": `Bearer ${AIRTABLE_ANS.API_KEY}`, "Content-Type": "application/json" }; }
const aBaseUrl = () => `https://api.airtable.com/v0/${AIRTABLE_ANS.BASE_ID}/${encodeURIComponent(AIRTABLE_ANS.TABLE_ID)}`;

/* Find existing answer record by (UserEmail & QuestionId) */
async function findAnswerRecord(userEmail, questionId){
  const url = new URL(aBaseUrl());
  const e = s => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set("filterByFormula", `AND({UserEmail}='${e(userEmail)}',{QuestionId}='${e(questionId)}')`);
  url.searchParams.set("pageSize", "1");
  const res = await fetch(url.toString(), { headers: aHeaders() });
  if (!res.ok) throw new Error(`Find failed: HTTP ${res.status}`);
  const data = await res.json();
  return (data.records && data.records[0]) ? data.records[0] : null;
}

/* Upsert + Wrong Attempts (overwrite count with +1 on wrong) */
const FIELD_WRONG_ATTEMPTS = "Wrong Attempts";
const FIELD_LAST_WRONG_AT  = "Last Wrong At";

async function upsertAnswerRecordWithWrongCount(baseFields) {
  if (!baseFields?.UserEmail || !baseFields?.QuestionId)
    throw new Error("Missing required fields: UserEmail and QuestionId");

  const existing = await findAnswerRecord(baseFields.UserEmail, baseFields.QuestionId);

  const isWrong = baseFields.IsCorrect === false;
  const prevWrong = existing?.fields?.[FIELD_WRONG_ATTEMPTS] || 0;
  const nextWrong = isWrong ? prevWrong + 1 : prevWrong;

  const fieldsToSave = {
    ...baseFields,
    [FIELD_WRONG_ATTEMPTS]: nextWrong,
  };
  if (isWrong && FIELD_LAST_WRONG_AT)
    fieldsToSave[FIELD_LAST_WRONG_AT] = new Date().toISOString();

  if (existing) {
    const res = await fetch(aBaseUrl(), {
      method: "PATCH",
      headers: aHeaders(),
      body: JSON.stringify({
        records: [{ id: existing.id, fields: fieldsToSave }],
        typecast: true,
      }),
    });
    if (!res.ok) throw new Error(`Update failed: HTTP ${res.status}`);
    return res.json();
  } else {
    const res = await fetch(aBaseUrl(), {
      method: "POST",
      headers: aHeaders(),
      body: JSON.stringify({
        records: [{ fields: fieldsToSave }],
        typecast: true,
      }),
    });
    if (!res.ok) throw new Error(`Create failed: HTTP ${res.status}`);
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

    // Parse MC fields
    const optsRaw = (f["Options (JSON)"] || "[]");
    let options = [];
    try { options = Array.isArray(optsRaw) ? optsRaw : JSON.parse(optsRaw); } catch {}

    // Parse FITB fields
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

  // Use prior answer only when NOT in retake mode
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
    <div style="margin-top:10px">
      <input id="fitbInput" type="text" placeholder="Type your answer..." value="${valueAttr}" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa" />
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

function isAllAnswered(){
  const total = getQuestionCount();
  let count = 0;
  for (let i = 0; i < total; i++){
    const q = currentQuizForIndex(i);
    if (q && state.answers[q.questionId]) count++;
  }
  return total > 0 && count >= total;
}

async function go(delta) {
  const quiz = currentQuizForIndex(state.i);
  if (quiz && quiz.required) {
    const cur = getUserAnswer(quiz).trim();
    const has = !!(state.answers[quiz.questionId]?.answer);
    if (!cur && !has) return pulse("Answer required before continuing.", "warn");
  }

  // In retake mode: do NOT consult/merge prior answers; just move linearly.
  if (state.retake) {
    state.i = clamp(state.i + delta, 0, state.slides.length - 1);
    render();
    return;
  }

  // Normal mode (resume-aware)
  state.i = clamp(state.i + delta, 0, state.slides.length - 1);

  try {
    const prior = await loadExistingAnswersForUser(
      state.presentationId,
      (el.userEmail?.value || localStorage.getItem('trainingEmail') || '').trim()
    );
    state.answers = Object.assign({}, prior);

    // If we land on an already-answered slide, jump forward to next unanswered
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

/* ---------- Resume logic (skipped in retake mode) -------------------------- */
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
  return 0; // all answered: start at beginning
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
  state.slides = (Array.isArray(slidesArray) && slidesArray.length)
    ? slidesArray
    : [{ objectId: presentationId, title: "Slides Embed" }];
  state.i = 0;

  showEmbed(presentationId);

  try {
    await fetchQuestionsFromAirtable();
  } catch (e) {
    console.error("Failed to fetch questions:", e);
    pulse("Could not load questions.", "bad");
  }

  ensureSlidesForQuestions();

  if (el.prevBtn) el.prevBtn.disabled = state.i <= 0;
  if (el.nextBtn) el.nextBtn.disabled = state.slides.length <= 1;

  // RETAKE MODE: do NOT load/merge prior answers; start fresh at Q1
  if (state.retake) {
    state.answers = {};
  } else {
    try {
      const prior = await loadExistingAnswersForUser(
        state.presentationId,
        (el.userEmail?.value||localStorage.getItem('trainingEmail')||'').trim()
      );
      state.answers = Object.assign({}, prior);
      state.i = nextUnansweredIndex(); // only in normal mode
    } catch(e){ console.warn('Resume load failed', e); }
  }

  // Wire Retry button
  if (el.btnRetry) {
    el.btnRetry.onclick = () => {
      const pid = state.presentationId || (el.presentationIdInput?.value || "");
      if (!pid) return;
      const url = new URL(location.href);
      url.searchParams.set("presentationId", pid);
      url.searchParams.set("reset", "1");
      // keep same email in localStorage; just navigate
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
    try { document.dispatchEvent(new CustomEvent("deck:loaded", { detail: { id, slides: state.slides } })); } catch {}
  } catch(err){
    console.error("[deck] load failed", err);
  }
};

/* Keyboard navigation convenience */
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

  // Correctness
  let isCorrect = true;
  if (quiz.type === "MC") {
    isCorrect = ans === quiz.correct;
  } else {
    isCorrect = isFitbCorrect(ans, quiz.fitbAnswers, { useRegex: quiz.fitbUseRegex, caseSensitive: quiz.fitbCaseSensitive });
  }

  // Save to local resume map (normal mode), but do NOT overwrite a prior correct answer
  if (!state.retake) {
    const prev = state.answers[quiz.questionId];
    if (!(prev && prev.isCorrect === true)) {
      state.answers[quiz.questionId] = { answer: ans, isCorrect, at: Date.now() };
    }
  }

  // Persist to Airtable (answers log with Wrong Attempts)
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

  // Always continue to next slide after submit (even if wrong)
  if (state.i < state.slides.length - 1) {
    state.i += 1;
    render();
  } else {
    // End of deck — show retry UI
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
