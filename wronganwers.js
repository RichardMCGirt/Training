/* eslint-disable no-console */
(function(){
  "use strict";

  // --- Pull current user email the same way index.html/script.js do ---
  function getUserEmail(){
    try {
      const a = localStorage.getItem("trainingEmail") || localStorage.getItem("authEmail") || "";
      return String(a||"").trim();
    } catch { return ""; }
  }

  // --- Simple esc helpers (match style from your codebase) ---
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]); }
  function att(s){ return String(s==null?"":s).replace(/"/g, "&quot;"); }

  const AIR = {
    API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
    BASE_ID: "app3rkuurlsNa7ZdQ",
    ANSWERS_TABLE_ID: "tblkz5HyZGpgO093S"
  };

  function aHeaders(){
    return {
      Authorization: `Bearer ${AIR.API_KEY}`,
      "Content-Type": "application/json"
    };
  }
  function aBaseUrl(){
    return `https://api.airtable.com/v0/${AIR.BASE_ID}/${encodeURIComponent(AIR.ANSWERS_TABLE_ID)}`;
  }

  // --- DOM ---
  const dom = {
    hello: document.getElementById("hello"),
    toggle: document.getElementById("toggleMistakes"),
    modulesCard: document.getElementById("modulesCard"),
    modulesListCard: document.getElementById("modulesListCard"),
    mistakesCard: document.getElementById("mistakesCard"),
    mistakesSearch: document.getElementById("mistakesSearch"),
    btnReloadMistakes: document.getElementById("btnReloadMistakes"),
    mistakesSummary: document.getElementById("mistakesSummary"),
    mistakesList: document.getElementById("mistakesList"),
    search: document.getElementById("search"),
    btnRefresh: document.getElementById("btnRefresh"),
    list: document.getElementById("list")
  };

  // Greet
  try { if (dom.hello) dom.hello.textContent = getUserEmail() || "(not signed in)"; } catch {}

  // --- Build a map PresentationId -> Module using your modules.js helpers ---
  // modules.js exposes window.trainingModules.listMappings(), which returns the
  // raw Airtable rows with fields like "Module" and "Presentation ID".
  // We'll read those to map decks to module names.
  // (This mirrors how your admin UI renders mapping rows.)  :contentReference[oaicite:6]{index=6}
  let pidToModule = {};
  async function buildPidMap(){
    pidToModule = {};
    try {
      if (!window.trainingModules || !window.trainingModules.listMappings) return;
      const rows = await window.trainingModules.listMappings({ activeOnly: false });
      for (const r of (rows||[])){
        const f = r.fields || {};
        const mod = String(f["Module"]||"").trim();
        const pid = String(f["Presentation ID"]||f["PresentationId"]||"").trim();
        if (pid) pidToModule[pid] = mod || "";
      }
    } catch (e){
      console.warn("[dashboard] buildPidMap failed", e);
    }
  }

  // --- Fetch ALL wrong answers for this user, latest attempt for each (PresentationId, QuestionId) ---
  async function fetchWrongAnswersLatestByQuestion(){
    const email = getUserEmail();
    if (!email) return [];

    // Step 1: fetch all rows for the user (paged)
    let all = [];
    let offset;
    const e = s => String(s||"").replace(/'/g, "\\'");
    do {
      const url = new URL(aBaseUrl());
      url.searchParams.set("pageSize","100");
      url.searchParams.set("filterByFormula", `{UserEmail}='${e(email)}'`);
      if (offset) url.searchParams.set("offset", offset);

      const res = await fetch(url.toString(), { headers: aHeaders() });
      if (!res.ok) throw new Error(`Answers fetch failed: ${res.status} ${await res.text().catch(()=>"(no body)")}`);
      const data = await res.json();
      all = all.concat(data.records||[]);
      offset = data.offset;
    } while(offset);

    // Step 2: group by (PresentationId, QuestionId), keep row with highest Attempt;
    // after that, filter to only WRONG (IsCorrect false)
    const byKey = new Map();
    for (const r of all){
      const f = r.fields || {};
      const pid = String(f.PresentationId||"").trim();
      const qid = String(f.QuestionId||"").trim();
      const attempt = Number(f.Attempt||1);
      if (!pid || !qid) continue;
      const key = pid+"||"+qid;
      const prev = byKey.get(key);
      if (!prev || attempt > prev.attempt){
        byKey.set(key, {
          id: r.id,
          pid,
          qid,
          attempt,
          question: String(f.Question||""),
          answer: String(f.Answer||""),
          correctAnswer: String(f["Correct Answer"]||""),
          wrongAttempts: Number(f["Wrong Attempts"]||0),
          isCorrect: !!f.IsCorrect,
          timestamp: f.Timestamp || ""
        });
      }
    }

    // Only wrong
    const latestWrong = Array.from(byKey.values()).filter(x => !x.isCorrect);

    // Sort newest first by timestamp (fallback by attempt)
    latestWrong.sort((a,b)=>{
      const ta = Date.parse(a.timestamp||"") || 0;
      const tb = Date.parse(b.timestamp||"") || 0;
      if (tb !== ta) return tb - ta;
      return (b.attempt||0) - (a.attempt||0);
    });

    return latestWrong;
  }

  // --- Render mistakes into cards with a "Review" button that deep-links to index.html ---
  function renderMistakes(items, filter=""){
    const q = String(filter||"").toLowerCase().trim();
    const rows = items.filter(it=>{
      if (!q) return true;
      const mod = String(pidToModule[it.pid]||"").toLowerCase();
      const txt = String(it.question||"").toLowerCase();
      return mod.includes(q) || txt.includes(q);
    });

    if (dom.mistakesSummary){
      dom.mistakesSummary.textContent = rows.length
        ? `Showing ${rows.length} wrong question${rows.length===1?"":"s"} (latest attempt per question).`
        : `No wrong questions found for your latest attempts.`;
    }

    if (!dom.mistakesList) return;
    if (!rows.length){
      dom.mistakesList.innerHTML = `<div class="muted">Nothing to show.</div>`;
      return;
    }

    dom.mistakesList.innerHTML = rows.map(it=>{
      const moduleName = pidToModule[it.pid] || "(Unknown module)";
      const ts = it.timestamp ? new Date(it.timestamp).toLocaleString() : "";
      const reviewHref = `index.html?presentationId=${encodeURIComponent(it.pid)}&reset=1`;

      return `
        <div class="mistake">
          <div class="title">${esc(moduleName)}</div>
          <div class="meta">
            Attempt #${it.attempt}${ts ? ` • ${esc(ts)}` : ""}${it.wrongAttempts ? ` • <span class="badge">${it.wrongAttempts} wrong tries</span>` : ""}
          </div>
          <div class="q">${esc(it.question)}</div>
          <div class="ans">
            <div><strong>Your last answer:</strong> ${esc(it.answer||"(blank)")}</div>
            ${it.correctAnswer ? `<div class="muted"><strong>Correct answer:</strong> ${esc(it.correctAnswer)}</div>` : ""}
          </div>
          <div class="btn-row">
            <a class="btn" href="${att(reviewHref)}">Review this deck</a>
          </div>
        </div>
      `;
    }).join("");
  }

  // --- Toggle wiring ---
  async function showMistakes(){
    if (dom.modulesCard) dom.modulesCard.style.display = "none";
    if (dom.modulesListCard) dom.modulesListCard.style.display = "none";
    if (dom.mistakesCard) dom.mistakesCard.style.display = "block";

    // Build PID map (module names) then fetch wrongs
    await buildPidMap();
    const items = await fetchWrongAnswersLatestByQuestion();
    renderMistakes(items, dom.mistakesSearch?.value||"");

    // cache
    window.___mistakesCache = items;
  }

  function showModules(){
    if (dom.modulesCard) dom.modulesCard.style.display = "block";
    if (dom.modulesListCard) dom.modulesListCard.style.display = "block";
    if (dom.mistakesCard) dom.mistakesCard.style.display = "none";
  }

  // --- Events ---
  if (dom.toggle){
    dom.toggle.addEventListener("change", async () => {
      if (dom.toggle.checked) { await showMistakes(); }
      else { showModules(); }
    });
  }
  if (dom.btnReloadMistakes){
    dom.btnReloadMistakes.addEventListener("click", async ()=>{
      await showMistakes();
    });
  }
  if (dom.mistakesSearch){
    dom.mistakesSearch.addEventListener("input", ()=>{
      const items = window.___mistakesCache || [];
      renderMistakes(items, dom.mistakesSearch.value||"");
    });
  }

  // --- Initial state ---
  // default: modules visible; if you want to remember the toggle:
  try{
    const saved = localStorage.getItem("__dash_show_mistakes")==="1";
    if (saved && dom.toggle){ dom.toggle.checked = true; showMistakes(); }
    if (dom.toggle){
      dom.toggle.addEventListener("change", ()=>{
        localStorage.setItem("__dash_show_mistakes", dom.toggle.checked ? "1" : "0");
      });
    }
  } catch {}

})();
