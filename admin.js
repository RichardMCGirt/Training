// ========= Airtable Config =========
const AIRTABLE = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",
  TABLE_ID: "tblpvVpIJnkWco25E",
  TITLES_TABLE_ID: "tblppx6qNXXNJL7ON",
  TITLES_FIELD_NAME: "Title",
  TITLES_ASSIGNED_FIELD: "Assigned Modules",
  TITLES_MAPPING_FIELD: "Assigned Modules Mapping"
};

// ===== Airtable config (Questions table) =====
const QUESTIONS_AT = {
  API_KEY:        'patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054',         // e.g. 'patXXXX...'
  BASE_ID:        'app3rkuurlsNa7ZdQ',              // e.g. 'appXXXX...'
  TABLE_ID:       'tblbf2TwwlycoVvQq',   // e.g. 'tblXXXX...'
};

function qBaseUrl(){
  return `https://api.airtable.com/v0/${encodeURIComponent(QUESTIONS_AT.BASE_ID)}/${encodeURIComponent(QUESTIONS_AT.TABLE_ID)}`;
}

function qHeaders(){
  return {
    'Authorization': `Bearer ${QUESTIONS_AT.API_KEY}`,
    'Content-Type': 'application/json'
  };
}


// ========= Tiny DOM Helpers =========
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// ========= UI Map =========
const ui = {
  search: $("#search"),
  fltActive: $("#fltActive"),
  fltInactive: $("#fltInactive"),
  btnRefresh: $("#btnRefresh"),
  listStatus: $("#listStatus"),
  moduleGroups: $("#moduleGroups"),

  questionType: $("#questionType"),
  slideId: $("#slideId"),
  order: $("#order"),
  questionId: $("#questionId"),
  questionText: $("#questionText"),
  btnAddOption: $("#btnAddOption"),
  btnClearOptions: $("#btnClearOptions"),
  options: $("#options"),
  btnSave: $("#btnSave"),
  btnReset: $("#btnReset"),

  mcBlock: $("#mcBlock"),
  fitbBlock: $("#fitbBlock"),
  fitbAnswers: $("#fitbAnswers"),
  fitbUseRegex: $("#fitbUseRegex"),
  fitbCaseSensitive: $("#fitbCaseSensitive"),

  // Module controls (with '+ Add new…' reveal)
  moduleSelect: $("#moduleSelect"),
  moduleNewWrap: $("#moduleNewWrap"),
  moduleInput: $("#moduleInput"),
  moduleChips: $("#moduleChips"),

  toast: $("#toast"),
  toastMsg: $("#toastMsg"),

  // Titles & modules assignment UI
  titleSearch: document.getElementById('titleSearch'),
  titleSelect: document.getElementById('titleSelect'),
  btnSelectAllTitles: document.getElementById('btnSelectAllTitles'),
  btnClearTitles: document.getElementById('btnClearTitles'),
  titleCount: document.getElementById('titleCount'),

  moduleSearch: document.getElementById('moduleSearch'),
  chkShowAssignedFirst: document.getElementById('chkShowAssignedFirst'),
  btnSelectAllModules: document.getElementById('btnSelectAllModules'),
  btnClearModules: document.getElementById('btnClearModules'),
  moduleList: document.getElementById('moduleList'),

  btnAssign: document.getElementById('btnAssign'),
  btnUnassign: document.getElementById('btnUnassign'),
  assignStatus: document.getElementById('assignStatus'),

  modTitleList: document.getElementById('modTitleList'),
};

