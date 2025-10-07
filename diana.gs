/**
 * Web App to list slides and get thumbnails.
 * Deploy: New deployment → Type: Web app
 * Execute as: Me
 * Who has access: Anyone (or Anyone with link)
 * Services: Enable "Slides API" (Advanced Google Services) for Slides.Presentations.get
 */

const DEFAULT_SIZE = "LARGE"; // SMALL | MEDIUM | LARGE

function doGet(e) {
  var p = (e && e.parameter) || {};
  var mode = String(p.mode || "slides").toLowerCase();
  var presentationId = String(p.presentationId || "").trim();
  var size = String(p.size || DEFAULT_SIZE).toUpperCase();
  var pageObjectId = String(p.pageObjectId || "").trim();
  var cb = String(p.callback || "").trim();

  try {
    if (mode !== "ping" && !presentationId) {
      return _jsonp({ ok: false, error: "Missing presentationId" }, cb);
    }

    if (mode === "slides") {
      // List slides (IDs + best-effort title)
      var pres = Slides.Presentations.get(presentationId);
      var slides = (pres.slides || []).map(function (s, i) {
        return { objectId: s.objectId, title: _firstText(s) || ("Slide " + (i + 1)) };
      });
      return _jsonp({ ok: true, presentationId: presentationId, slides: slides, count: slides.length }, cb);
    }

    if (mode === "thumbnail") {
      // Original: return googleusercontent URL (may need third-party cookies)
      if (!pageObjectId) return _jsonp({ ok: false, error: "Missing pageObjectId" }, cb);
      var thumbUrl = _getSlideThumbnailREST(presentationId, pageObjectId, size);
      return _jsonp({ ok: true, presentationId: presentationId, pageObjectId: pageObjectId, thumbUrl: thumbUrl }, cb);
    }

    if (mode === "thumbnaildata") {
      // New: return data URL (no cookies needed)
      if (!pageObjectId) return _jsonp({ ok: false, error: "Missing pageObjectId" }, cb);
      var dataUrl = _getThumbDataUrl(presentationId, pageObjectId, size);
      return _jsonp({ ok: true, presentationId: presentationId, pageObjectId: pageObjectId, dataUrl: dataUrl }, cb);
    }

    if (mode === "ping") {
      return _jsonp({ ok: true, pong: true }, cb);
    }

    return _jsonp({ ok: false, error: "Unknown mode: " + mode }, cb);
  } catch (err) {
    return _jsonp({ ok: false, error: (err && err.message) || String(err) }, cb);
  }
}

/** Build thumbnail URL by calling Slides REST directly (authorized via script token). */
function _getSlideThumbnailREST(presentationId, pageObjectId, size) {
  var base = "https://slides.googleapis.com/v1";
  var url = base +
    "/presentations/" + encodeURIComponent(presentationId) +
    "/pages/" + encodeURIComponent(pageObjectId) +
    "/thumbnail?thumbnailProperties.mimeType=" + encodeURIComponent("PNG") +
    "&thumbnailProperties.thumbnailSize=" + encodeURIComponent(size);

  var resp = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Thumbnail fetch failed (" + code + "): " + resp.getContentText());
  }
  var j = JSON.parse(resp.getContentText() || "{}");
  return j.contentUrl || "";
}

/** Helpers */
function _json(obj, callback) {
  // JSONP if "callback" provided; otherwise JSON
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(obj) + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _getThumbDataUrl(presentationId, pageObjectId, size) {
  var contentUrl = _getSlideThumbnailREST(presentationId, pageObjectId, size);
  var imgResp = UrlFetchApp.fetch(contentUrl, { method: "get", muteHttpExceptions: true });
  var code = imgResp.getResponseCode();
  if (code !== 200) throw new Error("Image bytes fetch failed (" + code + ")");
  var blob = imgResp.getBlob(); // PNG
  var b64 = Utilities.base64Encode(blob.getBytes());
  return "data:image/png;base64," + b64;
}

function _jsonp(obj, callbackName) {
  var out = ContentService.createTextOutput();
  out.setMimeType(ContentService.MimeType.JAVASCRIPT);
  var payload = JSON.stringify(obj);
  if (callbackName) {
    out.setContent(callbackName + "(" + payload + ")");
  } else {
    out.setContent(payload);
  }
  return out;
}

function _firstText(slide) {
  try {
    var elems = slide.pageElements || [];
    for (var i = 0; i < elems.length; i++) {
      var te = elems[i].shape && elems[i].shape.text && elems[i].shape.text.textElements;
      if (Array.isArray(te)) {
        var s = te.map(function (t) { return (t.textRun && t.textRun.content) || ""; }).join("").trim();
        if (s) return s.slice(0, 120);
      }
    }
  } catch (_e) {}
  return "";
}
