
(function(){
  "use strict";

  // ========= CONFIG =========
  const AIRTABLE = {
    API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
    BASE_ID:  "app3rkuurlsNa7ZdQ",
    MODULES_TABLE_ID: "Table3"
  };
const norm = s => String(s||"").toLowerCase().trim();

  // ========= Helpers =========
  function headers(){
    return {
      "Authorization": `Bearer ${AIRTABLE.API_KEY}`,
      "Content-Type": "application/json"
    };
  }

  function h(){ return headers(); }

  const baseUrl = (t) => `https://api.airtable.com/v0/${AIRTABLE.BASE_ID}/${encodeURIComponent(t)}`;
  const escSquotes = s => String(s||"").replace(/'/g, "\\'");

  // ========= List mappings =========
  async function listMappings({ activeOnly=false } = {}){
    const url = new URL(baseUrl(AIRTABLE.MODULES_TABLE_ID));
    url.searchParams.set("pageSize","100");
    if (activeOnly) url.searchParams.set("filterByFormula","OR({Active}=1, {Active}='1')");
    let out = [], offset;
    do {
      if (offset) url.searchParams.set("offset", offset);
      const res = await fetch(url.toString(), { headers: headers() });
      if (!res.ok) throw new Error("Modules list failed: "+res.status+" "+await res.text());
      const data = await res.json();
      out = out.concat(data.records||[]);
      offset = data.offset;

      if (offset){
        const u = new URL(baseUrl(AIRTABLE.MODULES_TABLE_ID));
        u.searchParams.set("pageSize","100");
        if (activeOnly) u.searchParams.set("filterByFormula","OR({Active}=1, {Active}='1')");
        url.search = u.search;
      }
    } while (offset);
    return out;
  }

  // ========= Find ALL records by Module (case-insensitive) =========
 async function findAllRecordsByModuleStrict(moduleName){
  const url = new URL(baseUrl(AIRTABLE.MODULES_TABLE_ID));
  const ff = `LOWER(TRIM({Module}))='${norm(moduleName).replace(/'/g,"\\'")}'`;
  url.searchParams.set("filterByFormula", ff);
  url.searchParams.set("pageSize","100");

  const out = [];
  let offset;
  do {
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: h() });
    if (!res.ok) {
      const body = await res.text().catch(()=>"(no body)");
      throw new Error(`Lookup failed: ${res.status} – ${body}`);
    }
    const data = await res.json();
    (data.records||[]).forEach(r => out.push(r));
    offset = data.offset;

    if (offset){
      const u = new URL(baseUrl(AIRTABLE.MODULES_TABLE_ID));
      u.searchParams.set("pageSize","100");
      u.searchParams.set("filterByFormula", ff);
      url.search = u.search;
    }
  } while (offset);

  return out.filter(r => norm(r?.fields?.Module) === norm(moduleName));
}

  // ========= Get one config (first match) by Module =========
  async function getConfigForModule(moduleName){
    if (!moduleName) return { presentationId:"", gasUrl:"", active:false };
    const url = new URL(baseUrl(AIRTABLE.MODULES_TABLE_ID));
    url.searchParams.set("filterByFormula", `LOWER({Module})='${escSquotes(moduleName).toLowerCase()}'`);
    url.searchParams.set("pageSize","1");
    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) throw new Error("Lookup failed: "+res.status+" "+await res.text());
    const data = await res.json();
    const rec = (data.records && data.records[0]) ? data.records[0] : null;
    const f = rec?.fields || {};
    return {
      id: rec?.id || "",
      presentationId: String(f["Presentation ID"]||"").trim(),
      gasUrl: String(f["GAS URL"]||"").trim(),
      active: !!f["Active"]
    };
  }

  // ========= UPSERT ALL: Patch every record where Module matches; create if none =========
  async function upsertMappingAll({ moduleName, presentationId, gasUrl, active=true }){
  if (!moduleName) throw new Error("moduleName required");

  // STRICT find
  const matches = await findAllRecordsByModuleStrict(moduleName);

  const fields = {
    "Module": moduleName,
    "Presentation ID": presentationId || "",
    "GAS URL": gasUrl || "",
    "Active": !!active
  };

  if (matches.length > 0) {
    const BATCH = 10;
    for (let i = 0; i < matches.length; i += BATCH) {
      const chunk = matches.slice(i, i + BATCH).map(r => ({ id: r.id, fields }));
      const res = await fetch(baseUrl(AIRTABLE.MODULES_TABLE_ID), {
        method: "PATCH",
        headers: h(),
        body: JSON.stringify({ records: chunk, typecast: true })
      });
      if (!res.ok) {
        const body = await res.text().catch(()=>"(no body)");
        throw new Error(`Update failed: ${res.status} – ${body}`);
      }
    }
    return { updated: matches.length };
  }

  // create if none
  const res = await fetch(baseUrl(AIRTABLE.MODULES_TABLE_ID), {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ records: [{ fields }], typecast: true })
  });
  if (!res.ok) {
    const body = await res.text().catch(()=>"(no body)");
    throw new Error(`Create failed: ${res.status} – ${body}`);
  }
  const created = await res.json();
  return { created: created.records?.length || 0, ids: (created.records||[]).map(r=>r.id) };
}

  // ========= Delete by record id =========
  async function deleteMappingById(id){
    if (!id) return { deleted: [] };
    const u = new URL(baseUrl(AIRTABLE.MODULES_TABLE_ID));
    u.searchParams.append("records[]", id);
    const res = await fetch(u.toString(), { method: "DELETE", headers: headers() });
    if (!res.ok) throw new Error("Delete failed: "+res.status+" "+await res.text());
    return res.json();
  }

  // ========= Export =========
  window.trainingModules = {
    listMappings,
    getConfigForModule,
    upsertMappingAll,     // <- use this from admin-modules.js
    deleteMappingById,
    _config: AIRTABLE
  };
})();
