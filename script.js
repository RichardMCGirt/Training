const GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycby9d3L18bAVmlw05Y7HwTwBLPcwR0b_1TmVmZcgfvTaZE6anMwfIGxhuQFMkZuh2QD-Bw/exec";
const PRESENTATION_ID = "1lsNam3OMuol_lxdplqXKQJ57D8m2ZHUaGxdmdx2uwEQ";
const AIRTABLE_API_KEY = "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054";
const AIRTABLE_BASE_ID = "app3rkuurlsNa7ZdQ";
const AIRTABLE_TABLE   = "tblkz5HyZGpgO093S";
const AIRTABLE_WEBHOOK_URL = "https://hooks.airtable.com/workflows/v1/genericWebhook/app3rkuurlsNa7ZdQ/wfl42Z7YQTcn5WB2O/wtrfVqhBdGdz5YD6S";
let active = 0;                   // used by schedule() to count in-flight jobs

let thumbDelayMs = 350;     // was 1500 — start much faster
const BASE_BACKOFF = 1500;  // was 6000 — recover quicker after 429s
const MAX_BACKOFF  = 8000;  // was 30000 — cap retries lower
const MAX_CONCURRENCY = 3;
let thumbBusy = false;
const thumbnailCache = new Map();
const thumbQueue = [];
const backoffMap = new Map(); // slideId -> delayMs
const backoffBySlide = new Map();
function queueThumb(presentationId, slideId) {
  if (!slideId) return;
  if (thumbnailCache.has(slideId) || inflightThumbs.has(slideId)) return;

  inflightThumbs.add(slideId);
  thumbQueue.push({
    presentationId,
    slideId,
    resolve: () => inflightThumbs.delete(slideId),
    reject:  () => inflightThumbs.delete(slideId)
  });
  schedule();
}
/* ---------- Email persistence ---------- */
const EMAIL_STORAGE_KEY = "trainingUserEmail";

function loadSavedEmail() {
  try { return localStorage.getItem(EMAIL_STORAGE_KEY) || ""; } catch { return ""; }
}
function saveEmailNow() {
  try {
    const v = (el.userEmail.value || "").trim();
    if (v) localStorage.setItem(EMAIL_STORAGE_KEY, v);
  } catch {}
}

// On init (after DOM + el.userEmail exists):


function schedule() {
  // fill available "slots"
  while (active < MAX_CONCURRENCY && thumbQueue.length) {
    const job = thumbQueue.shift();
    if (!job || !job.slideId) continue;

    // already cached? resolve and continue
    if (thumbnailCache.has(job.slideId)) {
      try { job.resolve?.(thumbnailCache.get(job.slideId)); } finally { inflightThumbs.delete(job.slideId); }
      continue;
    }

    active++;
    runThumbJob(job)
      .catch(e => {
        // error handling inside runThumbJob decides requeue/backoff
        console.warn("thumb job failed:", e?.message || e);
      })
      .finally(() => {
        active--;
        // small pacing delay to prevent burst → 429
        setTimeout(schedule, thumbDelayMs);
      });
  }
}
async function runThumbJob({ presentationId, slideId, resolve, reject }) {
  try {
    const data = await jsonp(GAS_ENDPOINT, {
      mode: "thumbnailData",
      presentationId,
      pageObjectId: slideId
    });
    if (!data || data.ok !== true || !data.dataUrl) {
      throw new Error((data && data.error) || "No dataUrl");
    }

    // cache and resolve
    thumbnailCache.set(slideId, data.dataUrl);
    resolve?.(data.dataUrl);

    // if current slide, re-render to swap in image
    if (state.slides[state.i]?.objectId === slideId) {
      state.slides[state.i].thumbUrl = data.dataUrl;
      render();
    }

    // success: clear per-slide backoff
    backoffBySlide.delete(slideId);
  } catch (err) {
    const msg = String(err?.message || "");
    const isQuota = /quota|rate|429|RESOURCE_EXHAUSTED/i.test(msg);
    if (isQuota) {
      // exponential backoff for this slide
      const prev = backoffBySlide.get(slideId) ?? BASE_BACKOFF;
      const next = Math.min(MAX_BACKOFF, Math.max(BASE_BACKOFF, Math.round(prev * 1.5)));
      backoffBySlide.set(slideId, next);

      // raise global pacing slightly and requeue
      thumbDelayMs = Math.max(thumbDelayMs, next);
      thumbQueue.push({ presentationId, slideId, resolve, reject });
    } else {
      // hard error -> bubble to caller
      reject?.(err);
      inflightThumbs.delete(slideId);
    }
  }
}

