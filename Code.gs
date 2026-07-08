/**
 * Sales Data Training Academy — Apps Script Web App (Data Layer v3.0, Sprint 2)
 *
 * One Web App, two jobs:
 *   1) Assignment submissions  → appended to the "Submissions" tab
 *      (POST body has NO "action"/"type" — backward compatible with the form).
 *   2) Content storage (PRIMARY) → Academies / Modules / Lessons tabs.
 *      Nested fields are stored as JSON strings in a single cell:
 *        Modules.objectives, Lessons.assignment, Lessons.activities.
 *
 * READ (JSONP GET, no CORS needed):
 *   ?action=getAll       → { result:"success", academies, modules, lessons }
 *   ?action=getModules   → { result:"success", modules }
 *   ?action=getLessons   → { result:"success", lessons }
 *   ?action=getAcademies → { result:"success", academies }
 *
 * WRITE (POST JSON body { action, ... }):
 *   saveModule {item} · deleteModule {id} (cascades its lessons)
 *   saveLesson {item} · deleteLesson {id}
 *   saveAcademy {item} · deleteAcademy {id}
 *   bulkSave {modules[], lessons[], academies[]}  (used for first-run migration)
 *
 * DEPLOY: Extensions → Apps Script → paste → run `setup` once → Deploy →
 *         Manage deployments → edit deployment → New version → Deploy (URL stays
 *         the same). Execute as **Me**, access **Anyone**. See
 *         GOOGLE_SHEETS_BACKEND.md for the full steps.
 */

/* ============================================================
   SHEET LAYOUTS (single source of truth)
   ============================================================ */
var SUBMISSIONS_SHEET = "Submissions";
var SUBMISSION_HEADERS = [
  "Timestamp", "Employee Name", "Assignment ID", "Submission Link", "Notes",
  "Status", "Score", "Manager Feedback", "Reviewed By", "Reviewed At"
];
var SUBMISSION_DEFAULT_STATUS = "Pending Review";

var ACADEMY_HEADERS = ["key", "name", "team", "icon", "order"];
var MODULE_HEADERS  = ["id", "academyKey", "moduleNumber", "moduleTitle", "shortDesc",
                       "objectives", "studyTime", "difficulty", "prerequisites", "status", "updatedAt"];
var LESSON_HEADERS  = ["id", "academyKey", "moduleId", "moduleNumber", "lessonNumber", "lessonTitle",
                       "contentType", "contentBody", "status", "order", "assignment", "activities", "updatedAt"];

/* Columns whose value is a JSON object/array (stored as a JSON string). */
var JSON_COLS = { Academies: [], Modules: ["objectives"], Lessons: ["assignment", "activities"] };

var ACADEMY_SEED = [
  ["sales-data", "Sales Data", "Sales Data Team", "📊", 1],
  ["sales", "Sales", "Sales Team", "🤝", 2],
  ["sales-accounting", "Sales Accounting", "Sales Accounting Team", "🧾", 3]
];

/* ============================================================
   ENDPOINTS
   ============================================================ */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || "";
  var payload;
  try {
    if (action === "getAll" || action === "getContent" || action === "content") {
      payload = {
        result: "success",
        academies: readSheet_("Academies", ACADEMY_HEADERS, ACADEMY_SEED),
        modules: readSheet_("Modules", MODULE_HEADERS),
        lessons: readSheet_("Lessons", LESSON_HEADERS)
      };
    } else if (action === "getAcademies") {
      payload = { result: "success", academies: readSheet_("Academies", ACADEMY_HEADERS, ACADEMY_SEED) };
    } else if (action === "getModules") {
      payload = { result: "success", modules: readSheet_("Modules", MODULE_HEADERS) };
    } else if (action === "getLessons") {
      payload = { result: "success", lessons: readSheet_("Lessons", LESSON_HEADERS) };
    } else {
      payload = { result: "ready" };
    }
  } catch (err) {
    payload = { result: "error", message: String(err) };
  }
  return respond_(payload, p.callback);
}

/** JSONP-aware response: wraps in callback(...) when a callback is provided
    (lets the browser read cross-origin via a <script> tag — no CORS needed). */
