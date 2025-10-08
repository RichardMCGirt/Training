/* ===========================
   Training Dashboard (Launcher)
   - Lists modules user can access
   - On click → index.html?module=...&presentationId=...
   - No answer counting / no 422s
   =========================== */

// Toggle verbose console logging
window.DEBUG = true;

// Simple grouped logger
const LOGGER = {
  group(label, ...args){ try{ if (window.DEBUG) console.group(label, ...args); }catch{} },
  groupEnd(){ try{ if (window.DEBUG) console.groupEnd(); }catch{} },
  info(...a){ try{ if (window.DEBUG) console.log(...a); }catch{} },
  warn(...a){ try{ if (window.DEBUG) console.warn(...a); }catch{} },
  error(...a){ try{ if (window.DEBUG) console.error(...a); }catch{} },
};

// Peek at error body safely
async function _peekBody(res){
  try {
    const txt = await res.text();
    return txt.length > 800 ? txt.slice(0, 800) + " …[truncated]" : txt;
  } catch {
    return "(no body)";
  }
}

// Wrapped fetch with timing + logs
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
   - Questions table: modules + Active flag
   - Titles table: "Assigned Modules Mapping" (strings like "role: module")
   =========================== */
const AIR = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",
  Q_TABLE: "tblbf2TwwlycoVvQq",                // Questions (has {Module} + {Active})
  T_TABLE: "tblppx6qNXXNJL7ON",                // Titles / Users table
  T_FIELD: "Assigned Modules Mapping"          // Field with strings that include module names
};

function h() {
  return {
    Authorization: `Bearer ${AIR.API_KEY}`,
    "Content-Type": "application/json"
  };
}
const baseUrl = (t) => `https://api.airtable.com/v0/${AIR.BASE_ID}/${encodeURIComponent(t)}`;

/* ===========================
   Data loaders
   =========================== */

// Collect distinct active modules from Questions
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
  if (window.DEBUG) {
    const preview = Array.from(byModule.values()).slice(0, 10).map(v => ({ module: v.name }));
    console.table(preview);
  }
  LOGGER.groupEnd();
  return byModule; // Map(moduleName -> {name})
}

// True if any mapping string contains the module name (case-insensitive)
function moduleIsAllowedByContains(moduleName, mappingStrings){
  const needle = (moduleName || '').trim().toLowerCase();
  if (!needle) return false;
  return mappingStrings.some(s => s.includes(needle));
}

// Read Titles field (Assigned Modules Mapping) → array of lowercased strings
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
        // Split on comma/semicolon/newline; also keep the full string if it contains colon-delimited role: module
        const parts = raw.split(/[,;\n]/g).map(s => s.trim()).filter(Boolean);
        if (parts.length) bucket.push(...parts);
        // Additionally push raw as-is if unique (covers "role: module" patterns)
        if (raw.trim() && !parts.includes(raw.trim())) bucket.push(raw.trim());
      }
      // ignore other types
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
  if (window.DEBUG) {
    console.table(lower.slice(0, 30).map((s, i)=>({i, value:s})));
  }
  LOGGER.groupEnd();
  return lower;
}

/* ===========================
   Navigation
   =========================== */

// Attempt to enrich with Slides presentationId via modules.js (if present)
async function openModule(moduleName, { reset = false } = {}) {
  try {
    // Remember selection for index.html as a fallback
    localStorage.setItem('selectedModule', moduleName);

    // Try to get Slides Presentation ID from modules.js
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
    // Fallback: at least go with module param
    const params = new URLSearchParams();
    params.set("module", moduleName);
    if (reset) params.set("reset", "1");
    location.href = "index.html?" + params.toString();
  }
}

// After your module cards are rendered into #list:
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

/* ===========================
   Render
   =========================== */

async function render(){
  const list = document.getElementById('list');
  if (!list) {
    LOGGER.warn("[render] #list not found");
    return;
  }
  list.innerHTML = '<div class="muted">Loading modules…</div>';

  LOGGER.group("[render] begin");
  try {
    // Load distinct modules & title mappings
    const [byModule, mappingStrings] = await Promise.all([
      fetchDistinctModules(),            // Map(name -> {name})
      fetchAssignedModuleMappingStrings()// Array<string> (lowercased)
    ]);

    const search = (document.getElementById('search')?.value||'').trim().toLowerCase();
    LOGGER.info("[render] searchTerm", search);

    // If mappingStrings empty, allow all modules (warn but don't block)
    const effectiveFilter = (mappingStrings && mappingStrings.length)
      ? (m) => moduleIsAllowedByContains(m.name, mappingStrings)
      : (m) => (LOGGER.warn("[render] mappingStrings is empty — showing all modules. Check AIR.T_FIELD."), true);

    const arr = Array.from(byModule.values())
      .filter(effectiveFilter)
      .filter(m => !search || m.name.toLowerCase().includes(search));

    LOGGER.info("[render] visible modules after filters", { count: arr.length });

    if (!arr.length){
      list.innerHTML = '<div class="muted">No modules found.</div>';
      LOGGER.groupEnd();
      return;
    }

    const cards = arr.map(m => {
      // Simple card without answer stats (launcher-only)
      return `<div class="card" data-module="${m.name}">
        <div class="hd">${m.name}</div>
        <div class="bd">
          <div class="row" style="margin-top:6px">
            <button class="btn" onclick="openModule('${m.name.replace(/'/g, "\\'")}')">Open</button>
            <button class="btn btn-ghost" onclick="openModule('${m.name.replace(/'/g, "\\'")}', { reset:true })" style="margin-left:8px">Restart</button>
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

/* ===========================
   Wire up
   =========================== */

document.getElementById('btnRefresh')?.addEventListener('click', render);
document.getElementById('search')?.addEventListener('input', render);

// Best-effort navigability on initial paint
setTimeout(makeModuleCardsNavigable, 400);

// Kick things off
render();
