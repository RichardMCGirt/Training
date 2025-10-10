// ================== Admin – Questions & Assignments (Improved) ==================
// This version auto-computes Order, safely handles empty/active flags, and adds
// one-click "Normalize Orders" (per-module or all modules) without breaking training.

// ========= Airtable Config =========
const AIRTABLE = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",

  // Questions table
  TABLE_ID: "tblbf2TwwlycoVvQq",

  // Titles/Users table (for module assignments)
  TITLES_TABLE_ID: "tblppx6qNXXNJL7ON",
  TITLES_FIELD_NAME: "Title",
  TITLES_ASSIGNED_FIELD: "Assigned Modules",
  TITLES_MAPPING_FIELD: "Assigned Modules Mapping"
};

// ===== Airtable config (Questions table) – reused helpers =====
const QUESTIONS_AT = {
  API_KEY: AIRTABLE.API_KEY,
  BASE_ID: AIRTABLE.BASE_ID,
  TABLE_ID: AIRTABLE.TABLE_ID,
};

function qBaseUrl(){
  return `https://api.airtable.com/v0/${encodeURIComponent(QUESTIONS_AT.BASE_ID)}/${encodeURIComponent(QUESTIONS_AT.TABLE_ID)}`;
}
function qHeaders(){
  return { 'Authorization': `Bearer ${QUESTIONS_AT.API_KEY}`, 'Content-Type': 'application/json' };
}

