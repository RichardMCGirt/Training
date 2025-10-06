// admin.js – Questions editor + Assignments (Modules by Job Title)

// ========= Airtable Config =========
const AIRTABLE = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",
  // Questions table (stores quiz questions)
  TABLE_ID: "tblpvVpIJnkWco25E",
  // Titles table (stores Job Titles with an "Assigned Modules" field)
  TITLES_TABLE_ID: "tblppx6qNXXNJL7ON",
  // Optional: a friendly name for the Titles field
  TITLES_FIELD_NAME: "Title",
  TITLES_ASSIGNED_FIELD: "Assigned Modules"
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
  questionsBody: $("#questionsBody"),
  listStatus: $("#listStatus"),
  prevPage: $("#prevPage"),
  nextPage: $("#nextPage"),

  // Form
  slideId: $("#slideId"),
  order: $("#order"),
  questionId: $("#questionId"),
  questionText: $("#questionText"),
  btnAddOption: $("#btnAddOption"),
  btnClearOptions: $("#btnClearOptions"),
  options: $("#options"),
  btnSave: $("#btnSave"),
  btnReset: $("#btnReset"),

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
  btnClearAssignment: $("#btnClearAssignment"),
  assignStatus: $("#assignStatus")
};

// ========= Toast / Utils =========
function toast(msg, kind="info", ms=1800){
  try {
    ui.toastMsg.textContent = msg;
    ui.toast.classList.add("show");
    setTimeout(() => ui.toast.classList.remove("show"), ms);
  } catch {}
}
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
const asBool = v => !!(v === true || v === "true" || v === 1 || v === "1" || v === "on");
function safeParseJSON(v){ try { return JSON.parse(v); } catch { return Array.isArray(v) ? v : []; }}

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

// Generic list with sort + optional filter + paging for any table
async function listAll({ tableId = AIRTABLE.TABLE_ID, pageSize=100, offset, sortField="Order", sortDir="asc", filterByFormula } = {}){
  const url = new URL(baseUrl(tableId));
  url.searchParams.set("pageSize", String(pageSize));
  if (sortField) {
    url.searchParams.set("sort[0][field]", sortField);
    url.searchParams.set("sort[0][direction]", sortDir);
  }
  if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
  if (offset) url.searchParams.set("offset", offset);

  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(()=>"(no body)");
    console.error("[Admin] listAll failed:", { tableId, status: res.status, body });
    throw new Error(`Fetch failed: HTTP ${res.status}`);
  }
  return res.json();
}
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
async function batchUpdateOrder(pairs /* [{id, order}] */){
  for (let i = 0; i < pairs.length; i += 10) {
    const chunk = pairs.slice(i, i + 10).map(p => ({ id: p.id, fields: { "Order": p.order } }));
    const res = await fetch(baseUrl(), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ records: chunk, typecast: true }),
    });
    if (!res.ok) throw new Error(`Reorder failed: HTTP ${res.status} – ${await res.text()}`);
    await res.json();
  }
}
async function deleteRecord(id){
  const url = baseUrl() + `?records[]=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method:"DELETE", headers: headers() });
  if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status} – ${await res.text()}`);
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
  titles: [],           // [{id, title}]
  selectedTitleId: null // record id
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

// ========= Form helpers (Questions) =========
function genQuestionId(prefix="q"){ return `${prefix}_${Math.random().toString(36).slice(2,8)}`; }
function readForm(){
  const slide = (ui.slideId.value || "").trim();
  const order = Number(ui.order.value || 0);
  const qid = (ui.questionId.value || "").trim() || genQuestionId("q");
  const qtext = (ui.questionText.value || "").trim();
  const opts = getOptions();
  const moduleVal = currentModuleValue();

  if (!qtext) throw new Error("Question text is required.");
  if (opts.length === 0) throw new Error("Add at least one option.");
  const correct = (opts.find(o => o.correct) || {}).text || "";

  return {
    "Slide ID": slide,
    "Order": order,
    "QuestionId": qid,
    "Question": qtext,
    "Options (JSON)": JSON.stringify(opts.map(o => o.text)),
    "Correct": correct,
    "Required": true,
    "Active": true,
    "Module": moduleVal || undefined,
  };
}
function fillForm(fields){
  ui.slideId.value = fields["Slide ID"] || "";
  ui.order.value = Number(fields["Order"] || 1);
  ui.questionId.value = fields["QuestionId"] || "";
  ui.questionText.value = fields["Question"] || "";
  const arr = safeParseJSON(fields["Options (JSON)"]);
  setOptions(arr, fields["Correct"] || "");
  const m = fields["Module"] || "";
  if (ui.moduleSelect) ui.moduleSelect.value = m;
  if (ui.moduleInput) ui.moduleInput.value = "";
}
function resetForm(){
  state.editingId = null;
  ui.slideId.value = "";
  ui.order.value = "1";
  ui.questionId.value = "";
  ui.questionText.value = "";
  if (ui.moduleSelect) ui.moduleSelect.value = "";
  if (ui.moduleInput) ui.moduleInput.value = "";
  setOptions(["",""]);
}

