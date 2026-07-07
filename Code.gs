/**
 * Sales Data Training Academy — Apps Script Web App (Data Layer v2.0)
 *
 * One Web App, two jobs:
 *   1) Assignment submissions  → appended to the "Submissions" tab
 *      (POST body has NO "type" field — backward compatible with the form).
 *   2) Content management       → Academies / Modules / Lessons tabs
 *      (POST body has a "type" field: module | lesson | deleteModule | deleteLesson).
 *
 * READ:  GET  ?action=content   → { result:"success", academies, modules, lessons }
 *        GET  (no action)        → { result:"ready" }  (health check)
 *
 * Deploy: Extensions → Apps Script → paste → Deploy → Manage deployments →
 *         edit the existing deployment → New version → Deploy (URL stays the same).
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
var MODULE_HEADERS  = ["id", "academyKey", "moduleNumber", "moduleTitle", "shortDesc", "studyTime", "difficulty", "status", "updatedAt"];
var LESSON_HEADERS  = ["id", "academyKey", "moduleId", "moduleNumber", "lessonTitle", "contentType", "contentBody", "status", "updatedAt"];

var ACADEMY_SEED = [
  ["sales-data", "Sales Data", "Sales Data Team", "📊", 1],
  ["sales", "Sales", "Sales Team", "🤝", 2],
  ["sales-accounting", "Sales Accounting", "Sales Accounting Team", "🧾", 3]
];

/* ============================================================
   ENDPOINTS
   ============================================================ */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "";
    if (action === "content") {
      return json_({
        result: "success",
        academies: readSheet_("Academies", ACADEMY_HEADERS, ACADEMY_SEED),
        modules: readSheet_("Modules", MODULE_HEADERS),
        lessons: readSheet_("Lessons", LESSON_HEADERS)
      });
    }
    return json_({ result: "ready" });
  } catch (err) {
    return json_({ result: "error", message: String(err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ result: "error", message: "No request body received." });
    }
    var data;
    try { data = JSON.parse(e.postData.contents); }
    catch (parseErr) { return json_({ result: "error", message: "Invalid JSON body." }); }

    switch (data.type) {
      case "module":
        upsertRow_("Modules", MODULE_HEADERS, data.item);
        return json_({ result: "success" });
      case "lesson":
        upsertRow_("Lessons", LESSON_HEADERS, data.item);
        return json_({ result: "success" });
      case "deleteModule":
        deleteRow_("Modules", MODULE_HEADERS, "id", data.id);
        deleteWhere_("Lessons", LESSON_HEADERS, "moduleId", data.id); // cascade
        return json_({ result: "success" });
      case "deleteLesson":
        deleteRow_("Lessons", LESSON_HEADERS, "id", data.id);
        return json_({ result: "success" });
      default:
        return handleSubmission_(data); // no type → assignment submission
    }
  } catch (err) {
    return json_({ result: "error", message: String(err) });
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

  // Seed default rows only when the sheet has just headers (no data).
  if (seedRows && seedRows.length && sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
  }
  return sheet;
}

/** Reads a sheet into an array of plain objects keyed by header. */
function readSheet_(name, headers, seedRows) {
  var sheet = ensureSheet_(name, headers, seedRows);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < head.length; c++) {
      obj[head[c]] = values[r][c];
      if (values[r][c] !== "" && values[r][c] !== null) empty = false;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

/** Insert or update a row matched by "id". */
function upsertRow_(name, headers, item) {
  var sheet = ensureSheet_(name, headers);
  var values = sheet.getDataRange().getValues();
  var head = values[0];
  var idCol = head.indexOf("id");
  var row = headers.map(function (h) { return item[h] !== undefined && item[h] !== null ? item[h] : ""; });

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(item.id)) {
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
function deleteRow_(name, headers, col, value) { deleteWhere_(name, headers, col, value); }

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
