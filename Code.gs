/**
 * Sales Data Team — Training Portal
 * Data Layer v1.0 — Google Apps Script Web App
 *
 * Receives Assignment submissions from the portal form and appends
 * them as rows in the bound Google Sheet.
 *
 * Design notes (for future growth):
 *  - HEADERS is the single source of truth for the column layout.
 *    Add a new column by adding it to HEADERS and (if the form should
 *    populate it) mapping it in buildRow_(). Nothing else needs to change.
 *  - Review columns (Score, Manager Feedback, Reviewed By, Reviewed At)
 *    are written empty on submission and filled later by a manager.
 *
 * Setup / deployment: see GOOGLE_SHEETS_SETUP.md
 */

/* ============================================================
   CONFIG
   ============================================================ */

// Tab (sheet) where submissions are stored.
var SHEET_NAME = "Submissions";

// Column layout — the single source of truth (A → J).
// To add a column later, append it here (and map it in buildRow_ if needed).
var HEADERS = [
  "Timestamp",         // A
  "Employee Name",     // B
  "Assignment ID",     // C
  "Submission Link",   // D
  "Notes",             // E
  "Status",            // F
  "Score",             // G  (review field — filled later)
  "Manager Feedback",  // H  (review field — filled later)
  "Reviewed By",       // I  (review field — filled later)
  "Reviewed At"        // J  (review field — filled later)
];

// Default status applied to every new submission.
var DEFAULT_STATUS = "Pending Review";

/* ============================================================
   WEB APP ENDPOINTS
   ============================================================ */

/**
 * Handles POST requests from the portal's submission form.
 * Expects a JSON body: { employeeName, assignmentId, submissionLink, notes }
 * Appends one row and returns a JSON result.
 */
function doPost(e) {
  try {
    // --- Validate the request envelope ---
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ result: "error", message: "No request body received." });
    }

    // --- Parse the JSON body ---
    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return json_({ result: "error", message: "Invalid JSON body." });
    }

    // --- Validate required fields ---
    var employeeName = (data.employeeName || "").toString().trim();
    var assignmentId = (data.assignmentId || "").toString().trim();

    if (!employeeName || !assignmentId) {
      return json_({
        result: "error",
        message: "Missing required fields: employeeName and assignmentId."
      });
    }

    // --- Append the row ---
    var sheet = getSheet_();
    sheet.appendRow(buildRow_(data, employeeName, assignmentId));

    return json_({ result: "success", status: DEFAULT_STATUS });

  } catch (err) {
    // Any unexpected failure is reported, never thrown to the client.
    return json_({ result: "error", message: String(err) });
  }
}

/**
 * Health check. Open the Web App URL in a browser to confirm it's live.
 * Returns: { "result": "ready" }
 */
function doGet() {
  return json_({ result: "ready" });
}

/* ============================================================
   HELPERS
   ============================================================ */

/**
 * Returns the Submissions sheet, creating it (with headers) if missing.
 * Idempotently ensures the header row is correct, bold, and frozen — so
 * an older/short sheet is safely upgraded to the current HEADERS layout.
 */
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  ensureHeaders_(sheet);
  return sheet;
}

/**
 * Writes the header row if it's missing or out of date, then makes it
 * bold and freezes the first row. Safe to run on every request.
 */
function ensureHeaders_(sheet) {
  var range = sheet.getRange(1, 1, 1, HEADERS.length);
  var current = range.getValues()[0];

  var matches = true;
  for (var i = 0; i < HEADERS.length; i++) {
    if (current[i] !== HEADERS[i]) { matches = false; break; }
  }

  if (!matches) {
    range.setValues([HEADERS]).setFontWeight("bold");
  }
  sheet.setFrozenRows(1);
}

/**
 * Builds a single row aligned to HEADERS.
 * Submission fills A–F; review fields G–J start empty.
 */
function buildRow_(data, employeeName, assignmentId) {
  return [
    new Date(),                                    // A Timestamp
    employeeName,                                  // B Employee Name
    assignmentId,                                  // C Assignment ID
    (data.submissionLink || "").toString().trim(), // D Submission Link
    (data.notes || "").toString().trim(),          // E Notes
    DEFAULT_STATUS,                                // F Status
    "",                                            // G Score
    "",                                            // H Manager Feedback
    "",                                            // I Reviewed By
    ""                                             // J Reviewed At
  ];
}

/**
 * Serializes an object to a JSON web-app response.
 */
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
