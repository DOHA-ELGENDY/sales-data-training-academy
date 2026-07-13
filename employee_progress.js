/* ============================================================
   Employee Progress Dashboard v1.0 (admin only)
   ------------------------------------------------------------
   Reads every analytics dataset from Supabase ONCE, then does all
   filtering / searching / aggregation client-side. Sources:
     employee_profiles, learning_progress, knowledge_check_responses,
     submissions, lesson_activity_log  (+ modules / lessons for structure).

   Access is admin-only (identity.js already redirects non-admins; we also
   guard here). Nothing here writes to Supabase or touches the Learning Path,
   Content Manager, Knowledge Check, Assignment, or identity logic.
   ============================================================ */
(function () {
  "use strict";

  var S = { profiles: [], progress: [], kcs: [], subs: [], activity: [], modules: [], lessons: [], rows: [] };
  var INACTIVE_DAYS = 7;

  /* ---------- tiny helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return (typeof escHtml === "function") ? escHtml(s)
      : String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function isAdmin() { return typeof Identity !== "undefined" && Identity.isAdmin && Identity.isAdmin(); }
  function dayKey(d) { try { return new Date(d).toISOString().slice(0, 10); } catch (e) { return ""; } }
  function todayKey() { return new Date().toISOString().slice(0, 10); }
  function isToday(iso) { return iso && dayKey(iso) === todayKey(); }
  function daysSince(iso) { if (!iso) return Infinity; return (Date.now() - new Date(iso).getTime()) / 86400000; }
  function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); } catch (e) { return "—"; }
  }
  function fmtDateTime(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return "—"; }
  }
  function timeAgo(iso) {
    if (!iso) return "Never";
    var mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return Math.round(mins) + "m ago";
    if (mins < 1440) return Math.round(mins / 60) + "h ago";
    var d = Math.round(mins / 1440);
    return d + (d === 1 ? " day ago" : " days ago");
  }
  function pctBar(pct, kind) {
    return '<div class="ep-bar' + (kind ? " ep-bar-" + kind : "") + '"><span style="width:' + Math.max(0, Math.min(100, pct)) + '%"></span></div>';
  }

  /* ---------- data load (once) ---------- */
  function fetchActivity() {
    // lesson_activity_log has no SB.fetch* helper — read it directly (read-only).
    try {
      if (typeof SUPABASE_URL === "undefined" || !SUPABASE_URL) return Promise.resolve([]);
      var url = SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/lesson_activity_log?select=*&order=created_at.desc&limit=5000";
      return fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY } })
        .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    } catch (e) { return Promise.resolve([]); }
  }
  function safe(p) { return p.then(function (v) { return Array.isArray(v) ? v : []; }).catch(function () { return []; }); }

  function loadAll() {
    var jobs = [
      safe(SB.fetchProfiles()), safe(SB.fetchProgress()), safe(SB.fetchKcResponses()),
      safe(SB.fetchSubmissions()), safe(SB.fetchModules()), safe(SB.fetchLessons()), safe(fetchActivity())
    ];
    return Promise.all(jobs).then(function (r) {
      S.profiles = (r[0] || []).filter(function (p) { return p && (p.role || "") !== "admin"; });
      S.progress = r[1] || [];
      S.kcs = r[2] || [];
      S.subs = r[3] || [];
      // modules/lessons come back as app-shaped objects (moduleFromRow/lessonFromRow).
      S.modules = r[4] || [];
      S.lessons = r[5] || [];
      S.activity = r[6] || [];
    });
  }

  /* ---------- per-academy structure ---------- */
  function pubLessons(academyKey) {
    return S.lessons.filter(function (l) { return l && l.academyKey === academyKey && l.status === "Published"; });
  }
  function modulesOf(academyKey) {
    return S.modules.filter(function (m) { return m && m.academyKey === academyKey; })
      .sort(function (a, b) { return (parseFloat(a.moduleNumber) || 0) - (parseFloat(b.moduleNumber) || 0); });
  }
  function lessonById(id) { return S.lessons.find(function (l) { return l.id === id; }); }
  function moduleById(id) { return S.modules.find(function (m) { return m.id === id; }); }
  function academyName(key) {
    if (typeof academyByKey === "function") { var a = academyByKey(key); if (a) return a.name; }
    return key || "—";
  }

  /* ---------- compute one row per employee ---------- */
  function progressFor(empId) { return S.progress.filter(function (p) { return p.employee_id === empId; }); }
  function kcsFor(empId) { return S.kcs.filter(function (k) { return k.employee_id === empId; }); }
  function subsFor(empId) { return S.subs.filter(function (s) { return s.employee_id === empId; }); }
  function activityFor(empId) { return S.activity.filter(function (a) { return a.employee_id === empId; }); }

  function kcAverage(list) {
    var obj = list.filter(function (k) { return k.is_correct === true || k.is_correct === false; });
    if (!obj.length) return null;
    var ok = obj.filter(function (k) { return k.is_correct === true; }).length;
    return Math.round((ok / obj.length) * 100);
  }
  function isPending(sub) { return /pending/i.test(String(sub.status || sub.review_status || "")); }

  function computeRows() {
    S.rows = S.profiles.map(function (p) {
      var academy = p.academy_key || "";
      var prog = progressFor(p.id);
      var total = pubLessons(academy).length;
      var pubIds = {}; pubLessons(academy).forEach(function (l) { pubIds[l.id] = 1; });
      var doneLessons = prog.filter(function (pr) { return pr.status === "completed" && (pubIds[pr.lesson_id] || total === 0); });
      var done = doneLessons.length;
      var overall = total ? Math.round((done / total) * 100) : (done ? 100 : 0);
      var kc = kcsFor(p.id);
      var pending = subsFor(p.id).filter(isPending).length;
      var last = p.last_active;
      var startedAny = prog.length > 0 || activityFor(p.id).length > 0;

      var status;
      if (!startedAny) status = "Not Started";
      else if (total > 0 && done >= total) status = "Completed";
      else if (daysSince(last) > INACTIVE_DAYS) status = "Inactive";
      else status = "Learning";

      return {
        id: p.id, name: p.employee_name || "—", team: p.team || "—",
        academyKey: academy, academyName: academyName(academy),
        overall: overall, doneLessons: done, totalLessons: total,
        currentModule: p.current_module_title || "—",
        currentLesson: p.current_lesson_title || "—",
        currentSection: "—", // section-level progress is client-side only (see limitations)
        kcAvg: kcAverage(kc), pending: pending,
        lastActive: last, startDate: p.first_seen, status: status,
        _p: p
      };
    });
  }

  /* ---------- summary cards ---------- */
  function renderCards() {
    var totalEmp = S.rows.length;
    var activeToday = S.rows.filter(function (r) { return isToday(r.lastActive); }).length;
    var avgProg = totalEmp ? Math.round(S.rows.reduce(function (a, r) { return a + r.overall; }, 0) / totalEmp) : 0;
    var completedToday = S.progress.filter(function (pr) { return pr.status === "completed" && isToday(pr.completed_at); }).length;
    var pendingReviews = S.subs.filter(isPending).length;
    var kcAvgAll = kcAverage(S.kcs);

    var cards = [
      { label: "Total Employees", value: totalEmp, ico: "👥" },
      { label: "Active Today", value: activeToday, ico: "🟢" },
      { label: "Average Progress", value: avgProg + "%", ico: "📈" },
      { label: "Completed Lessons Today", value: completedToday, ico: "✅" },
      { label: "Pending Assignment Reviews", value: pendingReviews, ico: "📋" },
      { label: "Avg Knowledge Check Score", value: (kcAvgAll == null ? "—" : kcAvgAll + "%"), ico: "🎯" }
    ];
    $("epCards").innerHTML = cards.map(function (c) {
      return '<div class="ep-card"><span class="ep-card-ico" aria-hidden="true">' + c.ico + '</span>' +
        '<span class="ep-card-value">' + esc(c.value) + '</span>' +
        '<span class="ep-card-label">' + esc(c.label) + '</span></div>';
    }).join("");
    var foot = $("epFootCount"); if (foot) foot.textContent = totalEmp + " employees";
  }

  /* ---------- filter option population ---------- */
  function uniqueSorted(arr) { return Array.from(new Set(arr.filter(Boolean))).sort(); }
  function fillSelect(sel, values, keepFirst) {
    if (!sel) return;
    var first = keepFirst ? sel.options[0].outerHTML : "";
    sel.innerHTML = first + values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join("");
  }
  function populateFilterOptions() {
    fillSelect($("epTeam"), uniqueSorted(S.rows.map(function (r) { return r.team; })), true);
    fillSelect($("epAcademy"), uniqueSorted(S.rows.map(function (r) { return r.academyName; })), true);
    fillSelect($("epModule"), uniqueSorted(S.rows.map(function (r) { return r.currentModule; }).filter(function (v) { return v && v !== "—"; })), true);
    fillSelect($("epLesson"), uniqueSorted(S.rows.map(function (r) { return r.currentLesson; }).filter(function (v) { return v && v !== "—"; })), true);
  }

  /* ---------- filtering (client-side) ---------- */
  function progressBucket(pct) {
    if (pct >= 100) return "100";
    if (pct >= 75) return "75";
    if (pct >= 50) return "50";
    if (pct >= 25) return "25";
    if (pct > 0) return "1";
    return "0";
  }
  function applyFilters() {
    var q = ($("epSearch").value || "").trim().toLowerCase();
    var team = $("epTeam").value, acad = $("epAcademy").value, status = $("epStatus").value;
    var mod = $("epModule").value, les = $("epLesson").value;
    var prog = $("epProgress").value, asg = $("epAssign").value;
    var activeToday = $("epActiveToday").checked;
    return S.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0) return false;
      if (team && r.team !== team) return false;
      if (acad && r.academyName !== acad) return false;
      if (status && r.status !== status) return false;
      if (mod && r.currentModule !== mod) return false;
      if (les && r.currentLesson !== les) return false;
      if (prog && progressBucket(r.overall) !== prog) return false;
      if (asg === "pending" && r.pending <= 0) return false;
      if (asg === "none" && r.pending > 0) return false;
      if (activeToday && !isToday(r.lastActive)) return false;
      return true;
    });
  }

  /* ---------- table ---------- */
  function statusPill(st) {
    var slug = { "Not Started": "ns", "Learning": "learn", "Completed": "done", "Inactive": "inactive" }[st] || "ns";
    return '<span class="ep-status ep-status-' + slug + '">' + esc(st) + '</span>';
  }
  function renderTable() {
    var rows = applyFilters();
    var tb = $("epList");
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="11" class="ep-empty">No employees match these filters.</td></tr>'; return; }
    tb.innerHTML = rows.map(function (r) {
      return '<tr class="ep-row" data-emp="' + esc(r.id) + '" tabindex="0" role="button">' +
        '<td class="ep-name"><span class="ep-avatar" aria-hidden="true">' + esc((r.name[0] || "?").toUpperCase()) + '</span>' + esc(r.name) + '</td>' +
        '<td>' + esc(r.team) + '</td>' +
        '<td>' + esc(r.academyName) + '</td>' +
        '<td class="ep-progcell"><div class="ep-progwrap">' + pctBar(r.overall) + '<span class="ep-progtxt">' + r.overall + '%</span></div></td>' +
        '<td class="ep-dim">' + esc(r.currentModule) + '</td>' +
        '<td class="ep-dim">' + esc(r.currentLesson) + '</td>' +
        '<td class="ep-dim">' + esc(r.currentSection) + '</td>' +
        '<td>' + (r.kcAvg == null ? '<span class="ep-dim">—</span>' : r.kcAvg + '%') + '</td>' +
        '<td>' + (r.pending > 0 ? '<span class="ep-badge-warn">' + r.pending + '</span>' : '<span class="ep-dim">0</span>') + '</td>' +
        '<td class="ep-dim" title="' + esc(fmtDateTime(r.lastActive)) + '"><bdi>' + esc(timeAgo(r.lastActive)) + '</bdi></td>' +
        '<td>' + statusPill(r.status) + '</td>' +
        '</tr>';
    }).join("");
    var cnt = $("epCount"); if (cnt) cnt.textContent = rows.length + " / " + S.rows.length;
  }

  /* ---------- module / lesson / section detail ---------- */
  function moduleProgressList(r) {
    var mods = modulesOf(r.academyKey);
    if (!mods.length) return '<p class="ep-none">No modules for this academy.</p>';
    var prog = progressFor(r.id);
    return mods.map(function (m) {
      var mLessons = pubLessons(r.academyKey).filter(function (l) { return l.moduleId === m.id; });
      var total = mLessons.length;
      var doneIds = {}; prog.forEach(function (p) { if (p.status === "completed") doneIds[p.lesson_id] = 1; });
      var done = mLessons.filter(function (l) { return doneIds[l.id]; }).length;
      var pct = total ? Math.round(done / total * 100) : 0;
      var state = total === 0 ? "Locked" : (done >= total ? "Completed" : (done > 0 || m.id === r._p.current_module_id ? "In Progress" : "Locked"));
      var sslug = { "Completed": "done", "In Progress": "prog", "Locked": "lock" }[state];
      return '<div class="ep-mod"><div class="ep-mod-top"><span class="ep-mod-title">M' + esc(m.moduleNumber) + ' — ' + esc(m.moduleTitle) + '</span>' +
        '<span class="ep-chip ep-chip-' + sslug + '">' + esc(state) + '</span></div>' +
        pctBar(pct) + '<span class="ep-mod-sub">' + done + ' / ' + total + ' lessons · ' + pct + '%</span></div>';
    }).join("");
  }
  function lessonRows(r) {
    var lessons = pubLessons(r.academyKey).slice().sort(function (a, b) {
      return (parseFloat(a.moduleNumber) || 0) - (parseFloat(b.moduleNumber) || 0) || (Number(a.order) || 0) - (Number(b.order) || 0);
    });
    if (!lessons.length) return '<tr><td colspan="5" class="ep-none">No lessons.</td></tr>';
    var pmap = {}; progressFor(r.id).forEach(function (p) { pmap[p.lesson_id] = p; });
    return lessons.map(function (l) {
      var p = pmap[l.id] || {};
      var st = p.status === "completed" ? "Completed" : (p.status === "in-progress" ? "In Progress" : "Not Started");
      var pct = p.status === "completed" ? 100 : (p.status === "in-progress" ? 50 : 0);
      var sslug = { "Completed": "done", "In Progress": "prog", "Not Started": "lock" }[st];
      return '<tr><td>L' + esc(l.lessonNumber) + ' — ' + esc(l.lessonTitle) + '</td>' +
        '<td><span class="ep-chip ep-chip-' + sslug + '">' + esc(st) + '</span></td>' +
        '<td class="ep-dim">' + esc(fmtDate(p.started_at)) + '</td>' +
        '<td class="ep-dim">' + esc(fmtDate(p.completed_at)) + '</td>' +
        '<td class="ep-progcell">' + pctBar(pct) + '</td></tr>';
    }).join("");
  }
  function sectionRows(r) {
    // Section (Part) completion is stored per-employee in localStorage, not in
    // Supabase — so time/attempts/time-spent are not available server-side.
    var lessons = pubLessons(r.academyKey);
    var pmap = {}; progressFor(r.id).forEach(function (p) { pmap[p.lesson_id] = p; });
    var out = [], any = false;
    lessons.forEach(function (l) {
      var parts = (typeof lessonParts === "function") ? lessonParts(l) : [];
      if (!parts.length) return;
      var lp = pmap[l.id] || {};
      var lessonDone = lp.status === "completed";
      parts.forEach(function (part) {
        any = true;
        var title = (typeof sectionDisplayTitle === "function") ? sectionDisplayTitle(part) : (part.title || "Section");
        var st = lessonDone ? "Completed" : (lp.status === "in-progress" ? "In Progress" : "Locked");
        var sslug = { "Completed": "done", "In Progress": "prog", "Locked": "lock" }[st];
        out.push('<tr><td>' + esc(l.lessonTitle) + ' · ' + esc(title) + '</td>' +
          '<td><span class="ep-chip ep-chip-' + sslug + '">' + esc(st) + '</span></td>' +
          '<td class="ep-dim">—</td><td class="ep-dim">—</td><td class="ep-dim">—</td></tr>');
      });
    });
    if (!any) return '<tr><td colspan="5" class="ep-none">No sections.</td></tr>';
    return out.join("");
  }
  function kcHistory(r) {
    var list = kcsFor(r.id).slice().sort(function (a, b) { return new Date(b.submitted_at) - new Date(a.submitted_at); });
    if (!list.length) return '<tr><td colspan="6" class="ep-none">No Knowledge Check submissions.</td></tr>';
    return list.map(function (k) {
      var result = (k.is_correct === true) ? '<span class="ep-chip ep-chip-done">Correct</span>'
        : (k.is_correct === false) ? '<span class="ep-chip ep-chip-lock">Incorrect</span>'
        : '<span class="ep-chip ep-chip-prog">' + esc(k.review_status || "Submitted") + '</span>';
      var score = (k.score ? esc(k.score) : (k.is_correct === true ? "100%" : (k.is_correct === false ? "0%" : "—")));
      return '<tr><td>' + esc((k.question || "—")).slice(0, 120) + '</td>' +
        '<td class="ep-dim">' + esc(k.response_type || "—") + '</td>' +
        '<td>' + result + '</td><td class="ep-dim">1</td>' +
        '<td class="ep-dim">' + esc(fmtDate(k.submitted_at)) + '</td>' +
        '<td>' + score + '</td></tr>';
    }).join("");
  }
  function assignmentRows(r) {
    var list = subsFor(r.id).slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    if (!list.length) return '<tr><td colspan="6" class="ep-none">No assignment submissions.</td></tr>';
    return list.map(function (a) {
      var link = a.submission_link || a.file_url || "";
      var linkHtml = link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">Open ↗</a>' : (a.text_answer ? '<span class="ep-dim">Text</span>' : '<span class="ep-dim">—</span>');
      var rev = a.status || "Pending Review";
      var rslug = /review|reviewed/i.test(rev) && !/pending/i.test(rev) ? "done" : (/pending/i.test(rev) ? "prog" : "lock");
      return '<tr><td>' + esc(a.assignment_title || a.lesson_title || "Assignment") + '</td>' +
        '<td><span class="ep-chip ep-chip-' + rslug + '">' + esc(rev) + '</span></td>' +
        '<td class="ep-dim">' + esc(fmtDate(a.created_at)) + '</td>' +
        '<td>' + (a.score ? esc(a.score) : '<span class="ep-dim">—</span>') + '</td>' +
        '<td class="ep-dim">' + esc(a.feedback || "—") + '</td>' +
        '<td>' + linkHtml + '</td></tr>';
    }).join("");
  }
  var EVENT_LABEL = {
    identified: "Identified", academy_opened: "Opened academy", module_opened: "Opened module",
    lesson_opened: "Started lesson", lesson_completed: "Completed lesson",
    kc_submitted: "Submitted Knowledge Check", assignment_submitted: "Uploaded assignment"
  };
  function timeline(r) {
    var list = activityFor(r.id).slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); }).slice(0, 60);
    if (!list.length) return '<p class="ep-none">No recorded activity yet.</p>';
    return '<ul class="ep-timeline">' + list.map(function (e) {
      var l = e.lesson_id ? lessonById(e.lesson_id) : null;
      var m = e.module_id ? moduleById(e.module_id) : null;
      var ctx = [m ? "M" + m.moduleNumber : "", l ? l.lessonTitle : ""].filter(Boolean).join(" · ");
      return '<li class="ep-tl-item"><span class="ep-tl-dot" aria-hidden="true"></span>' +
        '<div class="ep-tl-body"><span class="ep-tl-title">' + esc(EVENT_LABEL[e.event_type] || e.event_type) + '</span>' +
        (ctx ? '<span class="ep-tl-ctx">' + esc(ctx) + '</span>' : '') +
        '<span class="ep-tl-time">' + esc(fmtDateTime(e.created_at)) + '</span></div></li>';
    }).join("") + '</ul>';
  }

  /* ---------- profile drawer ---------- */
  function openProfile(empId) {
    var r = S.rows.find(function (x) { return x.id === empId; });
    if (!r) return;
    var drawer = $("epDrawer"), body = $("epDrawerBody");
    body.innerHTML =
      '<div class="ep-prof-head">' +
        '<span class="ep-avatar ep-avatar-lg" aria-hidden="true">' + esc((r.name[0] || "?").toUpperCase()) + '</span>' +
        '<div><h2 class="ep-prof-name">' + esc(r.name) + '</h2>' +
        '<div class="ep-prof-meta">' + esc(r.team) + ' · ' + esc(r.academyName) + ' · ' + statusPill(r.status) + '</div></div>' +
      '</div>' +
      '<div class="ep-prof-grid">' +
        infoTile("Start Date", fmtDate(r.startDate)) +
        infoTile("Last Active", timeAgo(r.lastActive)) +
        infoTile("Current Module", r.currentModule) +
        infoTile("Current Lesson", r.currentLesson) +
        infoTile("Current Section", r.currentSection) +
        infoTile("Pending Assignments", String(r.pending)) +
      '</div>' +
      '<div class="ep-prof-overall"><div class="ep-prof-overall-top"><span>Overall Progress</span><strong>' + r.overall + '%</strong></div>' +
        pctBar(r.overall) + '<span class="ep-mod-sub">' + r.doneLessons + ' / ' + r.totalLessons + ' lessons · KC avg ' + (r.kcAvg == null ? "—" : r.kcAvg + "%") + '</span></div>' +
      section("Module Progress", '<div class="ep-mods">' + moduleProgressList(r) + '</div>') +
      section("Lesson Progress", table(["Lesson", "Status", "Started", "Completed", "%"], lessonRows(r))) +
      section("Section Progress", table(["Section", "Status", "Completion Time", "Attempts", "Time Spent"], sectionRows(r)) +
        '<p class="ep-note">Section-level timing & attempts are recorded on the employee device and are not yet synced to the server.</p>') +
      section("Knowledge Check History", table(["Question", "Type", "Result", "Attempts", "Submitted", "Score"], kcHistory(r))) +
      section("Assignments", table(["Assignment", "Status", "Submitted", "Score", "Feedback", "File / Link"], assignmentRows(r))) +
      section("Activity Timeline", timeline(r));
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    $("epDrawerScrim").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function infoTile(label, val) { return '<div class="ep-info"><span class="ep-info-label">' + esc(label) + '</span><span class="ep-info-val">' + esc(val) + '</span></div>'; }
  function section(title, inner) { return '<section class="ep-sec"><h3 class="ep-sec-title">' + esc(title) + '</h3>' + inner + '</section>'; }
  function table(cols, bodyHtml) {
    return '<div class="ep-subtable-wrap"><table class="ep-subtable"><thead><tr>' +
      cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join("") + '</tr></thead><tbody>' + bodyHtml + '</tbody></table></div>';
  }
  function closeProfile() {
    var drawer = $("epDrawer");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    $("epDrawerScrim").hidden = true;
    document.body.style.overflow = "";
  }

  /* ---------- wire up ---------- */
  function wire() {
    ["epSearch", "epTeam", "epAcademy", "epStatus", "epModule", "epLesson", "epProgress", "epAssign"].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener(el.tagName === "INPUT" && el.type === "text" ? "input" : "change", renderTable);
    });
    var at = $("epActiveToday"); if (at) at.addEventListener("change", renderTable);
    var refresh = $("epRefresh"); if (refresh) refresh.addEventListener("click", reload);
    $("epList").addEventListener("click", function (e) { var tr = e.target.closest(".ep-row"); if (tr) openProfile(tr.getAttribute("data-emp")); });
    $("epList").addEventListener("keydown", function (e) { if (e.key === "Enter") { var tr = e.target.closest(".ep-row"); if (tr) openProfile(tr.getAttribute("data-emp")); } });
    $("epDrawerClose").addEventListener("click", closeProfile);
    $("epDrawerScrim").addEventListener("click", closeProfile);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeProfile(); });
  }

  function reload() {
    $("epList").innerHTML = '<tr><td colspan="11" class="ep-loading">Loading…</td></tr>';
    loadAll().then(function () { computeRows(); renderCards(); populateFilterOptions(); renderTable(); })
      .catch(function () { $("epList").innerHTML = '<tr><td colspan="11" class="ep-empty">Could not load data.</td></tr>'; });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!$("epList")) return; // not this page
    if (!isAdmin()) { try { location.replace("learning_path.html"); } catch (e) {} return; }
    if (typeof Identity !== "undefined" && Identity.applyNav) Identity.applyNav();
    wire();
    reload();
  });
})();
