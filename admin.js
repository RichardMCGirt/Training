
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

// ========= Tiny DOM Helpers =========
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// ========= UI Map =========
const ui = {
  // Filters / list controls
  search: $("#search"),
  fltActive: $("#fltActive"),
  fltInactive: $("#fltInactive"),
  btnRefresh: $("#btnRefresh"),
  listStatus: $("#listStatus"),
  // New grouped modules container
  moduleGroups: $("#moduleGroups"),

  // Form
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

  // MC/FITB blocks
  mcBlock: $("#mcBlock"),
  fitbBlock: $("#fitbBlock"),
  fitbAnswers: $("#fitbAnswers"),
  fitbUseRegex: $("#fitbUseRegex"),
  fitbCaseSensitive: $("#fitbCaseSensitive"),

  // Module helpers (for questions)
  moduleSelect: $("#moduleSelect"),
  moduleInput: $("#moduleInput"),
  moduleChips: $("#moduleChips"),

  // Toast
  toast: $("#toast"),
  toastMsg: $("#toastMsg"),

  // Assignments UI (Job Title → Modules)
  titleSelect: $("#titleSelect"),
  btnReloadTitles: $("#btnReloadTitles"),
  moduleChecklist: $("#moduleChecklist"),
  btnSaveAssignment: $("#btnSaveAssignment"),
  btnUnassignModule: $("#btnUnassignModule"),
  btnClearAssignment: $("#btnClearAssignment"),
  assignStatus: $("#assignStatus")
};

// ========= Toast / Utils =========
function toast(msg, kind="info", ms=2000){
  try {
    ui.toastMsg.textContent = msg;
    ui.toast.classList.add("show");
    setTimeout(() => ui.toast.classList.remove("show"), ms);
  } catch {}
}
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
const asBool = v => !!(v === true || v === "true" || v === 1 || v === "1" || v === "on");
function safeParseJSON(v){ try { return JSON.parse(v); } catch { return Array.isArray(v) ? v : [];}}
const dangerConfirm = (msg) => window.confirm(msg);

function parseListTextarea(text){
  if (!text) return [];
  return String(text)
    .split(/\r?\n|,/g)
    .map(s => s.trim())
    .filter(Boolean);
}

