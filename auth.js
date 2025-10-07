const AIRTABLE_AUTH = {
  API_KEY: "patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054",
  BASE_ID: "app3rkuurlsNa7ZdQ",
  TABLE_ID: "tblppx6qNXXNJL7ON"
};

function authHeaders(){ return { "Authorization": `Bearer ${AIRTABLE_AUTH.API_KEY}`, "Content-Type": "application/json" }; }
const authBaseUrl = () => `https://api.airtable.com/v0/${AIRTABLE_AUTH.BASE_ID}/${encodeURIComponent(AIRTABLE_AUTH.TABLE_ID)}`;

async function authFindByEmail(email){
  const url = new URL(authBaseUrl());
  const e = String(email||"").replace(/'/g, "\\'");
  url.searchParams.set("filterByFormula", `LOWER({Email})='${e.toLowerCase()}'`);
  url.searchParams.set("pageSize", "1");
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error(`Auth lookup failed: ${res.status}`);
  const data = await res.json();
  return (data.records && data.records[0]) ? data.records[0] : null;
}

async function authCreate(email, password){
  const res = await fetch(authBaseUrl(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ records: [{ fields: { Email: email, Password: password } }], typecast: true })
  });
  if (!res.ok) throw new Error(`Signup failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loginWithEmailPassword(email, password){
  const rec = await authFindByEmail(email);
  if (!rec) throw new Error("No account found for that email.");
  const fields = rec.fields || {};
  if (String(fields.Password || "") !== String(password || "")) throw new Error("Incorrect password.");
  // success
  localStorage.setItem("authEmail", email);
  // Also store training email for quiz
  localStorage.setItem("trainingEmail", email);
  return true;
}

async function signupWithEmailPassword(email, password){
  const existing = await authFindByEmail(email);
  if (existing) throw new Error("An account already exists for that email.");
  await authCreate(email, password);
  // Auto-login after signup
  localStorage.setItem("authEmail", email);
  localStorage.setItem("trainingEmail", email);
  return true;
}

function requireAuthOrRedirect(){
  const em = localStorage.getItem("authEmail");
  if (!em) { window.location.href = "./login.html"; return false; }
  return true;
}

function logout(){
  localStorage.removeItem("authEmail");
  // keep trainingEmail if you want resume cross-pages
  window.location.href = "./login.html";
}
