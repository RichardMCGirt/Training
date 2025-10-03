/* ---------- Config (must be first) ---------- */
// Your published Web App URL (the /exec one)
const GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycbze3lvYA918QbvTBAMrANvffQfFMvhTb-oQRT-JSQGBd9ifdv8-NHV7iFZ9c8gT2quglA/exec";

const PRESENTATION_ID = "1lsNam3OMuol_lxdplqXKQJ57D8m2ZHUaGxdmdx2uwEQ";

const AIRTABLE_API_KEY = "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054";
const AIRTABLE_BASE_ID = "app3rkuurlsNa7ZdQ";
const AIRTABLE_TABLE   = "tblkz5HyZGpgO093S";
const AIRTABLE_WEBHOOK_URL = "https://hooks.airtable.com/workflows/v1/genericWebhook/app3rkuurlsNa7ZdQ/wfl42Z7YQTcn5WB2O/wtrfVqhBdGdz5YD6S";

let thumbDelayMs = 1500;           // start slower to avoid 429s
const BASE_BACKOFF = 6000;         // backoff on quota errors
const MAX_BACKOFF  = 30000;
let thumbBusy = false;
const thumbnailCache = new Map();
const thumbQueue = [];
const backoffMap = new Map(); // slideId -> delayMs

function queueThumb(presentationId, slideId) {
  if (!slideId) return;
  if (thumbnailCache.has(slideId)) return;
  thumbQueue.push({
    presentationId,
    slideId,
    resolve: () => {},
    reject:  () => {},
  });
  processThumbQueue();
}