// ========= Fetch helpers =========
function headers(){
  return {
    "Authorization": `Bearer ${AIRTABLE.API_KEY}`,
    "Content-Type": "application/json"
  };
}
function baseUrl(tableId = AIRTABLE.TABLE_ID){
  if (!AIRTABLE.BASE_ID || !tableId) {
    console.error("[Admin] baseUrl missing pieces:", { base: AIRTABLE.BASE_ID, tableId });
    throw new Error("Base URL undefined: missing BASE_ID or TABLE_ID");
  }
  return `https://api.airtable.com/v0/${AIRTABLE.BASE_ID}/${encodeURIComponent(tableId)}`;
}
// Read a single record (for verification)
async function readRecord(tableId, id){
  const url = `${baseUrl(tableId)}/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(()=>"(no body)");
    throw new Error(`Read failed: HTTP ${res.status} – ${body}`);
  }
  return res.json();
}
// Generic list with sort + optional filter + paging for any table
async function listAll({
  tableId = AIRTABLE.TABLE_ID,
  pageSize = 10,
  offset,
  sortField = "Order",
  sortDir = "asc",
  filterByFormula
} = {}) {
  // Airtable max pageSize is 100 — clamp to avoid 422s
  const ps = Math.max(1, Math.min(100, Number(pageSize) || 10));

  const url = new URL(baseUrl(tableId));
  url.searchParams.set("pageSize", String(ps));
  if (sortField) {
    url.searchParams.set("sort[0][field]", sortField);
    url.searchParams.set("sort[0][direction]", sortDir);
  }
  if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
  if (offset) url.searchParams.set("offset", offset);

  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    console.error("[Admin] listAll failed:", { tableId, status: res.status, body });
    throw new Error(`Fetch failed: HTTP ${res.status}`);
  }
  return res.json();
}
function debounce(fn, ms = 160) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
if (ui.search) {
  ui.search.addEventListener("input", debounce(() => {
    renderModulesView(filterRows(ui.search.value));
  }, 120));
}
if (ui.fltActive)  ui.fltActive.addEventListener("change", () => renderModulesView(filterRows(ui.search?.value)));
if (ui.fltInactive) ui.fltInactive.addEventListener("change", () => renderModulesView(filterRows(ui.search?.value)));
async function createRecord(fields){
  const res = await fetch(baseUrl(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
  if (!res.ok) throw new Error(`Create failed: HTTP ${res.status} – ${await res.text()}`);
  return res.json();
}
async function updateRecord(id, fields){
  const res = await fetch(baseUrl(), {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ records: [{ id, fields }], typecast: true }),
  });
  if (!res.ok) throw new Error(`Update failed: HTTP ${res.status} – ${await res.text()}`);
  return res.json();
}
// ======== NEW: Delete helpers =========
async function deleteRecord(id){
  if (!id) throw new Error("Missing record id");
  const url = `${baseUrl()}/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(()=>"(no body)");
    throw new Error(`Delete failed: HTTP ${res.status} – ${body}`);
  }
  return res.json();
}
async function deleteRecords(ids = []){
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return { deleted: [] };
  const url = new URL(baseUrl());
  unique.forEach(id => url.searchParams.append("records[]", id));
  const res = await fetch(url.toString(), { method: "DELETE", headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(()=>"(no body)");
    throw new Error(`Batch delete failed: HTTP ${res.status} – ${body}`);
  }
  return res.json();
}

// ========= State =========
const state = {
  // Questions
  rows: [],
  nextOffset: null,
  prevOffsets: [],
  editingId: null,
  modules: new Set(),

  // Titles
  titles: [],             // [{id, title, assigned: string[]}]
  selectedTitleIds: [],   // array of record ids
  // Detected field names (from Titles table records)
  assignedFieldName: null,  // long text storing modules list
  mappingFieldName: null,    // optional long text for "Title: m1, m2"
  idsByTitleKey: Object.create(null), // { 'purchasing agent': ['recA','recB', ...] }
  titleKeyById: Object.create(null)   // { 'recA': 'purchasing agent', ... }
};

// ========= Options editor (Questions) =========
function addOption(value=""){
  const row = document.createElement("div");
  row.className = "opt";
  row.innerHTML = `
    <input type="text" class="optText" placeholder="Option text" value="${esc(value)}">
    <div class="mark hint">
      <input type="radio" name="correctRadio" class="optCorrect">
      <span>Correct</span>
    </div>
    <button class="btn btn-ghost up" title="Move up">↑</button>
    <button class="btn btn-danger del" title="Remove">×</button>
  `;
  row.querySelector(".up").addEventListener("click", () => {
    const parent = ui.options;
    const idx = Array.from(parent.children).indexOf(row);
    if (idx > 0) parent.insertBefore(row, parent.children[idx-1]);
  });
  row.querySelector(".del").addEventListener("click", () => row.remove());
  ui.options.appendChild(row);
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

// ========= Module helpers (Questions) =========
function currentModuleValue(){
  const typed = (ui.moduleInput?.value || "").trim();
  if (typed) return typed;
  const sel = ui.moduleSelect;
  return sel && sel.value ? sel.value : "";
}
function populateModuleSelect(modules){
  const sel = ui.moduleSelect; if (!sel) return;
  const list = Array.from(modules).sort((a,b)=>a.localeCompare(b));
  sel.innerHTML = `<option value="">(none)</option>` + list.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  const chips = ui.moduleChips; if (chips){
    chips.innerHTML = list.map(m => `<span class="chip" data-m="${esc(m)}">${esc(m)}</span>`).join("");
    chips.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {
      if (ui.moduleSelect) ui.moduleSelect.value = ch.dataset.m || "";
      if (ui.moduleInput) ui.moduleInput.value = "";
    }));
  }
}

