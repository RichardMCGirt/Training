(function(){
  "use strict";

  // This helper assumes script.js has defined:
  //  - window.getOrCreateSummaryRecordId({ userEmail, presentationId, attempt })
  //  - window.aHeaders() and window.aBaseUrl() for Airtable Answers endpoint
  //  - window.state.currentAttempt and getUserEmail()          (script.js)
  //  - it emits "deck:loaded" with { id: presentationId }      (script.js)
  //
  // It stores timing on the __summary__ row:
  //   Attempt Start (ISO), Attempt End (ISO), Attempt Elapsed (ms), Attempt Segments (JSON)

  const TAG = "[attempt-timer]";
  const S = {
    presId: "",
    userEmail: "",
    attempt: 1,
    startedAt: null,         // Date
    running: false,
    // segments: [{ start: ISO, end: ISO, elapsedMs: number }]
    segments: []
  };

  function log(){ try{ console.log(TAG, ...arguments);}catch{} }

  function nowIso(){ return new Date().toISOString(); }
  function msBetween(a,b){ return Math.max(0, (new Date(b)).getTime() - (new Date(a)).getTime()); }

  function haveDeps(){
    return typeof window.getOrCreateSummaryRecordId === "function"
        && typeof window.aHeaders === "function"
        && typeof window.aBaseUrl === "function"
        && typeof window.state === "object"
        && typeof window.getUserEmail === "function";
  }

  function resetTimer(){
    S.startedAt = null;
    S.running = false;
    S.segments = [];
  }

  // ---------- public-ish helpers ----------
  async function attachAndStart(presId){
    if (!haveDeps()){ log("Missing script.js helpers; timer disabled."); return; }

    S.presId = String(presId||"");
    S.userEmail = String(window.getUserEmail?.() || "");
    S.attempt = Number(window.state?.currentAttempt || 1) || 1;

    if (!S.presId || !S.userEmail){
      log("No presentationId or userEmail; timer not started.");
      return;
    }

    // Start a new segment immediately
    startSegment();

    // Pause/resume with page visibility
    document.addEventListener("visibilitychange", onVisibility, { passive:true });

    // Stop on unload (best-effort save)
    window.addEventListener("beforeunload", stopAndSaveSync);

    // Watch for completion UI (#retryRow changing display to flex)
    try { watchForCompletionRow(); } catch {}

    log("Timer attached for", { presId: S.presId, userEmail: S.userEmail, attempt: S.attempt });
  }

  function startSegment(){
    if (S.running) return;
    S.startedAt = new Date();
    S.running = true;
    log("segment started", S.startedAt.toISOString());
  }

  function stopSegment(){
    if (!S.running || !S.startedAt) return;
    const end = new Date();
    const seg = {
      start: S.startedAt.toISOString(),
      end: end.toISOString(),
      elapsedMs: end.getTime() - S.startedAt.getTime()
    };
    S.segments.push(seg);
    S.running = false;
    S.startedAt = null;
    log("segment stopped", seg);
  }

  function onVisibility(){
    if (document.visibilityState === "hidden") {
      stopSegment();
      // do not save yet; user may come back
    } else if (document.visibilityState === "visible") {
      startSegment();
    }
  }

  async function watchForCompletionRow(){
    const target = document.getElementById("retryRow");
    if (!target) return;
    const mo = new MutationObserver(() => {
      const styles = window.getComputedStyle(target);
      if (styles && (styles.display === "flex" || styles.display === "block")) {
        // Consider module complete
        stopAndSave(); // async
        mo.disconnect();
      }
    });
    mo.observe(target, { attributes: true, attributeFilter: ["style", "class"] });
  }

  // ---------- Airtable patch on summary row ----------
  async function saveSummary(){
    if (!S.presId || !S.userEmail) return;

    // Attempt End = now; include any open segment
    if (S.running) stopSegment();

    const attemptEndIso = nowIso();
    const totalMs = S.segments.reduce((sum, s) => sum + Math.max(0, s.elapsedMs||0), 0);
    const segJson = JSON.stringify(S.segments);

    const id = await window.getOrCreateSummaryRecordId({
      userEmail: S.userEmail,
      presentationId: S.presId,
      attempt: S.attempt
    });

    const fields = {
      "Attempt End": attemptEndIso,
      "Attempt Elapsed (ms)": totalMs,
      "Attempt Segments (JSON)": segJson
    };

    // Attempt Start: use the first segment start if present
    const firstStart = S.segments.length ? S.segments[0].start : null;
    if (firstStart) fields["Attempt Start"] = firstStart;

    const res = await fetch(window.aBaseUrl(), {
      method: "PATCH",
      headers: window.aHeaders(),
      body: JSON.stringify({ records: [{ id, fields }] })
    });
    if (!res.ok){
      const body = await res.text().catch(()=>"(no body)");
      console.warn(TAG, "Summary patch failed", res.status, body);
    } else {
      log("Summary patched", { id, totalMs, segments: S.segments.length });
    }
  }

  async function stopAndSave(){
    try {
      stopSegment();
      await saveSummary();
    } catch(e){
      console.warn(TAG, "stopAndSave failed", e);
    } finally {
      resetTimer();
    }
  }

  // best-effort synchronous-ish save on unload
  function stopAndSaveSync(){
    try {
      stopSegment();
      const attemptEndIso = nowIso();
      const totalMs = S.segments.reduce((sum, s) => sum + Math.max(0, s.elapsedMs||0), 0);
      const segJson = JSON.stringify(S.segments);

      // We can’t await network here. Use sendBeacon if available.
      const idKey = "__attempt_timer_summary_id";
      const key = `${S.userEmail}|${S.presId}|${S.attempt}`;
      let summaryId = sessionStorage.getItem(idKey+key) || "";

      // Fire-and-forget: if we don’t know the summary id, we can’t create it synchronously.
      // Rely on regular save during normal completion; unload is just a fallback.
      if (!summaryId) return;

      const payload = {
        records: [{
          id: summaryId,
          fields: {
            "Attempt End": attemptEndIso,
            "Attempt Elapsed (ms)": totalMs,
            "Attempt Segments (JSON)": segJson,
            "Attempt Start": (S.segments[0] && S.segments[0].start) || null
          }
        }]
      };

      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      navigator.sendBeacon?.(window.aBaseUrl(), blob);
    } catch(_) {}
  }

  // optional: let script.js call this if it knows the “end”
  window.markAttemptComplete = stopAndSave;

  // Auto-start when your deck is ready
  document.addEventListener("deck:loaded", async (ev) => {
    const id = String(ev?.detail?.id || "");
    try {
      await attachAndStart(id);
    } catch(e){
      console.warn(TAG, "attach failed", e);
    }
  });

})();