function enqueueThumb(presentationId, slideId, { force = false } = {}) {
  // If we already have it cached, no need to queue
  if (!force && thumbnailCache.has(slideId)) return;
  // Avoid duplicate queued entries for same (pid, slideId)
  const exists = thumbQueue.some(q => q.presentationId === presentationId && q.slideId === slideId);
  if (!exists) {
    thumbQueue.push({ presentationId, slideId });
    schedule();
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
    window[cb] = (data) => { if (!done) { done = true; cleanup(); resolve(data); } };
    tag.onerror = () => { if (!done) { done = true; cleanup(); reject(new Error("JSONP network error")); } };
    document.head.appendChild(tag);

    function cleanup() { delete window[cb]; tag.remove(); }
  });
}


function fetchSlideThumbnailThrottled(presentationId, slideId) {
  if (thumbnailCache.has(slideId)) {
    return Promise.resolve(thumbnailCache.get(slideId));
  }
  return new Promise((resolve, reject) => {
    // avoid duplicate queue entries (but still attach resolvers)
    const exists = thumbQueue.some(j => j.slideId === slideId);
    thumbQueue.push({ presentationId, slideId, resolve, reject });
    if (!exists) inflightThumbs.add(slideId);
    schedule();
  });
}

function processThumbQueue() {
  if (thumbBusy || thumbQueue.length === 0) return;
  thumbBusy = true;

  const { presentationId, slideId, resolve, reject } = thumbQueue.shift();
  const onResolve = typeof resolve === "function" ? resolve : () => {};
  const onReject  = typeof reject  === "function" ? reject  : (e) => console.warn("thumb error (no consumer)", e);

  jsonp(GAS_ENDPOINT, {
    mode: "thumbnailData",           // <— IMPORTANT: ask for data URL
    presentationId: presentationId,
    pageObjectId: slideId
  })
  .then(data => {
    if (!data || data.ok !== true || !data.dataUrl) throw new Error((data && data.error) || "No dataUrl");
    thumbnailCache.set(slideId, data.dataUrl);
    onResolve(data.dataUrl);

    // if current slide, re-render to show the image
    if (state.slides[state.i] && state.slides[state.i].objectId === slideId) {
      state.slides[state.i].thumbUrl = data.dataUrl;
      render();
    }
  })
  .catch(err => {
    const msg = String(err && err.message || "");
    if (/quota|rate|429|RESOURCE_EXHAUSTED/i.test(msg)) {
      thumbDelayMs = Math.min(MAX_BACKOFF, Math.max(BASE_BACKOFF, Math.round(thumbDelayMs * 1.5)));
      thumbQueue.push({ presentationId, slideId, resolve: onResolve, reject: onReject });
      console.warn("Quota/backoff ->", thumbDelayMs, "ms");
    } else {
      onReject(err);
    }
  })
  .finally(() => {
    thumbBusy = false;
    setTimeout(schedule, thumbDelayMs);
  });
}