function enqueueThumb(presentationId, slideId, { force = false } = {}) {
  // If we already have it cached, no need to queue
  if (!force && thumbnailCache.has(slideId)) return;
  // Avoid duplicate queued entries for same (pid, slideId)
  const exists = thumbQueue.some(q => q.presentationId === presentationId && q.slideId === slideId);
  if (!exists) {
    thumbQueue.push({ presentationId, slideId });
    processThumbQueue();
  }
}
// JSONP helper (bypasses CORS by using a <script> tag)
function jsonp(url, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = `__jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    params.callback = cb;
    const qs = new URLSearchParams(params).toString();

    const tag = document.createElement("script");
    tag.src = `${url}${url.includes("?") ? "&" : "?"}${qs}`;
    tag.async = true;

    let done = false;
    window[cb] = (data) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(data);
    };
    tag.onerror = () => { if (!done) { done = true; cleanup(); reject(new Error("JSONP network error")); } };

    document.head.appendChild(tag);

    function cleanup() {
      delete window[cb];
      tag.remove();
    }
  });
}
function fetchSlideThumbnailThrottled(presentationId, slideId) {
  if (thumbnailCache.has(slideId)) {
    return Promise.resolve(thumbnailCache.get(slideId));
  }
  return new Promise((resolve, reject) => {
    thumbQueue.push({ presentationId, slideId, resolve, reject });
    processThumbQueue();
  });
}




function processThumbQueue() {
  if (thumbBusy || thumbQueue.length === 0) return;
  thumbBusy = true;

  const { presentationId, slideId, resolve, reject } = thumbQueue.shift();

  // Guarded callbacks so we never crash if an entry lacks them
  const onResolve = typeof resolve === "function" ? resolve : () => {};
  const onReject  = typeof reject  === "function" ? reject  : (e) => {
    console.warn("Thumb fetch failed (no consumer)", slideId, e);
  };

  jsonp(GAS_ENDPOINT, {
    mode: "thumbnail",
    presentationId,
    pageObjectId: slideId
  })
  .then(data => {
    if (!data || data.ok !== true || !data.thumbUrl) {
      throw new Error((data && data.error) || "No thumbnail");
    }
    thumbnailCache.set(slideId, data.thumbUrl);
    onResolve(data.thumbUrl);

    // If this is the current slide, re-render
    if (state.slides[state.i] && state.slides[state.i].objectId === slideId) {
      state.slides[state.i].thumbUrl = data.thumbUrl;
      render();
    }
  })
  .catch(err => {
    const msg = String(err && err.message || "");
    if (/quota|rate|429|RESOURCE_EXHAUSTED/i.test(msg)) {
      // Back off and REQUEUE with the SAME callbacks
      thumbDelayMs = Math.min(MAX_BACKOFF, Math.max(BASE_BACKOFF, Math.round(thumbDelayMs * 1.5)));
      console.warn("Quota hit; backing off to", thumbDelayMs, "ms for", slideId);
      thumbQueue.push({ presentationId, slideId, resolve: onResolve, reject: onReject });
      // Important: don’t call onReject here; we’ll try again later
    } else {
      onReject(err);
    }
  })
  .finally(() => {
    thumbBusy = false;
    setTimeout(processThumbQueue, thumbDelayMs);
  });
}





/* ---------- Quiz mapping (expand as needed) ---------- */
const QUIZ_BY_INDEX = {
  0: {
    questionId: "q1_intro",
    question: "Did you view the first slide?",
    options: ["Yes", "No"],
    correct: "Yes",
    required: true
  }
  // Add more by slide index…
};

/* ---------- DOM ---------- */
const el = {
  pres: document.getElementById("presentationId"),
  btnLoad: document.getElementById("btnLoad"),
  loadStatus: document.getElementById("loadStatus"),
  stage: document.getElementById("stage"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  counter: document.getElementById("counter"),
  bar: document.getElementById("bar"),
  quizBox: document.getElementById("quizBox"),
  btnSubmit: document.getElementById("btnSubmit"),
  saveStatus: document.getElementById("saveStatus"),
  userEmail: document.getElementById("userEmail"),
  notice: document.getElementById("notice"),
  noticeText: document.getElementById("noticeText"),
  retryBtn: document.getElementById("retryBtn"),
  embedCard: document.getElementById("embedCard"),
  slidesEmbed: document.getElementById("slidesEmbed"),
  embedHint: document.getElementById("embedHint")
};

const state = {
  presentationId: "",
  slides: [],
  i: 0,
  answers: {},
  animating: false,
  usedEmbedFallback: false
};

/* ---------- Wiring ---------- */
el.prevBtn.addEventListener("click", () => go(-1));
el.nextBtn.addEventListener("click", () => go(+1));
el.btnSubmit.addEventListener("click", submitAnswer);
el.btnLoad.addEventListener("click", onLoadDeckClick);
el.retryBtn.addEventListener("click", () => startTypeAndLoad(true));
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") go(-1);
  if (e.key === "ArrowRight") go(+1);
});

/* ---------- Kickoff: type + click ---------- */
window.addEventListener("DOMContentLoaded", async () => {
  el.pres.focus();
  showCaret(true);
  await sleep(120);
  startTypeAndLoad(false);
});

async function startTypeAndLoad(isRetry) {
  if (!PRESENTATION_ID) {
    setNotice("Slides ID is missing. Contact your admin.", "bad", false);
    return;
  }
  state.animating = true;
  state.usedEmbedFallback = false;
  el.pres.value = "";
  el.btnLoad.disabled = true;
  setNotice(isRetry ? "Retrying… typing ID…" : "Typing Slides ID…", "info", false);
  setStageMsg("Preparing to load deck…");

  try {
    await typeInto(el.pres, PRESENTATION_ID, { minDelay: 45, maxDelay: 70, jitter: 15 });
    setNotice("ID ready. Loading deck…", "info", false);
    await sleep(250);
    el.btnLoad.click();
  } catch (err) {
    console.error(err);
    setNotice("Could not type ID automatically.", "bad", true);
  } finally {
    state.animating = false;
    showCaret(false);
  }
}

function showCaret(on){
  const caret = document.querySelector(".type-wrap .caret");
  if (caret) caret.style.visibility = on ? "visible" : "hidden";
}

/* ---------- Button handler (called by programmatic click) ---------- */
async function onLoadDeckClick() {
  const pid = (el.pres.value || "").trim();
  if (!pid) { setLoad("Please enter a presentation ID.", true); return; }

  state.presentationId = pid;
  setLoad("Loading slides…");
  setNotice("Loading deck…", "info", false);

  try {
    const urlSlides = `${GAS_ENDPOINT}?mode=slides&presentationId=${encodeURIComponent(pid)}`;
    console.log("[GAS] slides URL:", urlSlides);
    const j = await jsonp(GAS_ENDPOINT, {
  mode: "slides",
  presentationId: pid
});
if (!j || j.ok === false) {
  throw new Error("GAS_ERROR: " + (j && j.error || "Unknown"));
}
state.slides = Array.isArray(j.slides) ? j.slides : [];

    state.i = 0;
    render();

    const count = state.slides.length;
    if (!count) {
      embedFallback(pid, "Deck has 0 slides.");
    } else {
      setNotice(`Loaded ${count} slides. Thumbnails will load on demand.`, "info", false);
      el.embedCard.style.display = "none";
      state.usedEmbedFallback = false;
    }

    setLoad("");
    el.btnLoad.disabled = false;

    // prime first 3–5 thumbs so the UI shows quickly
    state.slides.slice(0, 5).forEach(s => queueThumb(pid, s.objectId));
    processThumbQueue();
  } catch (err) {
    console.error("[Deck Load] Error:", err);
    embedFallback(pid, String(err && err.message || err));
    setLoad("Load failed (showing live embed).", true);
    el.btnLoad.disabled = false;
  }
}



/* ---------- Fallback: live embed iframe ---------- */
function embedFallback(pid, reason) {
  const url = `https://docs.google.com/presentation/d/${encodeURIComponent(pid)}/embed?start=false&loop=false&delayms=3000`;
  el.slidesEmbed.src = url;
  el.embedCard.style.display = "";
  state.usedEmbedFallback = true;

  let humanMsg = "Thumbnail service unavailable. Showing live embed instead.";
  if (reason && /permission|GAS_ERROR|HTTP|fetch|network|CORS/i.test(reason)) {
    humanMsg = "Using live embed due to service/permission/network issue.";
  }
  setNotice(humanMsg, "warn", true);
  el.embedHint.textContent = `Reason: ${reason}`;
}

