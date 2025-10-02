// auto-load.js (BFCache + cache-bust + idempotent)
// Fills the Slides ID and triggers the same flow you proved in console.

(function(){
  "use strict";

  const SLIDES_ID = "1lsNam3OMuol_lxdplqXKQJ57D8m2ZHUaGxdmdx2uwEQ";
  const TAG = "[auto-load]";
  let running = false;                 // prevents re-entrancy while in-flight
  let hasRunThisShow = false;          // prevents double-run per pageshow

  log("init");

  // 1) Run on first parse
  whenReady(runOnce);

  // 2) ALSO run on BFCache restores (e.g., back button, history nav)
  window.addEventListener("pageshow", (ev) => {
    const navEntries = performance.getEntriesByType("navigation");
    const navType = navEntries && navEntries[0] ? navEntries[0].type : "(unknown)";
    log("pageshow", { persisted: ev.persisted, navType });

    // some browsers set persisted=true; others report navType "back_forward"
    if (ev.persisted || navType === "back_forward") {
      if (!hasRunThisShow) {
        hasRunThisShow = true;
        runOnce("pageshow");
      } else {
        log("pageshow ignored (already ran this show).");
      }
    } else {
      hasRunThisShow = false; // normal navigation; allow future run
    }
  });

  // Optional: console helper to force a re-run
  window.forceSlidesLoad = () => runOnce("manual");

  async function runOnce(origin="first-load"){
    if (running) { log("runOnce skipped (already running)", { origin }); return; }
    running = true;
    console.groupCollapsed(`${TAG} run (${origin})`);
    try {
      // If your app constructs the GAS URL using a global, monkey-patch a cache-bust hook.
      // (Safe no-op if not present.)
      tryAttachCacheBuster();

      // Wait for DOM + elements (handles SPA-delayed DOM as well)
      await ensureElements(["presentationId","btnLoad"]);
      const input = document.getElementById("presentationId");
      const btn   = document.getElementById("btnLoad");

      // Fill like a real user
      try { input.focus(); } catch {}
      input.value = SLIDES_ID;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      log("Filled Slides ID");

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
    } catch (e) {
      console.error(TAG, "run failed:", e);
    } finally {
      console.groupEnd();
      running = false;
    }
  }

  function whenReady(fn){
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      // Even if DOM is "complete", SPAs may still be hydrating—delay a tick
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

  // Adds a timestamp param to GAS requests if your app exposes a builder.
  // If not applicable, harmlessly does nothing.
  function tryAttachCacheBuster(){
    // Example: if your app uses a global GAS_ENDPOINT variable and fetches like:
    // fetch(`${GAS_ENDPOINT}?presentationId=...&size=LARGE`)
    // this override adds &_cb=TIMESTAMP automatically.
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
  function log(msg, extra){ try{ console.log(TAG, msg, extra||""); }catch{} }

})();