// ========= Type visibility =========
function updateTypeVisibility(){
  const type = (ui.questionType?.value || "MC").toUpperCase();
  if (ui.mcBlock) ui.mcBlock.style.display = (type === "MC") ? "" : "none";
  if (ui.fitbBlock) ui.fitbBlock.style.display = (type === "FITB") ? "" : "none";
}

// ========= Form helpers (Questions) =========
function genQuestionId(prefix="q"){ return `${prefix}_${Math.random().toString(36).slice(2,8)}`; }
function readForm(){
  const type = (ui.questionType?.value || "MC").toUpperCase();
  const slide = (ui.slideId.value || "").trim();
  const order = Number(ui.order.value || 0);
  const qid = (ui.questionId.value || "").trim() || genQuestionId("q");
  const qtext = (ui.questionText.value || "").trim();
  const moduleVal = currentModuleValue();

  if (!qtext) throw new Error("Question text is required.");

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
    // clear FITB fields if present
    fields["FITB Answers (JSON)"] = undefined;
    fields["FITB Use Regex"] = undefined;
    fields["FITB Case Sensitive"] = undefined;
  } else {
    const list = parseListTextarea(ui.fitbAnswers?.value || "");
    if (!list.length) throw new Error("Add at least one accepted answer.");
    fields["FITB Answers (JSON)"] = JSON.stringify(list);
    fields["FITB Use Regex"] = !!(ui.fitbUseRegex && ui.fitbUseRegex.checked);
    fields["FITB Case Sensitive"] = !!(ui.fitbCaseSensitive && ui.fitbCaseSensitive.checked);
    // clear MC fields if present
    fields["Options (JSON)"] = undefined;
    fields["Correct"] = undefined;
  }
  return fields;
}

