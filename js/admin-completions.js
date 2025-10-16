(function(){
  "use strict";

  // ====== AIRTABLE CONFIG (mirrors your dashboard.js) ======
  const AIR = {
    API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
    BASE_ID: "app3rkuurlsNa7ZdQ",
    Q_TABLE: "tblbf2TwwlycoVvQq",       // Questions
    T_TABLE: "tblppx6qNXXNJL7ON",       // Titles/Users (holds Assigned Modules Mapping)
    A_TABLE: "tblkz5HyZGpgO093S"        // Answers
  };

  const FIELDS = {
    ASSIGNED_MAP: "Assigned Modules Mapping", // Titles/Users
    USER_EMAIL: "Email",                      // Titles/Users
    JOB_TITLE: "Job Title",                   // Titles/Users (preferred)
    // Fallback to "Title" if your base uses that field name:
    QUESTION: "Question",
    TYPE: "Type",
    RESULT: "Result",                         // "Right"/"Wrong"
    USEREMAIL: "UserEmail",                   // Answers
    PRESENTATION_ID: "PresentationId",        // Answers
    QUESTION_ID: "QuestionId",                // Answers
    ATTEMPT: "Attempt",                       // Answers (if present)
    TIMESTAMP: "Timestamp",                   // Answers (if present)
  };

  const COMPLETE_THRESHOLD = 1.0; // require 100%

  // ====== DOM ======
  const dom = {
    adminEmail: document.getElementById("adminEmail"),
    btnLogout: document.getElementById("btnLogout"),
    search: document.getElementById("search"),
    jobTitleFilter: document.getElementById("jobTitleFilter"),
    btnRefresh: document.getElementById("btnRefresh"),
    btnExport: document.getElementById("btnExport"),
    scanStatus: document.getElementById("scanStatus"),
    tbody: document.getElementById("tbody")
  };

  // ====== Helpers ======
  function h(){ return { Authorization: `Bearer ${AIR.API_KEY}`, "Content-Type": "application/json" }; }
  const base = (t) => `https://api.airtable.com/v0/${AIR.BASE_ID}/${encodeURIComponent(t)}`;
  const escQ = (s) => String(s||"").replace(/'/g,"\\'");
  const norm = (s) => String(s||"").trim().toLowerCase();

  function nameFromEmail(email){
    if (!email) return "";
    const s = String(email).trim().toLowerCase();
    const at = s.indexOf("@");
    if (at <= 0) return email;
    let local = s.slice(0, at).split("+",1)[0];
    let parts = local.split(/[._-]+/).filter(Boolean);
    const titleCase = (t)=>t.replace(/(^|[-'])([a-z])/g,(_,p1,p2)=>p1+p2.toUpperCase());
    if (!parts.length) return email;
    return parts.map(titleCase).join(" ");
  }

  function pctStr(v){ return `${Math.round(v*100)}%`; }

  function setStatus(msg){
    try { dom.scanStatus.textContent = msg || ""; } catch {}
  }

  // Build pid->module map from modules.js helpers (graceful fallback)
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
    } catch(e){
      console.warn("[admin-completions] buildPidMap failed", e);
    }
  }

  // ====== Data fetchers ======
  async function fetchUsersWithAssignedModules(){
    // Titles/Users table: Email + Assigned Modules Mapping (+ Job Title)
    const out = [];
    let offset;
    do {
      const url = new URL(base(AIR.T_TABLE));
      url.searchParams.set("pageSize","100");
      if (offset) url.searchParams.set("offset", offset);
      const res = await fetch(url.toString(), { headers: h() });
      if (!res.ok) throw new Error(`Titles fetch failed: ${res.status} ${await res.text().catch(()=>"(no body)")}`);
      const data = await res.json();
      for (const r of (data.records||[])){
        const f = r.fields||{};
        const email = String(f[FIELDS.USER_EMAIL]||"").trim();

        // Backward-compatible job title extraction:
        const jobTitle =
          String(f[FIELDS.JOB_TITLE] ?? f["Title"] ?? "").trim();

        let assigned = f[FIELDS.ASSIGNED_MAP];
        let list = [];
        if (Array.isArray(assigned)) list = assigned.map(s=>String(s||"").trim()).filter(Boolean);
        else if (typeof assigned === "string") list = String(assigned).split(/[,;\n]/g).map(s=>s.trim()).filter(Boolean);

        out.push({
          id: r.id,
          email,
          jobTitle,
          modules: Array.from(new Set(list.map(m=>m.trim()).filter(Boolean)))
        });
      }
      offset = data.offset;
    } while(offset);
    return out;
  }

  async function fetchActiveQuestionCountsByModule(){
    // Count how many active questions exist per module
    const counts = new Map();
    let offset;
    do {
      const url = new URL(base(AIR.Q_TABLE));
      url.searchParams.set("pageSize","100");
      url.searchParams.set("filterByFormula","AND({Active}=1)");
      if (offset) url.searchParams.set("offset", offset);
      const res = await fetch(url.toString(), { headers: h() });
      if (!res.ok) throw new Error(`Questions fetch failed: ${res.status} ${await res.text().catch(()=>"(no body)")}`);
      const data = await res.json();
      for (const r of (data.records||[])){
        const f = r.fields||{};
        const mod = String(f.Module||"").trim();
        if (!mod) continue;
        counts.set(mod, (counts.get(mod)||0)+1);
      }
      offset = data.offset;
    } while(offset);
    return counts;
  }

  async function fetchLatestAnswerRowsForUser(email){
    // Pull all answer rows for a user; reduce to latest per (PresentationId, QuestionId)
    const rows = [];
    let offset;
    do {
      const url = new URL(base(AIR.A_TABLE));
      url.searchParams.set("pageSize","100");
      url.searchParams.set("filterByFormula", `{${FIELDS.USEREMAIL}}='${escQ(email)}'`);
      if (offset) url.searchParams.set("offset", offset);
      const res = await fetch(url.toString(), { headers: h() });
      if (!res.ok) throw new Error(`Answers fetch failed: ${res.status} ${await res.text().catch(()=>"(no body)")}`);
      const data = await res.json();
      rows.push(...(data.records||[]));
      offset = data.offset;
    } while(offset);

    // Reduce to latest by (pid,qid) by ATTEMPT or TIMESTAMP
    const latest = new Map();
    for (const r of rows){
      const f = r.fields||{};
      const pid = String(f[FIELDS.PRESENTATION_ID]||"").trim();
      const qid = String(f[FIELDS.QUESTION_ID]||"").trim();
      if (!pid || !qid) continue;
      const key = pid+"||"+qid;
      const attempt = Number(f[FIELDS.ATTEMPT]||0);
      const ts = f[FIELDS.TIMESTAMP] ? new Date(f[FIELDS.TIMESTAMP]).getTime() : 0;
      const score = Number.isFinite(attempt) && attempt>0 ? attempt : (Number.isFinite(ts)?ts:0);
      const prev = latest.get(key);
      if (!prev || score > prev.__score){
        latest.set(key, { __score: score, pid, qid, isRight: String(f[FIELDS.RESULT]||"").toLowerCase()==="right" });
      }
    }
    return Array.from(latest.values());
  }

  // ====== Compute per-user progress ======
  async function computeProgressForUser(user, qCountsByModule){
    // Map user’s latest right answers by module
    const latest = await fetchLatestAnswerRowsForUser(user.email);

    // Convert pid->module (fallback: unknown module becomes "")
    const rightByModule = new Map();
    for (const r of latest){
      if (!r.isRight) continue;
      const mod = (pidToModule[r.pid]||"").trim();
      if (!mod) continue;
      const set = rightByModule.get(mod) || new Set();
      set.add(r.qid);
      rightByModule.set(mod, set);
    }

    // For each assigned module, compute %
    const rows = [];
    let totalRight = 0, totalQuestions = 0;

    for (const m of user.modules){
      const qTotal = qCountsByModule.get(m) || 0;
      const rightSet = rightByModule.get(m) || new Set();
      const correct = Math.min(rightSet.size, qTotal); // cap
      const pct = qTotal > 0 ? (correct / qTotal) : 0;
      totalRight += correct;
      totalQuestions += qTotal;
      rows.push({ module:m, correct, qTotal, pct, complete: qTotal>0 && pct >= COMPLETE_THRESHOLD });
    }

    const overall = totalQuestions>0 ? (totalRight/totalQuestions) : 0;
    const allComplete = rows.length>0 && rows.every(r => r.complete);
    return { perModule: rows, overall, allComplete };
  }

  // ====== Render (grouped by Job Title) ======
  function renderGrid(records, needle, selectedTitle){
    const q = norm(needle);
    const cols = 5;

    if (!records.length){
      dom.tbody.innerHTML = `<tr><td colspan="${cols}" class="muted">No data.</td></tr>`;
      return;
    }

    // search + title filter
    const filtered = records.filter(rec => {
      const titleKey = (rec.jobTitle && rec.jobTitle.trim()) ? rec.jobTitle.trim() : "(No Title)";
      const titleMatch = selectedTitle === "__ALL__" || titleKey === selectedTitle;

      const name = nameFromEmail(rec.email);
      const modules = rec.progress.perModule.map(r=>r.module).join(", ") || "(none)";
      const hay = `${name} ${rec.email} ${modules} ${rec.jobTitle || ""}`.toLowerCase();
      const searchMatch = !q || hay.indexOf(q) !== -1;

      return titleMatch && searchMatch;
    });

    if (!filtered.length){
      dom.tbody.innerHTML = `<tr><td colspan="${cols}" class="muted">No matches.</td></tr>`;
      return;
    }

    // Group by job title (fallback "(No Title)")
    const groups = new Map();
    for (const rec of filtered){
      const key = (rec.jobTitle && rec.jobTitle.trim()) ? rec.jobTitle.trim() : "(No Title)";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rec);
    }

    // Sort groups alphabetically, and users within each group by name
    const groupKeys = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b, undefined, {sensitivity:"base"}));

    const rows = [];
    for (const gKey of groupKeys){
      // Group header row
      rows.push(`
        <tr class="group-row">
          <th colspan="${cols}">Job Title: ${gKey}</th>
        </tr>
      `);

      const recs = groups.get(gKey) || [];
      recs.sort((a,b)=>{
        const an = nameFromEmail(a.email);
        const bn = nameFromEmail(b.email);
        return an.localeCompare(bn, undefined, {sensitivity:"base"});
      });

      for (const rec of recs){
        const name = nameFromEmail(rec.email);
        const modules = rec.progress.perModule.map(r=>r.module).join(", ") || "(none)";
        const overallPct = pctStr(rec.progress.overall);
        const allDone = rec.progress.allComplete;

        const modHtml = rec.progress.perModule.length
          ? rec.progress.perModule.map(r=>{
              const w = Math.max(0, Math.min(100, Math.round(r.pct*100)));
              const cls = r.complete ? "right" : (w>0 ? "warn" : "bad");
              return `
                <div style="margin:6px 0">
                  <div class="row" style="justify-content:space-between"><strong>${r.module}</strong><span class="${cls}">${w}%</span></div>
                  <div class="bar"><i style="width:${w}%"></i></div>
                  <div class="tiny muted">${r.correct} of ${r.qTotal} correct</div>
                </div>`;
            }).join("")
          : `<span class="muted">(no assigned modules)</span>`;

        rows.push(`
          <tr>
            <td>
              <div><strong>${name || "(unknown)"}</strong></div>
              <div class="mono tiny muted">${rec.email||""}</div>
            </td>
            <td>${modules || "<span class='muted'>(none)</span>"}</td>
            <td>${modHtml}</td>
            <td><strong>${overallPct}</strong></td>
            <td>${allDone ? "<span class='pill'>Yes</span>" : "<span class='pill'>No</span>"}</td>
          </tr>`);
      }
    }

    dom.tbody.innerHTML = rows.join("");
  }

  function toCsv(records, selectedTitle, searchNeedle){
    const q = norm(searchNeedle);
    const titleKey = (r)=> (r.jobTitle && r.jobTitle.trim()) ? r.jobTitle.trim() : "(No Title)";

    const filtered = records.filter(r=>{
      const titleMatch = selectedTitle === "__ALL__" || titleKey(r) === selectedTitle;
      const name = nameFromEmail(r.email);
      const modules = r.progress.perModule.map(x=>x.module).join(", ") || "(none)";
      const hay = `${name} ${r.email} ${modules} ${r.jobTitle || ""}`.toLowerCase();
      const searchMatch = !q || hay.indexOf(q) !== -1;
      return titleMatch && searchMatch;
    });

    const header = ["Job Title","User Name","User Email","Module","Correct","Total","Percent","All Assigned Complete?"];
    const lines = [header.join(",")];
    for (const r of filtered){
      for (const pm of r.progress.perModule){
        const pct = Math.round(pm.pct*100);
        lines.push([
          `"${((titleKey(r))||"").replace(/"/g,'""')}"`,
          `"${(nameFromEmail(r.email) || "").replace(/"/g,'""')}"`,
          `"${(r.email||"").replace(/"/g,'""')}"`,
          `"${(pm.module||"").replace(/"/g,'""')}"`,
          pm.correct,
          pm.qTotal,
          pct,
          r.progress.allComplete ? "Yes" : "No"
        ].join(","));
      }
    }
    return lines.join("\n");
  }

  function download(name, text){
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  // ====== Page state (for filter/search/export cache) ======
  let cache = [];              // full dataset (all users)
  let currentTitle = "__ALL__";
  let currentSearch = "";

  // ====== Build Job Title dropdown from dataset ======
  function buildTitleDropdown(records){
    const counts = new Map();
    for (const r of records){
      const key = (r.jobTitle && r.jobTitle.trim()) ? r.jobTitle.trim() : "(No Title)";
      counts.set(key, (counts.get(key)||0)+1);
    }
    const keys = Array.from(counts.keys()).sort((a,b)=>a.localeCompare(b, undefined, {sensitivity:"base"}));

    // Preserve current selection if still present
    const sel = dom.jobTitleFilter;
    const prev = sel.value || "__ALL__";

    // Rebuild options
    sel.innerHTML = "";
    const mk = (val, label)=> {
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = label;
      return opt;
    };
    sel.appendChild(mk("__ALL__", `All job titles (${records.length})`));
    for (const k of keys){
      const c = counts.get(k)||0;
      sel.appendChild(mk(k, `${k} (${c})`));
    }

    // Restore if possible
    if (prev !== "__ALL__" && counts.has(prev)) sel.value = prev;
    else sel.value = "__ALL__";
    currentTitle = sel.value;
  }

  // ====== Main load ======
  async function load(){
    setStatus("Building PID map…");
    await buildPidMap(); // from modules.js

    setStatus("Loading users + assignments…");
    const users = (await fetchUsersWithAssignedModules())
      .filter(u => u.email); // only rows with an email

    setStatus("Counting active questions by module…");
    const qCountsByModule = await fetchActiveQuestionCountsByModule();

    const out = [];
    let done = 0;
    for (const u of users){
      setStatus(`Computing progress… ${++done}/${users.length}`);
      const progress = await computeProgressForUser(u, qCountsByModule);
      out.push({ email: u.email, jobTitle: u.jobTitle, modules: u.modules, progress });
    }

    setStatus(`Done. ${out.length} users.`);

    // Cache and build dropdown
    cache = out;
    buildTitleDropdown(cache);

    // Initial render with current filters
    renderGrid(cache, currentSearch, currentTitle);

    return cache;
  }

  // ====== Wire UI ======
  (function init(){
    // header right info & logout
    try { dom.adminEmail.textContent = localStorage.getItem("authEmail") || ""; } catch {}
    dom.btnLogout?.addEventListener("click", () => {
      if (typeof logout === "function") logout();
      else { localStorage.removeItem("authEmail"); location.href = "login.html"; }
    });

    dom.btnRefresh?.addEventListener("click", async () => {
      await load();
    });

    dom.search?.addEventListener("input", () => {
      currentSearch = dom.search.value;
      renderGrid(cache, currentSearch, currentTitle);
    });

    dom.jobTitleFilter?.addEventListener("change", () => {
      currentTitle = dom.jobTitleFilter.value || "__ALL__";
      renderGrid(cache, currentSearch, currentTitle);
    });

    dom.btnExport?.addEventListener("click", () => {
      if (!cache || !cache.length) return;
      const csv = toCsv(cache, currentTitle, currentSearch);
      const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
      download(`module-completions-${stamp}.csv`, csv);
    });

    // First load
    load().catch(e => {
      console.error(e);
      dom.tbody.innerHTML = `<tr><td colspan="5" class="bad">Load failed.</td></tr>`;
      setStatus("Load failed");
    });
  })();

})();