/* ---------- Rendering (on-demand thumbnails) ---------- */
function render() {
  const total = state.slides.length;
  const i = Math.max(0, Math.min(state.i, total - 1));
  state.i = i;

  if (!total) {
    el.stage.innerHTML = `<div class="muted">No thumbnails available.</div>`;
    el.prevBtn.disabled = true;
    el.nextBtn.disabled = true;
    el.counter.textContent = "0 / 0";
    el.bar.style.width = "0%";
    renderQuiz(null);
    return;
  }

  const s = state.slides[i];
  const cached = thumbnailCache.get(s.objectId);
  if (cached) {
    s.thumbUrl = cached;
    el.stage.innerHTML = `<img alt="${esc(s.title)}" src="${cached}">`;
  } else if (s.thumbUrl) {
    el.stage.innerHTML = `<img alt="${esc(s.title)}" src="${s.thumbUrl}">`;
  } else {
    el.stage.innerHTML = `<div class="muted">Loading thumbnail...</div>`;
    queueThumb(state.presentationId, s.objectId);
    processThumbQueue();
  }

  el.counter.textContent = `${i + 1} / ${total}`;
  el.bar.style.width = Math.round(((i + 1) / total) * 100) + "%";
  el.prevBtn.disabled = (i <= 0);
  el.nextBtn.disabled = (i >= total - 1);

  // prefetch next slide
  const next = state.slides[i + 1];
  if (next && !thumbnailCache.has(next.objectId)) {
    queueThumb(state.presentationId, next.objectId);
    processThumbQueue();
  }

  renderQuiz(QUIZ_BY_INDEX[i] || null);
}

function renderQuiz(quiz) {
  if (!quiz) {
    el.quizBox.innerHTML = `<div class="muted">No question for this slide.</div>`;
    el.btnSubmit.disabled = true;
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
  el.btnSubmit.disabled = !(quiz.options && quiz.options.length);
  el.saveStatus.textContent = "";
}

function go(delta) {
  const quiz = QUIZ_BY_INDEX[state.i];
  if (quiz && quiz.required) {
    const cur = getChoice();
    const has = !!(state.answers[quiz.questionId]?.answer);
    if (!cur && !has) return pulse("Answer required before continuing.", "warn");
  }
  state.i = clamp(state.i + delta, 0, state.slides.length - 1);
  render(); // will trigger on-demand fetch for the new current slide
}

function getChoice() {
  const x = document.querySelector('input[name="opt"]:checked');
  return x ? x.value : "";
}

/* ---------- Submit answer (Airtable upsert or webhook fallback) ---------- */
async function submitAnswer() {
  const slide = state.slides[state.i];
  const quiz = QUIZ_BY_INDEX[state.i];
  if (!quiz) return;
  const answer = getChoice();
  if (!answer) return pulse("Choose an option.", "warn");
  const isCorrect = !!(quiz.correct && answer.trim() === quiz.correct.trim());

  state.answers[quiz.questionId] = { answer, isCorrect };

  const payload = {
    userEmail: (el.userEmail.value || "").trim(),
    presentationId: state.presentationId,
    slideId: slide.objectId,
    questionId: quiz.questionId,
    answer,
    isCorrect,
    timestamp: new Date().toISOString()
  };

  try {
    if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID && AIRTABLE_TABLE) {
      await upsertAirtableBySlideId(payload.slideId, {
        PresentationId: payload.presentationId,
        "Slide ID": payload.slideId,   // keep the space; field must match Airtable column exactly
        QuestionId: payload.questionId,
        Answer: payload.answer,
        IsCorrect: payload.isCorrect,
        UserEmail: payload.userEmail,
        Timestamp: payload.timestamp
      });
      pulse(isCorrect ? "Saved ✓ (correct) via Airtable" : "Saved ✓ via Airtable", isCorrect ? "ok" : "");
    } else {
      const r = await fetch(AIRTABLE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error("Webhook failed: " + r.status);
      pulse(isCorrect ? "Saved ✓ (correct)" : "Saved ✓", isCorrect ? "ok" : "");
    }
  } catch (err) {
    console.error(err);
    pulse("Save failed. " + (err && err.message ? err.message : ""), "bad");
  }
}

/* ---------- Airtable helper: upsert by Slide ID (with space in field) ---------- */
async function upsertAirtableBySlideId(slideId, fields) {
  const filter = `({Slide ID} = "${escapeAirtableFormula(slideId)}")`;
  const listUrl =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}` +
    `?filterByFormula=${encodeURIComponent(filter)}&pageSize=1`;
  const headers = {
    "Authorization": `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json"
  };

  const searchResp = await fetch(listUrl, { method: "GET", headers });
  if (!searchResp.ok) throw new Error(`Airtable search failed: ${searchResp.status} ${await searchResp.text()}`);
  const searchJson = await searchResp.json();
  const found = (searchJson.records && searchJson.records.length) ? searchJson.records[0] : null;

  if (found) {
    const recId = found.id;
    const patchUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}/${recId}`;
    const patchResp = await fetch(patchUrl, { method: "PATCH", headers, body: JSON.stringify({ fields }) });
    if (!patchResp.ok) throw new Error(`Airtable patch failed: ${patchResp.status} ${await patchResp.text()}`);
    return await patchResp.json();
  } else {
    const postUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`;
    const postResp = await fetch(postUrl, { method: "POST", headers, body: JSON.stringify({ fields }) });
    if (!postResp.ok) throw new Error(`Airtable create failed: ${postResp.status} ${await postResp.text()}`);
    return await postResp.json();
  }
}

