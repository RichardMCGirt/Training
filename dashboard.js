/* ===========================
   Training Dashboard (Launcher) — with per-module stats
   - Lists modules user can access
   - Shows total questions and % completed for the signed-in user
   - NEW: Mistakes view grouped by module with tap-to-open headers
   =========================== */

window.DEBUG = true;

const LOGGER = {
  group(label, ...args){ try{ if (window.DEBUG) console.group(label, ...args); }catch{} },
  groupEnd(){ try{ if (window.DEBUG) console.groupEnd(); }catch{} },
  info(...a){ try{ if (window.DEBUG) console.log(...a); }catch{} },
  warn(...a){ try{ if (window.DEBUG) console.warn(...a); }catch{} },
  error(...a){ try{ if (window.DEBUG) console.error(...a); }catch{} },
};

async function _peekBody(res){
  try {
    const txt = await res.text();
    return txt.length > 800 ? txt.slice(0, 800) + " …[truncated]" : txt;
  } catch {
    return "(no body)";
  }
}

async function _fetch(url, options = {}, tag = "fetch"){
  const t0 = (performance?.now?.() ?? Date.now());
  const method = options.method || "GET";
  LOGGER.group(`[${tag}] ${method} ${url}`);
  try {
    const res = await fetch(url, options);
    const ms = Math.round((performance?.now?.() ?? Date.now()) - t0);
    LOGGER.info("[response]", { ok: res.ok, status: res.status, durationMs: ms });

    if (!res.ok) {
      const body = await _peekBody(res);
      LOGGER.error("[error body]", body);
    }
    LOGGER.groupEnd();
    return res;
  } catch (err) {
    const ms = Math.round((performance?.now?.() ?? Date.now()) - t0);
    LOGGER.error("[network error]", { error: String(err), durationMs: ms });
    LOGGER.groupEnd();
    throw err;
  }
}

/* ===========================
   Airtable config
   =========================== */
const AIR = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",
  Q_TABLE: "tblbf2TwwlycoVvQq",                // Questions (has {Module} + {Active})
  T_TABLE: "tblppx6qNXXNJL7ON",                // Titles / Users table
  T_FIELD: "Assigned Modules Mapping",         // Field with strings that include module names
  A_TABLE: "tblkz5HyZGpgO093S"                 // Answers (UserEmail, PresentationId, QuestionId, IsCorrect, Correct Answer, Wrong Attempts)
};

function h() {
  return {
    Authorization: `Bearer ${AIR.API_KEY}`,
    "Content-Type": "application/json"
  };
}
const baseUrl = (t) => `https://api.airtable.com/v0/${AIR.BASE_ID}/${encodeURIComponent(t)}`;

/* ===========================
   Helpers / DOM
   =========================== */
