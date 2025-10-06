
const AIRTABLE = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",
  TABLE_ID: "tblpvVpIJnkWco25E", 
};

/** ---------------------------------------------------------------------
 * UX helpers
 * --------------------------------------------------------------------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const ui = {
  search: $("#search"),
  fltActive: $("#fltActive"),
  fltInactive: $("#fltInactive"),
  btnRefresh: $("#btnRefresh"),
  btnExport: $("#btnExport"),
  fileImport: $("#fileImport"),
  questionsBody: $("#questionsBody"),
  listStatus: $("#listStatus"),
  prevPage: $("#prevPage"),
  nextPage: $("#nextPage"),
  // form
  formMode: $("#formMode"),
  slideId: $("#slideId"),
  order: $("#order"),
  questionId: $("#questionId"),
  questionText: $("#questionText"),
  required: $("#required"),
  active: $("#active"),
  btnAddOption: $("#btnAddOption"),
  btnClearOptions: $("#btnClearOptions"),
  options: $("#options"),
  btnSave: $("#btnSave"),
  btnReset: $("#btnReset"),
  saveStatus: $("#saveStatus"),
  toast: $("#toast"),
  toastMsg: $("#toastMsg"),
};

function toast(msg, kind="info", ms=1800){
  ui.toastMsg.textContent = msg;
  ui.toast.classList.add("show");
  setTimeout(() => ui.toast.classList.remove("show"), ms);
}
function pulse(el, msg){
  el.textContent = msg;
  setTimeout(()=> el.textContent = "", 1800);
}
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
const asBool = v => !!(v === true || v === "true" || v === 1 || v === "1" || v === "on");

/** ---------------------------------------------------------------------
 * Airtable REST helpers
 * --------------------------------------------------------------------- */
function headers(){ return { "Authorization": `Bearer ${AIRTABLE.API_KEY}`, "Content-Type": "application/json" }; }
const baseUrl = () => `https://api.airtable.com/v0/${AIRTABLE.BASE_ID}/${encodeURIComponent(AIRTABLE.TABLE_ID)}`;

async function listAll({pageSize=50, offset}={}){
  const url = new URL(baseUrl());
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("sort[0][field]", "Order");
  url.searchParams.set("sort[0][direction]", "asc");
  if (offset) url.searchParams.set("offset", offset);
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
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
async function deleteRecord(id){
  const url = baseUrl() + `?records[]=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method:"DELETE", headers: headers() });
  if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status} – ${await res.text()}`);
  return res.json();
}

/** ---------------------------------------------------------------------
 * State
 * --------------------------------------------------------------------- */
const state = {
  rows: [],            // full fetched rows in-memory (current page only)
  nextOffset: null,
  prevOffsets: [],     // stack for pagination back
  editingId: null,     // Airtable record id being edited
};

/** ---------------------------------------------------------------------
 * Options builder (radio-select correct, reorder, delete)
 * --------------------------------------------------------------------- */
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
  // Move up
  row.querySelector(".up").addEventListener("click", () => {
    const parent = ui.options;
    const idx = [...parent.children].indexOf(row);
    if (idx > 0) parent.insertBefore(row, parent.children[idx-1]);
  });
  // Delete
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

/** ---------------------------------------------------------------------
 * Form helpers
 * --------------------------------------------------------------------- */
function genQuestionId(prefix="q"){
  return `${prefix}_${Math.random().toString(36).slice(2,8)}`;
}
function readForm(){
  const slide = ui.slideId.value.trim();
  const order = Number(ui.order.value || 0);
  const qid = (ui.questionId.value || "").trim() || genQuestionId("q");
  const qtext = ui.questionText.value.trim();
  const required = ui.required.checked;
  const active = ui.active.checked;
  const opts = getOptions();

  if (!qtext) throw new Error("Question text is required.");
  if (opts.length === 0) throw new Error("Add at least one option.");
  const correct = (opts.find(o => o.correct) || {}).text || "";
  if (correct && !opts.some(o => o.text === correct)) {
    throw new Error("Correct option must match one of the options.");
  }

  return {
    "Slide ID": slide,
    "Order": order,
    "QuestionId": qid,
    "Question": qtext,
    "Options (JSON)": JSON.stringify(opts.map(o => o.text)),
    "Correct": correct,
    "Required": required,
    "Active": active,
  };
}
function fillForm(fields){
  ui.slideId.value = fields["Slide ID"] || "";
  ui.order.value = Number(fields["Order"] || 1);
  ui.questionId.value = fields["QuestionId"] || "";
  ui.questionText.value = fields["Question"] || "";
  ui.required.checked = asBool(fields["Required"]);
  ui.active.checked = asBool(fields["Active"]);
  const arr = safeParseJSON(fields["Options (JSON)"]);
  setOptions(arr, fields["Correct"] || "");
  ui.formMode.textContent = "Edit";
}
function resetForm(){
  state.editingId = null;
  ui.formMode.textContent = "Create";
  ui.slideId.value = "";
  ui.order.value = "1";
  ui.questionId.value = "";
  ui.questionText.value = "";
  ui.required.checked = false;
  ui.active.checked = true;
  setOptions(["",""]);
}

function safeParseJSON(v){
  try { return JSON.parse(v); } catch { return Array.isArray(v) ? v : []; }
}

/** ---------------------------------------------------------------------
 * Rendering list
 * --------------------------------------------------------------------- */