// ========= Render list (Questions) =========
function renderList(rows){
  console.groupCollapsed("[Admin] renderList()");
  console.time("[Admin] renderList");
  try {
    const tb = ui?.questionsBody;
    if (!tb) {
      console.error("[Admin] ui.questionsBody not found. Aborting render.");
      return;
    }
    tb.innerHTML = "";

    if (!rows || !rows.length) {
      tb.innerHTML = `<tr><td colspan="8" class="muted">No questions found.</td></tr>`;
      console.warn("[Admin] No rows to render.");
      return;
    }

    let rendered = 0;
    for (const r of rows) {
      const f = r.fields || {};
      let opts = safeParseJSON(f["Options (JSON)"]);
      const flags = `${asBool(f.Active) ? "Active" : "Inactive"} · ${asBool(f.Required) ? "Required" : "Optional"}`;
      const tr = document.createElement("tr");
      tr.setAttribute("draggable", "true");
      tr.dataset.id = r.id;
      tr.innerHTML = `
        <td class="nowrap handle">☰ ${Number(f.Order||0)}</td>
        <td>${esc(f.Question||"")}<div class="small muted">${opts?.length ? esc(opts.join(" | ")) : "<em>No options</em>"}</div></td>
        <td>${esc(f.Correct||"")}</td>
        <td class="small">${esc(f["Module"]||"")}</td>
        <td class="small">${esc(f["Slide ID"]||"")}</td>
        <td class="small">${esc(f["QuestionId"]||"")}</td>
        <td class="small muted">${esc(flags)}</td>
        <td class="nowrap">
          <button class="btn btn-ghost edit" data-id="${esc(r.id)}">Edit</button>
          <button class="btn btn-danger del" data-id="${esc(r.id)}">Delete</button>
        </td>
      `;
      tb.appendChild(tr);
      rendered++;
    }

    // Bind actions
    $$(".edit").forEach(b => b.addEventListener("click", () => {
      const id = b.getAttribute("data-id");
      const row = state.rows?.find(x => x.id === id);
      if (!row) return;
      state.editingId = id;
      fillForm(row.fields);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));
    $$(".del").forEach(b => b.addEventListener("click", async () => {
      const id = b.getAttribute("data-id");
      if (!confirm("Delete this question?")) return;
      try { await deleteRecord(id); toast("Deleted"); await refreshList({ keepPage:true }); }
      catch (e) { console.error(e); toast("Delete failed", "bad"); }
    }));

    enableRowDragAndSave();
  } catch (err) {
    console.error("[Admin] renderList() failed:", err);
  } finally {
    console.timeEnd("[Admin] renderList");
    console.groupEnd();
  }
}
function enableRowDragAndSave(){
  const rows = Array.from(ui.questionsBody.querySelectorAll("tr"));
  let dragEl = null;
  rows.forEach(tr => {
    tr.addEventListener("dragstart", e => {
      dragEl = tr;
      tr.classList.add("ghost");
      e.dataTransfer.effectAllowed = "move";
    });
    tr.addEventListener("dragend", () => {
      if (dragEl) dragEl.classList.remove("ghost");
      dragEl = null;
      saveNewOrderFromDom().catch(err => toast(err.message || "Reorder failed", "bad"));
    });
    tr.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const target = tr;
      if (!dragEl || dragEl === target) return;
      const box = target.getBoundingClientRect();
      const mid = box.top + box.height/2;
      const parent = ui.questionsBody;
      if (e.clientY < mid) parent.insertBefore(dragEl, target);
      else parent.insertBefore(dragEl, target.nextSibling);
    });
  });
}
async function saveNewOrderFromDom(){
  const ids = Array.from(ui.questionsBody.querySelectorAll("tr")).map(tr => tr.dataset.id);
  const pairs = ids.map((id, idx) => ({ id, order: idx + 1 }));
  await batchUpdateOrder(pairs);
  toast("Order saved.");
  await refreshList({ keepPage:true });
}

