/* Admin – Module Completion Grid
 * - Lists users from Titles/Users table with their assigned modules (Assigned Modules Mapping)
 * - For each user+module: % complete = distinct correct answers / total active questions in module
 * - “Complete?” = 100% (or configurable threshold)
 *
 * Relies on your existing schema and helpers used elsewhere in the app.
 * Airtable tables/fields mirror dashboard.js & script.js usage.
 */

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
    // Titles/Users table: Email + Assigned Modules Mapping (string or array)
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
        let assigned = f[FIELDS.ASSIGNED_MAP];
        let list = [];
        if (Array.isArray(assigned)) list = assigned.map(s=>String(s||"").trim()).filter(Boolean);
        else if (typeof assigned === "string") list = String(assigned).split(/[,;\n]/g).map(s=>s.trim()).filter(Boolean);
        out.push({ id:r.id, email, modules: Array.from(new Set(list.map(m=>m.trim()).filter(Boolean))) });
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

  // ====== Render ======
  function renderGrid(records, needle){
    const q = norm(needle);
    if (!records.length){
      dom.tbody.innerHTML = `<tr><td colspan="5" class="muted">No data.</td></tr>`;
      return;
    }

    const rows = [];
    for (const rec of records){
      const name = nameFromEmail(rec.email);
      const modules = rec.progress.perModule.map(r=>r.module).join(", ") || "(none)";
      const overallPct = pctStr(rec.progress.overall);
      const allDone = rec.progress.allComplete;

      // search filter
      const hay = `${name} ${rec.email} ${modules}`.toLowerCase();
      if (q && hay.indexOf(q) === -1) continue;

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

    dom.tbody.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="5" class="muted">No matches.</td></tr>`;
  }

  function toCsv(records){
    const header = ["User Name","User Email","Module","Correct","Total","Percent","All Assigned Complete?"];
    const lines = [header.join(",")];
    for (const r of records){
      for (const pm of r.progress.perModule){
        const pct = Math.round(pm.pct*100);
        lines.push([
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
      out.push({ email: u.email, modules: u.modules, progress });
    }

    setStatus(`Done. ${out.length} users.`);
    renderGrid(out, dom.search.value);
    return out;
  }

  // ====== Wire UI ======
  (function init(){
    // header right info & logout
    try { dom.adminEmail.textContent = localStorage.getItem("authEmail") || ""; } catch {}
    dom.btnLogout?.addEventListener("click", () => {
      if (typeof logout === "function") logout();
      else { localStorage.removeItem("authEmail"); location.href = "login.html"; }
    });

    let cache = [];
    dom.btnRefresh?.addEventListener("click", async () => { cache = await load(); });
    dom.search?.addEventListener("input", () => renderGrid(cache, dom.search.value));
    dom.btnExport?.addEventListener("click", () => {
      if (!cache || !cache.length) return;
      const csv = toCsv(cache);
      const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
      download(`module-completions-${stamp}.csv`, csv);
    });

    // First load
    load().then(x => { /* cache for quick search & export */ cache = x; })
          .catch(e => { console.error(e); dom.tbody.innerHTML = `<tr><td colspan="5" class="bad">Load failed.</td></tr>`; setStatus("Load failed"); });
  })();

})();
