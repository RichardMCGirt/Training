/*************************************************
 * Google Forms/Sheets → Airtable (ID-first + diagnostics)
 * Paste the whole file into Code.gs
 **************************************************/

// ====== CONFIG (EDIT THESE) ======
const AIRTABLE_TOKEN = 'patTGK9HVgF4n1zqK.cbc0a103ecf709818f4cd9a37e18ff5f68c7c17f893085497663b12f2c600054'; // PAT (no "Bearer "), scopes: data.records:write (+ read)
const BASE_ID        = 'appC66GdZvBlr76Bv';                        // From base URL
const TABLE_ID       = 'tbl0DGsU5svef6Ak6';                        // Prefer table ID (from table URL)
const TABLE_NAME     = 'Form Responses 1';                         // Used only if TABLE_ID is blank

// Sheet headers row index
const HEADER_ROW_INDEX = 1;

// ====== INTERNAL ======
function buildAirtableUrl() {
  const path = (TABLE_ID && TABLE_ID.trim()) ? TABLE_ID.trim() : encodeURIComponent(TABLE_NAME);
  return `https://api.airtable.com/v0/${BASE_ID}/${path}`;
}
const AIRTABLE_URL = buildAirtableUrl();

// ====== MAIN ======
/**
 * Works as an onFormSubmit trigger; if run manually, falls back to last data row.
 */
function sendToAirtable(e) {
  try {
    let headers, rowVals;

    if (e && e.range) {
      const sheet   = e.range.getSheet();
      const lastCol = sheet.getLastColumn();
      headers = sheet.getRange(HEADER_ROW_INDEX, 1, 1, lastCol).getValues()[0];
      rowVals = (Array.isArray(e.values) && e.values.length === headers.length)
        ? e.values
        : sheet.getRange(e.range.getRow(), 1, 1, lastCol).getValues()[0];
    } else {
      const sheet   = SpreadsheetApp.getActiveSheet();
      const lastRow = sheet.getLastRow();
      if (lastRow <= HEADER_ROW_INDEX) throw new Error('No data rows available to send.');
      const lastCol = sheet.getLastColumn();
      headers = sheet.getRange(HEADER_ROW_INDEX, 1, 1, lastCol).getValues()[0];
      rowVals = sheet.getRange(lastRow, 1, 1, lastCol).getValues()[0];
      console.log(`Manual fallback: sending row ${lastRow}`);
    }

    const fields = mapHeadersToValues(headers, rowVals);
    if (!Object.keys(fields).length) { console.log('No fields detected; skipping.'); return; }

    const payload = { records: [{ fields }] };
    const res = airtablePostWithRetry(AIRTABLE_URL, payload, 5);
    console.log(`Airtable response (${res.getResponseCode()}): ${res.getContentText()}`);

  } catch (err) {
    console.error('[sendToAirtable] Error:', err && err.stack ? err.stack : err);
  }
}

// ====== ONE-TIME TRIGGER SETUP ======
function setupTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('sendToAirtable').forSpreadsheet(ss).onFormSubmit().create();
  console.log('Trigger created: onFormSubmit → sendToAirtable');
}

// ====== DIAGNOSTICS ======
/**
 * GET a single record to verify token/base/table. Prints friendly guidance for 401/403/404.
 */
function pingAirtable() {
  try {
    const url = `${AIRTABLE_URL}?maxRecords=1`;
    const options = {
      method: 'get',
      muteHttpExceptions: true,
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    };
    console.log(`Ping URL: ${url}`);
    const res  = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    const body = res.getContentText();
    console.log(`Ping status ${code}: ${body}`);

    if (code === 200) {
      console.log('✅ Access OK. Token, base, and table are valid.');
    } else if (code === 401) {
      console.log('❌ 401 Unauthorized: Token invalid/expired or missing "Bearer" header.');
      console.log('   Ensure AIRTABLE_TOKEN is the raw "pat..." string (the code adds "Bearer ").');
    } else if (code === 403) {
      console.log('❌ 403 Forbidden: Token lacks access to this base/table OR wrong base/table.');
      console.log('   Fixes: enable data.records:write (+read) and add base ' + BASE_ID + ' under Access.');
      console.log('   Prefer TABLE_ID. Confirm you’re using the Airtable account that owns the base.');
    } else if (code === 404) {
      console.log('❌ 404 Not Found: Bad BASE_ID or table identifier.');
    } else {
      console.log('⚠️ Unexpected status. See body above for details.');
    }
  } catch (err) {
    console.error('[pingAirtable] Error:', err && err.stack ? err.stack : err);
  }
}

/**
 * Lists tables visible to this token in the base (needs schema.bases:read scope).
 * Helpful to confirm you have the right TABLE_ID/NAME.
 */
function listTables() {
  try {
    const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;
    const options = {
      method: 'get',
      muteHttpExceptions: true,
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    };
    const res  = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    const body = res.getContentText();
    console.log(`Tables status ${code}: ${body}`);
    if (code === 200) {
      const data = JSON.parse(body);
      (data.tables || []).forEach(t => console.log(`• ${t.name} — ${t.id}`));
      console.log('If your target table is not listed, your token does not have base access.');
    } else if (code === 403) {
      console.log('Needs schema.bases:read scope or base access.');
    }
  } catch (err) {
    console.error('[listTables] Error:', err && err.stack ? err.stack : err);
  }
}

// ====== OPTIONAL: manual tester ======
function testSendLastRow() { sendToAirtable(); }

// ====== HELPERS ======
function mapHeadersToValues(headers, rowVals) {
  const out = {};
  (headers || []).forEach((h, i) => {
    const key = String(h || '').trim();
    if (!key) return;
    out[key] = coerceCellValue(rowVals ? rowVals[i] : '');
  });
  return out;
}

function coerceCellValue(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s === 'TRUE')  return true;
  if (s === 'FALSE') return false;
  if (!isNaN(value) && value !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

function airtablePostWithRetry(url, bodyObj, maxAttempts) {
  const payload = JSON.stringify(bodyObj);
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload,
    muteHttpExceptions: true,
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  };
  let attempt = 0;
  while (true) {
    attempt++;
    const res  = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return res;
    if ((code === 429 || (code >= 500 && code < 600)) && attempt < maxAttempts) {
      const waitMs = Math.min(60000, Math.pow(2, attempt) * 250);
      console.warn(`Airtable ${code}; retrying in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`);
      Utilities.sleep(waitMs);
      continue;
    }
    throw new Error(`Airtable error ${code}. Body: ${res.getContentText()}`);
  }
}
