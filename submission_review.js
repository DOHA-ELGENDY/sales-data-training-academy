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

  var S = { kc: [], subs: [], modules: [], lessons: [], rows: [], byId: {}, selectedKey: null };
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
  // Task/Question values may be rich-text/Google-Docs HTML paste — show plain text.
  function stripHtml(v) {
    var t = String(v == null ? "" : v);
    if (t.indexOf("<") < 0 && t.indexOf("&") < 0) return t;
    return t.replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#3?9;/gi, "'")
      .replace(/\s+/g, " ").trim();
  }
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
      taskTitle: stripHtml(r.question) || "Knowledge Check", kc_id: r.knowledge_check_id || "",
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
      taskTitle: stripHtml(r.assignment_title) || "Lesson Assignment", instructions: stripHtml(instructions),
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

  /* ---------- presentation helpers ---------- */
  function initials(name) { var n = String(name == null ? "" : name).trim(); return (n.charAt(0) || "?").toUpperCase(); }
  function statusChip(st) {
    var slug = { "Pending Review": "pending", "Reviewed": "reviewed", "Needs Revision": "revision" }[st] || "pending";
    return '<span class="sr-chip sr-chip-' + slug + '">' + esc(st) + '</span>';
  }
  function sourceChip(src) {
    var slug = src === "Assignment" ? "src-asg" : "src-kc";
    return '<span class="sr-chip sr-chip-' + slug + '">' + esc(src) + '</span>';
  }
  function typeChip(t) { return '<span class="sr-chip sr-chip-type">' + esc(t) + '</span>'; }
  function kv(k, v) { return '<span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span>'; }
  function pathRow(tag, val) { return '<div class="srd-path-row"><span class="srd-path-tag">' + esc(tag) + '</span><span class="srd-path-val" title="' + esc(val) + '">' + esc(val) + '</span></div>'; }
  function emptyState(ico, title, sub) {
    return '<div class="sr-empty"><span class="sr-empty-ico" aria-hidden="true">' + ico + '</span>' +
      '<div class="sr-empty-title">' + esc(title) + '</div><div class="sr-empty-sub">' + esc(sub || "") + '</div></div>';
  }
  function reviewerName() { var i = (typeof Identity !== "undefined") ? Identity.get() : null; return (i && i.employeeName) || "Admin"; }
  function setCount(n) { var el = $("srCount"); if (el) el.textContent = n + " / " + S.rows.length; }

  /* ---------- LEFT: submission list (cards) ---------- */
  function renderList() {
    var rows = applyFilters();
    var host = $("srList");
    if (!rows.length) { host.innerHTML = emptyState("🔍", "No submissions found", "Adjust the filters above or clear the search."); setCount(0); return; }
    host.innerHTML = rows.map(function (r) {
      var key = r._table + ":" + r.id;
      var hasCtx = (r.moduleName && r.moduleName !== NA) || (r.lessonName && r.lessonName !== NA);
      return '<article class="sr-item' + (key === S.selectedKey ? ' is-active' : '') + '" data-open="' + esc(key) + '" tabindex="0" role="button" aria-label="View submission">' +
        '<div class="sr-item-top"><span class="sr-avatar" aria-hidden="true">' + esc(initials(r.employee_name)) + '</span>' +
          '<span class="sr-item-id"><span class="sr-item-name">' + esc(r.employee_name) + '</span>' +
          '<span class="sr-item-sub">' + esc(r.employee_id || "—") + ' · ' + esc(r.team) + '</span></span></div>' +
        '<div class="sr-item-badges">' + sourceChip(r.source) + typeChip(r.type) + statusChip(statusOf(r)) + '</div>' +
        (hasCtx ? '<div class="sr-item-ctx"><span><b>' + esc(r.moduleName) + '</b></span>' +
          '<span>' + esc(r.lessonName) + (r.sectionName && r.sectionName !== "—" ? ' · ' + esc(r.sectionName) : '') + '</span></div>' : '') +
        '<div class="sr-item-foot"><span class="sr-item-when">' + esc(fmtDateTime(r.submitted_at)) + '</span>' +
          '<button type="button" class="sr-btn sr-btn-sm" data-open="' + esc(key) + '">View →</button></div>' +
      '</article>';
    }).join("");
    setCount(rows.length);
  }

  /* ---------- RIGHT: details panel (persistent split view — no modal) ---------- */
  function docLabel(url) {
    var u = String(url || "");
    if (/docs\.google\.com/i.test(u)) return "Google Docs document";
    if (/drive\.google\.com/i.test(u)) return "Google Drive file";
    if (/sharepoint|onedrive|1drv\.ms/i.test(u)) return "OneDrive / SharePoint document";
    if (/dropbox/i.test(u)) return "Dropbox file";
    try { return (new URL(u)).hostname.replace(/^www\./, "") + " document"; } catch (e) { return "Shared document"; }
  }
  function docIcon(url) { return /docs\.google\.com/i.test(String(url)) ? "📝" : (/drive\.google/i.test(String(url)) ? "📁" : "📄"); }

  // Buttons only — a raw URL is NEVER displayed.
  function responseBlock(r) {
    if (r.type === "File Upload" && r.file_url) {
      return '<div class="srd-file"><span class="srd-file-ico" aria-hidden="true">📄</span>' +
        '<div class="srd-file-main"><div class="srd-file-name" title="' + esc(r.file_name || "") + '">' + esc(r.file_name || "Uploaded file") + '</div>' +
        '<div class="srd-file-sub">' + esc(r.file_type || "File") + ' · ' + esc(fmtSize(r.file_size)) + ' · ' + esc(fmtDateTime(r.submitted_at)) + '</div></div></div>' +
        '<div class="srd-sub-actions">' +
          '<a class="sr-btn sr-btn-sm" href="' + esc(r.file_url) + '" target="_blank" rel="noopener">📂 Open File</a>' +
          '<a class="sr-btn sr-btn-ghost sr-btn-sm" href="' + esc(r.file_url) + '" download="' + esc(r.file_name || "") + '" target="_blank" rel="noopener">📥 Download File</a>' +
        '</div>';
    }
    if (r.type === "Document Link" && r.link) {
      return '<div class="srd-doc"><span class="srd-doc-ico" aria-hidden="true">' + docIcon(r.link) + '</span>' +
        '<div class="srd-doc-main"><div class="srd-doc-title">' + esc(docLabel(r.link)) + '</div>' +
        '<div class="srd-doc-sub">Shared link · opens in a new tab</div></div></div>' +
        '<div class="srd-sub-actions">' +
          '<a class="sr-btn sr-btn-sm" href="' + esc(r.link) + '" target="_blank" rel="noopener">📄 Open Document</a>' +
          '<button type="button" class="sr-btn sr-btn-ghost sr-btn-sm" data-copy="' + esc(r.link) + '">🔗 Copy Link</button>' +
        '</div>';
    }
    if (r.text) return '<div class="srd-text">' + esc(r.text) + '</div>';
    return '<p style="color:var(--sr-dim)">No response content stored for this submission.</p>';
  }

  function renderDetailsEmpty() {
    $("srDetails").innerHTML = '<div class="srd-scroll">' +
      emptyState("🗂️", "Select a submission", "Choose a submission from the list to view its details and review it here.") + '</div>';
  }

  function selectSubmission(key) {
    var r = S.byId[key]; if (!r) return;
    S.selectedKey = key;
    Array.prototype.forEach.call(document.querySelectorAll(".sr-item"), function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-open") === key);
    });
    renderDetails(r, key);
  }

  /* ---------- derived helpers (reuse loaded data only — no new query/field) ---------- */
  function timeAgo(iso) {
    if (!iso) return NA;
    var t = new Date(iso).getTime(); if (isNaN(t)) return NA;
    var mins = Math.max(0, (Date.now() - t) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return Math.round(mins) + "m ago";
    if (mins < 1440) return Math.round(mins / 60) + "h ago";
    var d = Math.round(mins / 1440);
    return d + (d === 1 ? " day ago" : " days ago");
  }
  function daysSince(iso) { if (!iso) return Infinity; var t = new Date(iso).getTime(); return isNaN(t) ? Infinity : (Date.now() - t) / 86400000; }

  // Summary of ONE employee, computed from the submission/KC rows already loaded
  // in memory (S.rows) + the loaded course structure (S.lessons). No extra fetch.
  function employeeStats(r) {
    var eid = r.employee_id;
    var mine = S.rows.filter(function (x) { return x.employee_id === eid; });
    var kcRows = mine.filter(function (x) { return x.source === "Knowledge Check"; });
    var asgRows = mine.filter(function (x) { return x.source === "Assignment"; })
      .sort(function (a, b) { return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0); });
    var secSet = {}; kcRows.forEach(function (x) { if (x.section_id) secSet[x.section_id] = 1; });
    var modSet = {}, lesSet = {}; mine.forEach(function (x) { if (x.module_id) modSet[x.module_id] = 1; if (x.lesson_id) lesSet[x.lesson_id] = 1; });
    var pub = S.lessons.filter(function (l) { return l && l.status === "Published" && l.academyKey === r.academy_key; });
    var modTotalSet = {}; pub.forEach(function (l) { if (l.moduleId) modTotalSet[l.moduleId] = 1; });
    var last = mine.reduce(function (m, x) { var t = new Date(x.submitted_at || 0).getTime(); return isNaN(t) ? m : Math.max(m, t); }, 0);
    return {
      kc: kcRows.length, asg: asgRows.length,
      asgStatus: asgRows.length ? statusOf(asgRows[0]) : "Not submitted",
      sections: Object.keys(secSet).length,
      modules: Object.keys(modSet).length, moduleTotal: Object.keys(modTotalSet).length,
      lessons: Object.keys(lesSet).length, lessonTotal: pub.length,
      lastActivity: last ? new Date(last).toISOString() : ""
    };
  }
  function learningStatus(stats) {
    if (!stats.lastActivity) return "No activity";
    var d = daysSince(stats.lastActivity);
    if (d <= 7) return "Active";
    if (d <= 30) return "Recently active";
    return "Inactive";
  }
  function miniBar(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    return '<div class="srd-mini"><span style="width:' + Math.max(0, Math.min(100, pct)) + '%"></span></div>';
  }

  // Training context as an indented Academy → Module → Lesson → Section → task tree.
  function contextTree(r) {
    var section = (r.sectionName && r.sectionName !== "—") ? r.sectionName : (r.source === "Assignment" ? "Lesson-level" : "—");
    var leafTag = r.source === "Assignment" ? "Assignment" : "Knowledge Check";
    var leafVal = r.taskTitle ? String(r.taskTitle).slice(0, 70) : leafTag;
    function node(lvl, ico, tag, val, leaf) {
      return '<div class="srd-tnode' + (leaf ? " is-leaf" : "") + '" style="--lvl:' + lvl + '">' +
        '<span class="srd-tico" aria-hidden="true">' + ico + '</span>' +
        '<span class="srd-tbody"><span class="srd-ttag">' + esc(tag) + '</span>' +
        '<span class="srd-tval" title="' + esc(val) + '">' + esc(val) + '</span></span></div>';
    }
    return '<div class="srd-tree">' +
      node(0, "🎓", "Academy", r.academyName) +
      node(1, "📦", "Module", r.moduleName) +
      node(2, "📘", "Lesson", r.lessonName) +
      node(3, "📑", "Section", section) +
      node(4, (r.source === "Assignment" ? "📝" : "🧠"), leafTag, leafVal, true) +
    '</div>';
  }

  function progressCard(r) {
    var s = employeeStats(r);
    var tile = function (label, val, extra) {
      return '<div class="srd-ptile"><div class="srd-ptile-v">' + val + '</div><div class="srd-ptile-l">' + esc(label) + '</div>' + (extra || "") + '</div>';
    };
    return '<div class="srd-card"><h4 class="srd-card-h">Learning Progress</h4>' +
      '<div class="srd-pgrid">' +
        tile("Modules", s.modules + (s.moduleTotal ? ' / ' + s.moduleTotal : ''), miniBar(s.modules, s.moduleTotal)) +
        tile("Lessons", s.lessons + (s.lessonTotal ? ' / ' + s.lessonTotal : ''), miniBar(s.lessons, s.lessonTotal)) +
        tile("Sections", String(s.sections)) +
        tile("Knowledge Checks", String(s.kc)) +
        tile("Assignment", '<span class="srd-ptile-chip">' + (s.asgStatus === "Not submitted" ? '<span class="sr-chip sr-chip-type">Not submitted</span>' : statusChip(s.asgStatus)) + '</span>') +
        tile("Last Activity", '<span class="srd-ptile-sm">' + esc(timeAgo(s.lastActivity)) + '</span>') +
      '</div>' +
      '<p class="srd-note">Summary of this employee’s submitted work in the current academy.</p>' +
    '</div>';
  }

  function renderDetails(r, key) {
    var st = statusOf(r);
    var stats = employeeStats(r);
    // Professional header band: who + what + when + status.
    var header =
      '<div class="srd-header">' +
        '<span class="sr-avatar srd-header-av" aria-hidden="true">' + esc(initials(r.employee_name)) + '</span>' +
        '<div class="srd-header-main"><div class="srd-header-name">' + esc(r.employee_name) + '</div>' +
          '<div class="srd-header-meta">' + esc(r.employee_id || "—") + ' · ' + esc(r.team) + '</div></div>' +
        '<div class="srd-header-end">' + statusChip(st) + '<div class="srd-header-when">' + esc(fmtDateTime(r.submitted_at)) + '</div></div>' +
      '</div>';

    var scroll =
      // Card — Employee Information (+ Current Learning Status)
      '<div class="srd-card"><h4 class="srd-card-h">Employee Information</h4>' +
        '<div class="srd-emp"><span class="sr-avatar" aria-hidden="true">' + esc(initials(r.employee_name)) + '</span>' +
          '<div><div class="srd-emp-name">' + esc(r.employee_name) + '</div>' +
          '<div class="srd-emp-meta">' + esc(r.employee_id || "—") + ' · ' + esc(r.team) + '</div></div></div>' +
        '<div class="srd-kv" style="margin-top:16px">' +
          kv("Employee ID", r.employee_id || "—") + kv("Team", r.team) + kv("Academy", r.academyName) +
          '<span class="k">Current Status</span><span class="v"><span class="srd-status srd-status-' + (learningStatus(stats) === "Active" ? "on" : (learningStatus(stats) === "Inactive" || learningStatus(stats) === "No activity" ? "off" : "mid")) + '">' + esc(learningStatus(stats)) + '</span></span>' +
        '</div>' +
      '</div>' +
      // Card — Learning Progress (derived from loaded submissions)
      progressCard(r) +
      // Card — Training Context (visual tree)
      '<div class="srd-card"><h4 class="srd-card-h">Training Context</h4>' + contextTree(r) +
        '<div class="srd-kv" style="margin-top:14px">' + kv("Submission Type", r.type) + kv("Submitted", fmtDateTime(r.submitted_at)) + '</div>' +
      '</div>' +
      // Card — Question / Instructions
      '<div class="srd-card"><h4 class="srd-card-h">' + (r.source === "Knowledge Check" ? "Question" : "Assignment") + '</h4>' +
        (r.source === "Knowledge Check"
          ? '<div class="srd-prose">' + esc(r.taskTitle) + '</div>'
          : '<div class="srd-prose"><strong>' + esc(r.taskTitle) + '</strong></div>' +
            (r.instructions ? '<div class="srd-prose" style="margin-top:12px">' + esc(r.instructions) + '</div>' : '')) +
      '</div>' +
      // Card — Employee Submission (buttons only)
      '<div class="srd-card"><h4 class="srd-card-h">Employee Submission · ' + esc(r.type) + '</h4>' + responseBlock(r) + '</div>' +
      // Card — Review
      '<div class="srd-card srd-review"><h4 class="srd-card-h">Review</h4>' +
        '<label for="srRvStatus">Status</label>' +
        '<select id="srRvStatus">' + ['Pending Review', 'Reviewed', 'Needs Revision'].map(function (o) { return '<option value="' + o + '"' + (o === st ? ' selected' : '') + '>' + o + '</option>'; }).join("") + '</select>' +
        '<label for="srRvScore">Score</label><input type="text" id="srRvScore" value="' + esc(r.score) + '" placeholder="e.g. 8/10 or 80%" />' +
        '<label for="srRvFeedback">Feedback</label><textarea id="srRvFeedback" placeholder="Feedback for the employee…">' + esc(r.feedback) + '</textarea>' +
        '<label for="srRvBy">Reviewed By</label><input type="text" id="srRvBy" value="' + esc(r.reviewed_by || reviewerName()) + '" />' +
        (r.reviewed_at ? '<div class="srd-kv" style="margin-top:12px">' + kv("Reviewed At", fmtDateTime(r.reviewed_at)) + '</div>' : '') +
      '</div>';

    $("srDetails").innerHTML =
      header +
      '<div class="srd-scroll">' + scroll + '</div>' +
      '<div class="srd-actions" data-key="' + esc(key) + '">' +
        '<button type="button" class="sr-btn sr-btn-ghost" data-review="revision">Request Revision</button>' +
        '<button type="button" class="sr-btn sr-btn-ghost" data-review="reviewed">Mark Reviewed</button>' +
        '<button type="button" class="sr-btn" data-review="save">Save Review</button>' +
        '<div class="srd-actions-msg" data-review-msg></div>' +
      '</div>';
  }

  function copyLink(btn) {
    var url = btn.getAttribute("data-copy") || "";
    var flash = function () { var t = btn.textContent; btn.textContent = "✓ Copied"; setTimeout(function () { btn.textContent = t; }, 1400); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(flash, function () { fallbackCopy(url); flash(); }); return; }
    } catch (e) {}
    fallbackCopy(url); flash();
  }
  function fallbackCopy(url) {
    try { var ta = document.createElement("textarea"); ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); } catch (e) {}
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
    var panel = document.querySelector(".srd-actions[data-key]");
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
      // Refresh the summary + list + this submission's details in place (split view stays open).
      renderCards(); renderList(); selectSubmission(key);
      var m2 = document.querySelector("[data-review-msg]");
      if (m2) { m2.style.color = "var(--sr-reviewed)"; m2.textContent = "Saved ✓  (" + status + ")"; }
    }).catch(function () {
      var m2 = document.querySelector("[data-review-msg]");
      if (m2) { m2.style.color = "var(--sr-revision)"; m2.textContent = "Save failed — check the connection and retry."; }
    });
  }

  /* ---------- wire ---------- */
  function onFilter() { renderList(); }
  function wire() {
    ["srSearch", "srTeam", "srSource", "srAcademy", "srModule", "srLesson", "srSection", "srType", "srStatus", "srDate"].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener(el.tagName === "INPUT" && el.type === "text" ? "input" : "change", onFilter);
    });
    var refresh = $("srRefresh"); if (refresh) refresh.addEventListener("click", reload);
    // List: click / keyboard select → fill the persistent details panel (no modal).
    $("srList").addEventListener("click", function (e) {
      var b = e.target.closest("[data-open]"); if (b) selectSubmission(b.getAttribute("data-open"));
    });
    $("srList").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var b = e.target.closest("[data-open]"); if (b) { e.preventDefault(); selectSubmission(b.getAttribute("data-open")); }
    });
    // Details: review actions + copy-link.
    $("srDetails").addEventListener("click", function (e) {
      var rev = e.target.closest("[data-review]"); if (rev) { doReview(rev.getAttribute("data-review")); return; }
      var cp = e.target.closest("[data-copy]"); if (cp) { copyLink(cp); return; }
    });
  }

  function reload() {
    $("srList").innerHTML = '<div class="sr-loading">Loading live data from Supabase…</div>';
    renderDetailsEmpty();
    loadAll().then(function () {
      renderCards(); populateFilters(); renderList();
      // Auto-select the first submission so the split view opens populated.
      var rows = applyFilters();
      if (rows.length) selectSubmission(rows[0]._table + ":" + rows[0].id);
      else renderDetailsEmpty();
    }).catch(function () {
      $("srList").innerHTML = emptyState("⚠️", "Could not load data", "Check the connection and press Refresh.");
      renderDetailsEmpty();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!$("srList")) return;
    if (!isAdmin()) { try { location.replace("learning_path.html"); } catch (e) {} return; }
    if (typeof Identity !== "undefined" && Identity.applyNav) Identity.applyNav();
    wire();
    reload();
  });
})();