/* ---------- Quiz mapping (now full 10 Qs; slide 1..10) ---------- */
const QUIZ_BY_INDEX = {
  // 0 is your intro/title slide; no question there.
  1: {
    questionId: "q1_backcharge",
    question: "Q1: What field in Airtable is used to store whether a record is Approved or Disputed?",
    options: ["Job Name","Approved or Dispute","Vendor Amount to Backcharge","Field Technician"],
    correct: "Approved or Dispute",
    required: true
  },
  2: {
    questionId: "q2_backcharge",
    question: "Q2: What happens in the app when you swipe a card to the right?",
    options: ["It deletes the record","It opens the photo modal","It marks the record as Approved","It marks the record as Disputed"],
    correct: "It marks the record as Approved",
    required: true
  },
  3: {
    questionId: "q3_backcharge",
    question: "Q3: Which field links the record to the subcontractor responsible for the backcharge?",
    options: ["Customer","Subcontractor to Backcharge","Vendor Brick and Mortar Location","Reason for Builder Backcharge"],
    correct: "Subcontractor to Backcharge",
    required: true
  },
  4: {
    questionId: "q4_backcharge",
    question: "Q4: Where are uploaded photos stored after being added in the app?",
    options: ["Only in the browser cache","Airtable “Photos” field + Dropbox","A Google Drive folder","Email attachments"],
    correct: "Airtable “Photos” field + Dropbox",
    required: true
  },
  5: {
    questionId: "q5_backcharge",
    question: "Q5: Swiping a card to the left in the review screen will…",
    options: ["Approve the backcharge","Dispute the backcharge","Archive the record","Refresh the page"],
    correct: "Dispute the backcharge",
    required: true
  },
  6: {
    questionId: "q6_backcharge",
    question: "Q6: Which Airtable field is used in the app to filter jobs by location?",
    options: ["Vanir Branch","Job Name","Customer","GM/ACM Outcome"],
    correct: "Vanir Branch",
    required: true
  },
  7: {
    questionId: "q7_backcharge",
    question: "Q7: Which field identifies whether a record is Builder Issued or Vendor Issued?",
    options: ["Type of Backcharge","Builder Backcharged Amount","Secondary Subcontractor to Backcharge","Photos"],
    correct: "Type of Backcharge",
    required: true
  },
  8: {
    questionId: "q8_backcharge",
    question: "Q8: What is the difference between “Sub Backcharge Amount” and “Vendor Amount to Backcharge”?",
    options: ["They are the same","Sub applies to subcontractors; Vendor applies to vendors","Sub applies only to approved records; Vendor to disputed","Sub is numeric, Vendor is text"],
    correct: "Sub applies to subcontractors; Vendor applies to vendors",
    required: true
  },
  9: {
    questionId: "q9_backcharge",
    question: "Q9: Which Airtable field links back to the vendor being backcharged?",
    options: ["Vendor to Backcharge (or Vendor Brick and Mortar Location)","Customer","Job Name","Approved or Dispute"],
    correct: "Vendor to Backcharge (or Vendor Brick and Mortar Location)",
    required: true
  },
  10: {
    questionId: "q10_backcharge",
    question: "Q10: Which calculated field can be added to see the combined backcharge amount for Builder, Subcontractor, and Vendor?",
    options: ["Job Name","Total Backcharge Amount","Reason for Builder Backcharge","GM/ACM Outcome"],
    correct: "Total Backcharge Amount",
    required: true
  }
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
/* ---------- Always advance to the next quiz index ---------- */
function computeNextIndexByResult(currentIndex /*, isCorrect*/) {

  const keys = Object.keys(QUIZ_BY_INDEX).map(k => +k).sort((a,b)=>a-b);
  const nextKey = keys.find(k => k > currentIndex);
  return (typeof nextKey === "number") ? nextKey : (currentIndex + 1);
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

const ahead = Math.min(state.slides.length, state.i + 10);
for (let k = state.i; k < ahead; k++) queueThumb(state.presentationId, state.slides[k].objectId);
schedule();

    schedule();
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
function cacheKey(pid, sid) { return `thumb:${pid}:${sid}`; }
function getCached(pid, sid) {
  const k = cacheKey(pid, sid);
  return thumbnailCache.get(sid) || localStorage.getItem(k) || "";
}
function setCached(pid, sid, dataUrl) {
  thumbnailCache.set(sid, dataUrl);
  try { localStorage.setItem(cacheKey(pid, sid), dataUrl); } catch {}
}

/* ---------- Rendering (on-demand thumbnails) ---------- */
function render() {
  const total = state.slides.length;
  const i = clamp(state.i, 0, Math.max(0, total - 1));
  state.i = i;

  // controls / progress
  if (!total) {
    el.stage.innerHTML = `<div class="muted">No thumbnails available.</div>`;
    el.prevBtn.disabled = true;
    el.nextBtn.disabled = true;
    el.counter.textContent = "0 / 0";
    el.bar.style.width = "0%";
    renderQuiz(null);
    return;
  }
  el.prevBtn.disabled = (i <= 0);
  el.nextBtn.disabled = (i >= total - 1);
  el.counter.textContent = `${i + 1} / ${total}`;
  el.bar.style.width = Math.round(((i + 1) / total) * 100) + "%";

  // ✅ define s BEFORE using it anywhere
  const s = state.slides[i];

  // prefer cached → already-fetched url → else load
  const cached = thumbnailCache.get(s.objectId);
  const src = cached || s.thumbUrl || "";

  if (src) {
    el.stage.innerHTML = `<img alt="${esc(s.title)}" decoding="async" src="${src}" />`;
  } else {
    el.stage.innerHTML = `<div class="muted">Loading thumbnail...</div>`;

    // SIMPLE path (works with your current GAS):
    fetchSlideThumbnailThrottled(state.presentationId, s.objectId)
      .then((url) => {
        s.thumbUrl = url;
        if (state.slides[state.i]?.objectId === s.objectId) {
          el.stage.innerHTML = `<img alt="${esc(s.title)}" decoding="async" src="${url}" />`;
        }
      })
      .catch((e) => console.warn("Thumb fetch failed", s.objectId, e));

    // OPTIONAL LQIP path (only if your GAS recognizes ":small"/":large"):
    
    fetchSlideThumbnailThrottled(state.presentationId, s.objectId + ":small")
      .then(urlSmall => {
        if (state.slides[state.i]?.objectId === s.objectId) {
          el.stage.innerHTML = `<img alt="${esc(s.title)}" decoding="async" src="${urlSmall}" />`;
        }
      })
      .catch(()=>{});
    fetchSlideThumbnailThrottled(state.presentationId, s.objectId + ":large")
      .then(urlLarge => {
        s.thumbUrl = urlLarge;
        if (state.slides[state.i]?.objectId === s.objectId) {
          el.stage.innerHTML = `<img alt="${esc(s.title)}" decoding="async" src="${urlLarge}" />`;
        }
      })
      .catch(e => console.warn("Thumb fetch failed", s.objectId, e));
    
  }

  renderQuiz(QUIZ_BY_INDEX[i] || null);

  // 🔮 Predictive prefetch: next few slides
  for (let k = state.i + 1; k <= state.i + 4 && k < state.slides.length; k++) {
    queueThumb(state.presentationId, state.slides[k].objectId);
  }
}


// Optional: if you still want to explicitly queue from render()
const inflightThumbs = new Set();
function queueThumb(presentationId, slideId) {
  if (thumbnailCache.has(slideId) || inflightThumbs.has(slideId)) return;
  inflightThumbs.add(slideId);
  thumbQueue.push({
    presentationId,
    slideId,
    resolve: () => inflightThumbs.delete(slideId),
    reject:  () => inflightThumbs.delete(slideId)
  });
  schedule();
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
  const targetIndex = computeNextIndexByResult(state.i, isCorrect);

setTimeout(() => {
  if (typeof targetIndex === "number" && !Number.isNaN(targetIndex)) {
    state.i = clamp(targetIndex, 0, state.slides.length - 1);
    render();
  } else {
    go(+1);
  }
}, 250);
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

  let savedOk = false;
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
      savedOk = true;
    } else {
      const r = await fetch(AIRTABLE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error("Webhook failed: " + r.status);
      savedOk = true;
    }
  } catch (err) {
    console.error(err);
    pulse("Save failed. " + (err && err.message ? err.message : ""), "bad");
  } finally {
    // Always show feedback, then advance regardless of correctness
    if (savedOk) {
      pulse(isCorrect ? "Saved ✓ (correct)" : "Saved ✓ (try again next time)", isCorrect ? "ok" : "");
    }
    const isLast = state.i >= state.slides.length - 1;
    if (isLast) {
      // End of deck
      setTimeout(() => {
        pulse("Training complete. Great job!", "ok");
      }, 200);
    } else {
      // Auto-advance even if the answer was wrong
      setTimeout(() => go(+1), 250);
    }
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
(function initEmailPersistence(){
  const saved = loadSavedEmail();
  if (saved && el.userEmail) el.userEmail.value = saved;

  if (el.userEmail) {
    el.userEmail.addEventListener("change", saveEmailNow);
    el.userEmail.addEventListener("blur", saveEmailNow);
    el.userEmail.addEventListener("input", () => {
      clearTimeout(initEmailPersistence._t);
      initEmailPersistence._t = setTimeout(saveEmailNow, 300);
    });
  }
})();