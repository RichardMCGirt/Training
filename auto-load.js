

(function(){
  "use strict";

  const TAG = "[auto-load]";
  let running = false;
  let hasRunThisShow = false;
const NAV_TOKEN = (() => {
  try {
    const token = Date.now() + ":" + Math.random().toString(36).slice(2,8);
    // Store in sessionStorage; cleared on new tab/window
    sessionStorage.setItem("__auto_load_nav_token", token);
    return token;
  } catch { return "fallback"; }
})();
function getLastRunToken(){ try { return sessionStorage.getItem("__auto_load_last_run"); } catch { return ""; } }
function setLastRunToken(v){ try { sessionStorage.setItem("__auto_load_last_run", v); } catch {} }


  log("init");
  whenReady(runOnce);
  window.addEventListener("pageshow", (ev) => {
    const navEntries = performance.getEntriesByType("navigation");
    const navType = navEntries && navEntries[0] ? navEntries[0].type : "(unknown)";
    log("pageshow", { persisted: ev.persisted, navType });
    if (ev.persisted || navType === "back_forward") {
      if (!hasRunThisShow) { hasRunThisShow = true; runOnce("pageshow"); }
      else { log("pageshow ignored (already ran this show)."); }
    } else {
      hasRunThisShow = false;
    }
  });

 async function runOnce(origin="first-load"){
  if (running) { log("runOnce skipped (already running)", { origin }); return; }
  const last = getLastRunToken();
  if (last === NAV_TOKEN) { log("runOnce skipped (same nav token)", { origin }); return; }
  running = true;
  setLastRunToken(NAV_TOKEN);
    console.groupCollapsed(`${TAG} run (${origin})`);
    try {
      await ensureElements(["presentationId","btnLoad"]);
      const input = document.getElementById("presentationId");
      const btn   = document.getElementById("btnLoad");

      // 1) Resolve selected module
      const params = new URLSearchParams(location.search);
      const selectedModule = params.get("module") || localStorage.getItem("selectedModule") || "";

      // 2) If hard-coded ?presentationId=… is present, allow direct load
      const directPid = params.get("presentationId") || "";
      if (!selectedModule && directPid) {
        // optional GAS endpoint via query too
        const gasFromQuery = params.get("gas");
        if (gasFromQuery) window.GAS_ENDPOINT = gasFromQuery;
        await fillAndSubmit(input, btn, directPid);
        return;
      }

      if (!selectedModule) {
        log("No module selected and no presentationId in query; skipping auto-load.");
        return;
      }

      // 3) Lookup module config (Presentation ID + GAS URL)
      let cfg = { presentationId:"", gasUrl:"", active:false };
      if (window.trainingModules?.getConfigForModule) {
        try {
          cfg = await window.trainingModules.getConfigForModule(selectedModule);
        } catch(e){
          console.warn(TAG, "Airtable lookup failed:", e);
        }
      }

      const presId = (cfg.presentationId || "").trim();
      if (!presId) {
        console.warn(TAG, "No Presentation ID found for module:", selectedModule);
        return; // Let admin populate it
      }

      // Expose GAS endpoint globally for any code that needs it (optional)
      if (cfg.gasUrl) window.GAS_ENDPOINT = cfg.gasUrl;

      // 4) Cache-bust GAS calls automatically (safe no-op if unused)
      tryAttachCacheBuster();

      // 5) Fill and submit
      await fillAndSubmit(input, btn, presId);

      // 6) Keep the user's email in localStorage up-to-date
      const inputE = document.getElementById('userEmail');
      if (inputE) {
        const savedEmail = localStorage.getItem('trainingEmail') || localStorage.getItem('authEmail') || '';
        if (savedEmail && !inputE.value) inputE.value = savedEmail;
        inputE.addEventListener('input', () => {
          localStorage.setItem('trainingEmail', inputE.value.trim());
        });
      }
    } catch(e){
      console.error(TAG, "run failed:", e);
    } finally {
      console.groupEnd();
      running = false;
    }
  }

  async function fillAndSubmit(input, btn, presentationId){
    // Fill like a real user
    try { input.focus(); } catch {}
    input.value = presentationId;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    log("Filled Slides ID", { presentationId });

    // Prefer form submit if present; otherwise click the button
    const form = input.form || document.querySelector("form");
    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit(btn);
      log("requestSubmit() fired");
    } else if (form) {
      const ok = form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      if (ok) btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      log("submit event + click fallback fired");
    } else {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      log("direct click fired");
    }
  }

  function whenReady(fn){
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      setTimeout(fn, 0);
    }
  }

  async function ensureElements(ids, tries=60, interval=100){
    for (let i=0; i<tries; i++){
      const all = ids.map(id => document.getElementById(id));
      if (all.every(Boolean)) return;
      if (i===0 || (i+1)%10===0) log("waiting for elements…", { try: i+1 });
      await sleep(interval);
    }
    throw new Error("Required elements not found: " + ids.join(", "));
  }

  // Adds a timestamp param to GAS requests automatically (optional)
  function tryAttachCacheBuster(){
    try {
      const origFetch = window.fetch;
      if (!origFetch || origFetch.__autoLoadPatched) return;

      window.fetch = function(input, init){
        try {
          let url = (typeof input === "string") ? input : (input && input.url);
          if (typeof url === "string" && url.includes("script.google.com/macros") && url.includes("?")) {
            const sep = url.includes("_cb=") ? "" : `&${new URLSearchParams({ _cb: Date.now() }).toString()}`;
            const bumped = url + sep;
            if (typeof input === "string") input = bumped;
            else if (input && input.url) input = new Request(bumped, input);
            log("cache-bust added to GAS url");
          }
        } catch(_) {}
        return origFetch.apply(this, arguments);
      };
      window.fetch.__autoLoadPatched = true;
      log("fetch cache-buster attached");
    } catch (e) {
      // ignore
    }
  }

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
  function log(){ try { console.log(TAG, ...arguments); } catch{} }
})();