/* ---------- Utilities ---------- */
function setNotice(msg, level, showRetry) {
  el.noticeText.textContent = msg;
  el.notice.classList.remove("notice-info","notice-warn","notice-bad");
  el.notice.classList.add(
    level === "bad" ? "notice-bad" :
    level === "warn" ? "notice-warn" : "notice-info"
  );
  el.retryBtn.style.display = showRetry ? "" : "none";
}
function setStageMsg(msg){ el.stage.innerHTML = `<div class="muted">${esc(msg)}</div>`; }
function setLoad(msg, bad){ el.loadStatus.textContent = msg; el.loadStatus.className = bad ? "bad" : "muted"; }
function pulse(msg, cls) {
  el.saveStatus.textContent = msg;
  el.saveStatus.className = (cls ? cls + " " : "") + "muted";
  setTimeout(() => { el.saveStatus.textContent = ""; el.saveStatus.className = "muted"; }, 2200);
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function esc(s) { return String(s || "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
function att(s) { return esc(s).replace(/"/g, "&quot;"); }
function escapeAirtableFormula(s) { return String(s || "").replace(/"/g, '""'); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function rand(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }

// Strongly visible typing (slower) so you notice it
async function typeInto(inputEl, text, { minDelay = 45, maxDelay = 70, jitter = 15 } = {}) {
  inputEl.focus();
  showCaret(true);
  inputEl.value = "";
  for (let i = 0; i < text.length; i++) {
    inputEl.value = text.slice(0, i + 1);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    const base = rand(minDelay, maxDelay);
    const delay = Math.max(16, base + rand(-jitter, jitter));
    await sleep(delay);
  }
  showCaret(false);
}

async function fetchWithTimeoutJSON(url, { timeoutMs = 15000, ...opts } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    if (!ct.includes("application/json")) throw new Error(`Non-JSON response (content-type: ${ct || "unknown"})`);
    return await resp.json();
  } finally {
    clearTimeout(id);
  }
}

/* ---------- Autofill and auto-click for convenience ---------- */
(async function(){
  const SLIDES_ID = PRESENTATION_ID;

  // Wait for the DOM & elements
  if (document.readyState === "loading") {
    await new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true }));
  }
  const need = ids => ids.map(id => [id, document.getElementById(id)]);
  const hasAll = arr => arr.every(([, el]) => !!el);

  // Try up to ~5s for elements to appear
  let tries = 0, got;
  while (tries++ < 50) {
    got = need(["presentationId","btnLoad"]);
    if (hasAll(got)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const dict = Object.fromEntries(got);
  const input = dict.presentationId;
  const btn   = dict.btnLoad;

  if (!input || !btn) {
    console.error("Missing #presentationId or #btnLoad after waiting.");
    return;
  }

  // Fill the input like a user would
  input.focus();
  input.value = SLIDES_ID;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  // Prefer submitting the form if present, otherwise click the button
  const form = input.form || document.querySelector("form"); // safest guess
  if (form) {
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit(btn); // passes the button as the submitter
    } else {
      const ok = form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      if (ok && btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    console.log("Submitted form with Slides ID:", SLIDES_ID);
  } else {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    console.log("Clicked Load with Slides ID:", SLIDES_ID);
  }
})();