// ========= List / search / paging (Questions) =========
function filterRows(q){
  const s = (q||"").trim().toLowerCase();
  const showActive = ui.fltActive ? ui.fltActive.checked : true;
  const showInactive = ui.fltInactive ? ui.fltInactive.checked : true;
  return state.rows.filter(r => {
    const f = r.fields || {};
    const hay = `${f.Question||""}\n${f["Slide ID"]||""}\n${f.QuestionId||""}\n${f.Module||""}`.toLowerCase();
    const passesSearch = !s || hay.includes(s);
    const isActive = asBool(f.Active);
    const passesFlags = (isActive && showActive) || (!isActive && showInactive);
    return passesSearch && passesFlags;
  });
}
async function refreshList({ keepPage=false } = {}){
  ui.listStatus && (ui.listStatus.textContent = "Loading…");
  try {
    let offset = keepPage ? state.prevOffsets.at(-1) : undefined;
    if (!keepPage) { state.prevOffsets = []; state.nextOffset = null; }
    const data = await listAll({ tableId: AIRTABLE.TABLE_ID, pageSize: 100, offset, sortField:"Order", sortDir:"asc" });
    state.rows = data.records || [];
    state.nextOffset = data.offset || null;

    // collect module values
    state.modules = new Set(state.rows.map(r => (r.fields||{}).Module).filter(Boolean));
    populateModuleSelect(state.modules);

    // Also (re)build assignment checklist if already visible/used
    buildModuleChecklist();

    renderList(filterRows(ui.search ? ui.search.value : ""));
    ui.listStatus && (ui.listStatus.textContent = `Showing ${state.rows.length} ${state.rows.length===1?"record":"records"}.`);
    if (ui.prevPage) ui.prevPage.disabled = state.prevOffsets.length === 0;
    if (ui.nextPage) ui.nextPage.disabled = !state.nextOffset;
  } catch (e) {
    console.error("[Admin] refreshList failed:", e);
    ui.listStatus && (ui.listStatus.textContent = "Load failed.");
    toast(e.message || "Load failed", "bad");
  }
}

