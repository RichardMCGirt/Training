
(function(){
  "use strict";

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  function esc(s){ return String(s??"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }

  async function renderList(){
    const box = $("#modmap-list");
    if (!box) return;
    box.innerHTML = `<div class="muted">Loading…</div>`;
    try{
      const rows = await window.trainingModules.listMappings();
      if (!rows.length) { box.innerHTML = `<div class="muted">No mappings yet.</div>`; return; }
      box.innerHTML = rows.map(r=>{
        const f = r.fields||{};
        const id = r.id;
        const active = !!f.Active;
        const tag = active ? `<span class="pill" style="margin-left:6px">Active</span>` : `<span class="pill" style="margin-left:6px">Inactive</span>`;
        return `
          <div class="qline" data-id="${esc(id)}" style="grid-template-columns:1fr auto">
            <div>
              <div><strong>${esc(f.Module||"(no module)")}</strong> ${tag}</div>
              <div class="muted small mono" style="margin-top:4px">Presentation ID: <span class="pid mono">${esc(f["Presentation ID"]||"")}</span></div>
              <div class="muted small mono" style="margin-top:2px">GAS URL: <span class="gas mono">${esc(f["GAS URL"]||"")}</span></div>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn btn-ghost" data-act="edit">Edit</button>
              <button class="btn" style="border-color:#ef4444;color:#ef4444;background:#fff" data-act="del">Delete</button>
            </div>
          </div>`;
      }).join("");
    } catch(e){
      console.error(e);
      box.innerHTML = `<div class="muted">Failed to load mappings.</div>`;
    }
  }
// Make sure quick chips mirror Admin's module chips
function wireQuickChips(){
  const chipsHost = document.querySelector("#moduleChips");
  const dest = document.querySelector("#modmap-quick");
  if (!chipsHost || !dest) return;
  dest.innerHTML = chipsHost.innerHTML;
  dest.querySelectorAll(".chip").forEach(ch => {
    ch.addEventListener("click", () => {
      document.querySelector("#modmap-module").value = ch.dataset.m || ch.textContent.trim();
    });
  });
}

// Call this once on init (after DOM ready)
document.addEventListener("DOMContentLoaded", wireQuickChips, { once: true });

  function showForm(initial={}){
    $("#modmap-id").value = initial.id||"";
    $("#modmap-module").value = initial.module||"";
    $("#modmap-pid").value = initial.presentationId||"";
    $("#modmap-gas").value = initial.gasUrl||"";
    $("#modmap-active").checked = !!initial.active;
    $("#modmap-status").textContent = "";
    $("#modmap-status").className = "muted small";
  }

  async function onSave(ev){
    ev?.preventDefault?.();
    const id = $("#modmap-id").value.trim();
    const moduleName = $("#modmap-module").value.trim();
    const presentationId = $("#modmap-pid").value.trim();
    const gasUrl = $("#modmap-gas").value.trim();
    const active = $("#modmap-active").checked;
    const status = $("#modmap-status");

    if (!moduleName) {
      status.textContent = "Module is required.";
      status.className = "bad";
      return;
    }

    try{
await window.trainingModules.upsertMappingAll({ moduleName, presentationId, gasUrl, active });
      status.textContent = "Saved.";
      status.className = "ok";
      await renderList();
      if (!id) showForm({});
    } catch(e){
      status.textContent = e?.message || "Save failed.";
      status.className = "bad";
    }
  }

  async function onListClick(ev){
    const btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    const row = ev.target.closest(".qline");
    const id = row?.dataset?.id;
    if (!id) return;

    if (btn.dataset.act === "del") {
      if (!confirm("Delete this mapping?")) return;
      try { await window.trainingModules.deleteMappingById(id); await renderList(); }
      catch(e){ alert("Delete failed: " + (e.message||e)); }
      return;
    }

    if (btn.dataset.act === "edit") {
      const moduleName = row.querySelector("strong")?.textContent || "";
      const presentationId = row.querySelector(".pid")?.textContent || "";
      const gasUrl = row.querySelector(".gas")?.textContent || "";
      const isActive = /Active<\/span>/.test(row.innerHTML);
      showForm({ id, module: moduleName, presentationId, gasUrl, active: isActive });
    }
  }

  function wireQuickChips(){
    // Reuse your Admin module chips if present (optional)
    const chipsHost = document.querySelector("#moduleChips");
    if (!chipsHost) return;
    const dest = $("#modmap-quick");
    if (!dest) return;
    dest.innerHTML = chipsHost.innerHTML;
    dest.querySelectorAll(".chip").forEach(ch=>{
      ch.addEventListener("click", () => {
        $("#modmap-module").value = ch.dataset.m || ch.textContent.trim();
      });
    });
  }

  function wire(){
    const root = document.getElementById("modmap-root");
    if (!root) return;
    wireQuickChips();
    $("#modmap-form").addEventListener("submit", onSave);
    $("#modmap-list").addEventListener("click", onListClick);
    renderList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire, { once:true });
  } else {
    wire();
  }
})();

