/* ============================================================
   Submission Review Center — admin only
   ------------------------------------------------------------
   One page to find, open, and review every employee submission from BOTH:
     • Knowledge Checks   → knowledge_check_responses
     • Lesson Assignments → submissions

   Reads LIVE from Supabase via direct REST (read-only) and writes review updates
   via a column-tolerant PATCH — fully self-contained, so it depends on NO
   uncommitted helpers and touches no Learning Path / Content Manager / tracking /
   identity code. Missing values render "Not available"; no fake data.

   Access is admin-only: identity.js guards admin pages, and we also redirect
   non-admins to the Learning Path here.
   ============================================================ */
(function () {
  "use strict";

  var S = { kc: [], subs: [], modules: [], lessons: [], rows: [], byId: {} };
  var NA = "Not available";

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return (typeof escHtml === "function") ? escHtml(s)
      : String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function isAdmin() { return typeof Identity !== "undefined" && Identity.isAdmin && Identity.isAdmin(); }
  function fmtDateTime(iso) {
    if (!iso) return NA;
    try { return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return NA; }
  }
  function dayKey(d) { try { return new Date(d).toISOString().slice(0, 10); } catch (e) { return ""; } }
  function fmtSize(bytes) {
    var b = Number(bytes); if (!b) return NA;
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function safe(p) { return p.then(function (v) { return Array.isArray(v) ? v : []; }).catch(function () { return []; }); }
  function apiBase() { return (typeof SUPABASE_URL !== "undefined" && SUPABASE_URL) ? SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/" : ""; }
  function authHeaders(extra) {
    var h = { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  function restGet(pathAndQuery) {
    var base = apiBase(); if (!base) return Promise.resolve([]);
    return fetch(base + pathAndQuery, { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
  }

  /* ---------- data load ---------- */
  function loadAll() {
    return Promise.all([
      safe(restGet("knowledge_check_responses?select=*&order=submitted_at.desc&limit=10000")),
      safe(restGet("submissions?select=*&order=created_at.desc&limit=10000")),
      safe((typeof SB !== "undefined" && SB.fetchModules) ? SB.fetchModules() : Promise.resolve([])),
      safe((typeof SB !== "undefined" && SB.fetchLessons) ? SB.fetchLessons() : Promise.resolve([]))
    ]).then(function (r) {
      S.kc = r[0] || []; S.subs = r[1] || []; S.modules = r[2] || []; S.lessons = r[3] || [];
      buildStructureMaps();
      computeRows();
    });
  }

  var modMap = {}, lessonMap = {};
  function buildStructureMaps() {
    modMap = {}; lessonMap = {};
    S.modules.forEach(function (m) { if (m && m.id) modMap[m.id] = m; });
    S.lessons.forEach(function (l) { if (l && l.id) lessonMap[l.id] = l; });
  }
  function academyName(key) {
    if (typeof academyByKey === "function") { var a = academyByKey(key); if (a) return a.name; }
    return key || NA;
  }
  function moduleName(id) { var m = modMap[id]; return m ? ("M" + (m.moduleNumber || "") + " — " + (m.moduleTitle || "")) : (id || NA); }
  function lessonName(id) { var l = lessonMap[id]; return l ? ("L" + (l.lessonNumber || "") + " — " + (l.lessonTitle || "")) : (id || NA); }
  function sectionName(sectionId, lessonId) {
    if (!sectionId) return "—"; // assignments belong to the lesson, not a section
    var l = lessonMap[lessonId];
    var partId = String(sectionId).split(":")[0];
    var kind = String(sectionId).split(":")[1];
    if (l && typeof lessonParts === "function") {
      try {
        var parts = lessonParts(l);
        var p = parts.find(function (x) { return x.id === partId; });
        if (p) { var base = p.title || ("Part " + (p.partNumber || "")); return kind === "kc" ? (base + " · Knowledge Check") : base; }
      } catch (e) {}
    }
    return sectionId;
  }

  /* ---------- normalize both tables into one row model ---------- */
  function respType(row) {
    if (row.file_url) return "File Upload";
    if (row.link) return "Document Link";
    if (row.text) return "Text";
    var t = (row.response_type_raw || "").toLowerCase();
    if (t.indexOf("file") >= 0) return "File Upload";
    if (t.indexOf("doc") >= 0 || t.indexOf("link") >= 0) return "Document Link";
    if (t) return "Text";
    return "—";
  }
  function normKc(r) {
    return {
      _table: "knowledge_check_responses", statusCol: "review_status", id: r.id, source: "Knowledge Check",
      employee_id: r.employee_id || "", employee_name: r.employee_name || NA, team: r.team || "—",
      academy_key: r.academy_key || "", module_id: r.module_id || "", lesson_id: r.lesson_id || "", section_id: r.section_id || "",
      taskTitle: r.question || "Knowledge Check", kc_id: r.knowledge_check_id || "",
      text: r.text_answer || "", link: r.document_url || "", file_url: r.file_url || "", file_name: r.file_name || "", file_type: r.file_type || "", file_size: r.file_size,
      submitted_at: r.submitted_at, review_status: r.review_status || "Pending Review",
      score: r.score || "", feedback: r.feedback || "", reviewed_by: r.reviewed_by || "", reviewed_at: r.reviewed_at || "",
      response_type_raw: r.response_type || ""
    };
  }
  function normSub(r) {
    var l = lessonMap[r.lesson_id];
    var instructions = (l && l.assignment && l.assignment.instructions) || "";
    return {
      _table: "submissions", statusCol: "status", id: r.id, source: "Assignment",
      employee_id: r.employee_id || "", employee_name: r.employee_name || NA, team: r.team || "—",
      academy_key: r.academy_key || "", module_id: r.module_id || "", lesson_id: r.lesson_id || "", section_id: "",
      taskTitle: r.assignment_title || "Lesson Assignment", instructions: instructions,
      text: r.text_answer || "", link: r.submission_link || "", file_url: r.file_url || "", file_name: r.file_name || "", file_type: r.file_type || "", file_size: r.file_size,
      submitted_at: r.created_at, review_status: r.status || "Pending Review",
      score: r.score || "", feedback: r.feedback || "", reviewed_by: r.reviewed_by || "", reviewed_at: r.reviewed_at || "",
      response_type_raw: r.submissionType || r.submission_type || ""
    };
  }
  function computeRows() {
    S.rows = S.kc.map(normKc).concat(S.subs.map(normSub));
    S.rows.forEach(function (row) {
      row.type = respType(row);
      row.academyName = academyName(row.academy_key);
      row.moduleName = moduleName(row.module_id);
      row.lessonName = lessonName(row.lesson_id);
      row.sectionName = sectionName(row.section_id, row.lesson_id);
    });
    S.rows.sort(function (a, b) { return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0); });
    S.byId = {}; S.rows.forEach(function (r) { S.byId[r._table + ":" + r.id] = r; });
  }

  /* ---------- summary cards ---------- */
  function statusOf(r) {
    var s = String(r.review_status || "");
    if (/needs revision/i.test(s)) return "Needs Revision";
    if (/reviewed/i.test(s)) return "Reviewed";
    return "Pending Review";
  }
  function renderCards() {
    var rows = S.rows;
    var pending = rows.filter(function (r) { return statusOf(r) === "Pending Review"; }).length;
    var reviewed = rows.filter(function (r) { return statusOf(r) === "Reviewed"; }).length;
    var revision = rows.filter(function (r) { return statusOf(r) === "Needs Revision"; }).length;
    var kc = rows.filter(function (r) { return r.source === "Knowledge Check"; }).length;
    var asg = rows.filter(function (r) { return r.source === "Assignment"; }).length;
    var cards = [
      { l: "Total Submissions", v: rows.length },
      { l: "Pending Review", v: pending, cls: "is-prog" },
      { l: "Reviewed", v: reviewed },
      { l: "Needs Revision", v: revision, cls: "is-warn" },
      { l: "Knowledge Check", v: kc },
      { l: "Assignments", v: asg }
    ];
    $("srCards").innerHTML = cards.map(function (c) {
      return '<div class="sr-card ' + (c.cls || "") + '"><span class="sr-card-val">' + esc(c.v) + '</span><span class="sr-card-lbl">' + esc(c.l) + '</span></div>';
    }).join("");
    var foot = $("srFootCount"); if (foot) foot.textContent = rows.length + " submissions";
  }

  /* ---------- filters ---------- */
  function uniqueSorted(arr) { return Array.from(new Set(arr.filter(function (v) { return v && v !== NA && v !== "—"; }))).sort(); }
  function fillSelect(sel, values) {
    if (!sel) return;
    var first = sel.options[0] ? sel.options[0].outerHTML : "";
    var keep = sel.value;
    sel.innerHTML = first + values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join("");
    if (keep) sel.value = keep;
  }
  function populateFilters() {
    fillSelect($("srTeam"), uniqueSorted(S.rows.map(function (r) { return r.team; })));
    fillSelect($("srAcademy"), uniqueSorted(S.rows.map(function (r) { return r.academyName; })));
    fillSelect($("srModule"), uniqueSorted(S.rows.map(function (r) { return r.moduleName; })));
    fillSelect($("srLesson"), uniqueSorted(S.rows.map(function (r) { return r.lessonName; })));
    fillSelect($("srSection"), uniqueSorted(S.rows.map(function (r) { return r.sectionName; })));
  }
  function applyFilters() {
    var q = ($("srSearch").value || "").trim().toLowerCase();
    var team = $("srTeam").value, source = $("srSource").value, acad = $("srAcademy").value;
    var mod = $("srModule").value, les = $("srLesson").value, sec = $("srSection").value;
    var type = $("srType").value, status = $("srStatus").value, date = $("srDate").value;
    return S.rows.filter(function (r) {
      if (q && String(r.employee_name).toLowerCase().indexOf(q) < 0) return false;
      if (team && r.team !== team) return false;
      if (source && r.source !== source) return false;
      if (acad && r.academyName !== acad) return false;
      if (mod && r.moduleName !== mod) return false;
      if (les && r.lessonName !== les) return false;
      if (sec && r.sectionName !== sec) return false;
      if (type && r.type !== type) return false;
      if (status && statusOf(r) !== status) return false;
      if (date && (!r.submitted_at || dayKey(r.submitted_at) < date)) return false;
      return true;
    });
  }

  /* ---------- table ---------- */
  function statusChip(st) {
    var slug = { "Pending Review": "pending", "Reviewed": "reviewed", "Needs Revision": "revision" }[st] || "pending";
    return '<span class="sr-chip sr-chip-' + slug + '">' + esc(st) + '</span>';
  }
  function sourceChip(src) {
    var slug = src === "Assignment" ? "src-asg" : "src-kc";
    return '<span class="sr-chip sr-chip-' + slug + '">' + esc(src) + '</span>';
  }
  function renderTable() {
    var rows = applyFilters();
    var tb = $("srList");
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="12" class="sr-empty"><span class="sr-empty-ico">🔍</span>No submissions match these filters.</td></tr>'; setCount(0); return; }
    tb.innerHTML = rows.map(function (r) {
      var key = r._table + ":" + r.id;
      return '<tr>' +
        '<td class="sr-name">' + esc(r.employee_name) + '</td>' +
        '<td class="sr-dim">' + esc(r.team) + '</td>' +
        '<td>' + sourceChip(r.source) + '</td>' +
        '<td class="sr-dim">' + esc(r.academyName) + '</td>' +
        '<td class="sr-dim">' + esc(r.moduleName) + '</td>' +
        '<td class="sr-dim">' + esc(r.lessonName) + '</td>' +
        '<td class="sr-dim">' + esc(r.sectionName) + '</td>' +
        '<td>' + esc(String(r.taskTitle).slice(0, 80)) + '</td>' +
        '<td><span class="sr-chip sr-chip-type">' + esc(r.type) + '</span></td>' +
        '<td class="sr-dim" style="white-space:nowrap">' + esc(fmtDateTime(r.submitted_at)) + '</td>' +
        '<td>' + statusChip(statusOf(r)) + '</td>' +
        '<td><button type="button" class="sr-btn sr-btn-sm" data-open="' + esc(key) + '">View Submission</button></td>' +
      '</tr>';
    }).join("");
    setCount(rows.length);
  }
  function setCount(n) { var el = $("srCount"); if (el) el.textContent = n + " / " + S.rows.length + " submissions"; }

  /* ---------- detail drawer ---------- */
  function fileButtons(r) {
    if (!r.file_url) return "";
    return '<div class="sr-actions-row">' +
      '<a class="sr-btn sr-btn-sm" href="' + esc(r.file_url) + '" target="_blank" rel="noopener">Open File ↗</a>' +
      '<a class="sr-btn sr-btn-ghost sr-btn-sm" href="' + esc(r.file_url) + '" download="' + esc(r.file_name || "") + '" target="_blank" rel="noopener">Download File ⬇</a>' +
    '</div>';
  }
  function responseBlock(r) {
    if (r.type === "File Upload" && r.file_url) {
      return '<div class="sr-file"><div class="sr-kv">' +
        '<span class="k">File Name</span><span class="v">' + esc(r.file_name || NA) + '</span>' +
        '<span class="k">File Type</span><span class="v">' + esc(r.file_type || NA) + '</span>' +
        '<span class="k">File Size</span><span class="v">' + esc(fmtSize(r.file_size)) + '</span>' +
        '<span class="k">Uploaded At</span><span class="v">' + esc(fmtDateTime(r.submitted_at)) + '</span>' +
        '</div>' + fileButtons(r) + '</div>';
    }
    if (r.type === "Document Link" && r.link) {
      return '<div><a class="sr-link" href="' + esc(r.link) + '" target="_blank" rel="noopener">' + esc(r.link) + '</a>' +
        '<div class="sr-actions-row"><a class="sr-btn sr-btn-sm" href="' + esc(r.link) + '" target="_blank" rel="noopener">Open Document ↗</a></div></div>';
    }
    if (r.text) return '<div class="sr-answer">' + esc(r.text) + '</div>';
    return '<p class="sr-dim">No response content stored for this submission.</p>';
  }
  function kv(k, v) { return '<span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span>'; }

  function openDrawer(key) {
    var r = S.byId[key]; if (!r) return;
    var st = statusOf(r);
    var taskSec = r.source === "Knowledge Check"
      ? '<div class="sr-sec"><h4 class="sr-sec-h">Knowledge Check Prompt</h4><div class="sr-answer">' + esc(r.taskTitle) + '</div></div>'
      : '<div class="sr-sec"><h4 class="sr-sec-h">Assignment</h4><div class="sr-kv">' + kv("Title", r.taskTitle) + '</div>' +
        (r.instructions ? '<div class="sr-answer" style="margin-top:8px">' + esc(r.instructions) + '</div>' : '') + '</div>';

    $("srDrawerBody").innerHTML =
      '<div class="sr-sec"><h4 class="sr-sec-h">Employee</h4><div class="sr-kv">' +
        kv("Name", r.employee_name) + kv("Team", r.team) + '</div></div>' +
      '<div class="sr-sec"><h4 class="sr-sec-h">Training Context</h4><div class="sr-kv">' +
        kv("Academy", r.academyName) + kv("Module", r.moduleName) + kv("Lesson", r.lessonName) +
        kv("Section", r.sectionName) + kv("Source", r.source) + kv("Submitted At", fmtDateTime(r.submitted_at)) + '</div></div>' +
      taskSec +
      '<div class="sr-sec"><h4 class="sr-sec-h">Employee Response · ' + esc(r.type) + '</h4>' + responseBlock(r) + '</div>' +
      '<div class="sr-review" data-key="' + esc(key) + '">' +
        '<h4 class="sr-sec-h">Review</h4>' +
        '<label for="srRvStatus">Review Status</label>' +
        '<select id="srRvStatus">' +
          ['Pending Review', 'Reviewed', 'Needs Revision'].map(function (o) { return '<option value="' + o + '"' + (o === st ? ' selected' : '') + '>' + o + '</option>'; }).join("") +
        '</select>' +
        '<label for="srRvScore">Score</label>' +
        '<input type="text" id="srRvScore" value="' + esc(r.score) + '" placeholder="e.g. 8/10 or 80%" />' +
        '<label for="srRvFeedback">Feedback</label>' +
        '<textarea id="srRvFeedback" placeholder="Feedback for the employee…">' + esc(r.feedback) + '</textarea>' +
        '<label for="srRvBy">Reviewed By</label>' +
        '<input type="text" id="srRvBy" value="' + esc(r.reviewed_by || reviewerName()) + '" />' +
        (r.reviewed_at ? '<p class="sr-dim" style="margin-top:8px">Last reviewed: ' + esc(fmtDateTime(r.reviewed_at)) + '</p>' : '') +
        '<div class="sr-review-actions">' +
          '<button type="button" class="sr-btn" data-review="save">Save Review</button>' +
          '<button type="button" class="sr-btn sr-btn-ghost" data-review="reviewed">Mark Reviewed</button>' +
          '<button type="button" class="sr-btn sr-btn-ghost" data-review="revision">Request Revision</button>' +
        '</div>' +
        '<div class="sr-review-msg" data-review-msg></div>' +
      '</div>';

    var drawer = $("srDrawer");
    drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
    $("srScrim").hidden = false; document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    var drawer = $("srDrawer");
    drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true");
    $("srScrim").hidden = true; document.body.style.overflow = "";
  }
  function reviewerName() {
    var i = (typeof Identity !== "undefined") ? Identity.get() : null;
    return (i && i.employeeName) || "Admin";
  }

  /* ---------- review save (column-tolerant PATCH) ---------- */
  function patchTolerant(table, id, body) {
    var base = apiBase(); if (!base) return Promise.reject(new Error("Supabase not configured"));
    var url = base + table + "?id=eq." + encodeURIComponent(id);
    function attempt(payload) {
      return fetch(url, { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }), body: JSON.stringify(payload) })
        .then(function (res) {
          if (res.ok) return true;
          return res.text().then(function (t) {
            var mm = t.match(/'([A-Za-z0-9_]+)' column/) || t.match(/column "?([A-Za-z0-9_]+)"?\s+.*does not exist/i);
            var col = mm ? mm[1] : null;
            if (col && (col in payload)) { var c = {}; for (var k in payload) if (k !== col) c[k] = payload[k]; return attempt(c); }
            throw new Error("PATCH " + res.status + " " + t);
          });
        });
    }
    return attempt(body);
  }
  function doReview(action) {
    var panel = document.querySelector(".sr-review[data-key]");
    if (!panel) return;
    var key = panel.getAttribute("data-key");
    var r = S.byId[key]; if (!r) return;
    var msg = panel.querySelector("[data-review-msg]");
    var status = action === "reviewed" ? "Reviewed" : (action === "revision" ? "Needs Revision" : ($("srRvStatus").value || "Pending Review"));
    var score = ($("srRvScore").value || "").trim();
    var feedback = ($("srRvFeedback").value || "").trim();
    var reviewedBy = ($("srRvBy").value || "").trim() || reviewerName();
    var reviewedAt = new Date().toISOString();

    var body = {};
    body[r.statusCol] = status;              // review_status (KC) | status (submissions)
    body.score = score; body.feedback = feedback; body.reviewed_by = reviewedBy; body.reviewed_at = reviewedAt;

    if (msg) { msg.style.color = "var(--sr-dim)"; msg.textContent = "Saving…"; }
    patchTolerant(r._table, r.id, body).then(function () {
      r.review_status = status; r.score = score; r.feedback = feedback; r.reviewed_by = reviewedBy; r.reviewed_at = reviewedAt;
      // Sync the dropdown/state if the status changed via a shortcut button.
      var sel = $("srRvStatus"); if (sel) sel.value = status;
      renderCards(); renderTable();
      if (msg) { msg.style.color = "var(--sr-ok)"; msg.textContent = "Saved ✓  (" + status + ")"; }
    }).catch(function () {
      if (msg) { msg.style.color = "var(--sr-warn)"; msg.textContent = "Save failed — check the connection and retry."; }
    });
  }

  /* ---------- wire ---------- */
  function wire() {
    ["srSearch", "srTeam", "srSource", "srAcademy", "srModule", "srLesson", "srSection", "srType", "srStatus", "srDate"].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener(el.tagName === "INPUT" && el.type === "text" ? "input" : "change", renderTable);
    });
    var refresh = $("srRefresh"); if (refresh) refresh.addEventListener("click", reload);
    $("srList").addEventListener("click", function (e) {
      var b = e.target.closest("[data-open]"); if (b) openDrawer(b.getAttribute("data-open"));
    });
    $("srDrawerClose").addEventListener("click", closeDrawer);
    $("srScrim").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
    $("srDrawerBody").addEventListener("click", function (e) {
      var b = e.target.closest("[data-review]"); if (b) doReview(b.getAttribute("data-review"));
    });
  }

  function reload() {
    $("srList").innerHTML = '<tr><td colspan="12" class="sr-loading">Loading live data from Supabase…</td></tr>';
    loadAll().then(function () { renderCards(); populateFilters(); renderTable(); })
      .catch(function () { $("srList").innerHTML = '<tr><td colspan="12" class="sr-empty">Could not load data from Supabase. Check the connection and Refresh.</td></tr>'; });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!$("srList")) return;
    if (!isAdmin()) { try { location.replace("learning_path.html"); } catch (e) {} return; }
    if (typeof Identity !== "undefined" && Identity.applyNav) Identity.applyNav();
    wire();
    reload();
  });
})();
