// ===== question-timer.js =====
// Per-question timing + save to Airtable "Question Timings" long text field.
// Requires: window.state, window.getUserEmail, window.getOrCreateSummaryRecordId,
//           window.aBaseUrl(), window.aHeaders().
// Works by wrapping submitAnswer() and listening for deck/question changes.

(function(){
  // --- Guard for required deps
  function need(fn, name){ if (!fn) throw new Error("[question-timer] missing " + name); }
  need(window, "window");
  need(window.state, "window.state");
  need(window.getUserEmail, "getUserEmail");
  need(window.getOrCreateSummaryRecordId, "getOrCreateSummaryRecordId");
  need(window.aBaseUrl, "aBaseUrl");   // function in your app
  need(window.aHeaders, "aHeaders");   // function in your app

  // Helpers to access current quiz/question safely
  function currentQuiz(){
    try {
      if (typeof window.currentQuizForIndex === "function") {
        return window.currentQuizForIndex(window.state.i);
      }
      // Fallback: if you keep questions in state.quizzes
      const qs = Array.isArray(window.state.quizzes) ? window.state.quizzes : null;
      return qs ? qs[window.state.i] : null;
    } catch(_) { return null; }
  }
  function questionIdOf(q){
    if (!q) return "";
    // Try common identifiers in your app
    return String(q.id ?? q.quizId ?? q.qid ?? q.key ?? q.question ?? q.title ?? window.state.i);
  }

  // Storage for timings (not persisted until save)
  const QT = {
    active: null,            // { index, qid, tsStart }
    entries: [],             // { index, qid, startedAt, endedAt, elapsedMs }
    startedAtDeck: null,     // for context
    summaryRecordId: null,   // Airtable summary row id
    fieldName: "Question Timings", // change if you prefer a different field
  };

  // Start timing current question
  function startQuestionTimer(reason){
    // Finish previous if somehow still open
    stopQuestionTimer("[auto-close-before-start]");

    const q = currentQuiz();
    const idx = Number(window.state.i || 0);
    const qid = questionIdOf(q);
    QT.active = { index: idx, qid, tsStart: Date.now(), reason: reason || "start" };
    // console.debug("[question-timer] start", QT.active);
  }

  // Stop timing and push an entry
  function stopQuestionTimer(reason){
    if (!QT.active) return;
    const now = Date.now();
    const elapsed = Math.max(0, now - QT.active.tsStart);
    const entry = {
      index: QT.active.index,
      qid: QT.active.qid,
      startedAt: new Date(QT.active.tsStart).toISOString(),
      endedAt: new Date(now).toISOString(),
      elapsedMs: elapsed,
      stopReason: reason || "stop"
    };
    QT.entries.push(entry);
    // console.debug("[question-timer] stop", entry);
    QT.active = null;
  }

  // Build JSON Lines (each line one JSON object) for the field
  function toJsonLines(entries){
    return (entries || []).map(e => JSON.stringify(e)).join("\n");
  }

  // Ensure we have the summary record id used for attempts
  async function ensureSummaryRecordId(){
    if (QT.summaryRecordId) return QT.summaryRecordId;

    const email = (window.getUserEmail && window.getUserEmail()) || "";
    const presId =
      (window.state && (window.state.presentationId || window.state.id || window.state.currentDeckId)) || "";
    const attempt = Number(window.state?.currentAttempt || 1) || 1;
    if (!email || !presId) throw new Error("[question-timer] missing email or presentation id");

    // ❗ FIX 1: pass an OBJECT { userEmail, presentationId, attempt }
    QT.summaryRecordId = await window.getOrCreateSummaryRecordId({
      userEmail: email,
      presentationId: presId,
      attempt
    });
    return QT.summaryRecordId;
  }

  // Save entries to Airtable long text field "Question Timings"
  async function saveQuestionTimings(reason){
    // Close any active question timer first so we don't lose the current question time
    stopQuestionTimer(reason || "save");

    // Nothing to save? bail quietly
    if (!QT.entries.length) return false;

    const recId = await ensureSummaryRecordId();

    // ❗ FIX 2: call aBaseUrl() and aHeaders()
    const url = String(window.aBaseUrl()) + "/" + encodeURIComponent(recId);
    const body = {
      fields: {}
    };
    body.fields[QT.fieldName] = toJsonLines(QT.entries);

    // PATCH
    const res = await fetch(url, {
      method: "PATCH",
      headers: window.aHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text().catch(()=>String(res.status));
      console.warn("[question-timer] save failed", res.status, txt);
      return false;
    }
    // console.debug("[question-timer] save OK, entries:", QT.entries.length);
    return true;
  }

  // Public controls (optional)
  window.qTimer = {
    startQuestionTimer,
    stopQuestionTimer,
    saveQuestionTimings,
    _state: QT
  };

  // ---- Wiring: deck load, question flow, submit flow, and exit hooks ----

  // When a deck loads, remember a deck start, clear previous entries, and start timing Q0
  document.addEventListener("deck:loaded", () => {
    QT.entries = [];
    QT.active = null;
    QT.summaryRecordId = null; // let ensureSummaryRecordId re-resolve for new deck
    QT.startedAtDeck = Date.now();
    // Give your app a tick to render the first question
    setTimeout(() => startQuestionTimer("deck-loaded"), 50);
  });

  // Wrap submitAnswer() so we stop the current question when user submits,
  // then auto-start timing for the next question (after your app advances index)
  (function wrapSubmit(){
    if (typeof window.submitAnswer !== "function") return; // if not global, skip
    const _submit = window.submitAnswer;
    window.submitAnswer = async function wrappedSubmitAnswer(){
      // User is submitting answer for current question
      stopQuestionTimer("submit");

      // Let original logic run (likely advances state.i)
      const ret = await _submit.apply(this, arguments);

      // Start next question timer after UI updates
      setTimeout(() => startQuestionTimer("after-submit"), 50);
      return ret;
    };
  })();

  // If your app has explicit next/prev handlers, you can optionally wrap them too:
  /*
  (function wrapNav(){
    if (typeof window.gotoNext === "function") {
      const _next = window.gotoNext;
      window.gotoNext = function(){
        stopQuestionTimer("next");
        const r = _next.apply(this, arguments);
        setTimeout(() => startQuestionTimer("after-next"), 50);
        return r;
      };
    }
    if (typeof window.gotoPrev === "function") {
      const _prev = window.gotoPrev;
      window.gotoPrev = function(){
        stopQuestionTimer("prev");
        const r = _prev.apply(this, arguments);
        setTimeout(() => startQuestionTimer("after-prev"), 50);
        return r;
      };
    }
  })();
  */

  // Save timings along with your existing “exit” hooks
  function exitSave(label){
    // Fire and forget; we can’t await during unload reliably
    try { saveQuestionTimings(label); } catch(_) {}
  }
  window.addEventListener("pagehide", () => exitSave("pagehide"));
  window.addEventListener("beforeunload", () => exitSave("beforeunload"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") exitSave("visibility-hidden");
  }, { passive: true });
  window.addEventListener("freeze", () => exitSave("freeze"));

})();