// ========= Toast / Utils =========
function toast(msg, kind="info", ms=1800){
  try { ui.toastMsg.textContent = msg; ui.toast.classList.add("show"); setTimeout(()=>ui.toast.classList.remove("show"), ms); } catch {}
}
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
const asBool = v => !!(v === true || v === "true" || v === 1 || v === "1" || v === "on");
function safeParseJSON(v){ try { return JSON.parse(v); } catch { return Array.isArray(v) ? v : []; } }
function parseListTextarea(text){ if (!text) return []; return String(text).split(/\r?\n|,/g).map(s => s.trim()).filter(Boolean); }
function debounce(fn, ms=200){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

// Sorting
function sortTitlesAZ(list){
  return (Array.isArray(list) ? [...list] : []).sort((a,b)=>
    String(a?.title ?? "").trim().localeCompare(String(b?.title ?? "").trim(), undefined, {sensitivity:"base"})
  );
}

// Airtable helpers
function headers(){ return { "Authorization": `Bearer ${AIRTABLE.API_KEY}`, "Content-Type":"application/json" }; }
function baseUrl(tableId = AIRTABLE.TABLE_ID){
  if (!AIRTABLE.BASE_ID || !tableId) throw new Error("Base URL undefined: missing BASE_ID or TABLE_ID");
  return `https://api.airtable.com/v0/${AIRTABLE.BASE_ID}/${encodeURIComponent(tableId)}`;
}
async function readRecord(tableId, id){
  const url = `${baseUrl(tableId)}/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Read failed: HTTP ${res.status} – ${await res.text().catch(()=>"(no body)")}`);
  return res.json();
}
async function listAll({ tableId = AIRTABLE.TABLE_ID, pageSize = 10, offset, sortField = "Order", sortDir = "asc", filterByFormula } = {}){
  const ps = Math.max(1, Math.min(100, Number(pageSize) || 10));
  const url = new URL(baseUrl(tableId));
  url.searchParams.set("pageSize", String(ps));
  if (sortField) { url.searchParams.set("sort[0][field]", sortField); url.searchParams.set("sort[0][direction]", sortDir); }
  if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
  if (offset) url.searchParams.set("offset", offset);
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status} – ${await res.text().catch(() => "(no body)")}`);
  return res.json();
}
async function createRecord(fields){
  const res = await fetch(baseUrl(), { method: "POST", headers: headers(), body: JSON.stringify({ records: [{ fields }], typecast: true })});
  if (!res.ok) throw new Error(`Create failed: HTTP ${res.status} – ${await res.text()}`);
  return res.json();
}
async function updateRecord(id, fields){
  const res = await fetch(baseUrl(), { method: "PATCH", headers: headers(), body: JSON.stringify({ records: [{ id, fields }], typecast: true })});
  if (!res.ok) throw new Error(`Update failed: HTTP ${res.status} – ${await res.text()}`);
  return res.json();
}
async function deleteRecord(id){
  const url = `${baseUrl()}/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status} – ${await res.text().catch(()=>"(no body)")}`);
  return res.json();
}

// ========= State =========
const state = {
  rows: [],
  modules: new Set(),
  manualModules: new Set(),

  titles: [],
  selectedTitleIds: [],
  assignedFieldName: AIRTABLE.TITLES_ASSIGNED_FIELD,
  mappingFieldName:  AIRTABLE.TITLES_MAPPING_FIELD,
  idsByTitleKey: Object.create(null),
  titleKeyById: Object.create(null),

  selectedModules: new Set(),
};

// ========= Options editor =========
function addOption(value = "") {
  // Prefer a local esc fallback in case esc() isn't defined globally
  const _esc = (s) => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const row = document.createElement("div");
  row.className = "opt inline";
  // NOTE: handle first for visibility; include hidden .opt-order for renumbering.
  row.innerHTML = `
    <span class="handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
    <input type="text" class="optText grow" placeholder="" value="${(typeof esc==='function'?esc:_esc)(value)}" />
    <label class="hint inline">
      <input type="radio" name="correctRadio" class="optCorrect" />
      Correct
    </label>
    <button class="btn btn-danger del" title="Remove" type="button">×</button>
    <input type="hidden" class="opt-order" value="0" />
  `;

 

  // Delete (and keep indices in sync)
  row.querySelector(".del").addEventListener("click", () => {
    row.remove();
    if (window.OptionDrag && typeof window.OptionDrag.renumber === "function") {
      window.OptionDrag.renumber();
    }
  });

  // Append and return
  ui.options.appendChild(row);

  // If you’re using the auto-inject handle helper, this is optional (we already added a handle)
  if (window.ensureOptionHandle) window.ensureOptionHandle(row);

  return row;
}

function getOptions(){
  return $$(".opt").map(row => {
    const text = row.querySelector(".optText").value.trim();
    const correct = row.querySelector(".optCorrect").checked;
    return { text, correct };
  }).filter(o => o.text);
}
function setOptions(arr=[], correctText=""){
  ui.options.innerHTML = "";
  if (!arr || !arr.length) arr = ["",""];
  arr.forEach(text => {
    const row = addOption(text);
    if (text === correctText) row.querySelector(".optCorrect").checked = true;
  });
}

// ========= Module helpers (Create/Edit) =========
const ADD_NEW_VALUE = "__ADD_NEW__";

function populateModuleSelect(modules){
  const sel = ui.moduleSelect; if (!sel) return;
  const list = Array.from(new Set([
    ...Array.from(modules || []),
    ...Array.from(state.manualModules || [])
  ])).sort((a,b)=>a.localeCompare(b));

  sel.innerHTML =
    `<option value="">(none)</option>` +
    list.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("") +
    `<option value="${ADD_NEW_VALUE}">+ Add new…</option>`;

  // Quick-pick chips
  const chips = ui.moduleChips;
  if (chips){
    chips.innerHTML = list.map(m => `<span class="chip" data-m="${esc(m)}">${esc(m)}</span>`).join("");
    chips.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {
      if (ui.moduleSelect) ui.moduleSelect.value = ch.dataset.m || "";
      if (ui.moduleNewWrap) ui.moduleNewWrap.classList.add("hide");
      if (ui.moduleInput) ui.moduleInput.value = "";
    }));
  }
}

function currentModuleValue(){
  const selVal = ui.moduleSelect ? ui.moduleSelect.value : "";
  if (selVal === ADD_NEW_VALUE) {
    return (ui.moduleInput?.value || "").trim();
  }
  return selVal || "";
}

function toggleModuleNewVisibility(){
  const selVal = ui.moduleSelect ? ui.moduleSelect.value : "";
  if (!ui.moduleNewWrap) return;
  if (selVal === ADD_NEW_VALUE) {
    ui.moduleNewWrap.classList.remove("hide");
    setTimeout(()=>ui.moduleInput?.focus(), 0);
  } else {
    ui.moduleNewWrap.classList.add("hide");
    if (ui.moduleInput) ui.moduleInput.value = "";
  }
}

// ========= Type visibility =========
function updateTypeVisibility(){
  const type = (ui.questionType?.value || "MC").toUpperCase();
  if (ui.mcBlock) ui.mcBlock.style.display = (type === "MC") ? "" : "none";
  if (ui.fitbBlock) ui.fitbBlock.style.display = (type === "FITB") ? "" : "none";
}

// ========= Form helpers =========
function genQuestionId(prefix="q"){ return `${prefix}_${Math.random().toString(36).slice(2,8)}`; }

function readForm(){
  const type = (ui.questionType?.value || "MC").toUpperCase();
  const slide = (ui.slideId?.value || "").trim();
  const order = Number(ui.order?.value || 0);
  const qid = (ui.questionId?.value || "").trim() || genQuestionId("q");
  const qtext = (ui.questionText?.value || "").trim();

  if (!qtext) throw new Error("Question text is required.");

  // Module value (with '+ Add new…' validation)
  const selVal = ui.moduleSelect ? ui.moduleSelect.value : "";
  const typed = (ui.moduleInput?.value || "").trim();
  let moduleVal = "";
  if (selVal === ADD_NEW_VALUE) {
    if (!typed) throw new Error("Enter a new module name or choose an existing module.");
    moduleVal = typed;
    state.manualModules.add(moduleVal);
  } else {
    moduleVal = selVal || "";
  }

  const fields = {
    "Type": type,
    "Slide ID": slide,
    "Order": order,
    "QuestionId": qid,
    "Question": qtext,
    "Required": true,
    "Active": true,
    "Module": moduleVal || undefined,
  };

  if (type === "MC") {
    const opts = getOptions();
    if (opts.length === 0) throw new Error("Add at least one option.");
    const correct = (opts.find(o => o.correct) || {}).text || "";
    fields["Options (JSON)"] = JSON.stringify(opts.map(o => o.text));
    fields["Correct"] = correct;
    fields["FITB Answers (JSON)"] = undefined;
    fields["FITB Use Regex"] = undefined;
    fields["FITB Case Sensitive"] = undefined;
  } else {
    const list = parseListTextarea(ui.fitbAnswers?.value || "");
    if (!list.length) throw new Error("Add at least one accepted answer.");
    fields["FITB Answers (JSON)"] = JSON.stringify(list);
    fields["FITB Use Regex"] = !!(ui.fitbUseRegex && ui.fitbUseRegex.checked);
    fields["FITB Case Sensitive"] = !!(ui.fitbCaseSensitive && ui.fitbCaseSensitive.checked);
    fields["Options (JSON)"] = undefined;
    fields["Correct"] = undefined;
  }
  return fields;
}

function fillForm(fields){
  const type = (fields["Type"] || "MC").toUpperCase();
  if (ui.questionType) ui.questionType.value = type;
  updateTypeVisibility();

  if (ui.slideId) ui.slideId.value = fields["Slide ID"] || "";
  if (ui.order) ui.order.value = Number(fields["Order"] || 1);
  if (ui.questionId) ui.questionId.value = fields["QuestionId"] || "";
  if (ui.questionText) ui.questionText.value = fields["Question"] || "";

  const m = fields["Module"] || "";
  if (ui.moduleSelect) ui.moduleSelect.value = m && optionExists(ui.moduleSelect, m) ? m : "";
  if (ui.moduleNewWrap) ui.moduleNewWrap.classList.add("hide");
  if (ui.moduleInput) ui.moduleInput.value = "";

  if (type === "MC") {
    const arr = safeParseJSON(fields["Options (JSON)"]);
    setOptions(arr, fields["Correct"] || "");
  } else {
    const answers = safeParseJSON(fields["FITB Answers (JSON)"]);
    if (ui.fitbAnswers) ui.fitbAnswers.value = (answers || []).join("\n");
    if (ui.fitbUseRegex) ui.fitbUseRegex.checked = asBool(fields["FITB Use Regex"]);
    if (ui.fitbCaseSensitive) ui.fitbCaseSensitive.checked = asBool(fields["FITB Case Sensitive"]);
  }
}

function optionExists(selectEl, value){
  return Array.from(selectEl.options).some(o => o.value === value);
}

function resetForm(){
  if (ui.questionType) ui.questionType.value = "MC";
  updateTypeVisibility();
  if (ui.slideId) ui.slideId.value = "";
  if (ui.order) ui.order.value = "1";
  if (ui.questionId) ui.questionId.value = "";
  if (ui.questionText) ui.questionText.value = "";
  if (ui.moduleSelect) ui.moduleSelect.value = "";
  if (ui.moduleNewWrap) ui.moduleNewWrap.classList.add("hide");
  if (ui.moduleInput) ui.moduleInput.value = "";
  setOptions(["",""]);
  if (ui.fitbAnswers) ui.fitbAnswers.value = "";
  if (ui.fitbUseRegex) ui.fitbUseRegex.checked = false;
  if (ui.fitbCaseSensitive) ui.fitbCaseSensitive.checked = false;
}

// ========= Questions list rendering =========
function groupByModule(rows){
  const groups = new Map();
  rows.forEach(r => {
    const f = r.fields || {};
    const name = (f.Module || "(no module)").trim() || "(no module)";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(r);
  });
  return groups;
}
function filterRows(q){
  const s = (q||"").trim().toLowerCase();
  const showActive = ui.fltActive ? ui.fltActive.checked : true;
  const showInactive = ui.fltInactive ? ui.fltInactive.checked : true;
  return state.rows.filter(r => {
    const f = r.fields || {};
    const hay = `${f.Type||""}\n${f.Question||""}\n${f["Slide ID"]||""}\n${f.QuestionId||""}\n${f.Module||""}`.toLowerCase();
    const passesSearch = !s || hay.includes(s);
    const isActive = asBool(f.Active);
    const passesFlags = (isActive && showActive) || (!isActive && showInactive);
    return passesSearch && passesFlags;
  });
}
function summarizeQuestion(f){
  const type = (f.Type || "MC").toUpperCase();
  if (type === "FITB") {
    const answers = safeParseJSON(f["FITB Answers (JSON)"]) || [];
    const mode = asBool(f["FITB Use Regex"]) ? "regex" : "plain";
    const cs = asBool(f["FITB Case Sensitive"]) ? "CS" : "CI";
    return `FITB (${mode}, ${cs}) – Accepts ${answers.length} answer(s)`;
  } else {
    const arr = safeParseJSON(f["Options (JSON)"]) || [];
    const correct = f["Correct"] || "(none)";
    return `MC – ${arr.length} option(s), correct: “${correct}”`;
  }
}
function renderModulesView(rows){
  const el = ui.moduleGroups;
  if (!el) return;
  el.innerHTML = "";
  if (!rows || !rows.length){
    el.innerHTML = `<div class="muted small">No questions found.</div>`;
    return;
  }
  const groups = groupByModule(rows);
  const mods = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b));
  const out = [];
  for (const modName of mods){
    const list = groups.get(modName) || [];
    const count = list.length;
    const body = list.map(r => {
      const f = r.fields || {};
      const qtxt = esc(f.Question || "");
      const id = esc(r.id);
      const meta = summarizeQuestion(f);
      return `<div class="qline">
        <div class="qtext">
          <div><strong>${qtxt}</strong></div>
          <div class="muted small">${esc(meta)}</div>
        </div>
        <div class="actions" style="display:flex; gap:8px">
          <button class="btn btn-ghost edit" data-id="${id}">Edit</button>
          <button class="btn btn-danger delete" data-id="${id}">Delete</button>
        </div>
      </div>`;
    }).join("");
    out.push(`<div class="mod" data-mod="${esc(modName)}">
      <button class="mod-head" type="button" aria-expanded="false">
        <span>${esc(modName)}</span>
        <span class="mod-count">${count}</span>
      </button>
      <div class="mod-body" hidden>${body}</div>
    </div>`);
  }
  el.innerHTML = out.join("");
  el.querySelectorAll(".mod-head").forEach(btn => {
    btn.addEventListener("click", () => {
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
      const body = btn.parentElement.querySelector(".mod-body");
      if (body) body.hidden = !body.hidden;
    });
  });
  el.querySelectorAll(".edit").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.getAttribute("data-id");
      const row = state.rows.find(x => x.id === id);
      if (!row) return;
      fillForm(row.fields);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  el.querySelectorAll(".delete").forEach(b => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-id");
      const row = state.rows.find(x => x.id === id);
      const title = row?.fields?.Question ? `“${row.fields.Question.slice(0, 80)}${row.fields.Question.length>80?"…":""}”` : `ID ${id}`;
      if (!confirm(`Delete this question ${title}?\nThis action cannot be undone.`)) return;
      try {
        await deleteRecord(id);
        toast("Deleted");
        state.rows = state.rows.filter(r => r.id !== id);
        renderModulesView(filterRows(ui.search ? ui.search.value : ""));
        await refreshList();
      } catch (e) {
        console.error(e);
        toast(e?.message || "Delete failed", "bad");
      }
    });
  });
}

// ========= List / search / paging =========
async function refreshList(){
  if (ui.listStatus) ui.listStatus.textContent = "Loading…";
  try {
    const data = await listAll({ tableId: AIRTABLE.TABLE_ID, pageSize: 100, sortField:"Order", sortDir:"asc" });
    state.rows = data.records || [];
    state.modules = new Set(state.rows.map(r => (r.fields||{}).Module).filter(Boolean));
    populateModuleSelect(state.modules);
    renderModulesView(filterRows(ui.search ? ui.search.value : ""));
    if (ui.listStatus) ui.listStatus.textContent = `Loaded ${state.rows.length} question${state.rows.length===1?"":"s"}.`;
    renderModuleList();
    renderModuleTitleLinker();
  } catch (e) {
    console.error("[Admin] refreshList failed:", e);
    if (ui.listStatus) ui.listStatus.textContent = "Load failed.";
  }
}

// ========= Titles (load + helpers) =========
function parseModulesFromLongText(v){ if (!v) return []; return String(v).split(/[\n,;]+/g).map(s => s.trim()).filter(Boolean); }
function joinModulesForLongText(arr){ return (arr || []).map(s => String(s).trim()).filter(Boolean).join("\n"); }
function normalizeTitle(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        if (typeof item.name === "string") return item.name.trim();
        if (typeof item.id === "string") return item.id;
      }
    } return v.length ? String(v[0]) : "";
  }
  if (typeof v === "object") { if (typeof v.name === "string") return v.name.trim(); return JSON.stringify(v); }
  try { return String(v); } catch { return ""; }
}
function detectAssignedFieldNameFromRecordFields(fieldsObj){
  if (!fieldsObj) return null;
  const keys = Object.keys(fieldsObj);
  const want = (AIRTABLE.TITLES_ASSIGNED_FIELD || "").toLowerCase();
  let found = keys.find(k => k.toLowerCase() === want);
  if (found) return found;
  const cand = keys.find(k => { const s = k.toLowerCase(); return s.includes("assigned") && s.includes("module"); });
  if (cand) return cand;
  return keys.find(k => k.toLowerCase().includes("modules")) || null;
}
function detectMappingFieldNameFromRecordFields(fieldsObj){
  if (!fieldsObj) return null;
  const keys = Object.keys(fieldsObj);
  if (AIRTABLE.TITLES_MAPPING_FIELD) {
    const want = AIRTABLE.TITLES_MAPPING_FIELD.toLowerCase();
    const exact = keys.find(k => k.toLowerCase() === want);
    if (exact) return exact;
  }
  const cand = keys.find(k => { const s = k.toLowerCase(); return s.includes("assigned") && (s.includes("map") || s.includes("mapping")); });
  return cand || null;
}
async function listAllTitlesPage(offset){
  return listAll({
    tableId: AIRTABLE.TITLES_TABLE_ID,
    pageSize: 100,
    offset,
    sortField: AIRTABLE.TITLES_FIELD_NAME,
    sortDir: "asc"
  });
}
async function fetchDistinctTitles(){
  const all = [];
  let offset;
  state.idsByTitleKey = Object.create(null);
  state.titleKeyById  = Object.create(null);
  let detectedAssigned = null;
  let detectedMapping = null;
  do {
    const data = await listAllTitlesPage(offset);
    (data.records || []).forEach(r => {
      const f = r.fields || {};
      if (!detectedAssigned) detectedAssigned = detectAssignedFieldNameFromRecordFields(f);
      if (!detectedMapping) detectedMapping = detectMappingFieldNameFromRecordFields(f);
      const rawTitle = f[AIRTABLE.TITLES_FIELD_NAME];
      const title = normalizeTitle(rawTitle);
      if (!title) return;
      const assigned = (detectedAssigned && typeof f[detectedAssigned] !== "undefined")
        ? parseModulesFromLongText(f[detectedAssigned])
        : (typeof f[AIRTABLE.TITLES_ASSIGNED_FIELD] !== "undefined")
            ? parseModulesFromLongText(f[AIRTABLE.TITLES_ASSIGNED_FIELD])
            : [];
      const rec = { id: r.id, title, assigned };
      all.push(rec);
      const key = title.toLowerCase().trim();
      state.titleKeyById[r.id] = key;
      if (!state.idsByTitleKey[key]) state.idsByTitleKey[key] = [];
      state.idsByTitleKey[key].push(r.id);
    });
    offset = data.offset;
  } while (offset);

  state.assignedFieldName = detectedAssigned || state.assignedFieldName;
  state.mappingFieldName  = detectedMapping  || state.mappingFieldName;

  const seen = new Set();
  const unique = [];
  for (const row of all) {
    const key = row.title.toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(row); }
  }
  state.titles = sortTitlesAZ(unique);
  populateTitleSelect(state.titles);
  updateTitleCount();
  renderModuleTitleLinker();
  return state.titles;
}
function populateTitleSelect(list){
  if (!ui.titleSelect) return;
  const sorted = sortTitlesAZ(Array.isArray(list) ? list : []);
  ui.titleSelect.innerHTML = sorted.map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("");
}
function getSelectedTitleIds(){ const sel = ui.titleSelect; if (!sel) return []; return Array.from(sel.selectedOptions || []).map(o => o.value).filter(Boolean); }
function updateTitleCount(){
  if (!ui.titleCount) return;
  const total = state.titles.length;
  const selected = getSelectedTitleIds().length;
  ui.titleCount.textContent = `${total} titles • ${selected} selected`;
}

// ========= Assignment logic =========
function computeAssignedAgg(selectedIds){
  const chosen = state.titles.filter(t => selectedIds.includes(t.id));
  const lists = chosen.map(t => new Set((t.assigned || []).map(String)));
  if (lists.length === 0) return { all: new Set(), some: new Set() };
  const union = new Set(); lists.forEach(s => s.forEach(x => union.add(x)));
  let intersection = new Set(lists[0]);
  for (let i=1;i<lists.length;i++){ const next = new Set(); lists[i].forEach(x => { if (intersection.has(x)) next.add(x); }); intersection = next; }
  return { all: intersection, some: union };
}

function renderModuleList(){
  if (!ui.moduleList) return;
  const query = (ui.moduleSearch?.value || "").toLowerCase().trim();
  const selectedTitles = getSelectedTitleIds();
  const { all, some } = computeAssignedAgg(selectedTitles);

  const itemsSet = new Set([ ...Array.from(state.modules), ...Array.from(state.manualModules) ]);
  const items = Array.from(itemsSet).sort((a,b)=>a.localeCompare(b));

  const rows = items
    .filter(m => !query || m.toLowerCase().includes(query))
    .map(m => {
      const isAll = all.has(m);
      const isSome = !isAll && some.has(m);
      return { name: m, rank: isAll ? 0 : (isSome ? 1 : 2), isAll, isSome };
    });

  rows.sort((a,b) => (a.rank !== b.rank) ? a.rank - b.rank : a.name.localeCompare(b.name));

  if (rows.length === 0) { ui.moduleList.innerHTML = ""; return; }

  ui.moduleList.innerHTML = rows.map(r => {
    const selected = state.selectedModules.has(r.name);
    const cls = `${r.isAll ? "is-all" : r.isSome ? "is-some" : ""} ${selected ? "selected" : ""}`.trim();
    const tag = r.isAll ? "Assigned (all)" : r.isSome ? "Assigned (some)" : "Not assigned";
    return `<li class="${cls}" data-module="${esc(r.name)}">
      <div class="pick">
        <input type="checkbox" class="pickbox"${selected?" checked":""} aria-label="select module ${esc(r.name)}"/>
        <div>
          <div class="name">${esc(r.name)}</div>
          <div class="meta">${tag}</div>
        </div>
      </div>
      <span class="tag">${tag}</span>
    </li>`;
  }).join("");

  ui.moduleList.querySelectorAll("li").forEach(li => {
    li.addEventListener("click", (ev) => {
      const mod = li.getAttribute("data-module");
      if (!mod) return;
      const selected = state.selectedModules.has(mod);
      if (selected) state.selectedModules.delete(mod); else state.selectedModules.add(mod);
      renderModuleList();
      updateAssignStatusText();
    });
  });

  updateAssignStatusText();
}
function updateAssignStatusText(){
  const selectedTitles = getSelectedTitleIds();
  const mods = Array.from(state.selectedModules);
  if (!ui.assignStatus) return;
  if (!selectedTitles.length) { ui.assignStatus.textContent = "Select one or more titles, then pick modules."; return; }
  ui.assignStatus.textContent = mods.length ? `Ready: ${mods.length} module(s) selected.` : `All selected titles share the same module set.`;
}

async function batchPatch(tableId, updates){
  const BATCH = 10;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    const res = await fetch(baseUrl(tableId), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ records: chunk, typecast: true })
    });
    if (!res.ok) throw new Error(`Update failed: HTTP ${res.status} – ${await res.text()}`);
  }
}

async function assignSelected(){
  const selectedIds = getSelectedTitleIds();
  if (!selectedIds.length) return toast("Select at least one title.", "bad");
  if (!state.selectedModules.size) return toast("Pick module(s) to assign.", "bad");

  const updates = [];
  selectedIds.forEach(id => {
    const t = state.titles.find(x => x.id === id);
    const set = new Set([...(t?.assigned || []), ...state.selectedModules]);
    const fields = {};
    fields[state.assignedFieldName] = joinModulesForLongText(Array.from(set).sort((a,b)=>a.localeCompare(b)));
    fields[state.mappingFieldName]  = `${t?.title || ""}: ${fields[state.assignedFieldName]}`;
    updates.push({ id, fields });
  });

  await batchPatch(AIRTABLE.TITLES_TABLE_ID, updates);
  toast("Assigned.", "ok");
  state.selectedModules.clear();
  await fetchDistinctTitles();
  renderModuleList();
  renderModuleTitleLinker();
}

async function unassignSelected(){
  const selectedIds = getSelectedTitleIds();
  if (!selectedIds.length) return toast("Select at least one title.", "bad");
  if (!state.selectedModules.size) return toast("Pick module(s) to unassign.", "bad");

  const updates = [];
  selectedIds.forEach(id => {
    const t = state.titles.find(x => x.id === id);
    const set = new Set((t?.assigned || []).filter(m => !state.selectedModules.has(m)));
    const fields = {};
    fields[state.assignedFieldName] = joinModulesForLongText(Array.from(set).sort((a,b)=>a.localeCompare(b)));
    fields[state.mappingFieldName]  = `${t?.title || ""}: ${fields[state.assignedFieldName]}`;
    updates.push({ id, fields });
  });

  await batchPatch(AIRTABLE.TITLES_TABLE_ID, updates);
  toast("Unassigned.", "ok");
  state.selectedModules.clear();
  await fetchDistinctTitles();
  renderModuleList();
  renderModuleTitleLinker();
}

// ========= Module ↔ Titles matrix =========
function buildModuleToTitlesMap(){
  const map = new Map();
  const allModules = new Set([ ...Array.from(state.modules), ...Array.from(state.manualModules) ]);
  state.titles.forEach(t => (t.assigned||[]).forEach(m => allModules.add(m)));
  allModules.forEach(m => map.set(m, []));
  state.titles.forEach(t => { (t.assigned || []).forEach(m => { if (!map.has(m)) map.set(m, []); map.get(m).push({ id: t.id, title: t.title }); }); });
  return map;
}
function titlesNotLinkedToModule(moduleName){
  const linkedIds = new Set((buildModuleToTitlesMap().get(moduleName) || []).map(t => t.id));
  return state.titles.filter(t => !linkedIds.has(t.id));
}
function renderModuleTitleLinker(){
  if (!ui.modTitleList) return;
  const map = buildModuleToTitlesMap();
  const modules = Array.from(map.keys()).sort((a,b)=>a.localeCompare(b));
  if (modules.length === 0){
    ui.modTitleList.innerHTML = `<div class="module-empty">No modules yet. Create questions with a Module or add modules above to get started.</div>`;
    return;
  }

  const html = [
    `<div class="modtitle-grid">`,
    ...modules.map((m, idx) => {
      const list = map.get(m) || [];
      const selectId = `mt-add-${idx}`;
      const options = titlesNotLinkedToModule(m).map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("");
      return `
        <div class="modtitle-card" data-module="${esc(m)}">
          <div class="modtitle-head">
            <div class="modtitle-name">${esc(m)}</div>
            <div class="muted small">${list.length} title${list.length===1?"":"s"}</div>
          </div>
          <div class="chips">
            ${ list.length
                ? list.sort((a,b)=>a.title.localeCompare(b.title))
                      .map(t => `<span class="chip" data-title-id="${esc(t.id)}"><span>${esc(t.title)}</span><span class="x" title="Remove from ${esc(m)}" aria-label="Remove">✕</span></span>`).join("")
                : `<span class="muted small">No titles linked.</span>`
            }
          </div>
          <div class="addbar">
            <select id="${selectId}">
              <option value="">Add title…</option>
              ${options}
            </select>
            <button class="btn" data-add-for="${esc(m)}" data-select="#${selectId}">Add</button>
          </div>
        </div>
      `;
    }),
    `</div>`
  ].join("");

  ui.modTitleList.innerHTML = html;

  // Remove handlers
  ui.modTitleList.querySelectorAll(".chip .x").forEach(x => {
    x.addEventListener("click", async (ev) => {
      const chip = ev.currentTarget.closest(".chip");
      const card = ev.currentTarget.closest(".modtitle-card");
      const moduleName = card?.getAttribute("data-module");
      const titleId = chip?.getAttribute("data-title-id");
      if (!moduleName || !titleId) return;
      try {
        await unassignOne(titleId, moduleName);
        toast(`Removed "${moduleName}" from selected title.`, "ok");
        await fetchDistinctTitles();
        renderModuleTitleLinker();
        renderModuleList();
      } catch(e){ console.error(e); toast(e.message || "Unassign failed", "bad"); }
    });
  });

  // Add handlers
  ui.modTitleList.querySelectorAll("[data-add-for]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const moduleName = btn.getAttribute("data-add-for");
      const sel = ui.modTitleList.querySelector(btn.getAttribute("data-select"));
      const val = sel ? sel.value : "";
      if (!moduleName || !val) return;
      try {
        await assignOne(val, moduleName);
        toast(`Added title to "${moduleName}".`, "ok");
        await fetchDistinctTitles();
        renderModuleTitleLinker();
        renderModuleList();
      } catch(e){ console.error(e); toast(e.message || "Assign failed", "bad"); }
    });
  });
}

async function assignOne(titleId, moduleName){
  const t = state.titles.find(x => x.id === titleId);
  const set = new Set([...(t?.assigned || []), moduleName]);
  const fields = {};
  fields[state.assignedFieldName] = joinModulesForLongText(Array.from(set).sort((a,b)=>a.localeCompare(b)));
  fields[state.mappingFieldName]  = `${t?.title || ""}: ${fields[state.assignedFieldName]}`;
  await batchPatch(AIRTABLE.TITLES_TABLE_ID, [{ id: titleId, fields }]);
}
async function unassignOne(titleId, moduleName){
  const t = state.titles.find(x => x.id === titleId);
  const set = new Set((t?.assigned || []).filter(m => m !== moduleName));
  const fields = {};
  fields[state.assignedFieldName] = joinModulesForLongText(Array.from(set).sort((a,b)=>a.localeCompare(b)));
  fields[state.mappingFieldName]  = `${t?.title || ""}: ${fields[state.assignedFieldName]}`;
  await batchPatch(AIRTABLE.TITLES_TABLE_ID, [{ id: titleId, fields }]);
}

// ========= Events =========
if (ui.btnAddOption) ui.btnAddOption.addEventListener("click", () => addOption(""));
if (ui.btnClearOptions) ui.btnClearOptions.addEventListener("click", () => setOptions(["",""]));
if (ui.questionType) ui.questionType.addEventListener("change", updateTypeVisibility);

// Save / Reset
if (ui.btnSave) ui.btnSave.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    const fields = readForm();
    await createRecord(fields);
    toast("Created");
    resetForm();
    await refreshList();
  } catch (err) { toast(err?.message || "Save failed", "bad"); }
});
if (ui.btnReset) ui.btnReset.addEventListener("click", (e) => { e.preventDefault(); resetForm(); });

// Module dropdown reveal: '+ Add new…'
if (ui.moduleSelect) ui.moduleSelect.addEventListener("change", toggleModuleNewVisibility);
// Commit new module name on Enter
if (ui.moduleInput) ui.moduleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const name = (ui.moduleInput.value || "").trim();
    if (!name) return;
    state.manualModules.add(name);
    // Rebuild dropdown so the new module appears as a normal option
    populateModuleSelect(state.modules);
    ui.moduleSelect.value = name;
    toggleModuleNewVisibility();
    toast(`Added module “${name}”`, "ok");
  }
});

// Search/filter live for Questions list
if (ui.search) ui.search.addEventListener('input', () => renderModulesView(filterRows(ui.search.value)));
if (ui.fltActive) ui.fltActive.addEventListener('change', () => renderModulesView(filterRows(ui.search.value)));
if (ui.fltInactive) ui.fltInactive.addEventListener('change', () => renderModulesView(filterRows(ui.search.value)));
if (ui.btnRefresh) ui.btnRefresh.addEventListener('click', () => { refreshList(); fetchDistinctTitles(); });

// Assignment panel events
if (ui.titleSelect) ui.titleSelect.addEventListener("change", () => { updateTitleCount(); renderModuleList(); });
if (ui.titleSearch) ui.titleSearch.addEventListener("input", debounce(() => {
  const q = ui.titleSearch.value.toLowerCase().trim();
  const filtered = !q ? state.titles : state.titles.filter(t => (t.title||"").toLowerCase().includes(q));
  ui.titleSelect.innerHTML = filtered.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join("");
  updateTitleCount();
  renderModuleList();
}, 150));
if (ui.btnSelectAllTitles) ui.btnSelectAllTitles.addEventListener("click", () => {
  const opts = $$("#titleSelect option"); opts.forEach(o => o.selected = true);
  ui.titleSelect.dispatchEvent(new Event("change"));
});
if (ui.btnClearTitles) ui.btnClearTitles.addEventListener("click", () => {
  $$("#titleSelect option").forEach(o => o.selected = false);
  ui.titleSelect.dispatchEvent(new Event("change"));
});

if (ui.moduleSearch) ui.moduleSearch.addEventListener("input", debounce(renderModuleList, 150));
if (ui.btnSelectAllModules) ui.btnSelectAllModules.addEventListener("click", () => {
  const itemsSet = new Set([ ...Array.from(state.modules), ...Array.from(state.manualModules) ]);
  Array.from(itemsSet).forEach(m => state.selectedModules.add(m));
  renderModuleList();
});
if (ui.btnClearModules) ui.btnClearModules.addEventListener("click", () => { state.selectedModules.clear(); renderModuleList(); });

if (ui.btnAssign) ui.btnAssign.addEventListener("click", assignSelected);
if (ui.btnUnassign) ui.btnUnassign.addEventListener("click", unassignSelected);

// ========= Init =========
(async function init(){
  try {
    updateTypeVisibility();
    if (ui.options && ui.options.children.length === 0) { setOptions(["","","",""]); }
    await refreshList();
    await fetchDistinctTitles();
    renderModuleList();
    renderModuleTitleLinker();
    toggleModuleNewVisibility(); // ensure hidden on load
  } catch (e) { console.error(e); toast(e.message || "Init failed", "bad"); }
})();
/* =========================
 * Module → Slides & GAS
 * ========================= */
(function ModMapModule(){
  // --- CONFIG: set your Airtable table for mappings here ---
  const MODMAP_TABLE_ID = "Table3"; // You can change to a real table ID like "tblXXXX..." or a table name
  // Field names in that table (create these columns in Airtable):
  // - Module (single line text)
  // - PresentationId (single line text)
  // - GasUrl (single line text)
  // - Active (checkbox)

  // --- UI refs ---
  const mm = {
    root: document.getElementById("modmap-root"),
    id:   document.getElementById("modmap-id"),
    module: document.getElementById("modmap-module"),
    pid:    document.getElementById("modmap-pid"),
    gas:    document.getElementById("modmap-gas"),
    active: document.getElementById("modmap-active"),
    quick:  document.getElementById("modmap-quick"),
    status: document.getElementById("modmap-status"),
    save:   document.getElementById("modmap-save"),
    reset:  document.getElementById("modmap-reset"),
    list:   document.getElementById("modmap-list"),
    search: document.getElementById("modmap-search"),
    refresh:document.getElementById("modmap-refresh"),
    ping:   document.getElementById("modmap-ping"),
    openSlides: document.getElementById("modmap-open-slides"),
    form:   document.getElementById("modmap-form")
  };

  if (!mm.root) return; // Section not on page; bail safely.

  // --- Local state ---
  const s = {
    rows: [], // airtable records
    query: ""
  };

  // --- Helpers ---
  const setStatus = (msg, kind="") => {
    if (!mm.status) return;
    mm.status.textContent = msg || "";
    mm.status.classList.remove("ok", "bad");
    if (kind) mm.status.classList.add(kind);
  };
  const trim = v => (v||"").trim();

  function slidesUrlFromId(pid){
    const p = trim(pid);
    if (!p) return "";
    return `https://docs.google.com/presentation/d/${encodeURIComponent(p)}/edit`;
  }

  function validForm(data){
    if (!data.Module)  return "Module is required.";
    if (!data.PresentationId && !data.GasUrl) {
      return "Provide at least a Slides Presentation ID or a GAS Web App URL.";
    }
    return "";
  }

  // Build quick-pick chips from known modules (populated by your Questions refresh)
  function renderQuickChips(){
    if (!mm.quick) return;
    const mods = Array.from((window.state?.modules || new Set())).sort((a,b)=>a.localeCompare(b));
    if (!mods.length){
      mm.quick.innerHTML = `<span class="muted small">No modules detected yet.</span>`;
      return;
    }
    mm.quick.innerHTML = mods.map(m => `<span class="chip" data-m="${esc(m)}">${esc(m)}</span>`).join("");
    mm.quick.querySelectorAll(".chip").forEach(ch => {
      ch.addEventListener("click", () => { mm.module.value = ch.getAttribute("data-m") || ""; });
    });
  }

  // --- Airtable calls (reusing your helpers) ---
  async function listAllModMaps(offset){
    // Sort by Module asc for nicer UX
    return listAll({ tableId: MODMAP_TABLE_ID, pageSize: 100, offset, sortField: "Module", sortDir: "asc" });
  }

  async function fetchAll(){
    const out = [];
    let offset;
    do {
      const page = await listAllModMaps(offset);
      (page.records || []).forEach(r => out.push(r));
      offset = page.offset;
    } while (offset);
    return out;
  }

  async function createModMap(fields){
    const res = await fetch(baseUrl(MODMAP_TABLE_ID), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    if (!res.ok) throw new Error(`Create failed: HTTP ${res.status} – ${await res.text()}`);
    return res.json();
  }

  async function updateModMap(id, fields){
    const res = await fetch(baseUrl(MODMAP_TABLE_ID), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ records: [{ id, fields }], typecast: true })
    });
    if (!res.ok) throw new Error(`Update failed: HTTP ${res.status} – ${await res.text()}`);
    return res.json();
  }

  async function deleteModMap(id){
    const url = `${baseUrl(MODMAP_TABLE_ID)}/${encodeURIComponent(id)}`;
    const res = await fetch(url, { method: "DELETE", headers: headers() });
    if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status} – ${await res.text()}`);
    return res.json();
  }

  // --- Render saved mappings ---
  function renderList(){
    if (!mm.list) return;
    const q = (s.query||"").toLowerCase();

    const items = s.rows.filter(r => {
      const f = r.fields || {};
      const hay = `${f.Module||""}\n${f.PresentationId||""}\n${f.GasUrl||""}`.toLowerCase();
      return !q || hay.includes(q);
    });

    if (!items.length){
      mm.list.innerHTML = `
        <div class="module-empty" style="margin-top:8px">
          No mappings yet. Create one above.
        </div>`;
      return;
    }

    mm.list.innerHTML = items.map(r => {
      const f = r.fields || {};
      const mod = esc(f.Module || "(no module)");
      const pid = esc(f.PresentationId || "");
      const gas = esc(f.GasUrl || "");
      const active = !!f.Active;
      const tag = active ? `<span class="badge on">Active</span>` : `<span class="badge off">Inactive</span>`;
      const meta = [
        pid ? `Slides: ${pid.slice(0, 10)}…` : null,
        gas ? `GAS: ${gas.slice(0, 28)}…` : null
      ].filter(Boolean).join(" • ");

      return `
        <li data-id="${esc(r.id)}">
          <div class="pick">
            <div>
              <div class="name">${mod}</div>
              <div class="meta">${esc(meta)}</div>
            </div>
          </div>
          ${tag}
          <div class="row actions">
            <button class="btn btn-ghost btn-mini" data-mm="edit">Edit</button>
            <button class="btn btn-danger btn-mini" data-mm="del">Delete</button>
          </div>
        </li>
      `;
    }).join("");

    // wire up actions
    mm.list.querySelectorAll("li").forEach(li => {
      const id = li.getAttribute("data-id");
      const row = s.rows.find(x => x.id === id);

      const btnE = li.querySelector('[data-mm="edit"]');
      const btnD = li.querySelector('[data-mm="del"]');

      if (btnE) btnE.addEventListener("click", () => fillFormFromRow(row));
      if (btnD) btnD.addEventListener("click", async () => {
        const name = row?.fields?.Module || "(no module)";
        if (!confirm(`Delete mapping for “${name}”?`)) return;
        try {
          await deleteModMap(id);
          toast("Deleted", "ok");
          await refresh();
        } catch(e){ console.error(e); toast(e.message||"Delete failed","bad"); }
      });
    });
  }

  // --- Form helpers ---
  function clearForm(){
    if (mm.id) mm.id.value = "";
    if (mm.module) mm.module.value = "";
    if (mm.pid) mm.pid.value = "";
    if (mm.gas) mm.gas.value = "";
    if (mm.active) mm.active.checked = true;
    if (mm.openSlides) mm.openSlides.disabled = true;
    setStatus("");
  }

  function readForm(){
    const data = {
      Module: trim(mm.module?.value),
      PresentationId: trim(mm.pid?.value),
      GasUrl: trim(mm.gas?.value),
      Active: !!mm.active?.checked
    };
    const err = validForm(data);
    if (err) throw new Error(err);
    return data;
  }

  function fillFormFromRow(row){
    const f = row?.fields || {};
    if (mm.id) mm.id.value = row?.id || "";
    if (mm.module) mm.module.value = f.Module || "";
    if (mm.pid) mm.pid.value = f.PresentationId || "";
    if (mm.gas) mm.gas.value = f.GasUrl || "";
    if (mm.active) mm.active.checked = !!f.Active;
    if (mm.openSlides) mm.openSlides.disabled = !trim(f.PresentationId);
    setStatus(`Editing “${f.Module || ""}”`);
    window.scrollTo({ top: mm.root.offsetTop - 12, behavior: "smooth" });
  }

  // --- Actions ---
  async function refresh(){
    setStatus("Loading…");
    try {
      // ensure quick chips show current modules
      renderQuickChips();
      s.rows = await fetchAll();
      renderList();
      setStatus(`Loaded ${s.rows.length} mapping${s.rows.length===1?"":"s"}.`, "ok");
    } catch (e) {
      console.error(e);
      setStatus("Load failed.", "bad");
      toast(e.message || "Load failed", "bad");
    }
  }

  async function onSave(e){
    e?.preventDefault?.();
    try {
      const fields = readForm();
      mm.save.disabled = true;
      setStatus("Saving…");

      const id = trim(mm.id?.value);
      if (id) {
        await updateModMap(id, fields);
      } else {
        await createModMap(fields);
      }

      toast("Saved", "ok");
      clearForm();
      await refresh();
    } catch(e){
      console.error(e);
      toast(e.message || "Save failed", "bad");
      setStatus(e.message || "Save failed", "bad");
    } finally {
      mm.save.disabled = false;
    }
  }

  function onReset(){ clearForm(); }

  function onSearch(){
    s.query = trim(mm.search?.value).toLowerCase();
    renderList();
  }

  async function onPing(){
    const url = trim(mm.gas?.value);
    if (!url) { toast("Enter a GAS Web App URL first.", "bad"); return; }
    setStatus("Pinging GAS…");
    try {
      // Simple GET; many GAS apps allow ?mode=ping for health—works even if ignored.
      const res = await fetch(url + (url.includes("?") ? "&" : "?") + "mode=ping", { method: "GET" });
      const ok = res.ok;
      setStatus(ok ? "GAS responded OK" : `GAS responded ${res.status}`, ok ? "ok" : "bad");
      toast(ok ? "Ping OK" : `Ping ${res.status}`, ok ? "ok" : "bad");
    } catch(e){
      console.warn(e);
      setStatus("Ping failed (likely CORS)", "bad");
      toast("Ping failed", "bad");
    }
  }

  function onOpenSlides(){
    const url = slidesUrlFromId(mm.pid?.value);
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function onPidInput(){
    const has = !!trim(mm.pid?.value);
    if (mm.openSlides) mm.openSlides.disabled = !has;
  }

  // --- Wire events ---
  if (mm.form)   mm.form.addEventListener("submit", onSave);
  if (mm.reset)  mm.reset.addEventListener("click", onReset);
  if (mm.search) mm.search.addEventListener("input", debounce(onSearch, 150));
  if (mm.refresh)mm.refresh.addEventListener("click", refresh);
  if (mm.ping)   mm.ping.addEventListener("click", onPing);
  if (mm.openSlides) mm.openSlides.addEventListener("click", onOpenSlides);
  if (mm.pid)    mm.pid.addEventListener("input", onPidInput);

  // --- Init ---
  (async function initModMap(){
    try {
      renderQuickChips();
      onPidInput();
      await refresh();
    } catch(e){
      console.error(e);
      toast(e.message || "Init (modmap) failed", "bad");
    }
  })();
})();
// Create → POST a single question to Airtable
async function createQuestion(fields){
  const res = await fetch(qBaseUrl(), {
    method: 'POST',
    headers: qHeaders(),
    body: JSON.stringify({ records: [{ fields }] })
  });
  if (!res.ok) {
    const body = await res.text().catch(()=>'(no body)');
    throw new Error(`Create failed: HTTP ${res.status} – ${body}`);
  }
  const data = await res.json();
  return data.records?.[0];
}

// Collect values from your existing DOM
function readQuestionFormFromDOM(){
  const statusEl   = document.getElementById('qStatus');

  const typeSel    = document.getElementById('questionType');
  const type       = (typeSel?.value || 'MC').toUpperCase();
  const slideRaw   = (document.getElementById('slideId')?.value || '').trim(); // hidden (intentionally)
  const orderVal   = Number(document.getElementById('order')?.value || 1);
  const questionId = (document.getElementById('questionId')?.value || '').trim();
  const question   = (document.getElementById('questionText')?.value || '').trim();

  const moduleSel  = document.getElementById('moduleSelect');
  const moduleNew  = document.getElementById('moduleInput');
  const moduleName = (moduleSel?.value || moduleNew?.value || '').trim();

  const active     = true;   // checkbox field → boolean
  const required   = true;   // checkbox field → boolean

  if (!moduleName) throw new Error('Module is required.');
  if (!question)   throw new Error('Question text is required.');
  if (!Number.isFinite(orderVal) || orderVal < 1) throw new Error('Order must be a positive integer.');

  // If slideId is blank (hidden), create one automatically
  const slideId = slideRaw || genAutoSlideId(moduleName, orderVal);

  const fields = {
    'Active': active,
    'Required': required,
    'Module': moduleName,
    'Order': orderVal,
    'Type': type,
    'Question': question,
    'Slide ID': slideId
  };

  if (questionId) fields['QuestionId'] = questionId;

  if (type === 'MC') {
    const optWrap = document.getElementById('options');
    const rows = Array.from(optWrap?.children || []);
    const options = rows
      .map(row => row.querySelector('.optText')?.value?.trim())
      .filter(v => v && v.length);

    // Allow 2–6 options (or change to exactly 3 if you prefer)
    if (options.length < 2 || options.length > 6) {
      throw new Error('Provide 2–6 options for MC.');
    }

    const chosen = rows.find(r => r.querySelector('.optCorrect')?.checked);
    if (!chosen) throw new Error('Select one option as Correct.');
    const correct = (chosen.querySelector('.optText')?.value || '').trim();
    if (!correct) throw new Error('Selected correct option has empty text.');
    if (!options.includes(correct)) throw new Error('Correct must exactly match one of the options.');

    fields['Options (JSON)'] = JSON.stringify(options);
    fields['Correct']        = correct;
  } else {
    const fitbEl = document.getElementById('fitbAnswers');
    let answers = [];

    if (fitbEl) {
      try {
        const parsed = JSON.parse(fitbEl.value || '[]');
        if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 2) throw 0;
        answers = parsed.map(s => String(s).trim()).filter(Boolean);
      } catch {
        throw new Error('Provide FITB Answers (JSON) as ["word","two words"] (1–2 items).');
      }
    } else {
      const raw = window.prompt('Enter 1–2 FITB answers (comma-separated):', '');
      const parts = (raw||'').split(',').map(s=>s.trim()).filter(Boolean);
      if (parts.length < 1 || parts.length > 2) throw new Error('Need 1–2 FITB answers.');
      answers = parts;
    }

    fields['FITB Answers (JSON)'] = JSON.stringify(answers);
    fields['FITB Use Regex']      = false;
    fields['FITB Case Sensitive'] = false;
  }

  statusEl && (statusEl.textContent = 'Ready to save');
  return fields;
}



(function wireSaveQuestion(){
  const btn   = document.getElementById('btnSaveQuestion');
  const status= document.getElementById('qStatus');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    status && (status.textContent = 'Saving…');
    try {
      const fields = readQuestionFormFromDOM();
      const rec = await createQuestion(fields);
      status && (status.textContent = 'Saved ✔');
      // Optionally refresh the list or reset the form
      // refreshQuestionsList();
      // form.reset();
    } catch (e) {
      console.error(e);
      status && (status.textContent = e.message || 'Save failed');
    }
  });
})();