function renderList(rows){
  const tb = ui.questionsBody;
  tb.innerHTML = "";
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="7" class="muted">No questions found.</td></tr>`;
    return;
  }
  for (const r of rows) {
    const f = r.fields || {};
    const opts = safeParseJSON(f["Options (JSON)"]);
    const flags = `${asBool(f.Active)?"Active":"Inactive"} · ${asBool(f.Required)?"Required":"Optional"}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="nowrap">${Number(f.Order||0)}</td>
      <td>${esc(f.Question||"")}<div class="small muted">${opts?.length? esc(opts.join(" | ")) : "<em>No options</em>"}</div></td>
      <td>${esc(f.Correct||"")}</td>
      <td class="small">${esc(f["Slide ID"]||"")}</td>
      <td class="small">${esc(f["QuestionId"]||"")}</td>
      <td class="small muted">${esc(flags)}</td>
      <td class="nowrap">
        <button class="btn btn-ghost edit" data-id="${esc(r.id)}">Edit</button>
        <button class="btn btn-danger del" data-id="${esc(r.id)}">Delete</button>
      </td>
    `;
    tb.appendChild(tr);
  }
  // events
  $$(".edit").forEach(b => b.addEventListener("click", () => {
    const id = b.getAttribute("data-id");
    const row = state.rows.find(x => x.id === id);
    if (row) {
      state.editingId = id;
      fillForm(row.fields);
      window.scrollTo({ top: 0, behavior: "smooth"});
    }
  }));
  $$(".del").forEach(b => b.addEventListener("click", async () => {
    const id = b.getAttribute("data-id");
    if (!confirm("Delete this question?")) return;
    try {
      await deleteRecord(id);
      toast("Deleted");
      await refreshList({ keepPage:true });
    } catch (e) {
      toast("Delete failed", "bad");
    }
  }));
}

/** ---------------------------------------------------------------------
 * List / search / filter / paging
 * --------------------------------------------------------------------- */
function filterRows(q){
  const s = (q||"").trim().toLowerCase();
  const showActive = ui.fltActive.checked;
  const showInactive = ui.fltInactive.checked;
  return state.rows.filter(r => {
    const f = r.fields || {};
    const hay = `${f.Question||""}\n${f["Slide ID"]||""}\n${f.QuestionId||""}`.toLowerCase();
    const passesSearch = !s || hay.includes(s);
    const isActive = asBool(f.Active);
    const passesFlags = (isActive && showActive) || (!isActive && showInactive);
    return passesSearch && passesFlags;
  });
}
async function refreshList({ keepPage=false } = {}){
  ui.listStatus.textContent = "Loading…";
  try {
    let offset = keepPage ? state.prevOffsets.at(-1) : undefined;
    // If not keeping page, reset history
    if (!keepPage) {
      state.prevOffsets = [];
      state.nextOffset = null;
    }

    const data = await listAll({ pageSize: 50, offset });
    state.rows = data.records || [];
    state.nextOffset = data.offset || null;

    renderList(filterRows(ui.search.value));
    ui.listStatus.textContent = `Showing ${state.rows.length} ${state.rows.length===1?"record":"records"}.`;
    ui.prevPage.disabled = state.prevOffsets.length === 0;
    ui.nextPage.disabled = !state.nextOffset;
  } catch (e) {
    ui.listStatus.textContent = "Load failed.";
    toast(e.message || "Load failed", "bad");
  }
}
ui.btnRefresh.addEventListener("click", () => refreshList({ keepPage:false }));
ui.search.addEventListener("input", () => renderList(filterRows(ui.search.value)));
ui.fltActive.addEventListener("change", () => renderList(filterRows(ui.search.value)));
ui.fltInactive.addEventListener("change", () => renderList(filterRows(ui.search.value)));

ui.nextPage.addEventListener("click", async () => {
  if (!state.nextOffset) return;
  try {
    state.prevOffsets.push(state.nextOffset); // store current offset for back nav
    const data = await listAll({ pageSize: 50, offset: state.nextOffset });
    state.rows = data.records || [];
    state.nextOffset = data.offset || null;
    renderList(filterRows(ui.search.value));
    ui.prevPage.disabled = state.prevOffsets.length === 0;
    ui.nextPage.disabled = !state.nextOffset;
  } catch (e) { toast("Next page failed", "bad"); }
});
ui.prevPage.addEventListener("click", async () => {
  if (state.prevOffsets.length === 0) return;
  try {
    // In Airtable paging, we cannot go backwards directly with an API param.
    // Simple approach: restart from beginning and walk to the target page by consuming offsets.
    const targetDepth = state.prevOffsets.length - 1;
    let data, offset;
    state.rows = [];
    let depth = 0, currentOffset;
    while (true) {
      data = await listAll({ pageSize: 50, offset: currentOffset });
      if (depth === targetDepth) {
        state.rows = data.records || [];
        state.nextOffset = data.offset || null;
        state.prevOffsets = state.prevOffsets.slice(0, targetDepth);
        break;
      }
      if (!data.offset) break;
      currentOffset = data.offset;
      depth++;
    }
    renderList(filterRows(ui.search.value));
    ui.prevPage.disabled = state.prevOffsets.length === 0;
    ui.nextPage.disabled = !state.nextOffset;
  } catch (e) { toast("Prev page failed", "bad"); }
});

/** ---------------------------------------------------------------------
 * Save / Reset
 * --------------------------------------------------------------------- */
ui.btnAddOption.addEventListener("click", () => addOption(""));
ui.btnClearOptions.addEventListener("click", () => setOptions(["",""]));

ui.btnSave.addEventListener("click", async (e) => {
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
ui.btnReset.addEventListener("click", (e) => { e.preventDefault(); resetForm(); });



/** ---------------------------------------------------------------------
 * Init
 * --------------------------------------------------------------------- */
(function init(){
  // quick UX niceties
  addOption(""); addOption("");
  ui.search.placeholder = "Try typing part of a question…";
  // initial load
  refreshList();
})();