function respond_(payload, callback) {
  var out = JSON.stringify(payload);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + out + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (lockErr) { /* proceed best-effort */ }
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ result: "error", message: "No request body received." });
    }
    var data;
    try { data = JSON.parse(e.postData.contents); }
    catch (parseErr) { return json_({ result: "error", message: "Invalid JSON body." }); }

    var action = data.action || data.type || "";
    switch (action) {
      case "saveModule":
      case "module":
        upsertRow_("Modules", MODULE_HEADERS, data.item, "id");
        return json_({ result: "success" });
      case "saveLesson":
      case "lesson":
        upsertRow_("Lessons", LESSON_HEADERS, data.item, "id");
        return json_({ result: "success" });
      case "deleteModule":
        deleteWhere_("Modules", MODULE_HEADERS, "id", data.id);
        deleteWhere_("Lessons", LESSON_HEADERS, "moduleId", data.id); // cascade
        return json_({ result: "success" });
      case "deleteLesson":
        deleteWhere_("Lessons", LESSON_HEADERS, "id", data.id);
        return json_({ result: "success" });
      case "saveAcademy":
        upsertRow_("Academies", ACADEMY_HEADERS, data.item, "key");
        return json_({ result: "success" });
      case "deleteAcademy":
        deleteWhere_("Academies", ACADEMY_HEADERS, "key", data.id);
        return json_({ result: "success" });
      case "bulkSave":
        (data.academies || []).forEach(function (a) { upsertRow_("Academies", ACADEMY_HEADERS, a, "key"); });
        (data.modules || []).forEach(function (m) { upsertRow_("Modules", MODULE_HEADERS, m, "id"); });
        (data.lessons || []).forEach(function (l) { upsertRow_("Lessons", LESSON_HEADERS, l, "id"); });
        return json_({ result: "success" });
      default:
        return handleSubmission_(data); // no action → assignment submission
    }
  } catch (err) {
    return json_({ result: "error", message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (relErr) {}
  }
}

/* ============================================================
   ASSIGNMENT SUBMISSION (unchanged behavior)
   ============================================================ */
function handleSubmission_(data) {
  var employeeName = (data.employeeName || "").toString().trim();
  var assignmentId = (data.assignmentId || "").toString().trim();
  if (!employeeName || !assignmentId) {
    return json_({ result: "error", message: "Missing required fields: employeeName and assignmentId." });
  }
  var sheet = ensureSheet_(SUBMISSIONS_SHEET, SUBMISSION_HEADERS);
  sheet.appendRow([
    new Date(), employeeName, assignmentId,
    (data.submissionLink || "").toString().trim(),
    (data.notes || "").toString().trim(),
    SUBMISSION_DEFAULT_STATUS, "", "", "", ""
  ]);
  return json_({ result: "success", status: SUBMISSION_DEFAULT_STATUS });
}

/* ============================================================
   GENERIC SHEET HELPERS
   ============================================================ */
function ensureSheet_(name, headers, seedRows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var range = sheet.getRange(1, 1, 1, headers.length);
  var current = range.getValues()[0];
  var matches = true;
  for (var i = 0; i < headers.length; i++) {
    if (current[i] !== headers[i]) { matches = false; break; }
  }
  if (!matches) { range.setValues([headers]).setFontWeight("bold"); }
  sheet.setFrozenRows(1);

  if (seedRows && seedRows.length && sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
  }
  return sheet;
}

function parseJson_(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch (e) { return v; }
}

/** Reads a sheet into an array of plain objects keyed by header (JSON columns parsed). */
function readSheet_(name, headers, seedRows) {
  var sheet = ensureSheet_(name, headers, seedRows);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0];
  var jsonCols = JSON_COLS[name] || [];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < head.length; c++) {
      var key = head[c];
      var v = values[r][c];
      if (v !== "" && v !== null) empty = false;
      if (jsonCols.indexOf(key) >= 0) v = parseJson_(v);
      obj[key] = v;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

/** Insert or update a row matched by keyField (default "id"). JSON columns
    are stringified before writing. */
function upsertRow_(name, headers, item, keyField) {
  if (!item) return;
  keyField = keyField || "id";
  var sheet = ensureSheet_(name, headers);
  var jsonCols = JSON_COLS[name] || [];
  var values = sheet.getDataRange().getValues();
  var head = values[0];
  var keyCol = head.indexOf(keyField);

  var row = headers.map(function (h) {
    var v = (item[h] !== undefined && item[h] !== null) ? item[h] : "";
    if (jsonCols.indexOf(h) >= 0 && typeof v !== "string") v = JSON.stringify(v);
    return v;
  });

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][keyCol]) === String(item[keyField])) {
      sheet.getRange(r + 1, 1, 1, headers.length).setValues([row]);
      return;
    }
  }
  sheet.appendRow(row);
}

/** Delete row(s) where column == value. */
function deleteWhere_(name, headers, col, value) {
  var sheet = ensureSheet_(name, headers);
  var values = sheet.getDataRange().getValues();
  var head = values[0];
  var colIdx = head.indexOf(col);
  for (var r = values.length - 1; r >= 1; r--) {
    if (String(values[r][colIdx]) === String(value)) sheet.deleteRow(r + 1);
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   ONE-TIME SETUP — run once from the Apps Script editor.
   Creates the tabs + headers and seeds the academies. Safe to re-run.
   ============================================================ */
function setup() {
  ensureSheet_("Academies", ACADEMY_HEADERS, ACADEMY_SEED);
  ensureSheet_("Modules", MODULE_HEADERS);
  ensureSheet_("Lessons", LESSON_HEADERS);
  ensureSheet_(SUBMISSIONS_SHEET, SUBMISSION_HEADERS);
}