// ========= Tiny DOM Helpers =========
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
const asBool = v => !!(v === true || v === "true" || v === 1 || v === "1" || v === "on");
function safeParseJSON(v){ try { return JSON.parse(v); } catch { return Array.isArray(v) ? v : []; } }
function parseListTextarea(text){ if (!text) return []; return String(text).split(/\r?\n|,/g).map(s => s.trim()).filter(Boolean); }
function debounce(fn, ms=200){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function afEsc(s){ return String(s ?? "").replace(/'/g, "\\'"); }
function norm(s){ return String(s||"").trim().toLowerCase(); }

// ========= Randomization (display only; saving unaffected) =========
const RANDOMIZE_QUESTIONS = true;
function shuffleInPlace(a){
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Turn "firstname.lastname@vanirinstalledsales.com" -> "Firstname Lastname"
function nameFromEmail(email) {
  if (!email) return "";
  const s = String(email).trim().toLowerCase();
  const at = s.indexOf("@");
  if (at <= 0) return email; // not an email, return as-is
  let local = s.slice(0, at).split("+", 1)[0]; // drop +tag
  let parts = local.split(/[._-]+/).filter(Boolean);
  const titleCaseToken = (t) => t.replace(/(^|[-'])([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase());
  if (parts.length === 0) return email;
  if (parts.length === 1) return titleCaseToken(parts[0]);
  return parts.map(titleCaseToken).join(" ");
}

// ========= Answers table (for "who got it wrong") =========
const ANSWERS = {
  API_KEY:  AIRTABLE.API_KEY,
  BASE_ID:  AIRTABLE.BASE_ID,
  TABLE_ID: "tblkz5HyZGpgO093S"
};
function answersHeaders(){ return { "Authorization": `Bearer ${ANSWERS.API_KEY}`, "Content-Type": "application/json" }; }
function answersBaseUrl(){ return `https://api.airtable.com/v0/${ANSWERS.BASE_ID}/${encodeURIComponent(ANSWERS.TABLE_ID)}`; }

// Fetch distinct users who answered a question wrong (fallback to all answers if correctness not stored)
async function fetchWrongUsersByQuestion(questionText){
  const url = new URL(answersBaseUrl());
  const tryWrong = `AND({Question}='${afEsc(questionText)}', OR({Result}='Wrong', {Result}='Wrong'))`;
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("filterByFormula", tryWrong);

  const res1 = await fetch(url.toString(), { headers: answersHeaders() });
  if (!res1.ok) throw new Error(`Answers fetch failed: HTTP ${res1.status} – ${await res1.text().catch(()=>"(no body)")}`);
  const data1 = await res1.json();

  let rows = data1?.records || [];
  if (!rows.length){
    const url2 = new URL(answersBaseUrl());
    url2.searchParams.set("pageSize", "100");
    url2.searchParams.set("filterByFormula", `({Question}='${afEsc(questionText)}')`);
    const res2 = await fetch(url2.toString(), { headers: answersHeaders() });
    if (!res2.ok) throw new Error(`Answers fetch failed: HTTP ${res2.status} – ${await res2.text().catch(()=>"(no body)")}`);
    const data2 = await res2.json();
    rows = data2?.records || [];
  }
  const seen = new Set();
  const emails = [];
  for (const r of rows){
    const e = r?.fields?.UserEmail || r?.fields?.email || r?.fields?.Email || "";
    if (e && !seen.has(e)) { seen.add(e); emails.push(e); }
  }
  return emails;
}
function showWrongUsersModal(questionText, emails){
  let modal = document.getElementById("wrongUsersModal");
  if (!modal){
    modal = document.createElement("div");
    modal.id = "wrongUsersModal";
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.background = "rgba(0,0,0,0.4)";
    modal.style.zIndex = "9999";
    modal.style.display = "flex";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.innerHTML = `
      <div style="background:white; max-width:520px; width:92%; border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,.2);">
        <div style="padding:14px 16px; border-bottom:1px solid #eee; display:flex; align-items:center; justify-content:space-between;">
          <strong>People who got it wrong</strong>
          <button id="wrongUsersClose" class="btn btn-ghost">×</button>
        </div>
        <div style="padding:14px 16px;">
          <div class="muted small" style="margin-bottom:8px;">${questionText ? `Question: “${esc(questionText)}”` : ""}</div>
          <ul id="wrongUsersList" class="wrong-users" style="margin:0; padding:0 0 8px 18px; max-height:360px; overflow:auto;"></ul>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (ev) => {
      if (ev.target.id === "wrongUsersModal" || ev.target.id === "wrongUsersClose") modal.remove();
    });
  }
  const list = modal.querySelector("#wrongUsersList");
  list.innerHTML = emails.length
    ? emails.map(raw => `<li title="${esc(raw)}">${esc(nameFromEmail(raw))}</li>`).join("")
    : `<li class="muted">No matching answers found.</li>`;
}

// ========= Toast / Utils =========
function toast(msg, kind="info", ms=1800){
  let el = $("#toast"); let txt = $("#toastMsg");
  if (!el) {
    el = document.createElement("div"); el.id="toast"; el.className="toast";
    el.innerHTML = `<span id="toastMsg"></span>`;
    document.body.appendChild(el);
    txt = $("#toastMsg");
  }
  txt.textContent = msg;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), ms);
}

// ========= Airtable core helpers (CRUD) =========
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
async function listAll({ tableId = AIRTABLE.TABLE_ID, pageSize = 100, offset, sortField = "Order", sortDir = "asc", filterByFormula } = {}){
  const ps = Math.max(1, Math.min(100, Number(pageSize) || 100));
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
  const res = await fetch(baseUrl(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ records: [{ fields }], typecast: true })
  });
  if (!res.ok) throw new Error(`Create failed: HTTP ${res.status} – ${await res.text()}`);
  return res.json();
}
async function updateRecord(id, fields){
  const res = await fetch(baseUrl(), {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ records: [{ id, fields }], typecast: true })
  });
  if (!res.ok) throw new Error(`Update failed: HTTP ${res.status} – ${await res.text()}`);
  return res.json();
}
async function updateMany(records){
  if (!records.length) return { records: [] };
  const BATCH = 10;
  const out = [];
  for (let i=0;i<records.length;i+=BATCH){
    const chunk = records.slice(i, i+BATCH);
    const res = await fetch(baseUrl(), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ records: chunk, typecast: true })
    });
    if (!res.ok) throw new Error(`Batch update failed: HTTP ${res.status} – ${await res.text().catch(()=>"(no body)")}`);
    const data = await res.json();
    out.push(...(data.records||[]));
  }
  return { records: out };
}
async function deleteRecord(id){
  const url = `${baseUrl()}/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status} – ${await res.text().catch(()=>"(no body)")}`);
  return res.json();
}

// ========= State =========
const state = {
  rows: [],                 // full questions
  modules: new Set(),       // known module names (from existing rows)
  manualModules: new Set(), // modules added via "+ Add new…"

  // Titles/Assignments (right column)
  titles: [],
  selectedTitleIds: [],
  assignedFieldName: AIRTABLE.TITLES_ASSIGNED_FIELD,
  mappingFieldName:  AIRTABLE.TITLES_MAPPING_FIELD,
  idsByTitleKey: Object.create(null),
  titleKeyById: Object.create(null),

  selectedModules: new Set(),
};

// ========= UI Map =========
const ui = {
  // list / filters
  search: $("#search"),
  fltActive: $("#fltActive"),
  fltInactive: $("#fltInactive"),
  btnRefresh: $("#btnRefresh"),
  listStatus: $("#listStatus"),
  moduleGroups: $("#moduleGroups"),

  // normalize controls (in your HTML header toolbar)
  btnNormalizeAll: $("#btnNormalizeAll"),
  btnNormalizeForModule: $("#btnNormalizeForModule"),
  normalizeStatus: $("#normalizeStatus"),

  // left form
  questionType: $("#questionType"),
  slideId: $("#slideId"),
  order: $("#order"),
  questionId: $("#questionId"),
  questionText: $("#questionText"),
  btnAddOption: $("#btnAddOption"),
  btnClearOptions: $("#btnClearOptions"),
  options: $("#options"),
  btnSaveQuestion: $("#btnSaveQuestion"),

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

  // titles/modules linker (if present on page)
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

// ========= Options editor =========
function addOption(value = "") {
  const _esc = (s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const row = document.createElement("div");
  row.className = "opt inline";
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
  row.querySelector(".del").addEventListener("click", () => {
    row.remove();
    if (window.OptionDrag?.renumber) window.OptionDrag.renumber();
  });
  ui.options.appendChild(row);
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
function setOptions(arr = [], correctText = ""){
  ui.options.innerHTML = "";

  // Render any provided options first
  (arr || []).forEach(text => {
    const row = addOption(text);
    if (String(text) === String(correctText)) {
      const radio = row.querySelector(".optCorrect");
      if (radio) radio.checked = true;
    }
  });

  // If MC is selected, pad to 4 total option rows
  const type = (ui.questionType?.value || "MC").toUpperCase();
  if (type === "MC") {
    ensureFourOptionsForMC();
  } else {
    // For FITB we don't show options at all; just leave as-is
  }
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
function computeNextOrderInModule(modName){
  const nums = state.rows
    .filter(r => String(r?.fields?.Module||"") === String(modName||""))
    .map(r => Number(r?.fields?.Order))
    .filter(n => Number.isFinite(n) && n > 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}
function readForm(){
  const type = (ui.questionType?.value || "MC").toUpperCase();
  const slide = (ui.slideId?.value || "").trim();

  let order = Number(ui.order?.value || NaN);
  const moduleSelected =
    (ui.moduleSelect?.value === ADD_NEW_VALUE ? (ui.moduleInput?.value || "").trim() : ui.moduleSelect?.value) || "";
  if (!Number.isFinite(order) || order <= 0) {
    order = computeNextOrderInModule(moduleSelected);
  }

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
    "Slide ID": slide || undefined,      // optional
    "Order": order,                      // ALWAYS a positive number
    "QuestionId": qid,
    "Question": qtext,
    "Required": true,                    // default required
    "Active": true,                      // default active (safe for training)
    "Module": moduleVal || undefined,
  };

  if (type === "MC") {
    const opts = getOptions();
    if (opts.length === 0) throw new Error("Add at least one option.");
    const correct = (opts.find(o => o.correct) || {}).text || "";
    fields["Options (JSON)"] = JSON.stringify(opts.map(o => o.text));
    fields["Correct"] = correct || undefined;
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
function ensureFourOptionsForMC() {
  // Only enforce when MC is currently selected
  const type = (ui.questionType?.value || "MC").toUpperCase();
  if (type !== "MC") return;

  // Count existing option rows
  let count = $$(".opt").length;

  // Always keep at least 4 rows visible (blank if needed)
  while (count < 4) {
    addOption("");
    count++;
  }
}

function fillForm(fields){
  const type = (fields["Type"] || "MC").toUpperCase();
  if (ui.questionType) ui.questionType.value = type;
  updateTypeVisibility();

  if (ui.slideId) ui.slideId.value = fields["Slide ID"] || "";
  if (ui.order) ui.order.value = Number(fields["Order"] || "");
  if (ui.questionId) ui.questionId.value = fields["QuestionId"] || "";
  if (ui.questionText) ui.questionText.value = fields["Question"] || "";

  const m = fields["Module"] || "";
  if (ui.moduleSelect) ui.moduleSelect.value = (m && optionExists(ui.moduleSelect, m)) ? m : "";
  if (ui.moduleNewWrap) ui.moduleNewWrap.classList.add("hide");
  if (ui.moduleInput) ui.moduleInput.value = "";

  if (type === "MC") {
    const arr = safeParseJSON(fields["Options (JSON)"]);
    setOptions(arr, fields["Correct"] || "");
    ensureFourOptionsForMC()
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
function detectMappingFieldNameFromRecordFields(fieldsObj){
  if (!fieldsObj) return null;
  const keys = Object.keys(fieldsObj);
  const want = String(AIRTABLE.TITLES_MAPPING_FIELD || "").toLowerCase();
  if (want) {
    const exact = keys.find(k => k.toLowerCase() === want);
    if (exact) return exact;
  }
  // optional nicety; OK if absent
  const cand = keys.find(k => {
    const s = k.toLowerCase();
    return (s.includes("mapping") || s.includes("map")) && s.includes("assigned");
  });
  return cand || null; // may be null; we’ll conditionally skip it when patching
}
async function assignSelected(){
  const selectedIds = getSelectedTitleIds();
  if (!selectedIds.length) return toast("Select at least one title.", "bad");
  if (!state.selectedModules.size) return toast("Pick module(s) to assign.", "bad");

  const mods = Array.from(state.selectedModules).sort((a,b)=>a.localeCompare(b));
  const updates = [];

  selectedIds.forEach(id => {
    const t = state.titles.find(x => x.id === id);
    const set = new Set([...(t?.assigned || []), ...mods]);
    const assigned = Array.from(set).sort((a,b)=>a.localeCompare(b));
    updates.push({
      id,
      fields: buildTitleUpdateFields({
        titleText: t?.title || "",
        assignedArray: assigned,
        assignedFieldName: state.assignedFieldName,   // may be detected name
        mappingFieldName:  state.mappingFieldName     // may be null → skipped
      })
    });
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
    const assigned = (t?.assigned || []).filter(m => !state.selectedModules.has(m)).sort((a,b)=>a.localeCompare(b));
    updates.push({
      id,
      fields: buildTitleUpdateFields({
        titleText: t?.title || "",
        assignedArray: assigned,
        assignedFieldName: state.assignedFieldName,
        mappingFieldName:  state.mappingFieldName
      })
    });
  });

  await batchPatch(AIRTABLE.TITLES_TABLE_ID, updates);
  toast("Unassigned.", "ok");
  state.selectedModules.clear();
  await fetchDistinctTitles();
  renderModuleList();
  renderModuleTitleLinker();
}

async function assignOne(titleId, moduleName){
  const t = state.titles.find(x => x.id === titleId);
  const set = new Set([...(t?.assigned || []), moduleName]);
  const assigned = Array.from(set).sort((a,b)=>a.localeCompare(b));
  await batchPatch(AIRTABLE.TITLES_TABLE_ID, [{
    id: titleId,
    fields: buildTitleUpdateFields({
      titleText: t?.title || "",
      assignedArray: assigned,
      assignedFieldName: state.assignedFieldName,
      mappingFieldName:  state.mappingFieldName
    })
  }]);
}
async function listAllTitlesPage(offset){
  return listAll({
    tableId: AIRTABLE.TITLES_TABLE_ID,
    pageSize: 100,
    offset,
    sortField: AIRTABLE.TITLES_FIELD_NAME,
    sortDir: "asc",
  });
}

async function unassignOne(titleId, moduleName){
  const t = state.titles.find(x => x.id === titleId);
  const assigned = (t?.assigned || []).filter(m => m !== moduleName).sort((a,b)=>a.localeCompare(b));
  await batchPatch(AIRTABLE.TITLES_TABLE_ID, [{
    id: titleId,
    fields: buildTitleUpdateFields({
      titleText: t?.title || "",
      assignedArray: assigned,
      assignedFieldName: state.assignedFieldName,
      mappingFieldName:  state.mappingFieldName
    })
  }]);
}

function detectAssignedFieldNameFromRecordFields(fieldsObj){
  if (!fieldsObj) return null;
  const keys = Object.keys(fieldsObj);
  // exact match if configured
  const want = String(AIRTABLE.TITLES_ASSIGNED_FIELD || "").toLowerCase();
  if (want) {
    const exact = keys.find(k => k.toLowerCase() === want);
    if (exact) return exact;
  }
  // heuristics
  const byKeywords = keys.find(k => {
    const s = k.toLowerCase();
    return (s.includes("assigned") && s.includes("module")) || s === "assigned modules";
  });
  if (byKeywords) return byKeywords;
  // last-chance: any field containing "module"
  return keys.find(k => k.toLowerCase().includes("module")) || null;
}
function buildTitleUpdateFields({ titleText, assignedArray, assignedFieldName, mappingFieldName }){
  const fields = {};
  if (assignedFieldName) {
    fields[assignedFieldName] = (assignedArray || []).join("\n");
  }
  if (mappingFieldName) {
    fields[mappingFieldName] = `${titleText || ""}: ${ (assignedArray || []).join(", ") }`;
  }
  return fields;
}
function cleanAssignedList(v){
  if (!v) return [];
  // Accept newline/comma/semicolon separated
  return String(v).split(/[\n,;]+/g).map(s => s.trim()).filter(Boolean);
}
function resetForm(){
  if (ui.questionType) ui.questionType.value = "MC";
  updateTypeVisibility();

  if (ui.slideId) ui.slideId.value = "";
  if (ui.order) ui.order.value = "";
  if (ui.questionId) ui.questionId.value = "";
  if (ui.questionText) ui.questionText.value = "";

  if (ui.moduleSelect) ui.moduleSelect.value = "";
  if (ui.moduleNewWrap) ui.moduleNewWrap.classList.add("hide");
  if (ui.moduleInput) ui.moduleInput.value = "";

  // For MC by default, show 4 empty options
  setOptions(["","","",""], "");
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
    const isActive = asBool(f.Active); // missing Active -> false
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
function getWrongCount(f){
  const cand = ["Wrong Attempts","Wrong Count","Incorrect Count","Wrong Users","People Wrong","Wrong"];
  for (const k of cand){
    const v = f && f[k];
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
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
      const wrongCount = getWrongCount(f);
      const wrongBadge = (wrongCount > 10)
        ? `<span class="badge bad" title="${wrongCount} people got this wrong" style="margin-left:8px">${wrongCount} employees have answered this question wrong</span>`
        : "";

      return `<div class="qline">
        <div class="qtext">
          <div><strong>${qtxt}</strong> ${wrongBadge}</div>
          <div class="muted small">${esc(meta)}</div>
        </div>
        <div class="actions" style="display:flex; gap:8px">
          <button class="btn btn-ghost edit" data-id="${id}">Edit</button>
          <button class="btn btn-danger delete" data-id="${id}">Delete</button>
          <button class="btn wrongs" data-q="${esc(qtxt)}">Who got it wrong</button>
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

  // expand/collapse
  el.querySelectorAll(".mod-head").forEach(btn => {
    btn.addEventListener("click", () => {
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
      const body = btn.parentElement.querySelector(".mod-body");
      if (body) body.hidden = !body.hidden;
    });
  });

  // edit / delete / wrongs
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
  el.querySelectorAll(".wrongs").forEach(b => {
    b.addEventListener("click", async () => {
      const questionText = b.getAttribute("data-q") || "";
      try {
        const emails = await fetchWrongUsersByQuestion(questionText);
        showWrongUsersModal(questionText, emails);
      } catch (e) {
        console.error(e);
        alert("Failed to fetch wrong users.\n" + (e?.message || e));
      }
    });
  });
}
function buildModuleToTitlesMap(){
  const map = new Map();
  const allModules = new Set([ ...Array.from(state.modules), ...Array.from(state.manualModules) ]);
  state.titles.forEach(t => (t.assigned||[]).forEach(m => allModules.add(m)));
  allModules.forEach(m => map.set(m, []));
  state.titles.forEach(t => { (t.assigned || []).forEach(m => { if (!map.has(m)) map.set(m, []); map.get(m).push({ id: t.id, title: t.title }); }); });
  return map;
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

// ========= Auto-fix & Normalize =========
function splitModuleRows(){
  const byMod = new Map();
  for (const r of state.rows){
    const f = r.fields || {};
    const m = (f.Module || "(no module)").trim() || "(no module)";
    if (!byMod.has(m)) byMod.set(m, []);
    byMod.get(m).push(r);
  }
  return byMod;
}
function orderKey(n){
  // Sort helper: missing/NaN -> very large so they sink to bottom
  const num = Number(n);
  return Number.isFinite(num) && num > 0 ? num : 9_000_000;
}
async function autoFixEmptyOrdersForActive(){
  const byMod = splitModuleRows();
  const updates = [];

  for (const [mod, rows] of byMod.entries()){
    // Sort rows by current Order (invalid -> bottom)
    const sorted = [...rows].sort((a,b)=> orderKey(a.fields?.Order) - orderKey(b.fields?.Order));

    // Walk and ensure all ACTIVE rows have a sane positive, unique sequence
    let next = 1;
    for (const r of sorted){
      const f = r.fields || {};
      const isActive = !!f.Active; // empty treated as false
      if (!isActive) continue;     // leave inactive out of the active sequence

      const cur = Number(f.Order);
      if (!Number.isFinite(cur) || cur <= 0){
        updates.push({ id: r.id, fields: { "Order": next } });
        next++;
      } else {
        // if cur has gaps, we still compact only if needed later by "Normalize"
        next = Math.max(next, cur + 1);
      }
    }
  }

  if (updates.length){
    try {
      await updateMany(updates);
      // refresh cache so UI reflects fixed orders
      await refreshList();
      toast(`Auto-fixed ${updates.length} blank/invalid Order values for active questions.`);
    } catch (e) {
      console.warn("Auto-fix failed:", e);
    }
  }
}
async function normalizeOrdersForModule(moduleName){
  const mod = String(moduleName||"");
  const rows = state.rows.filter(r => String(r?.fields?.Module||"") === mod);
  if (!rows.length) return 0;

  // Active rows get a tight sequence 1..N (inactive rows keep their Order but sorted after)
  const active = rows.filter(r => !!r.fields?.Active);
  const inactive = rows.filter(r => !r.fields?.Active);

  const sortedActive = [...active].sort((a,b)=> orderKey(a.fields?.Order) - orderKey(b.fields?.Order));
  const updates = [];

  let seq = 1;
  for (const r of sortedActive){
    if (Number(r.fields?.Order) !== seq){
      updates.push({ id: r.id, fields: { "Order": seq } });
    }
    seq++;
  }
  // (Optionally: push inactives to a high range to avoid interleaving)
  // Not strictly required; training ignores inactive anyway.

  if (updates.length){
    await updateMany(updates);
  }
  return updates.length;
}
async function normalizeAllModules(){
  const byMod = splitModuleRows();
  let total = 0;
  for (const [mod] of byMod.entries()){
    total += await normalizeOrdersForModule(mod);
  }
  return total;
}
function titlesNotLinkedToModule(moduleName){
  const linkedIds = new Set((buildModuleToTitlesMap().get(moduleName) || []).map(t => t.id));
  return state.titles.filter(t => !linkedIds.has(t.id));
}
// ========= Titles (load + helpers) – unchanged skeletons (safe no-ops if absent) =========
// (We keep these minimal to avoid breaking pages that don’t render the linker UI.)

function updateTitleCount(){
  if (!ui.titleCount) return;
  const total = state.titles.length;
  const selected = getSelectedTitleIds().length;
  ui.titleCount.textContent = `${total} titles • ${selected} selected`;
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
function populateTitleSelect(list){
  if (!ui.titleSelect) return;
  const sorted = sortTitlesAZ(Array.isArray(list) ? list : []);
  ui.titleSelect.innerHTML = sorted
    .map(t => `\u003Coption value="${esc(t.id)}">${esc(t.title)}\u003C/option>`)
    .join("");
}
function sortTitlesAZ(list){ return (Array.isArray(list) ? [...list] : []).sort((a,b)=> String(a?.title ?? "").trim().localeCompare(String(b?.title ?? "").trim(), undefined, {sensitivity:"base"}) ); }
function normalizeTitle(v) { if (v == null) return ""; if (typeof v === "string") return v.trim(); if (typeof v === "number") return String(v); if (Array.isArray(v)) { for (const item of v) { if (typeof item === "string") return item.trim(); if (item && typeof item === "object") { if (typeof item.name === "string") return item.name.trim(); if (typeof item.id === "string") return item.id; } } return v.length ? String(v[0]) : ""; } if (typeof v === "object") { if (typeof v.name === "string") return v.name.trim(); return JSON.stringify(v); } try { return String(v); } catch { return ""; } }
function updateAssignStatusText(){
  const selectedTitles = getSelectedTitleIds();
  const mods = Array.from(state.selectedModules);
  if (!ui.assignStatus) return;

  if (!selectedTitles.length) {
    ui.assignStatus.textContent = "Select one or more titles, then pick modules.";
    return;
  }

  ui.assignStatus.textContent = mods.length
    ? `Ready: ${mods.length} module(s) selected.`
    : "All selected titles share the same module set.";
}

function computeAssignedAgg(selectedIds){ const chosen = state.titles.filter(t => selectedIds.includes(t.id)); const lists = chosen.map(t => new Set((t.assigned || []).map(String))); if (lists.length === 0) return { all: new Set(), some: new Set() }; const union = new Set(); lists.forEach(s => s.forEach(x => union.add(x))); let intersection = new Set(lists[0]); for (let i=1;i<lists.length;i++){ const next = new Set(); lists[i].forEach(x => { if (intersection.has(x)) next.add(x); }); intersection = next; } return { all: intersection, some: union }; }
function detectTitleFieldNameFromRecordFields(fieldsObj, prefer){
  if (!fieldsObj) return null;
  const keys = Object.keys(fieldsObj);

  // honor configured name first (exact or case-insensitive)
  if (prefer) {
    const exact = keys.find(k => k === prefer) || keys.find(k => k.toLowerCase() === String(prefer).toLowerCase());
    if (exact) return exact;
  }

  // common title-ish candidates
  const cands = ["Title","Name","Employee Title","Job Title","Position"];
  const hit = keys.find(k => cands.map(s => s.toLowerCase()).includes(k.toLowerCase()));
  if (hit) return hit;

  // fallback: first short string field
  const sample = keys.find(k => typeof fieldsObj[k] === "string" && String(fieldsObj[k]).length < 200);
  return sample || null;
}

async function fetchDistinctTitles(){
  const all = [];
  let offset;

  state.idsByTitleKey = Object.create(null);
  state.titleKeyById  = Object.create(null);

  let detectedTitle = null;
  let detectedAssigned = null;
  let detectedMapping = null;

  do {
    const data = await listAllTitlesPage(offset);
    (data.records || []).forEach(r => {
      const f = r.fields || {};

      if (!detectedTitle)   detectedTitle   = detectTitleFieldNameFromRecordFields(f, AIRTABLE.TITLES_FIELD_NAME);
      if (!detectedAssigned)detectedAssigned= detectAssignedFieldNameFromRecordFields(f);
      if (!detectedMapping) detectedMapping = detectMappingFieldNameFromRecordFields(f);

      const rawTitle = detectedTitle ? f[detectedTitle] : (AIRTABLE.TITLES_FIELD_NAME ? f[AIRTABLE.TITLES_FIELD_NAME] : "");
      const title = normalizeTitle(rawTitle);
      if (!title) return;

      const assignedRaw =
        (typeof f[detectedAssigned] !== "undefined") ? f[detectedAssigned] :
        (typeof f[AIRTABLE.TITLES_ASSIGNED_FIELD] !== "undefined") ? f[AIRTABLE.TITLES_ASSIGNED_FIELD] : "";

      const assigned = cleanAssignedList(assignedRaw);

      const rec = { id: r.id, title, assigned };
      all.push(rec);

      const key = title.toLowerCase().trim();
      state.titleKeyById[r.id] = key;
      if (!state.idsByTitleKey[key]) state.idsByTitleKey[key] = [];
      state.idsByTitleKey[key].push(r.id);
    });
    offset = data.offset;
  } while (offset);

  // Persist detections so the rest of the code uses them
  state.titleFieldName   = detectedTitle   || AIRTABLE.TITLES_FIELD_NAME; // for info only
  state.assignedFieldName= detectedAssigned|| AIRTABLE.TITLES_ASSIGNED_FIELD;
  state.mappingFieldName = detectedMapping || null; // mapping field is optional

  console.log("[titles] detected fields", {
    title: state.titleFieldName,
    assigned: state.assignedFieldName,
    mapping: state.mappingFieldName
  });

  // de-dupe by title text
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
async function batchPatch(tableId, updates){
  const BATCH = 10;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH).map(({id, fields}) => {
      // remove undefined keys and skip if no fields remain
      const cleaned = {};
      Object.keys(fields || {}).forEach(k => {
        if (typeof fields[k] !== "undefined" && fields[k] !== null) cleaned[k] = fields[k];
      });
      return { id, fields: cleaned };
    }).filter(u => u.id && u.fields && Object.keys(u.fields).length);

    if (!chunk.length) continue;

    const res = await fetch(baseUrl(tableId), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ records: chunk, typecast: true })
    });
    if (!res.ok) throw new Error(`Update failed: HTTP ${res.status} – ${await res.text()}`);
  }
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
    const tag = r.isAll ? "Assigned (all)" : r.isSome ? "Assigned (some)" : "";
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
function getSelectedTitleIds(){
  const sel = ui.titleSelect;
  if (!sel) return [];
  return Array.from(sel.selectedOptions || []).map(o => o.value).filter(Boolean);
}
// ========= Wire up =========
// ===== Boot & wiring (drop-in) =====
async function wire(){
  // ---- events ----
  ui.btnRefresh?.addEventListener("click", refreshList);
  ui.search?.addEventListener("input", debounce(()=> renderModulesView(filterRows(ui.search.value)), 150));
  ui.fltActive?.addEventListener("change", ()=> renderModulesView(filterRows(ui.search?.value||"")));
  ui.fltInactive?.addEventListener("change", ()=> renderModulesView(filterRows(ui.search?.value||"")));

  ui.questionType?.addEventListener("change", updateTypeVisibility);
  ui.moduleSelect?.addEventListener("change", toggleModuleNewVisibility);

  ui.btnAddOption?.addEventListener("click", () => {
    const type = (ui.questionType?.value || "MC").toUpperCase();
    if (type === "MC") {
      const count = $$(".opt").length;
      if (count >= 4) {
        // Comment out this guard if you want to allow >4
        return alert("Multiple Choice is limited to 4 options.");
      }
    }
    addOption("");
  });

  ui.btnClearOptions?.addEventListener("click", ()=> setOptions(["",""]));

  // Save (create new row)
  ui.btnSaveQuestion?.addEventListener("click", async ()=>{
    try{
      const fields = readForm();
      await createRecord(fields);
      toast("Saved.");
      resetForm();
      await refreshList();
      // modules cache may change if a new module was added
      renderModuleList();
      renderModuleTitleLinker();
    } catch(e){
      console.error(e);
      toast(e?.message || "Save failed", "bad");
    }
  });

  // Normalize buttons
ui.btnNormalizeAll?.addEventListener("click", async ()=>{
  if (ui.normalizeStatus) ui.normalizeStatus.textContent = "Normalizing all modules…";
  try {
    const changed = await normalizeAllModules(); // <-- use the actual function name
    if (ui.normalizeStatus) ui.normalizeStatus.textContent = `Updated ${changed} records.`;
    await refreshList();
    toast("Normalized Order across all modules.");
  } catch (e) {
    console.error(e);
    if (ui.normalizeStatus) ui.normalizeStatus.textContent = "Normalize failed.";
    toast("Normalize failed", "bad");
  }
});


  ui.btnNormalizeForModule?.addEventListener("click", async ()=>{
    // Try to detect the first expanded module in the UI; if none, use current select value.
    const expanded = $(".mod-head[aria-expanded='true']")?.parentElement?.getAttribute("data-mod") || currentModuleValue();
    if (!expanded) { toast("Open a module group or select one, then click Normalize.", "warn"); return; }
    if (ui.normalizeStatus) ui.normalizeStatus.textContent = `Normalizing “${expanded}”…`;
    try{
      const res = await normalizeOrdersForModule(expanded, { dryRun: false });
      if (ui.normalizeStatus) ui.normalizeStatus.textContent = `Module “${expanded}”: updated ${res.changed} records.`;
      await refreshList();
      toast(`Normalized Order in “${expanded}”.`);
    } catch (e) {
      console.error(e);
      if (ui.normalizeStatus) ui.normalizeStatus.textContent = "Normalize failed.";
      toast("Normalize failed", "bad");
    }
  });

  // ---- initial UI state ----
  updateTypeVisibility();
  toggleModuleNewVisibility();
  if (ui.options && ui.options.children.length === 0) { setOptions(["","","",""]); }

  // ---- first loads (await so dropdowns populate) ----
  await refreshList();           // loads Questions → builds state.modules
  await fetchDistinctTitles();   // loads Titles → fills state.titles + detected field names
  renderModuleList();            // uses state.titles + state.modules
  renderModuleTitleLinker();     // builds the matrix panel
}

// Boot
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { wire().catch(err => console.error("[wire]", err)); }, { once:true });
} else {
  wire().catch(err => console.error("[wire]", err));
}
