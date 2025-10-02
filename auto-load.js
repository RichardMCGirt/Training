// auto-load.js (verbose logging edition)
// Fills the Slides ID and triggers the same flow you proved in console.
// Safe against early execution (waits for DOM + elements). No other dependencies.

(function(){
  "use strict";

  /***********************
   * CONFIG + DEBUG TOOLS
   ***********************/
  const SLIDES_ID = "1lsNam3OMuol_lxdplqXKQJ57D8m2ZHUaGxdmdx2uwEQ";
  // Flip this to true to always log; or call window.setAutoLoadDebug(true)
  let DEBUG = true;
  const TAG = "[auto-load]";

  // Lightweight logger with a consistent prefix + timestamp
  function ts(){ return new Date().toISOString().replace("T"," ").replace("Z",""); }
  function log(...a){ if (DEBUG) console.log(TAG, ts(), ...a); }
  function info(...a){ if (DEBUG) console.info(TAG, ts(), ...a); }
  function warn(...a){ if (DEBUG) console.warn(TAG, ts(), ...a); }
  function error(...a){ if (DEBUG) console.error(TAG, ts(), ...a); }

  // Expose a quick toggle in console: setAutoLoadDebug(true/false)
  window.setAutoLoadDebug = function(v){ DEBUG = !!v; log("DEBUG =", DEBUG); };

  // Expose quick re-run helper in console
  window.forceSlidesLoad = async function(){
    log("forceSlidesLoad() called");
    try {
      await coreRun(/*reRun=*/true);
      log("forceSlidesLoad() completed.");
    } catch (e) {
      error("forceSlidesLoad() failed:", e);
    }
  };

  /***********************
   * ENTRY
   ***********************/
  (async function main(){
    console.groupCollapsed(`${TAG} start`);
    const t0 = performance.now();
    try {
      await coreRun(/*reRun=*/false);
      const dt = (performance.now() - t0).toFixed(1);
      info("Done in", dt, "ms");
    } catch (e) {
      error("Fatal error:", e);
    } finally {
      console.groupEnd();
    }
  })();

  /***********************
   * CORE LOGIC
   ***********************/
  async function coreRun(reRun){
    const phase = reRun ? "rerun" : "first-run";
    info(`Phase: ${phase}`);

    // 1) Wait for DOM
    if (document.readyState === "loading") {
      info("DOM not ready, waiting for DOMContentLoaded…");
      await new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true }));
      info("DOMContentLoaded fired.");
    } else {
      info("DOM already ready:", document.readyState);
    }

    // 2) Wait for elements
    const ids = ["presentationId","btnLoad"];
    const exists = () => ids.map(id => [id, document.getElementById(id)]);
    const hasAll = pairs => pairs.every(([, el]) => !!el);

    let tries = 0, got;
    const maxTries = 50, delayMs = 100;
    while (tries++ < maxTries) {
      got = exists();
      if (hasAll(got)) break;
      if (tries === 1 || tries % 10 === 0) log(`Waiting for elements… try ${tries}/${maxTries}`);
      await sleep(delayMs);
    }

    const dict = Object.fromEntries(got || []);
    const input = dict.presentationId;
    const btn   = dict.btnLoad;

    if (!input || !btn) {
      warn("Missing elements after waiting:", {
        hasInput: !!input,
        hasButton: !!btn
      });
      throw new Error("Missing #presentationId or #btnLoad");
    }
    info("Elements ready:", { input, btn });

    // 3) Fill like a real user
    try { input.focus(); } catch {}
    input.value = SLIDES_ID;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    log("Filled Slides ID.");

    // 4) Submit (prefer form.submit path), else click
    const form = input.form || document.querySelector("form");
    if (form) {
      info("Form detected. Using requestSubmit if available.", form);
      if (typeof form.requestSubmit === "function") {
        form.addEventListener("submit", submitLogger, { once: true, capture: true });
        form.requestSubmit(btn);
        log("requestSubmit() called with btn as submitter.");
      } else {
        form.addEventListener("submit", submitLogger, { once: true, capture: true });
        const ok = form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        log("Manual submit dispatch returned:", ok);
        if (ok && btn) {
          btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          log("Clicked button as fallback after submit event.");
        }
      }
    } else {
      info("No form detected. Clicking button directly.");
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      log("Dispatched MouseEvent('click') on #btnLoad.");
    }

    // 5) Optional: minimal post-check (if your app sets any known state/label)
    // Customize these selectors/texts to your app for better feedback.
    setTimeout(() => {
      const status = document.getElementById("loadStatus");
      const counter = document.getElementById("counter");
      if (status) log("loadStatus text:", status.textContent || "(empty)");
      if (counter) log("counter text:", counter.textContent || "(empty)");
    }, 600);
  }

  function submitLogger(ev){
    log("Form submit intercepted:", {
      type: ev.type,
      defaultPrevented: ev.defaultPrevented,
      target: ev.target
    });
  }

  /***********************
   * UTILS
   ***********************/
  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

})();