// ========= Assignments: Titles ⇄ Modules =========
function buildModuleChecklist(selected = new Set()){
  if (!ui.moduleChecklist) return;
  const modules = Array.from(state.modules).sort((a,b)=>a.localeCompare(b));
  if (!modules.length) {
    ui.moduleChecklist.innerHTML = `<div class="muted small">No modules found yet. Create questions with a Module value first.</div>`;
    return;
  }
  ui.moduleChecklist.innerHTML = modules.map(m => {
    const id = `chk_${m.replace(/\W+/g,'_').toLowerCase()}`;
    const checked = selected.has(m) ? "checked" : "";
    return `
      <label class="check-item" for="${id}">
        <input type="checkbox" id="${id}" class="modCheck" value="${esc(m)}" ${checked}>
        <span>${esc(m)}</span>
      </label>
    `;
  }).join("");
}
function readChecklistSelection(){
  return $$(".modCheck").filter(c => c.checked).map(c => c.value);
}
async function fetchDistinctTitles(){
  console.groupCollapsed("[Admin] fetchDistinctTitles");
  try {
    const titles = [];
    let offset;
    do {
      const data = await listAll({
        tableId: AIRTABLE.TITLES_TABLE_ID,
        pageSize: 100,
        offset,
        sortField: AIRTABLE.TITLES_FIELD_NAME,
        sortDir: "asc"
      });
      (data.records || []).forEach(r => {
        const f = r.fields || {};
        const t = (f[AIRTABLE.TITLES_FIELD_NAME] || "").trim();
        if (t) titles.push({ id: r.id, title: t, assigned: Array.isArray(f[AIRTABLE.TITLES_ASSIGNED_FIELD]) ? f[AIRTABLE.TITLES_ASSIGNED_FIELD] : [] });
      });
      offset = data.offset;
    } while (offset);

    // Dedup by title text just in case
    const seen = new Set();
    const unique = [];
    for (const row of titles) {
      const k = row.title.toLowerCase();
      if (!seen.has(k)) { seen.add(k); unique.push(row); }
    }
    state.titles = unique;
    populateTitleSelect(unique);
    console.log("[Admin] Titles loaded:", { count: unique.length, sample: unique[0] });
    return unique;
  } catch (e) {
    console.error("[Admin] fetchDistinctTitles failed:", e);
    toast("Titles fetch failed " + (e?.message || ""), "bad");
    throw e;
  } finally {
    console.groupEnd();
  }
}
function populateTitleSelect(list){
  if (!ui.titleSelect) return;
  if (!Array.isArray(list) || !list.length) {
    ui.titleSelect.innerHTML = `<option value="">(no titles found)</option>`;
    return;
  }
  ui.titleSelect.innerHTML =
    `<option value="">(select a title)</option>` +
    list.map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("");
}
function onTitleChange(){
  const id = ui.titleSelect?.value || "";
  state.selectedTitleId = id || null;
  // If we know the assigned modules for this title, pre-check them
  const row = state.titles.find(x => x.id === id);
  const preselected = new Set((row?.assigned || []).map(String));
  buildModuleChecklist(preselected);
}
async function saveAssignment(){
  if (!state.selectedTitleId) {
    toast("Pick a Title first.", "bad");
    return;
  }
  const selected = readChecklistSelection();
  try {
    const res = await fetch(baseUrl(AIRTABLE.TITLES_TABLE_ID), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        records: [{
          id: state.selectedTitleId,
          fields: {
            // Assuming "Assigned Modules" is a multi-select of text options.
            [AIRTABLE.TITLES_ASSIGNED_FIELD]: selected
          }
        }],
        typecast: true
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(()=>"(no body)");
      console.error("[Admin] saveAssignment failed:", res.status, body);
      throw new Error(`Save failed HTTP ${res.status}`);
    }
    toast("Assignment saved.");
    ui.assignStatus && (ui.assignStatus.textContent = `Saved ${selected.length} ${selected.length===1?"module":"modules"}.`);
    // Update cached assigned list for this title
    const row = state.titles.find(x => x.id === state.selectedTitleId);
    if (row) row.assigned = selected.slice();
  } catch (e) {
    console.error(e);
    toast("Save failed", "bad");
  }
}
function clearAssignmentChecks(){
  $$(".modCheck").forEach(c => c.checked = false);
  ui.assignStatus && (ui.assignStatus.textContent = "Cleared (not saved).");
}

// ========= Wire events =========
if (ui.btnAddOption) ui.btnAddOption.addEventListener("click", () => addOption(""));
if (ui.btnClearOptions) ui.btnClearOptions.addEventListener("click", () => setOptions(["",""]));

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
    await refreshList({ keepPage:true });
  } catch (err) {
    toast(err?.message || "Save failed", "bad");
  }
});
if (ui.btnReset) ui.btnReset.addEventListener("click", (e) => { e.preventDefault(); resetForm(); });

// Assignments: events
if (ui.btnReloadTitles) ui.btnReloadTitles.addEventListener("click", fetchDistinctTitles);
if (ui.titleSelect) ui.titleSelect.addEventListener("change", onTitleChange);
if (ui.btnSaveAssignment) ui.btnSaveAssignment.addEventListener("click", saveAssignment);
if (ui.btnClearAssignment) ui.btnClearAssignment.addEventListener("click", clearAssignmentChecks);

// ========= Init =========
(function init(){
  console.log("[Admin] init()");
  // Questions UI
  if (ui.options && ui.options.children.length === 0) { setOptions(["",""]); }
  if (ui.btnRefresh) ui.btnRefresh.addEventListener('click', () => refreshList());
  if (ui.search) ui.search.addEventListener('input', () => renderList(filterRows(ui.search.value)));
  if (ui.fltActive) ui.fltActive.addEventListener('change', () => renderList(filterRows(ui.search.value)));
  if (ui.fltInactive) ui.fltInactive.addEventListener('change', () => renderList(filterRows(ui.search.value)));

  // Load questions + modules
  refreshList().catch(e => console.error(e));

  // Load titles immediately so the select isn't empty
  fetchDistinctTitles()
    .then(() => onTitleChange())
    .catch(e => console.error("[Admin] Titles initial load failed:", e));
})();