function fillForm(fields){
  const type = (fields["Type"] || "MC").toUpperCase();
  if (ui.questionType) ui.questionType.value = type;
  updateTypeVisibility();

  ui.slideId.value = fields["Slide ID"] || "";
  ui.order.value = Number(fields["Order"] || 1);
  ui.questionId.value = fields["QuestionId"] || "";
  ui.questionText.value = fields["Question"] || "";

  const m = fields["Module"] || "";
  if (ui.moduleSelect) ui.moduleSelect.value = m;
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

function resetForm(){
  state.editingId = null;
  if (ui.questionType) ui.questionType.value = "MC";
  updateTypeVisibility();
  ui.slideId.value = "";
  ui.order.value = "1";
  ui.questionId.value = "";
  ui.questionText.value = "";
  if (ui.moduleSelect) ui.moduleSelect.value = "";
  if (ui.moduleInput) ui.moduleInput.value = "";
  setOptions(["",""]);
  if (ui.fitbAnswers) ui.fitbAnswers.value = "";
  if (ui.fitbUseRegex) ui.fitbUseRegex.checked = false;
  if (ui.fitbCaseSensitive) ui.fitbCaseSensitive.checked = false;
}

// ========= NEW: Grouped modules view =========
function groupByModule(rows){
  const groups = new Map(); // name -> [records]
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
      <div class="mod-body" hidden>
        ${body}
      </div>
    </div>`);
  }

  el.innerHTML = out.join("");

  // bind toggles
  el.querySelectorAll(".mod-head").forEach(btn => {
    btn.addEventListener("click", () => {
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
      const body = btn.parentElement.querySelector(".mod-body");
      if (body) body.hidden = !body.hidden;
    });
  });

  // bind edit buttons
  el.querySelectorAll(".edit").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.getAttribute("data-id");
      const row = state.rows.find(x => x.id === id);
      if (!row) return;
      state.editingId = id;
      fillForm(row.fields);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  // bind delete buttons
  el.querySelectorAll(".delete").forEach(b => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-id");
      const row = state.rows.find(x => x.id === id);
      const title = row?.fields?.Question ? `“${row.fields.Question.slice(0, 80)}${row.fields.Question.length>80?"…":""}”` : `ID ${id}`;
      if (!dangerConfirm(`Delete this question ${title}?\nThis action cannot be undone.`)) return;
      try {
        await deleteRecord(id);
        toast("Deleted");
        // remove from local state and re-render quickly
        state.rows = state.rows.filter(r => r.id !== id);
        renderModulesView(filterRows(ui.search ? ui.search.value : ""));
        // refresh to ensure module lists + counts stay accurate
        await refreshList();
      } catch (e) {
        console.error(e);
        toast(e?.message || "Delete failed", "bad");
      }
    });
  });
}

// ========= List / search / paging (Questions) =========
async function refreshList(){
  ui.listStatus && (ui.listStatus.textContent = "Loading…");
  try {
    const data = await listAll({ tableId: AIRTABLE.TABLE_ID, pageSize: 10, sortField:"Order", sortDir:"asc" });
    state.rows = data.records || [];

    // collect module values
    state.modules = new Set(state.rows.map(r => (r.fields||{}).Module).filter(Boolean));
    populateModuleSelect(state.modules);

    renderModulesView(filterRows(ui.search ? ui.search.value : ""));
    ui.listStatus && (ui.listStatus.textContent = `Loaded ${state.rows.length} question${state.rows.length===1?"":"s"}.`);
  } catch (e) {
    console.error("[Admin] refreshList failed:", e);
    ui.listStatus && (ui.listStatus.textContent = "Load failed.");
    toast(e.message || "Load failed", "bad");
  }
}

// ========= Assignments: Titles ⇄ Modules (preview-only) =========
function buildModuleChecklist(selected = new Set()){
  if (!ui.moduleChecklist) return;
  const modules = Array.from(state.modules).sort((a,b)=>a.localeCompare(b));
  if (!modules.length) {
    ui.moduleChecklist.innerHTML = `<div class="muted small">No modules found yet. Create questions with a Module value first.</div>`;
    return;
  }
  const pills = Array.from(selected).map(m => `
    <span class="chip" aria-hidden="true" title="Assigned to all selected titles">${esc(m)}</span>
  `).join("");
  ui.moduleChecklist.innerHTML = `
    <div class="muted small" style="margin-bottom:6px">
      Assigned to all selected titles (read-only preview):
    </div>
    <div class="chips" aria-hidden="true">${pills || '<span class="muted small">(none shared)</span>'}</div>
  `;
}
function readChecklistSelection(){
  const m = currentModuleValue();
  return m ? [m] : [];
}
function parseModulesFromLongText(v){
  if (!v) return [];
  return String(v).split(/[\n,;]+/g).map(s => s.trim()).filter(Boolean);
}
function joinModulesForLongText(arr){
  return (arr || []).map(s => String(s).trim()).filter(Boolean).join("\n");
}
function getSelectedTitleIds(){
  const sel = ui.titleSelect;
  if (!sel) return [];
  return Array.from(sel.selectedOptions || []).map(o => o.value).filter(Boolean);
}
function computeAssignedAgg(selectedIds){
  const chosen = state.titles.filter(t => selectedIds.includes(t.id));
  const lists = chosen.map(t => new Set((t.assigned || []).map(String)));
  if (lists.length === 0) return { all: new Set(), some: new Set() };
  const union = new Set();
  lists.forEach(s => s.forEach(x => union.add(x)));
  let intersection = new Set(lists[0]);
  for (let i=1;i<lists.length;i++){
    const next = new Set();
    lists[i].forEach(x => { if (intersection.has(x)) next.add(x); });
    intersection = next;
  }
  return { all: intersection, some: union };
}
function detectTitleFieldsFromSample(recFields = {}){
  state.assignedFieldName = state.assignedFieldName || AIRTABLE.TITLES_ASSIGNED_FIELD || "Assigned Modules";
  state.mappingFieldName  = state.mappingFieldName  || AIRTABLE.TITLES_MAPPING_FIELD  || "Assigned Modules Mapping";
  // If the table uses slightly different names, detect them once:
  Object.keys(recFields).forEach(k => {
    const lk = k.toLowerCase();
    if (!state.assignedFieldName && lk.includes("assigned") && lk.includes("module")) state.assignedFieldName = k;
    if (!state.mappingFieldName  && lk.includes("mapping")) state.mappingFieldName  = k;
  });
}
function rebuildChecklistForCurrentSelection(){
  const ids = state.selectedTitleIds;
  const { all, some } = computeAssignedAgg(ids);
  buildModuleChecklist(all);
  if (ui.assignStatus){
    if (!ids.length) {
      ui.assignStatus.textContent = "Select one or more titles to view/assign modules.";
    } else {
      const diff = [...some].filter(x => !all.has(x));
      ui.assignStatus.textContent =
        diff.length
          ? `Pre-checked = modules shared by ALL selected titles. Also detected ${diff.length} module(s) present in SOME but not all.`
          : `All selected titles share the same module set.`;
    }
  }
}
function detectAssignedFieldNameFromRecordFields(fieldsObj){
  if (!fieldsObj) return null;
  const keys = Object.keys(fieldsObj);
  if (!keys.length) return null;
  const want = (AIRTABLE.TITLES_ASSIGNED_FIELD || "").toLowerCase();
  let found = keys.find(k => k.toLowerCase() === want);
  if (found) return found;
  const cand = keys.find(k => {
    const s = k.toLowerCase();
    return s.includes("assigned") && s.includes("module");
  });
  if (cand) return cand;
  const modOnly = keys.find(k => k.toLowerCase().includes("modules"));
  return modOnly || null;
}
function detectMappingFieldNameFromRecordFields(fieldsObj){
  if (!fieldsObj) return null;
  const keys = Object.keys(fieldsObj);
  if (!keys.length) return null;
  if (AIRTABLE.TITLES_MAPPING_FIELD) {
    const want = AIRTABLE.TITLES_MAPPING_FIELD.toLowerCase();
    const exact = keys.find(k => k.toLowerCase() === want);
    if (exact) return exact;
  }
  const cand = keys.find(k => {
    const s = k.toLowerCase();
    return s.includes("assigned") && (s.includes("map") || s.includes("mapping"));
  });
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
  state.titles = unique;
  populateTitleSelect(unique);
  return unique;
}
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
    }
    return v.length ? String(v[0]) : "";
  }
  if (typeof v === "object") {
    if (typeof v.name === "string") return v.name.trim();
    return JSON.stringify(v);
  }
  try { return String(v); } catch { return ""; }
}
function populateTitleSelect(list){
  if (!ui.titleSelect) return;
  if (!Array.isArray(list) || !list.length) {
    ui.titleSelect.innerHTML = `<option value="">(no titles found)</option>`;
    return;
  }
  ui.titleSelect.innerHTML = list.map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("");
}
function onTitleChange(){
  state.selectedTitleIds = getSelectedTitleIds();
  rebuildChecklistForCurrentSelection();
}

// Save assignment — merge the selected module into Assigned Modules
async function saveAssignment(){
  const pickedIds = state.selectedTitleIds;
  if (!pickedIds.length) { toast("Pick at least one Title.", "bad"); return; }
  const expandedIds = Array.from(new Set(pickedIds.flatMap(id => {
    const key = state.titleKeyById[id];
    return key ? (state.idsByTitleKey[key] || [id]) : [id];
  })));
  const selected = readChecklistSelection();
  if (!selected.length) { toast("No module selected.", "bad"); return; }
  const fieldName   = state.assignedFieldName || AIRTABLE.TITLES_ASSIGNED_FIELD;
  const mappingField = state.mappingFieldName || null;
  if (!fieldName) { toast("Assigned field not found.", "bad"); return; }

  try {
    const toPatch = [];
    for (const id of expandedIds) {
      const rec = await readRecord(AIRTABLE.TITLES_TABLE_ID, id);
      const f = rec.fields || {};
      const titleTxt = normalizeTitle(f[AIRTABLE.TITLES_FIELD_NAME]);
      const currentRaw  = f[fieldName];
      const currentList = parseModulesFromLongText(currentRaw);
      const mergedSet   = new Set([...currentList, ...selected].map(s => String(s).trim()).filter(Boolean));
      const mergedArr   = Array.from(mergedSet).sort((a,b)=>a.localeCompare(b));
      const nextText    = joinModulesForLongText(mergedArr);
      if (nextText === (currentRaw == null ? "" : String(currentRaw))) continue;
      const fields = { [fieldName]: nextText };
      if (mappingField) fields[mappingField] = `${titleTxt}: ${mergedArr.join(", ")}`;
      toPatch.push({ id, fields });
    }
    if (!toPatch.length) { toast("Nothing to update.", "bad"); return; }
    for (let i=0; i<toPatch.length; i+=10) {
      const chunk = toPatch.slice(i, i+10);
      const res = await fetch(baseUrl(AIRTABLE.TITLES_TABLE_ID), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ records: chunk, typecast: true })
      });
      if (!res.ok) throw new Error(`Save failed HTTP ${res.status} – ${await res.text()}`);
      await res.json();
    }
    toast(`Updated ${toPatch.length} record(s).`);
    await fetchDistinctTitles();
    rebuildChecklistForCurrentSelection();
  } catch (e) {
    console.error(e);
    toast("Save failed", "bad");
  }
}
async function reloadTitles(){
  ui.assignStatus && (ui.assignStatus.textContent = "Loading titles…");
  const data = await listAll({ tableId: AIRTABLE.TITLES_TABLE_ID, pageSize: 100, sortField: AIRTABLE.TITLES_FIELD_NAME, sortDir: "asc" });
  const recs = data.records || [];
  if (recs[0]) detectTitleFieldsFromSample(recs[0].fields || {});

  state.titles = recs.map(r => {
    const f = r.fields || {};
    const assigned = parseModulesFromLongText(f[state.assignedFieldName] || "");
    const titleKey = String(f[AIRTABLE.TITLES_FIELD_NAME] || "").toLowerCase().trim();
    return { id: r.id, title: f[AIRTABLE.TITLES_FIELD_NAME] || "(untitled)", assigned, fields: f, key: titleKey };
  });

  state.idsByTitleKey = Object.create(null);
  state.titleKeyById  = Object.create(null);
  state.titles.forEach(t => {
    state.titleKeyById[t.id] = t.key;
    (state.idsByTitleKey[t.key] ||= []).push(t.id);
  });

  // Populate the multi-select
  if (ui.titleSelect) {
    ui.titleSelect.innerHTML = state.titles
      .map(t => `<option value="${t.id}">${esc(t.title)}</option>`)
      .join("");
  }
  ui.assignStatus && (ui.assignStatus.textContent = `Loaded ${state.titles.length} title(s).`);
}
function buildModuleChecklistForSelection(){
  const selectedIds = getSelectedTitleIds();
  const chosen = state.titles.filter(t => selectedIds.includes(t.id));
  const union = new Set();
  chosen.forEach(t => t.assigned.forEach(m => union.add(m)));
  buildModuleChecklist(union);
}
async function onSaveAssignment(){
  const selectedIds = getSelectedTitleIds();
  const moduleName = currentModuleValue();
  if (!selectedIds.length) return toast("Select at least one title.", "warn");
  if (!moduleName)       return toast("Choose a Module to assign.", "warn");

  // Prepare PATCH batch(es)
  const updates = [];
  selectedIds.forEach(id => {
    const t = state.titles.find(x => x.id === id);
    const set = new Set([...(t?.assigned || []), moduleName]);
    const fields = {};
    fields[state.assignedFieldName] = joinModulesForLongText(Array.from(set).sort((a,b)=>a.localeCompare(b)));
    fields[state.mappingFieldName]  = `${t?.title || ""}: ${fields[state.assignedFieldName]}`;
    updates.push({ id, fields });
  });

  await batchPatch(AIRTABLE.TITLES_TABLE_ID, updates);
  toast("Assigned.", "ok");
  await reloadTitles();
  buildModuleChecklistForSelection();
}
async function onUnassignModule(){
  const selectedIds = getSelectedTitleIds();
  const moduleName = currentModuleValue();
  if (!selectedIds.length) return toast("Select at least one title.", "warn");
  if (!moduleName)       return toast("Choose a Module to unassign.", "warn");

  const updates = [];
  selectedIds.forEach(id => {
    const t = state.titles.find(x => x.id === id);
    const set = new Set((t?.assigned || []).filter(m => m !== moduleName));
    const fields = {};
    fields[state.assignedFieldName] = joinModulesForLongText(Array.from(set).sort((a,b)=>a.localeCompare(b)));
    fields[state.mappingFieldName]  = `${t?.title || ""}: ${fields[state.assignedFieldName]}`;
    updates.push({ id, fields });
  });

  await batchPatch(AIRTABLE.TITLES_TABLE_ID, updates);
  toast("Unassigned.", "ok");
  await reloadTitles();
  buildModuleChecklistForSelection();
}
async function onClearAssignment(){
  const selectedIds = getSelectedTitleIds();
  if (!selectedIds.length) return toast("Select at least one title.", "warn");
  if (!dangerConfirm("Clear all assigned modules for the selected title(s)?")) return;

  const updates = selectedIds.map(id => ({
    id,
    fields: {
      [state.assignedFieldName]: "",
      [state.mappingFieldName]: ""
    }
  }));
  await batchPatch(AIRTABLE.TITLES_TABLE_ID, updates);
  toast("Cleared.", "ok");
  await reloadTitles();
  buildModuleChecklistForSelection();
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

// Wire up
if (ui.btnSaveAssignment)   ui.btnSaveAssignment.addEventListener("click", onSaveAssignment);
if (ui.btnUnassignModule)   ui.btnUnassignModule.addEventListener("click", onUnassignModule);
if (ui.btnClearAssignment)  ui.btnClearAssignment.addEventListener("click", onClearAssignment);
if (ui.titleSelect)         ui.titleSelect.addEventListener("change", buildModuleChecklistForSelection);

// Initial load (so titles/mapping exist)
reloadTitles().catch(e => { console.error(e); toast(e.message || "Titles load failed", "bad"); });
// NEW: Unassign (remove) the selected module from Assigned Modules
async function unassignAssignment(){
  const pickedIds = state.selectedTitleIds;
  if (!pickedIds.length) { toast("Pick at least one Title.", "bad"); return; }

  const targetModule = currentModuleValue().trim();
  if (!targetModule) { toast("Pick a Module (above) to unassign.", "bad"); return; }

  const expandedIds = Array.from(new Set(pickedIds.flatMap(id => {
    const key = state.titleKeyById[id];
    return key ? (state.idsByTitleKey[key] || [id]) : [id];
  })));

  const fieldName   = state.assignedFieldName || AIRTABLE.TITLES_ASSIGNED_FIELD;
  const mappingField = state.mappingFieldName || null;
  if (!fieldName) { toast("Assigned field not found.", "bad"); return; }

  try {
    const toPatch = [];
    for (const id of expandedIds) {
      const rec = await readRecord(AIRTABLE.TITLES_TABLE_ID, id);
      const f = rec.fields || {};
      const titleTxt = normalizeTitle(f[AIRTABLE.TITLES_FIELD_NAME]);
      const currentRaw  = f[fieldName];
      const currentList = parseModulesFromLongText(currentRaw);

      // remove the module (case-sensitive exact match)
      const nextArr = currentList.filter(m => m !== targetModule);
      // no-op if unchanged
      const nextText = joinModulesForLongText(nextArr);
      if (nextText === (currentRaw == null ? "" : String(currentRaw))) continue;

      const fields = { [fieldName]: nextText };
      if (mappingField) fields[mappingField] = `${titleTxt}: ${nextArr.join(", ")}`;
      toPatch.push({ id, fields });
    }

    if (!toPatch.length) { toast("Nothing to update.", "bad"); return; }

    for (let i=0; i<toPatch.length; i+=10) {
      const chunk = toPatch.slice(i, i+10);
      const res = await fetch(baseUrl(AIRTABLE.TITLES_TABLE_ID), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ records: chunk, typecast: true })
      });
      if (!res.ok) throw new Error(`Unassign failed HTTP ${res.status} – ${await res.text()}`);
      await res.json();
    }

    toast(`Unassigned “${targetModule}” from ${toPatch.length} record(s).`);
    await fetchDistinctTitles();
    rebuildChecklistForCurrentSelection();
  } catch (e) {
    console.error(e);
    toast(e?.message || "Unassign failed", "bad");
  }
}

function getSelectedTitleIds(){
  const sel = ui.titleSelect;
  if (!sel) return [];
  return Array.from(sel.selectedOptions || []).map(o => o.value).filter(Boolean);
}

// ========= Wire events =========
if (ui.btnAddOption) ui.btnAddOption.addEventListener("click", () => addOption(""));
if (ui.btnClearOptions) ui.btnClearOptions.addEventListener("click", () => setOptions(["",""]));
if (ui.questionType) ui.questionType.addEventListener("change", updateTypeVisibility);

if (ui.btnSave) ui.btnSave.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    const fields = readForm();
    if (state.editingId) {
      await updateRecord(state.editingId, fields);
      toast("Updated");
    } else {
      await createRecord(fields);
      toast("Created");
    }
    resetForm();
    await refreshList();
  } catch (err) {
    toast(err?.message || "Save failed", "bad");
  }
});
if (ui.btnReset) ui.btnReset.addEventListener("click", (e) => { e.preventDefault(); resetForm(); });

// Assignments: events
if (ui.btnReloadTitles) ui.btnReloadTitles.addEventListener("click", async () => {
  await fetchDistinctTitles();
  rebuildChecklistForCurrentSelection();
});
if (ui.titleSelect) ui.titleSelect.addEventListener("change", onTitleChange);
if (ui.btnSaveAssignment) ui.btnSaveAssignment.addEventListener("click", saveAssignment);
if (ui.btnUnassignModule) ui.btnUnassignModule.addEventListener("click", unassignAssignment);
if (ui.btnClearAssignment) ui.btnClearAssignment.addEventListener("click", () => {
  ui.assignStatus && (ui.assignStatus.textContent = "Cleared (not saved).");
});

// Search/filter live
if (ui.search) ui.search.addEventListener('input', () => renderModulesView(ui.search.value));
if (ui.fltActive) ui.fltActive.addEventListener('change', () => renderModulesView(ui.search.value));
if (ui.fltInactive) ui.fltInactive.addEventListener('change', () => renderModulesView(ui.search.value));
if (ui.btnRefresh) ui.btnRefresh.addEventListener('click', () => refreshList());

// ========= Init =========
(async function init(){
  console.log("[Admin] init() grouped modules + FITB + Unassign");
  try {
    updateTypeVisibility();
    if (ui.options && ui.options.children.length === 0) { setOptions(["",""]); }
    await refreshList();
    await fetchDistinctTitles();
    rebuildChecklistForCurrentSelection();
  } catch (e) {
    console.error(e);
  }
})();