function getUserEmail(){
  try {
    const a = localStorage.getItem("trainingEmail") || localStorage.getItem("authEmail") || "";
    return String(a||"").trim();
  } catch { return ""; }
}
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]); }
function att(s){ return String(s==null?"":s).replace(/"/g, "&quot;"); }

const dom = {
  hello: document.getElementById("hello"),
  toggle: document.getElementById("toggleMistakes"),
  modulesCard: document.getElementById("modulesCard"),
  modulesListCard: document.getElementById("modulesListCard"),
  mistakesCard: document.getElementById("mistakesCard"),
  mistakesSearch: document.getElementById("mistakesSearch"),
  btnReloadMistakes: document.getElementById("btnReloadMistakes"),
  mistakesSummary: document.getElementById("mistakesSummary"),
  // NEW container for grouped rendering:
  mistakesGroups: document.getElementById("mistakesGroups"),
  search: document.getElementById("search"),
  btnRefresh: document.getElementById("btnRefresh"),
  list: document.getElementById("list")
};

try { if (dom.hello) dom.hello.textContent = getUserEmail() || "(not signed in)"; } catch {}

/* ===========================
   Modules listing + stats (unchanged behavior)
   =========================== */
async function fetchDistinctModules(){
  LOGGER.group("[fetchDistinctModules] begin");
  const url = new URL(baseUrl(AIR.Q_TABLE));
  url.searchParams.set('pageSize','100');
  url.searchParams.set('filterByFormula', 'AND({Active}=1)');
  LOGGER.info("[url]", url.toString());

  let all = [], offset, page = 0;
  do {
    page++;
    if (offset) url.searchParams.set('offset', offset);
    LOGGER.info(`[page ${page}] request`, { offset: offset || "(none)" });

    const res = await _fetch(url.toString(), { headers: h() }, "questions");
    if (!res.ok) throw new Error('Questions load failed: '+res.status);

    const data = await res.json();
    const recs = data.records||[];
    LOGGER.info(`[page ${page}] received`, { count: recs.length });

    all = all.concat(recs);
    offset = data.offset;

    if (offset){
      const u = new URL(baseUrl(AIR.Q_TABLE));
      u.searchParams.set('pageSize','100');
      u.searchParams.set('filterByFormula','AND({Active}=1)');
      url.search = u.search;
    }
  } while(offset);

  const byModule = new Map();
  for (const r of all){
    const f = r.fields||{};
    const m = (f.Module||'').trim();
    if (!m) continue;
    if (!byModule.has(m)) byModule.set(m, { name:m });
  }

  LOGGER.info("[summary] modules found", { moduleCount: byModule.size, totalRecords: all.length });
  LOGGER.groupEnd();
  return byModule;
}

function moduleIsAllowedByContains(moduleName, mappingStrings){
  const needle = (moduleName || '').trim().toLowerCase();
  if (!needle) return false;
  return mappingStrings.some(s => s.includes(needle));
}

async function fetchAssignedModuleMappingStrings(){
  LOGGER.group("[fetchAssignedModuleMappingStrings] begin");
  const url = new URL(baseUrl(AIR.T_TABLE));
  url.searchParams.set('pageSize','100');
  LOGGER.info("[url]", url.toString(), "field to read:", AIR.T_FIELD);

  const bucket = [];
  let offset, page = 0;
  let loggedFieldKeys = false;

  do {
    page++;
    if (offset) url.searchParams.set('offset', offset);
    LOGGER.info(`[page ${page}] request`, { offset: offset || "(none)" });

    const res = await _fetch(url.toString(), { headers: h() }, "titles");
    if (!res.ok) throw new Error('Titles load failed: '+res.status);

    const data = await res.json();
    const recs = data.records || [];
    LOGGER.info(`[page ${page}] received`, { count: recs.length });

    if (!loggedFieldKeys && recs.length) {
      const keys = Object.keys(recs[0].fields || {});
      LOGGER.info("[titles] first record field keys", keys);
      loggedFieldKeys = true;
      if (!(AIR.T_FIELD in (recs[0].fields || {}))) {
        LOGGER.warn(`[titles] Field "${AIR.T_FIELD}" not present on first record. It may be blank on many rows—continuing to scan.`);
      }
    }

    for (const rec of recs){
      const f = rec.fields || {};
      const raw = f[AIR.T_FIELD];

      if (Array.isArray(raw)) {
        for (const v of raw) {
          const s = (v==null ? "" : String(v)).trim();
          if (s) bucket.push(s);
        }
      } else if (typeof raw === 'string') {
        const parts = raw.split(/[,;\n]/g).map(s => s.trim()).filter(Boolean);
        if (parts.length) bucket.push(...parts);
        if (raw.trim() && !parts.includes(raw.trim())) bucket.push(raw.trim());
      }
    }

    offset = data.offset;
    if (offset){
      const u = new URL(baseUrl(AIR.T_TABLE));
      u.searchParams.set('pageSize','100');
      url.search = u.search;
    }
  } while (offset);

  const lower = bucket.map(s => s.toLowerCase());
  LOGGER.info("[summary] rawCount:", bucket.length, "lowercasedCount:", lower.length);
  LOGGER.groupEnd();
  return lower;
}

async function countActiveQuestions(moduleName){
  const url = new URL(baseUrl(AIR.Q_TABLE));
  const escQ = (s) => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set('pageSize','100');
  url.searchParams.set('filterByFormula', `AND({Active}=1, LOWER(TRIM({Module}))='${escQ(moduleName.toLowerCase())}')`);

  let count = 0, offset;
  do {
    if (offset) url.searchParams.set('offset', offset);
    const res = await _fetch(url.toString(), { headers: h() }, "q-count");
    if (!res.ok) throw new Error("Questions count failed: "+res.status);
    const data = await res.json();
    count += (data.records||[]).length;
    offset = data.offset;

    if (offset){
      const u = new URL(baseUrl(AIR.Q_TABLE));
      u.searchParams.set('pageSize','100');
      u.searchParams.set('filterByFormula', `AND({Active}=1, LOWER(TRIM({Module}))='${escQ(moduleName.toLowerCase())}')`);
      url.search = u.search;
    }
  } while (offset);

  return count;
}

async function getPresentationIdForModule(moduleName){
  try{
    if (window.trainingModules?.getConfigForModule){
      const cfg = await window.trainingModules.getConfigForModule(moduleName);
      return (cfg?.presentationId || "").trim();
    }
  } catch(e){ LOGGER.warn("[getPresentationIdForModule] failed", e); }
  return "";
}

async function countCorrectForUser(presentationId, userEmail){
  if (!presentationId || !userEmail) return 0;

  const url = new URL(baseUrl(AIR.A_TABLE));
  const escQ = (s) => String(s||"").replace(/'/g, "\\'");
  url.searchParams.set('pageSize','100');
  url.searchParams.set('filterByFormula', `AND({UserEmail}='${escQ(userEmail)}',{PresentationId}='${escQ(presentationId)}',{IsCorrect}=1)`);

  const seen = new Set();
  let offset;
  do {
    if (offset) url.searchParams.set('offset', offset);
    const res = await _fetch(url.toString(), { headers: h() }, "a-count");
    if (!res.ok) throw new Error("Answers load failed: "+res.status);
    const data = await res.json();
    for (const r of (data.records||[])) {
      const qid = String(r?.fields?.QuestionId || "").trim();
      if (qid) seen.add(qid);
    }
    offset = data.offset;

    if (offset){
      const u = new URL(baseUrl(AIR.A_TABLE));
      u.searchParams.set('pageSize','100');
      u.searchParams.set('filterByFormula', `AND({UserEmail}='${escQ(userEmail)}',{PresentationId}='${escQ(presentationId)}',{IsCorrect}=1)`);
      url.search = u.search;
    }
  } while (offset);

  return seen.size;
}

async function fetchModuleStats(moduleName, userEmail){
  const [total, presId] = await Promise.all([
    countActiveQuestions(moduleName),
    getPresentationIdForModule(moduleName)
  ]);

  let correct = 0;
  try {
    correct = await countCorrectForUser(presId, userEmail);
  } catch (e){
    LOGGER.warn("[fetchModuleStats] correct-count failed", e);
  }

  const pct = total > 0 ? Math.round((Math.min(correct, total) * 100) / total) : 0;

  return {
    totalQuestions: total,
    correct,
    pct,
    presentationId: presId
  };
}

async function openModule(moduleName, { reset = false } = {}) {
  try {
    localStorage.setItem('selectedModule', moduleName);
    let presId = "";
    if (window.trainingModules?.getConfigForModule) {
      try {
        const cfg = await window.trainingModules.getConfigForModule(moduleName);
        presId = (cfg?.presentationId || "").trim();
      } catch (e) {
        console.warn("[openModule] mapping lookup failed; proceeding without presentationId", e);
      }
    }
    const params = new URLSearchParams();
    params.set("module", moduleName);
    if (presId) params.set("presentationId", presId);
    if (reset) params.set("reset", "1");
    location.href = "index.html?" + params.toString();
  } catch (err) {
    console.error("[openModule] failed", err);
    const params = new URLSearchParams();
    params.set("module", moduleName);
    if (reset) params.set("reset", "1");
    location.href = "index.html?" + params.toString();
  }
}

function makeModuleCardsNavigable(){
  const list = document.getElementById('list');
  list?.querySelectorAll('[data-module]').forEach(card=>{
    card.style.cursor = 'pointer';
    card.addEventListener('click', async ()=>{
      const m = card.getAttribute('data-module') || card.querySelector('[data-name]')?.textContent || '';
      if (m) await openModule(m);
    });
  });
}

async function render(){
  const list = document.getElementById('list');
  if (!list) { LOGGER.warn("[render] #list not found"); return; }
  list.innerHTML = '<div class="muted">Loading modules…</div>';

  LOGGER.group("[render] begin");
  try {
    const [byModule, mappingStrings] = await Promise.all([
      fetchDistinctModules(),
      fetchAssignedModuleMappingStrings()
    ]);

    const searchTerm = (dom.search?.value||'').trim().toLowerCase();
    LOGGER.info("[render] searchTerm", searchTerm);

    const effectiveFilter = (mappingStrings && mappingStrings.length)
      ? (m) => moduleIsAllowedByContains(m.name, mappingStrings)
      : (m) => (LOGGER.warn("[render] mappingStrings is empty — showing all modules. Check AIR.T_FIELD."), true);

    const arr = Array.from(byModule.values())
      .filter(effectiveFilter)
      .filter(m => !searchTerm || m.name.toLowerCase().includes(searchTerm));

    LOGGER.info("[render] visible modules after filters", { count: arr.length });

    if (!arr.length){
      list.innerHTML = '<div class="muted">No modules found.</div>';
      LOGGER.groupEnd();
      return;
    }

    const userEmail = getUserEmail();

    async function mapWithLimit(items, limit, fn){
      const out = new Array(items.length);
      let next = 0;
      const cap = Math.max(1, Math.min(Number(limit)||1, items.length));
      async function worker(){
        while (true){
          const i = next++;
          if (i >= items.length) break;
          out[i] = await fn(items[i], i, items);
        }
      }
      await Promise.all(Array.from({ length: cap }, worker));
      return out;
    }

    const stats = await mapWithLimit(arr, 4, async (m) => {
      try {
        const s = await fetchModuleStats(m.name, userEmail);
        return { name: m.name, ...s };
      } catch (e){
        LOGGER.warn("[stats] failed for", m.name, e);
        return { name: m.name, totalQuestions: 0, correct: 0, pct: 0, presentationId: "" };
      }
    });

    const cards = stats.map(s => {
      const totalTxt = `${s.totalQuestions} question${s.totalQuestions===1?"":"s"}`;
      const canShowPct = (s.totalQuestions > 0 && s.presentationId && userEmail);
      const pctVal = Number(s.pct || 0);
      const pctTxt = canShowPct
        ? `${pctVal}% completed`
        : (s.totalQuestions > 0 ? "—" : "0% completed");

      const bar = `
        <div style="margin-top:8px">
          <div style="height:8px;background:#eee;border-radius:6px;overflow:hidden">
            <i style="display:block;height:8px;width:${pctVal}%;background:#3b82f6"></i>
          </div>
          <div class="muted small" style="margin-top:4px">${pctTxt}</div>
        </div>`;

      const modEsc = JSON.stringify(s.name);

      return `<div class="card" data-module=${modEsc}>
        <div class="hd">${s.name}</div>
        <div class="bd">
          <div class="muted">${totalTxt}</div>
          ${bar}
          <div class="row" style="margin-top:10px">
            <button class="btn" onclick="openModule(${modEsc})">Open</button>
          </div>
        </div>
      </div>`;
    });

    list.innerHTML = cards.join('');
    makeModuleCardsNavigable();
    LOGGER.groupEnd();

  } catch (e){
    list.innerHTML = '<div class="muted">Failed to load. Check network/API key.</div>';
    LOGGER.error("[render] error", e);
    LOGGER.groupEnd();
  }
}

document.getElementById('btnRefresh')?.addEventListener('click', render);
document.getElementById('search')?.addEventListener('input', render);
setTimeout(makeModuleCardsNavigable, 400);
render();

/* ===========================
   Mistakes view — grouped by module with accordion
   =========================== */

// Build map: PresentationId -> Module (using modules.js)
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

function aHeaders(){
  return {
    Authorization: `Bearer ${AIR.API_KEY}`,
    "Content-Type": "application/json"
  };
}
function aBaseUrl(){
  return `https://api.airtable.com/v0/${AIR.BASE_ID}/${encodeURIComponent(AIR.A_TABLE)}`;
}

// Fetch latest wrong attempt per (PresentationId, QuestionId)
async function fetchWrongAnswersLatestByQuestion(){
  const email = getUserEmail();
  if (!email) return [];

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

  const latestWrong = Array.from(byKey.values()).filter(x => !x.isCorrect);

  latestWrong.sort((a,b)=>{
    const ta = Date.parse(a.timestamp||"") || 0;
    const tb = Date.parse(b.timestamp||"") || 0;
    if (tb !== ta) return tb - ta;
    return (b.attempt||0) - (a.attempt||0);
  });

  return latestWrong;
}

// Render a single mistake card
function renderMistakeCard(it){
  const ts = it.timestamp ? new Date(it.timestamp).toLocaleString() : "";
  const email = getUserEmail() || "";
  const moduleName = pidToModule[it.pid] || "";

  // Deep link to a SINGLE question
  const href =
    "index.html"
    + "?module=" + encodeURIComponent(moduleName)
    + "&presentationId=" + encodeURIComponent(it.pid)
    + (email ? ("&userEmail=" + encodeURIComponent(email)) : "")
    + "&questionId=" + encodeURIComponent(it.qid);

  return `
    <div class="mistake">
      <div class="meta">
        Attempt #${it.attempt}${ts ? ` • ${esc(ts)}` : ""}${it.wrongAttempts ? ` • <span class="badge">${it.wrongAttempts} wrong tries</span>` : ""}
      </div>
      <div class="q">${esc(it.question)}</div>
      <div class="ans">
        <div><strong>Your last answer:</strong> ${esc(it.answer||"(blank)")}</div>
        ${it.correctAnswer ? `<div class="muted"><strong>Correct answer:</strong> ${esc(it.correctAnswer)}</div>` : ""}
      </div>
      <div class="btn-row">
        <a class="btn" href="${att(href)}">Redo this question</a>
      </div>
    </div>
  `;
}



// NEW: grouped module accordion renderer
function renderMistakesGrouped(items, filter=""){
  const q = String(filter||"").toLowerCase().trim();

  // Attach module names
  const withModule = items.map(it => ({
    ...it,
    module: pidToModule[it.pid] || "(Unknown module)"
  }));

  // Filter by module or question text
  const filtered = withModule.filter(it=>{
    if (!q) return true;
    const mod = String(it.module||"").toLowerCase();
    const txt = String(it.question||"").toLowerCase();
    return mod.includes(q) || txt.includes(q);
  });

  // Group by module
  const byModule = new Map();
  for (const it of filtered){
    if (!byModule.has(it.module)) byModule.set(it.module, []);
    byModule.get(it.module).push(it);
  }

  // Sort modules alphabetically; inside each, newest first (already sorted upstream)
  const modules = Array.from(byModule.keys()).sort((a,b)=>a.localeCompare(b));

  // Summary
  const totalRows = filtered.length;
  if (dom.mistakesSummary){
    dom.mistakesSummary.textContent = totalRows
      ? `Showing ${totalRows} wrong question${totalRows===1?"":"s"} across ${modules.length} module${modules.length===1?"":"s"}.`
      : `No wrong questions found for your latest attempts.`;
  }

  // Empty state
  if (!modules.length){
    dom.mistakesGroups.innerHTML = `<div class="muted">Nothing to show.</div>`;
    return;
  }

  // Build accordion HTML
  const html = modules.map(mod=>{
    const rows = byModule.get(mod)||[];
    const count = rows.length;
   const qidsCsv = rows.map(r => r.qid).filter(Boolean).join(",");
const pidForGroup = rows[0]?.pid || "";
const email = getUserEmail() || "";

const redoAllHref =
  "index.html"
  + "?module=" + encodeURIComponent(mod)
  + "&presentationId=" + encodeURIComponent(pidForGroup)
  + (email ? ("&userEmail=" + encodeURIComponent(email)) : "")
  + (rows[0]?.qid ? ("&questionId=" + encodeURIComponent(rows[0].qid)) : "")
  + (qidsCsv ? ("&redoQids=" + encodeURIComponent(qidsCsv)) : "");

const grid = `
  <div class="group-actions" style="margin: 6px 0 14px;">
    <a class="btn" href="${att(redoAllHref)}">Redo all wrong in this module</a>
  </div>
  <div class="mistakes-grid">
    ${rows.map(renderMistakeCard).join("")}
  </div>
`;

    const groupId = `g_${mod.replace(/[^a-z0-9]/gi,'_')}`;

    return `
      <section class="group" data-group="${esc(mod)}" id="${esc(groupId)}">
        <div class="group-header" role="button" tabindex="0" aria-expanded="false" aria-controls="${esc(groupId)}_body">
          <div>
            <div class="group-title">${esc(mod)}</div>
            <div class="group-sub">Latest wrong answers in this module</div>
          </div>
          <div class="group-right">
            <span class="count-pill">${count}</span>
            <i class="chev" aria-hidden="true"></i>
          </div>
        </div>
        <div class="group-body" id="${esc(groupId)}_body">
          ${grid}
        </div>
      </section>
    `;
  }).join("");

  dom.mistakesGroups.innerHTML = html;

  // Wire expand/collapse (event delegation)
  dom.mistakesGroups.addEventListener("click", onGroupHeaderClick);
  dom.mistakesGroups.addEventListener("keydown", onGroupHeaderKeydown);
}

function onGroupHeaderClick(e){
  const header = e.target.closest(".group-header");
  if (!header) return;
  const group = header.closest(".group");
  const isOpen = group.classList.contains("open");
  group.classList.toggle("open", !isOpen);
  header.setAttribute("aria-expanded", String(!isOpen));
}

function onGroupHeaderKeydown(e){
  if (e.key !== "Enter" && e.key !== " ") return;
  const header = e.target.closest(".group-header");
  if (!header) return;
  e.preventDefault();
  header.click();
}

// Toggle views
async function showMistakes(){
  if (dom.modulesCard) dom.modulesCard.style.display = "none";
  if (dom.modulesListCard) dom.modulesListCard.style.display = "none";
  if (dom.mistakesCard) dom.mistakesCard.style.display = "block";

  await buildPidMap();
  const items = await fetchWrongAnswersLatestByQuestion();
  renderMistakesGrouped(items, dom.mistakesSearch?.value||"");
  window.___mistakesCache = items;
}
function showModules(){
  if (dom.modulesCard) dom.modulesCard.style.display = "block";
  if (dom.modulesListCard) dom.modulesListCard.style.display = "block";
  if (dom.mistakesCard) dom.mistakesCard.style.display = "none";
}

// Events
if (dom.toggle){
  dom.toggle.addEventListener("change", async () => {
    if (dom.toggle.checked) { await showMistakes(); }
    else { showModules(); }
  });
}
if (dom.btnReloadMistakes){
  dom.btnReloadMistakes.addEventListener("click", async ()=>{ await showMistakes(); });
}
if (dom.mistakesSearch){
  dom.mistakesSearch.addEventListener("input", ()=>{
    const items = window.___mistakesCache || [];
    renderMistakesGrouped(items, dom.mistakesSearch.value||"");
  });
}

// Remember toggle
try{
  const saved = localStorage.getItem("__dash_show_mistakes")==="1";
  if (saved && dom.toggle){ dom.toggle.checked = true; showMistakes(); }
  if (dom.toggle){
    dom.toggle.addEventListener("change", ()=>{
      localStorage.setItem("__dash_show_mistakes", dom.toggle.checked ? "1" : "0");
    });
  }
} catch {}
