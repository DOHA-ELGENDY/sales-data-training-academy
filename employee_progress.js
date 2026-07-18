/* ============================================================
   Admin Learning Dashboard — management drill-down (admin only)
   ------------------------------------------------------------
   Hierarchy:  Team → Employee → Module → Lesson → Section → KC / Assignment

   Reads LIVE from Supabase ONCE, then navigates / filters / aggregates entirely
   client-side. Data sources:
     • employee_profiles          — one row per employee (+ resume state + time)
     • learning_progress          — per-lesson status (started / completed)
     • lesson_activity_log        — the event stream (section opened/completed,
                                     KC started/result, time_spent, …)
     • knowledge_check_responses  — the employee's actual KC answers + grading
     • submissions                — assignment submissions + review status
     • modules / lessons          — course structure (for "what was NOT viewed")

   Admin only: identity.js redirects non-admins; we also guard here. The only
   writes are assignment-review updates (SB.updateSubmission) triggered by the
   admin from the Assignment panel — nothing here touches the Learning Path,
   Content Manager, tracking logic, Knowledge Check, or identity code.
   Missing values render as "Not available" — never invented.
   ============================================================ */
(function () {
  "use strict";

  var S = { profiles: [], progress: [], kcs: [], subs: [], activity: [], modules: [], lessons: [], rows: [] };
  var INACTIVE_DAYS = 7;
  var CANON_TEAMS = ["Sales", "Sales Data", "Sales Accounting"]; // always shown (from index.html team list)
  var NA = "Not available";

  // Navigation state (a small stack we can render from, no page reloads).
  // Default is the central Employees list; "teams" is an optional grouping.
  var view = { name: "list", team: null, empId: null };
  var open = { modules: {}, lessons: {} }; // expand/collapse state, keyed by employee+id

  // Task/Question values may be rich-text / Google-Docs HTML paste — show plain text.
  function stripHtml(v) {
    var t = String(v == null ? "" : v);
    if (t.indexOf("<") < 0 && t.indexOf("&") < 0) return t;
    return t.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
  }

  /* ---------------- tiny helpers ---------------- */
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
    if (!iso) return NA;
    try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); } catch (e) { return NA; }
  }
  function fmtDateTime(iso) {
    if (!iso) return NA;
    try { return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return NA; }
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
  function fmtDuration(sec) {
    sec = Number(sec) || 0;
    if (sec <= 0) return "0m";
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (h) return h + "h " + m + "m";
    if (m) return m + "m";
    return Math.round(sec) + "s";
  }
  function bar(pct, done) {
    pct = Math.max(0, Math.min(100, pct || 0));
    return '<div class="epd-bar' + (done ? " is-done" : "") + '"><span style="width:' + pct + '%"></span></div>';
  }
  function chip(text, slug) { return '<span class="epd-chip epd-chip-' + slug + '">' + esc(text) + '</span>'; }
  function initials(name) { return (String(name || "?").trim()[0] || "?").toUpperCase(); }

  var STATUS_SLUG = { "Not Started": "ns", "In Progress": "prog", "Completed": "done", "Inactive": "inactive", "Locked": "lock" };
  function statusChip(st) { return chip(st, STATUS_SLUG[st] || "ns"); }

  /* ---------------- data load (once) ---------------- */
  function fetchActivity() {
    // lesson_activity_log has no SB.fetch* helper — read it directly (read-only).
    try {
      if (typeof SUPABASE_URL === "undefined" || !SUPABASE_URL) return Promise.resolve([]);
      var url = SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/lesson_activity_log?select=*&order=created_at.desc&limit=10000";
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
      S.modules = r[4] || [];
      S.lessons = r[5] || [];
      S.activity = r[6] || [];
    });
  }

  /* ---------------- structure helpers ---------------- */
  function pubLessons(academyKey) {
    return S.lessons.filter(function (l) { return l && l.academyKey === academyKey && l.status === "Published"; });
  }
  function modulesOf(academyKey) {
    return S.modules.filter(function (m) { return m && m.academyKey === academyKey; })
      .sort(function (a, b) { return (parseFloat(a.moduleNumber) || 0) - (parseFloat(b.moduleNumber) || 0); });
  }
  function lessonsOfModule(academyKey, moduleId) {
    return pubLessons(academyKey).filter(function (l) { return l.moduleId === moduleId; })
      .sort(function (a, b) { return (parseFloat(a.lessonNumber) || 0) - (parseFloat(b.lessonNumber) || 0) || (Number(a.order) || 0) - (Number(b.order) || 0); });
  }
  function moduleById(id) { return S.modules.find(function (m) { return m.id === id; }); }
  function lessonById(id) { return S.lessons.find(function (l) { return l.id === id; }); }
  function academyName(key) {
    if (typeof academyByKey === "function") { var a = academyByKey(key); if (a) return a.name; }
    return key || NA;
  }
  function partsOf(lesson) { try { return (typeof lessonParts === "function") ? lessonParts(lesson) : []; } catch (e) { return []; } }
  function partTitle(part) {
    if (typeof sectionDisplayTitle === "function") { try { return sectionDisplayTitle(part) || part.title; } catch (e) {} }
    return part.title || ("Part " + (part.partNumber || ""));
  }

  /* ---------------- per-employee selectors ---------------- */
  function progressFor(id) { return S.progress.filter(function (p) { return p.employee_id === id; }); }
  function kcsFor(id) { return S.kcs.filter(function (k) { return k.employee_id === id; }); }
  // NOTE: submissions come back camelCase (submissionFromRow); everything else is raw snake_case.
  function subsFor(id) { return S.subs.filter(function (s) { return s.employeeId === id; }); }
  function activityFor(id) { return S.activity.filter(function (a) { return a.employee_id === id; }); }
  function isPending(sub) { return /pending|revision/i.test(String(sub.status || "Pending")); }

  /* ---------------- one summary row per employee ---------------- */
  function computeRows() {
    S.rows = S.profiles.map(function (p) {
      var academy = p.academy_key || "";
      var prog = progressFor(p.id);
      var pub = pubLessons(academy);
      var total = pub.length;
      var pubIds = {}; pub.forEach(function (l) { pubIds[l.id] = 1; });
      var done = prog.filter(function (pr) { return pr.status === "completed" && (pubIds[pr.lesson_id] || total === 0); }).length;
      var overall = total ? Math.round((done / total) * 100) : (done ? 100 : 0);
      var pending = subsFor(p.id).filter(isPending).length;
      var startedAny = prog.length > 0 || activityFor(p.id).length > 0;
      var last = p.last_active;

      var status;
      if (!startedAny) status = "Not Started";
      else if (total > 0 && done >= total) status = "Completed";
      else if (daysSince(last) > INACTIVE_DAYS) status = "Inactive";
      else status = "In Progress";

      return {
        id: p.id, name: p.employee_name || NA, team: p.team || "—",
        academyKey: academy, academyName: academyName(academy),
        overall: overall, doneLessons: done, totalLessons: total,
        currentModule: p.current_module_title || NA,
        currentLesson: p.current_lesson_title || NA,
        currentSection: p.current_section_title || NA,
        pending: pending, started: startedAny,
        lastActive: last, firstSeen: p.first_seen, totalTime: p.total_time_seconds || 0,
        status: status, _p: p
      };
    });
  }

  /* ---------------- global filters ---------------- */
  function progressBucket(pct) {
    if (pct >= 100) return "100";
    if (pct >= 75) return "75";
    if (pct >= 50) return "50";
    if (pct >= 25) return "25";
    if (pct > 0) return "1";
    return "0";
  }
  function filterVals() {
    return {
      q: ($("epSearch").value || "").trim().toLowerCase(),
      team: $("epTeam").value, acad: $("epAcademy").value, mod: $("epModule").value,
      status: $("epStatus").value, prog: $("epProgress").value,
      activeToday: $("epActiveToday").checked, pending: $("epPending").checked
    };
  }
  // Rows passing the GLOBAL filters (team filter optional — pass ignoreTeam when a
  // team is already fixed by the drill-down).
  function filteredRows(ignoreTeam) {
    var f = filterVals();
    return S.rows.filter(function (r) {
      if (f.q && r.name.toLowerCase().indexOf(f.q) < 0) return false;
      if (!ignoreTeam && f.team && r.team !== f.team) return false;
      if (f.acad && r.academyName !== f.acad) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.mod && r.currentModule !== f.mod) return false;
      if (f.prog && progressBucket(r.overall) !== f.prog) return false;
      if (f.activeToday && !isToday(r.lastActive)) return false;
      if (f.pending && r.pending <= 0) return false;
      return true;
    });
  }

  /* ---------------- top summary cards ---------------- */
  function renderCards() {
    var rows = S.rows;
    var total = rows.length;
    var started = rows.filter(function (r) { return r.started; }).length;
    var inProg = rows.filter(function (r) { return r.status === "In Progress"; }).length;
    var completed = rows.filter(function (r) { return r.status === "Completed"; }).length;
    var activeToday = rows.filter(function (r) { return isToday(r.lastActive); }).length;
    var pending = S.subs.filter(isPending).length;

    var cards = [
      { l: "Total Employees", v: total },
      { l: "Started", v: started },
      { l: "In Progress", v: inProg },
      { l: "Completed", v: completed },
      { l: "Active Today", v: activeToday },
      { l: "Pending Reviews", v: pending, warn: pending > 0 }
    ];
    $("epCards").innerHTML = cards.map(function (c) {
      return '<div class="epd-card' + (c.warn ? " is-warn" : "") + '"><span class="epd-card-val">' + esc(c.v) +
        '</span><span class="epd-card-lbl">' + esc(c.l) + '</span></div>';
    }).join("");
    var foot = $("epFootCount"); if (foot) foot.textContent = total + " employees";
  }

  /* ---------------- filter option population ---------------- */
  function uniqueSorted(arr) { return Array.from(new Set(arr.filter(function (v) { return v && v !== NA && v !== "—"; }))).sort(); }
  function fillSelect(sel, values) {
    if (!sel) return;
    var first = sel.options[0] ? sel.options[0].outerHTML : "";
    var keep = sel.value;
    sel.innerHTML = first + values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join("");
    if (keep) sel.value = keep;
  }
  function populateFilterOptions() {
    var teams = uniqueSorted(CANON_TEAMS.concat(S.rows.map(function (r) { return r.team; })));
    fillSelect($("epTeam"), teams);
    fillSelect($("epAcademy"), uniqueSorted(S.rows.map(function (r) { return r.academyName; })));
    fillSelect($("epModule"), uniqueSorted(S.rows.map(function (r) { return r.currentModule; })));
  }

  // Segmented control: All Employees ↔ By Team.
  function viewToggle(active) {
    return '<div class="epd-seg">' +
      '<button type="button" class="epd-seg-btn' + (active === "list" ? " is-on" : "") + '" data-viewmode="list">All Employees</button>' +
      '<button type="button" class="epd-seg-btn' + (active === "teams" ? " is-on" : "") + '" data-viewmode="teams">By Team</button>' +
    '</div>';
  }

  /* ============================================================
     VIEW — EMPLOYEES (central dashboard, default)
     ============================================================ */
  function renderEmployeeList() {
    var rows = filteredRows().slice().sort(function (a, b) {
      // Pending reviews first, then most recently active.
      if ((b.pending > 0) !== (a.pending > 0)) return (b.pending > 0 ? 1 : 0) - (a.pending > 0 ? 1 : 0);
      return new Date(b.lastActive || 0) - new Date(a.lastActive || 0) || a.name.localeCompare(b.name);
    });
    var head = '<div class="epd-view-title"><h2>Employees</h2><span class="epd-sub">' + rows.length + ' / ' + S.rows.length + '</span>' + viewToggle("list") + '</div>';
    if (!rows.length) { setView(head + emptyState("👥", "No employees match the current filters.")); return; }
    var body = rows.map(function (r) {
      var pos = [r.currentModule, r.currentLesson].filter(function (v) { return v && v !== NA; }).join(" · ") || NA;
      return '<tr class="epd-clickrow" data-emp="' + esc(r.id) + '" tabindex="0" role="button">' +
        '<td><span class="epd-name"><span class="epd-avatar">' + esc(initials(r.name)) + '</span><span><span class="epd-name-t">' + esc(r.name) + '</span><span class="epd-name-id">' + esc(r.id) + '</span></span></span></td>' +
        '<td class="epd-dim">' + esc(r.team) + '</td>' +
        '<td class="epd-dim">' + esc(r.academyName) + '</td>' +
        '<td>' + statusChip(r.status) + '</td>' +
        '<td class="epd-progcell"><span class="epd-progwrap">' + bar(r.overall, r.overall >= 100) + '<span class="epd-progtxt">' + r.overall + '%</span></span></td>' +
        '<td class="epd-dim">' + esc(pos) + '</td>' +
        '<td class="epd-dim" title="' + esc(fmtDateTime(r.lastActive)) + '"><bdi>' + esc(timeAgo(r.lastActive)) + '</bdi></td>' +
        '<td>' + (r.pending > 0 ? '<span class="epd-badge-warn">' + r.pending + '</span>' : '<span class="epd-dim">0</span>') + '</td>' +
        '<td><button type="button" class="epd-btn epd-btn-sm" data-emp="' + esc(r.id) + '">View Profile</button></td>' +
      '</tr>';
    }).join("");
    setView(head +
      '<div class="epd-tablewrap"><table class="epd-table"><thead><tr>' +
        '<th>Employee</th><th>Team</th><th>Academy</th><th>Status</th><th>Overall Progress</th><th>Current Position</th><th>Last Activity</th><th>Pending</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>');
  }

  /* ============================================================
     VIEW — TEAMS (optional grouping)
     ============================================================ */
  function teamAggregate(team, rows) {
    var emps = rows.filter(function (r) { return r.team === team; });
    var total = emps.length;
    var started = emps.filter(function (r) { return r.started; }).length;
    var inProg = emps.filter(function (r) { return r.status === "In Progress"; }).length;
    var completed = emps.filter(function (r) { return r.status === "Completed"; }).length;
    var avg = total ? Math.round(emps.reduce(function (a, r) { return a + r.overall; }, 0) / total) : 0;
    var activeToday = emps.filter(function (r) { return isToday(r.lastActive); }).length;
    var pending = emps.reduce(function (a, r) { return a + r.pending; }, 0);
    return { team: team, total: total, started: started, inProg: inProg, completed: completed, avg: avg, activeToday: activeToday, pending: pending };
  }
  function renderTeams() {
    var rows = filteredRows();
    var f = filterVals();
    // Which teams to show: the canonical three + any team that appears in data,
    // narrowed to the team filter when one is chosen.
    var teams = uniqueSorted(CANON_TEAMS.concat(S.rows.map(function (r) { return r.team; })));
    if (f.team) teams = teams.filter(function (t) { return t === f.team; });

    var stat = function (label, val, warn) {
      return '<div class="epd-stat"><span class="epd-dim">' + esc(label) + '</span><b' + (warn ? ' class="epd-warnnum"' : '') + '>' + esc(val) + '</b></div>';
    };
    var html = teams.map(function (t) {
      var a = teamAggregate(t, rows);
      return '<div class="epd-team">' +
        '<div class="epd-team-head"><span class="epd-team-name">' + esc(t) + '</span>' +
          (a.activeToday ? '<span class="epd-team-badge">' + a.activeToday + ' active today</span>' : '') + '</div>' +
        '<div class="epd-team-stats">' +
          stat("Employees", a.total) + stat("Started", a.started) +
          stat("In Progress", a.inProg) + stat("Completed", a.completed) +
          stat("Active Today", a.activeToday) + stat("Pending Reviews", a.pending, a.pending > 0) +
        '</div>' +
        '<div class="epd-team-prog"><div class="epd-team-prog-top"><span>Average Progress</span><span>' + a.avg + '%</span></div>' +
          bar(a.avg, a.avg >= 100) + '</div>' +
        '<div class="epd-team-act"><button type="button" class="epd-btn" data-team="' + esc(t) + '"' +
          (a.total ? '' : ' disabled title="No employees have selected this team yet"') + '>View Team →</button></div>' +
      '</div>';
    }).join("");

    setView('<div class="epd-view-title"><h2>Teams</h2><span class="epd-sub">' + teams.length + ' teams · ' + rows.length + ' employees</span>' + viewToggle("teams") + '</div>' +
      (teams.length ? '<div class="epd-teams">' + html + '</div>'
        : emptyState("🏷️", "No teams match the current filters.")));
  }

  /* ============================================================
     VIEW 2 — TEAM DETAILS (employees of one team)
     ============================================================ */
  function renderTeamDetail(team) {
    var rows = filteredRows(true).filter(function (r) { return r.team === team; })
      .sort(function (a, b) { return b.overall - a.overall || a.name.localeCompare(b.name); });

    var head = '<div class="epd-view-title"><h2>' + esc(team) + '</h2><span class="epd-sub">' + rows.length + ' employees</span></div>';

    if (!rows.length) { setView(head + emptyState("👥", "No employees in this team match the current filters.")); return; }

    var body = rows.map(function (r) {
      var cur = [r.currentModule, r.currentLesson].filter(function (v) { return v && v !== NA; });
      return '<tr class="epd-clickrow" data-emp="' + esc(r.id) + '" tabindex="0" role="button">' +
        '<td><span class="epd-name"><span class="epd-avatar">' + esc(initials(r.name)) + '</span>' + esc(r.name) + '</span></td>' +
        '<td>' + statusChip(r.status) + '</td>' +
        '<td class="epd-progcell"><span class="epd-progwrap">' + bar(r.overall, r.overall >= 100) + '<span class="epd-progtxt">' + r.overall + '%</span></span></td>' +
        '<td class="epd-dim">' + esc(r.currentModule) + '</td>' +
        '<td class="epd-dim">' + esc(r.currentLesson) + '</td>' +
        '<td class="epd-dim">' + esc(r.currentSection) + '</td>' +
        '<td>' + r.doneLessons + ' / ' + r.totalLessons + '</td>' +
        '<td class="epd-dim" title="' + esc(fmtDateTime(r.lastActive)) + '"><bdi>' + esc(timeAgo(r.lastActive)) + '</bdi></td>' +
        '<td>' + (r.pending > 0 ? '<span class="epd-badge-warn">' + r.pending + '</span>' : '<span class="epd-dim">0</span>') + '</td>' +
        '<td><button type="button" class="epd-btn epd-btn-ghost epd-btn-sm" data-emp="' + esc(r.id) + '">View Details</button></td>' +
      '</tr>';
    }).join("");

    setView(head +
      '<div class="epd-tablewrap"><table class="epd-table"><thead><tr>' +
        '<th>Employee</th><th>Status</th><th>Overall Progress</th><th>Current Module</th><th>Current Lesson</th>' +
        '<th>Current Section</th><th>Lessons</th><th>Last Activity</th><th>Pending</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>');
  }

  /* ============================================================
     VIEW 3 — EMPLOYEE DETAILS (Modules → Lessons → Sections → KC/Assignment)
     ============================================================ */
  // Index this employee's events by section_id and by type (fast lookups).
  function buildEventIndex(empId) {
    var idx = { bySection: {}, byLessonType: {} };
    activityFor(empId).forEach(function (e) {
      if (e.section_id) { (idx.bySection[e.section_id] = idx.bySection[e.section_id] || []).push(e); }
      var k = (e.lesson_id || "") + "|" + e.event_type;
      (idx.byLessonType[k] = idx.byLessonType[k] || []).push(e);
    });
    return idx;
  }
  function latest(list) {
    if (!list || !list.length) return null;
    return list.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];
  }

  function deriveSection(part, evIdx) {
    var contentSid = part.id + ":content";
    var kcSid = part.id + ":kc";
    var cEvents = evIdx.bySection[contentSid] || [];
    var opened = cEvents.some(function (e) { return e.event_type === "section_opened"; });
    var completedEv = latest(cEvents.filter(function (e) { return e.event_type === "section_completed"; }));
    var completed = !!completedEv;
    var timeSpent = cEvents.filter(function (e) { return e.event_type === "section_completed"; })
      .reduce(function (a, e) { return a + (Number(e.time_spent) || 0); }, 0);

    var status = completed ? "Completed" : (opened ? "In Progress" : "Not Started");
    var kc = part.knowledgeCheck && (part.knowledgeCheck.question || part.knowledgeCheck.type) ? part.knowledgeCheck : null;
    var kcResultEv = kc ? latest((evIdx.bySection[kcSid] || []).filter(function (e) { return e.event_type === "kc_result"; })) : null;

    return {
      id: part.id, title: partTitle(part), status: status,
      opened: opened, completed: completed, completedAt: completedEv ? completedEv.created_at : null,
      timeSpent: timeSpent, kc: kc, kcResultEv: kcResultEv
    };
  }

  function kcResultChip(sec, resp) {
    // Prefer the reviewed response row; fall back to the auto-graded event.
    if (resp) {
      var rs = String(resp.review_status || "");
      if (/pending|revision/i.test(rs)) return chip(rs || "Pending Review", "prog");
      if (resp.is_correct === true) return chip("Correct", "done");
      if (resp.is_correct === false) return chip("Incorrect", "warn");
      if (rs) return chip(rs, "done");
    }
    if (sec.kcResultEv) {
      var st = sec.kcResultEv.status;
      if (st === "correct") return chip("Correct", "done");
      if (st === "incorrect") return chip("Incorrect", "warn");
      return chip("Submitted", "prog");
    }
    return sec.kc ? chip("Not attempted", "ns") : '';
  }

  function renderKcDetail(sec, resp) {
    if (!sec.kc) return '';
    var kv = function (l, v) { return '<div class="epd-kv"><span class="epd-kv-l">' + esc(l) + '</span><span class="epd-kv-v">' + v + '</span></div>'; };
    var question = (resp && resp.question) || sec.kc.question || sec.kc.scenario || sec.kc.prompt || NA;
    var rtype = (resp && resp.response_type) || sec.kc.type || NA;
    var answer, submittedAt, score, feedback, fileLink;
    if (resp) {
      answer = resp.text_answer ? esc(resp.text_answer)
        : (resp.file_name ? esc(resp.file_name) : (resp.is_correct != null ? (resp.correct_answer ? "Selected option" : "Answered") : NA));
      submittedAt = fmtDateTime(resp.submitted_at);
      score = resp.score ? esc(resp.score) : (resp.is_correct === true ? "100%" : (resp.is_correct === false ? "0%" : NA));
      feedback = resp.feedback ? esc(resp.feedback) : NA;
      var link = resp.file_url || resp.document_url || "";
      fileLink = link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">Open file ↗</a>' : NA;
    } else {
      answer = NA; submittedAt = (sec.kcResultEv ? fmtDateTime(sec.kcResultEv.created_at) : NA);
      score = (sec.kcResultEv && sec.kcResultEv.score) ? esc(sec.kcResultEv.score) : NA; feedback = NA; fileLink = NA;
    }
    return '<div class="epd-sec-kc"><div class="epd-kc-q">🧠 ' + esc(question) + '</div>' +
      '<div class="epd-kc-grid">' +
        kv("Response Type", esc(rtype)) +
        kv("Result", kcResultChip(sec, resp) || NA) +
        kv("Employee Answer", '<span class="epd-kc-ans">' + answer + '</span>') +
        kv("Submitted", esc(submittedAt)) +
        kv("Score", esc(score)) +
        kv("Feedback", feedback) +
        kv("Document / File", fileLink) +
      '</div></div>';
  }

  var SEC_ICON = { "Completed": "✓", "In Progress": "○", "Not Started": "—", "Locked": "🔒" };
  function renderSections(lesson, evIdx, kcByCheck, lessonStarted) {
    var parts = partsOf(lesson);
    if (!parts.length) return '<p class="epd-none">No sections in this lesson.</p>';
    var out = parts.map(function (part) {
      var sec = deriveSection(part, evIdx);
      // A section the employee never reached in a lesson they never started reads as Locked.
      if (sec.status === "Not Started" && !lessonStarted) sec.status = "Locked";
      var resp = sec.kc ? kcByCheck[sec.kc.id] : null;
      var meta = [];
      meta.push(sec.opened ? "Opened" : "Not opened");
      meta.push(sec.completed ? "Completed " + fmtDate(sec.completedAt) : "Not completed");
      if (sec.timeSpent) meta.push("Time: " + fmtDuration(sec.timeSpent));
      if (sec.kc) meta.push("Knowledge Check");
      return '<div class="epd-sec">' +
        '<div class="epd-sec-head"><span class="epd-sec-ico">' + (SEC_ICON[sec.status] || "—") + '</span>' +
          '<span class="epd-sec-main"><span class="epd-sec-title">' + esc(sec.title) + '</span>' +
          '<span class="epd-sec-meta">' + meta.map(esc).join(' · ') + '</span></span>' +
          statusChip(sec.status) + '</div>' +
        renderKcDetail(sec, resp) +
      '</div>';
    }).join("");
    return '<div class="epd-secs">' + out + '</div>';
  }

  function assignmentPanel(lesson, empId) {
    var asg = lesson.assignment;
    if (!asg || !(asg.title || asg.status || asg.instructions)) return '';
    var subs = subsFor(empId).filter(function (s) { return s.lessonId === lesson.id; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    var sub = subs[0];
    var title = asg.title || "Assignment";
    var kv = function (l, v) { return '<div class="epd-kv"><span class="epd-kv-l">' + esc(l) + '</span><span class="epd-kv-v">' + v + '</span></div>'; };

    if (!sub) {
      return '<div class="epd-asg"><div class="epd-asg-top"><span class="epd-asg-title">📎 ' + esc(title) + '</span>' + chip("Not Submitted", "ns") + '</div>' +
        '<p class="epd-none">No submission from this employee yet.</p></div>';
    }
    var link = sub.submissionLink || "";
    var linkHtml = link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">Open submission ↗</a>'
      : (sub.textAnswer ? '<span class="epd-dim">Text answer provided</span>' : NA);
    var rev = sub.status || "Pending Review";
    var revSlug = /needs revision/i.test(rev) ? "warn" : (/pending/i.test(rev) ? "prog" : "done");

    return '<div class="epd-asg" data-sub="' + esc(sub.id) + '">' +
      '<div class="epd-asg-top"><span class="epd-asg-title">📎 ' + esc(sub.assignmentTitle || title) + '</span>' + chip(rev, revSlug) + '</div>' +
      '<div class="epd-asg-grid">' +
        kv("Submitted", esc(fmtDateTime(sub.createdAt))) +
        kv("File / Link", linkHtml) +
        kv("Score", sub.score ? esc(sub.score) : NA) +
        kv("Feedback", sub.feedback ? esc(sub.feedback) : NA) +
      '</div>' +
      '<div class="epd-asg-actions">' +
        '<input type="text" data-asg-score placeholder="Score" style="width:80px" value="' + esc(sub.score || "") + '" />' +
        '<input type="text" data-asg-feedback placeholder="Feedback…" style="min-width:180px;flex:1" value="' + esc(sub.feedback || "") + '" />' +
        '<button type="button" class="epd-btn epd-btn-sm" data-asg-act="reviewed">Mark Reviewed</button>' +
        '<button type="button" class="epd-btn epd-btn-ghost epd-btn-sm" data-asg-act="revision">Needs Revision</button>' +
        '<span class="epd-asg-msg" data-asg-msg></span>' +
      '</div>' +
    '</div>';
  }

  function lessonNode(lesson, empId, evIdx, kcByCheck) {
    var prog = progressFor(empId).find(function (p) { return p.lesson_id === lesson.id; }) || {};
    var lessonStarted = prog.status === "completed" || prog.status === "in-progress";
    var st = prog.status === "completed" ? "Completed" : (prog.status === "in-progress" ? "In Progress" : "Not Started");
    var parts = partsOf(lesson);
    var doneSecs = parts.filter(function (part) { return deriveSection(part, evIdx).completed; }).length;
    var curSection = (empId && lesson.id === (S.rows.find(function (r) { return r.id === empId; }) || {})._p.current_lesson_id)
      ? ((S.rows.find(function (r) { return r.id === empId; }) || {})._p.current_section_title || NA) : NA;
    var asg = lesson.assignment;
    var subForLesson = subsFor(empId).filter(function (s) { return s.lessonId === lesson.id; })[0];
    var asgStatus = !asg || !(asg.title || asg.status) ? "None" : (subForLesson ? (subForLesson.status || "Submitted") : "Not Submitted");

    var okey = empId + "|" + lesson.id;
    var isOpen = !!open.lessons[okey];

    var sub = [
      chip(st, STATUS_SLUG[st]),
      '<span class="epd-dim">' + doneSecs + ' / ' + parts.length + ' sections</span>',
      '<span class="epd-dim">Started ' + esc(fmtDate(prog.started_at)) + '</span>',
      '<span class="epd-dim">Completed ' + esc(fmtDate(prog.completed_at)) + '</span>',
      '<span class="epd-dim">Assignment: ' + esc(asgStatus) + '</span>'
    ].join(' ');

    return '<div class="epd-lnode' + (isOpen ? ' is-open' : '') + '" data-lesson-node="' + esc(okey) + '">' +
      '<div class="epd-lnode-head" data-toggle-lesson="' + esc(okey) + '">' +
        '<span class="epd-caret">▶</span>' +
        '<span class="epd-node-main"><span class="epd-node-title">L' + esc(lesson.lessonNumber || "") + ' — ' + esc(lesson.lessonTitle || "Lesson") + '</span>' +
        '<span class="epd-node-sub">' + sub + '</span></span>' +
      '</div>' +
      '<div class="epd-lnode-body">' +
        (isOpen ? (
          '<div class="epd-kv" style="margin:6px 0 2px"><span class="epd-kv-l">Current Section</span><span class="epd-kv-v">' + esc(curSection) + '</span></div>' +
          renderSections(lesson, evIdx, kcByCheck, lessonStarted) +
          assignmentPanel(lesson, empId)
        ) : '') +
      '</div>' +
    '</div>';
  }

  function moduleNode(mod, empId, evIdx, kcByCheck) {
    var lessons = lessonsOfModule(mod.academyKey, mod.id);
    var prog = progressFor(empId);
    var doneIds = {}; prog.forEach(function (p) { if (p.status === "completed") doneIds[p.lesson_id] = 1; });
    var inProgIds = {}; prog.forEach(function (p) { if (p.status === "in-progress") inProgIds[p.lesson_id] = 1; });
    var total = lessons.length;
    var done = lessons.filter(function (l) { return doneIds[l.id]; }).length;
    var anyStarted = lessons.some(function (l) { return doneIds[l.id] || inProgIds[l.id]; });
    var pct = total ? Math.round(done / total * 100) : 0;
    var isCurrent = empId && mod.id === (S.rows.find(function (r) { return r.id === empId; }) || {})._p.current_module_id;
    var st = total === 0 ? "Not Started" : (done >= total ? "Completed" : ((anyStarted || isCurrent) ? "In Progress" : "Not Started"));
    var lastEv = latest(activityFor(empId).filter(function (e) { return e.module_id === mod.id; }));

    var okey = empId + "|" + mod.id;
    var isOpen = !!open.modules[okey];

    var body = isOpen ? (total ? lessons.map(function (l) { return lessonNode(l, empId, evIdx, kcByCheck); }).join("")
      : '<p class="epd-none">No published lessons in this module.</p>') : '';

    return '<div class="epd-node' + (isOpen ? ' is-open' : '') + '" data-module-node="' + esc(okey) + '">' +
      '<div class="epd-node-head" data-toggle-module="' + esc(okey) + '">' +
        '<span class="epd-caret">▶</span>' +
        '<span class="epd-node-main"><span class="epd-node-title">M' + esc(mod.moduleNumber || "") + ' — ' + esc(mod.moduleTitle || "Module") + ' ' + statusChip(st) + '</span>' +
        '<span class="epd-node-sub"><span>' + done + ' / ' + total + ' lessons</span><span>' + pct + '%</span>' +
          '<span>Last activity: ' + esc(lastEv ? timeAgo(lastEv.created_at) : "Never") + '</span></span></span>' +
        '<span class="epd-node-prog">' + bar(pct, pct >= 100) + '</span>' +
      '</div>' +
      '<div class="epd-node-body">' + body + '</div>' +
    '</div>';
  }

  function renderEmployeeDetail(empId) {
    var r = S.rows.find(function (x) { return x.id === empId; });
    if (!r) { setView(emptyState("🔍", "Employee not found.")); return; }
    var p = r._p;
    var evIdx = buildEventIndex(empId);
    var kcByCheck = {}; kcsFor(empId).forEach(function (k) { if (k.knowledge_check_id) kcByCheck[k.knowledge_check_id] = k; });
    var mods = modulesOf(r.academyKey);

    var kv = function (l, v) { return '<div class="epd-kv"><span class="epd-kv-l">' + esc(l) + '</span><span class="epd-kv-v">' + esc(v) + '</span></div>'; };
    var head = '<div class="epd-emp-head">' +
      '<div class="epd-emp-id"><span class="epd-avatar" style="width:44px;height:44px;font-size:17px">' + esc(initials(r.name)) + '</span>' +
        '<div><h2 class="epd-emp-name">' + esc(r.name) + '</h2>' +
        '<div class="epd-emp-meta">' + esc(r.team) + ' · ' + esc(r.academyName) + ' · ' + statusChip(r.status) + '</div></div></div>' +
      '<div class="epd-emp-grid">' +
        kv("First Seen", fmtDate(r.firstSeen)) +
        kv("Last Active", timeAgo(r.lastActive)) +
        kv("Time in Academy", fmtDuration(r.totalTime)) +
        kv("Current Module", r.currentModule) +
        kv("Current Lesson", r.currentLesson) +
        kv("Current Section", r.currentSection) +
      '</div>' +
      '<div class="epd-emp-overall"><div class="epd-emp-overall-top"><span>Overall Progress</span><span>' + r.overall + '% · ' + r.doneLessons + ' / ' + r.totalLessons + ' lessons</span></div>' +
        bar(r.overall, r.overall >= 100) + '</div>' +
    '</div>';

    var tree = mods.length
      ? '<div class="epd-tree">' + mods.map(function (m) { return moduleNode(m, empId, evIdx, kcByCheck); }).join("") + '</div>'
      : emptyState("📚", "No modules found for this academy.");

    var legend = '<div class="epd-legend">' +
      '<span>✓ Completed</span><span>○ In Progress</span><span>— Not Started</span><span>🔒 Locked</span></div>';

    setView('<div class="epd-view-title"><h2>Learning Profile</h2><span class="epd-sub">' + esc(r.name) + '</span></div>' +
      head +
      sectionCard("Module / Lesson / Section Hierarchy", tree + legend) +
      profileKcHistory(empId) +
      profileAsgHistory(empId) +
      profileTimeline(empId));
  }

  /* ---------------- Learning Profile sections (history + timeline) ---------------- */
  function sectionCard(title, inner) { return '<section class="epd-pcard"><h3 class="epd-pcard-h">' + esc(title) + '</h3>' + inner + '</section>'; }
  function tableWrap(cols, body) {
    return '<div class="epd-tablewrap"><table class="epd-table"><thead><tr>' +
      cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join("") + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function lessonLabel(id) { var l = lessonById(id); return l ? ("L" + (l.lessonNumber || "") + " — " + (l.lessonTitle || "")) : (id || "—"); }
  function kcHistChip(k) {
    var rs = String(k.review_status || "");
    if (/needs revision/i.test(rs)) return chip("Needs Revision", "warn");
    if (/pending/i.test(rs)) return chip("Pending Review", "prog");
    if (k.is_correct === true) return chip("Correct", "done");
    if (k.is_correct === false) return chip("Incorrect", "warn");
    if (/reviewed/i.test(rs)) return chip("Reviewed", "done");
    return chip("Submitted", "prog");
  }

  function profileKcHistory(empId) {
    var list = kcsFor(empId).slice().sort(function (a, b) { return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0); });
    if (!list.length) return sectionCard("Knowledge Check History", '<p class="epd-none">No Knowledge Check submissions yet.</p>');
    var body = list.map(function (k) {
      var score = k.score || (k.is_correct === true ? "100%" : (k.is_correct === false ? "0%" : "—"));
      return '<tr>' +
        '<td>' + esc(stripHtml(k.question || "Knowledge Check").slice(0, 90)) + '</td>' +
        '<td class="epd-dim">' + esc(lessonLabel(k.lesson_id)) + '</td>' +
        '<td>' + kcHistChip(k) + '</td>' +
        '<td>' + esc(score) + '</td>' +
        '<td class="epd-dim">' + esc(k.feedback || "—") + '</td>' +
        '<td class="epd-dim">' + esc(fmtDateTime(k.submitted_at)) + '</td>' +
      '</tr>';
    }).join("");
    return sectionCard("Knowledge Check History (" + list.length + ")",
      tableWrap(["Question", "Lesson", "Result", "Score", "Feedback", "Submitted"], body));
  }

  function profileAsgHistory(empId) {
    var list = subsFor(empId).slice().sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
    if (!list.length) return sectionCard("Assignment History", '<p class="epd-none">No assignment submissions yet.</p>');
    var body = list.map(function (s) {
      var rev = s.status || "Pending Review";
      var slug = /needs revision/i.test(rev) ? "warn" : (/pending/i.test(rev) ? "prog" : "done");
      var link = s.submissionLink || s.file_url || "";
      var linkHtml = link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">Open ↗</a>' : (s.textAnswer ? '<span class="epd-dim">Text</span>' : '<span class="epd-dim">—</span>');
      return '<tr>' +
        '<td>' + esc(s.assignmentTitle || "Assignment") + '</td>' +
        '<td class="epd-dim">' + esc(lessonLabel(s.lessonId)) + '</td>' +
        '<td>' + chip(rev, slug) + '</td>' +
        '<td>' + esc(s.score || "—") + '</td>' +
        '<td class="epd-dim">' + esc(s.feedback || "—") + '</td>' +
        '<td>' + linkHtml + '</td>' +
        '<td class="epd-dim">' + esc(fmtDateTime(s.createdAt)) + '</td>' +
      '</tr>';
    }).join("");
    return sectionCard("Assignment History (" + list.length + ")",
      tableWrap(["Assignment", "Lesson", "Status", "Score", "Feedback", "File / Link", "Submitted"], body));
  }

  /* ---------------- Learning Timeline (meaningful events, real actions only) ----------------
     Merges the real learning journey from three live sources — lesson_activity_log
     (section/module/lesson/academy starts & completions), knowledge_check_responses
     (KC submitted / passed / failed / reviewed) and submissions (assignment
     submitted / reviewed / needs revision). Meaningless pings ("identified", time
     heartbeats) are dropped, duplicates collapsed, and everything is shown newest
     first with Module · Lesson · Section context + score / duration. No fabricated
     events — every entry is a real employee (or manager-review) action. */
  var ACTIVITY_LABEL = {
    academy_entered: "Started Academy", academy_opened: "Started Academy",
    module_opened: "Started Module", lesson_opened: "Started Lesson",
    section_opened: "Started Section", section_completed: "Finished Section",
    kc_started: "Knowledge Check Started", kc_submitted: "Knowledge Check Submitted",
    assignment_started: "Assignment Started", assignment_submitted: "Assignment Submitted",
    lesson_completed: "Lesson Completed", module_completed: "Module Completed", academy_completed: "Academy Completed"
  };
  function tlIcon(label) {
    if (/Passed/.test(label)) return "✅";
    if (/Failed/.test(label)) return "❌";
    if (/Needs Revision/.test(label)) return "⚠️";
    if (/Reviewed/.test(label)) return "📋";
    if (/Academy Completed/.test(label)) return "🎓";
    if (/Module Completed/.test(label)) return "🏁";
    if (/Lesson Completed/.test(label)) return "✅";
    if (/Finished Section/.test(label)) return "✓";
    if (/Started Academy/.test(label)) return "🎓";
    if (/Started Module/.test(label)) return "📦";
    if (/Started Lesson/.test(label)) return "📘";
    if (/Started Section/.test(label)) return "📄";
    if (/Knowledge Check/.test(label)) return "🧠";
    if (/Assignment/.test(label)) return "📝";
    return "•";
  }
  function moduleNameFor(module_id, lesson_id) {
    var m = module_id ? moduleById(module_id) : null;
    if (!m && lesson_id) { var l = lessonById(lesson_id); if (l) m = moduleById(l.moduleId); }
    return m ? ("M" + (m.moduleNumber || "") + " — " + (m.moduleTitle || "")) : "";
  }
  function sectionNameFor(section_id, lesson_id, fallback) {
    if (fallback) return fallback;
    if (!section_id) return "";
    var l = lessonById(lesson_id);
    var partId = String(section_id).split(":")[0], kind = String(section_id).split(":")[1];
    if (l) { try { var p = partsOf(l).find(function (x) { return x.id === partId; }); if (p) { var base = partTitle(p); return kind === "kc" ? (base + " · Knowledge Check") : base; } } catch (e) {} }
    return "";
  }

  function profileTimeline(empId) {
    var ev = [];
    // 1) lesson_activity_log — navigation / completion events. Skip meaningless
    //    pings AND the KC-result / submission echoes (those come from their
    //    authoritative tables below, so nothing is double-counted).
    var SKIP = { identified: 1, time: 1, kc_result: 1, kc_submitted: 1, assignment_submitted: 1 };
    activityFor(empId).forEach(function (e) {
      if (SKIP[e.event_type]) return;
      var label = ACTIVITY_LABEL[e.event_type];
      if (!label) return;
      ev.push({ at: e.created_at, label: label, module_id: e.module_id, lesson_id: e.lesson_id, section_id: e.section_id,
        sectionTitle: e.detail, score: e.score || "", duration: (e.event_type === "section_completed" && e.time_spent) ? fmtDuration(e.time_spent) : "" });
    });
    // 2) knowledge_check_responses — the real KC actions (objective → passed/failed).
    kcsFor(empId).forEach(function (k) {
      var passed = k.is_correct === true, failed = k.is_correct === false;
      var label = passed ? "Knowledge Check Passed" : (failed ? "Knowledge Check Failed" : "Knowledge Check Submitted");
      ev.push({ at: k.submitted_at, label: label, lesson_id: k.lesson_id, section_id: k.section_id || "",
        score: k.score || (passed ? "100%" : (failed ? "0%" : "")) });
      var rs = String(k.review_status || "");
      if (k.reviewed_at && (/reviewed/i.test(rs) || /needs revision/i.test(rs))) {
        ev.push({ at: k.reviewed_at, label: /needs revision/i.test(rs) ? "Knowledge Check Needs Revision" : "Knowledge Check Reviewed", lesson_id: k.lesson_id, score: k.score || "" });
      }
    });
    // 3) submissions — assignment submitted + manager review outcome (real actions).
    subsFor(empId).forEach(function (s) {
      ev.push({ at: s.createdAt, label: "Assignment Submitted", lesson_id: s.lessonId, score: s.score || "" });
      if (s.reviewedAt) {
        var rev = String(s.status || "");
        ev.push({ at: s.reviewedAt, label: /needs revision/i.test(rev) ? "Assignment Needs Revision" : "Assignment Reviewed", lesson_id: s.lessonId, score: s.score || "" });
      }
    });

    // Newest first, then collapse duplicates of the same event on the same target.
    ev.sort(function (a, b) { return new Date(b.at || 0) - new Date(a.at || 0); });
    var seen = {}, out = [];
    ev.forEach(function (e) {
      var key = e.label + "|" + (e.section_id || e.lesson_id || e.module_id || "");
      if (seen[key]) return; seen[key] = 1; out.push(e);
    });
    if (!out.length) return sectionCard("Learning Timeline", '<p class="epd-none">No learning activity recorded yet.</p>');

    var total = out.length;
    var body = out.slice(0, 80).map(function (e) {
      var ctx = [moduleNameFor(e.module_id, e.lesson_id), lessonById(e.lesson_id) ? ("L" + (lessonById(e.lesson_id).lessonNumber || "") + " — " + (lessonById(e.lesson_id).lessonTitle || "")) : "",
        sectionNameFor(e.section_id, e.lesson_id, e.sectionTitle)].filter(Boolean).join("  ·  ");
      var extra = [];
      if (e.score) extra.push("Score " + e.score);
      if (e.duration) extra.push(e.duration);
      return '<div class="epd-tl-item"><span class="epd-tl-ico" aria-hidden="true">' + tlIcon(e.label) + '</span>' +
        '<div class="epd-tl-body"><span class="epd-tl-title">' + esc(e.label) +
          (extra.length ? ' <span class="epd-tl-extra">' + esc(extra.join(" · ")) + '</span>' : '') + '</span>' +
          (ctx ? '<span class="epd-tl-ctx">' + esc(ctx) + '</span>' : '') + '</div>' +
        '<span class="epd-tl-when" title="' + esc(timeAgo(e.at)) + '">' + esc(fmtDateTime(e.at)) + '</span></div>';
    }).join("");
    return sectionCard("Learning Timeline (" + total + ")", '<div class="epd-timeline">' + body +
      (total > 80 ? '<p class="epd-none">Showing the 80 most recent events.</p>' : '') + '</div>');
  }

  /* ============================================================
     Breadcrumbs + view routing
     ============================================================ */
  function crumb(label, action, current) {
    if (current) return '<span class="epd-crumb is-current">' + esc(label) + '</span>';
    return '<button type="button" class="epd-crumb" data-nav="' + action + '">' + esc(label) + '</button>';
  }
  function renderCrumbs() {
    var parts = [crumb("Dashboard", "list", view.name === "list")];
    if (view.name === "teams") parts.push(crumb("Teams", "teams", true));
    if (view.name === "team" || view.name === "employee") {
      parts.push(crumb(view.team || "Team", "team", view.name === "team"));
    }
    if (view.name === "employee") {
      var r = S.rows.find(function (x) { return x.id === view.empId; });
      parts.push(crumb(r ? r.name : "Employee", "employee", true));
    }
    $("epCrumbs").innerHTML = parts.join('<span class="epd-crumb-sep">→</span>');
  }
  function setView(html) { $("epView").innerHTML = html; }
  function emptyState(ico, msg) { return '<div class="epd-empty"><span class="epd-empty-ico">' + ico + '</span>' + esc(msg) + '</div>'; }

  function route() {
    renderCrumbs();
    if (view.name === "team" && view.team) renderTeamDetail(view.team);
    else if (view.name === "employee" && view.empId) renderEmployeeDetail(view.empId);
    else if (view.name === "teams") renderTeams();
    else { view.name = "list"; renderEmployeeList(); }
  }
  function goList() { view = { name: "list", team: null, empId: null }; route(); }
  function goTeams() { view = { name: "teams", team: null, empId: null }; route(); }
  function goTeam(team) { view = { name: "team", team: team, empId: null }; route(); }
  function goEmployee(empId) {
    var r = S.rows.find(function (x) { return x.id === empId; });
    view = { name: "employee", team: (r ? r.team : view.team), empId: empId }; route();
  }

  /* ============================================================
     Assignment review (the only write — admin action from the panel)
     ============================================================ */
  function reviewSubmission(box, action) {
    var subId = box.getAttribute("data-sub");
    var msg = box.querySelector("[data-asg-msg]");
    var score = (box.querySelector("[data-asg-score]") || {}).value || "";
    var feedback = (box.querySelector("[data-asg-feedback]") || {}).value || "";
    var status = action === "revision" ? "Needs Revision" : "Reviewed";
    if (msg) { msg.textContent = "Saving…"; msg.style.color = ""; }
    var patch = { status: status, score: score, feedback: feedback, reviewedAt: new Date().toISOString() };
    SB.updateSubmission(subId, patch).then(function () {
      // Reflect locally so the view + summary update immediately (no reload).
      var s = S.subs.find(function (x) { return x.id === subId; });
      if (s) { s.status = status; s.score = score; s.feedback = feedback; s.reviewedAt = patch.reviewedAt; }
      computeRows(); renderCards();
      if (msg) { msg.textContent = "Saved ✓"; msg.style.color = "var(--epd-ok)"; }
      // Re-render the employee view so the chip/grid refresh.
      if (view.name === "employee") route();
    }).catch(function () {
      if (msg) { msg.textContent = "Save failed — retry"; msg.style.color = "var(--epd-warn)"; }
    });
  }

  /* ============================================================
     Wiring
     ============================================================ */
  function onFilterChange() {
    // Filters must work without reload — just re-render the active view.
    route();
  }
  function wire() {
    ["epSearch", "epTeam", "epAcademy", "epModule", "epStatus", "epProgress"].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener(el.tagName === "INPUT" ? "input" : "change", onFilterChange);
    });
    ["epActiveToday", "epPending"].forEach(function (id) { var el = $(id); if (el) el.addEventListener("change", onFilterChange); });
    var refresh = $("epRefresh"); if (refresh) refresh.addEventListener("click", reload);

    var crumbs = $("epCrumbs");
    crumbs.addEventListener("click", function (e) {
      var b = e.target.closest("[data-nav]"); if (!b) return;
      var nav = b.getAttribute("data-nav");
      if (nav === "list") goList();
      else if (nav === "teams") goTeams();
      else if (nav === "team" && view.team) goTeam(view.team);
    });

    var vroot = $("epView");
    vroot.addEventListener("click", function (e) {
      var t = e.target;
      // View-mode toggle: All Employees ↔ By Team
      var vm = t.closest("[data-viewmode]"); if (vm) { vm.getAttribute("data-viewmode") === "teams" ? goTeams() : goList(); return; }
      // Teams view: View Team
      var teamBtn = t.closest("[data-team]"); if (teamBtn && !teamBtn.disabled) { goTeam(teamBtn.getAttribute("data-team")); return; }
      // Team view: open employee
      var empBtn = t.closest("[data-emp]"); if (empBtn) { goEmployee(empBtn.getAttribute("data-emp")); return; }
      // Module toggle
      var modTog = t.closest("[data-toggle-module]");
      if (modTog) { var mk = modTog.getAttribute("data-toggle-module"); open.modules[mk] = !open.modules[mk]; route(); return; }
      // Lesson toggle
      var lesTog = t.closest("[data-toggle-lesson]");
      if (lesTog) { var lk = lesTog.getAttribute("data-toggle-lesson"); open.lessons[lk] = !open.lessons[lk]; route(); return; }
      // Assignment review actions
      var asgBtn = t.closest("[data-asg-act]");
      if (asgBtn) { var box = asgBtn.closest("[data-sub]"); if (box) reviewSubmission(box, asgBtn.getAttribute("data-asg-act")); return; }
    });
    vroot.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var row = e.target.closest("[data-emp]"); if (row) { e.preventDefault(); goEmployee(row.getAttribute("data-emp")); }
    });
  }

  function reload() {
    setView('<div class="epd-loading">Loading live data from Supabase…</div>');
    loadAll().then(function () {
      computeRows(); renderCards(); populateFilterOptions(); route();
    }).catch(function () {
      setView(emptyState("⚠️", "Could not load data from Supabase. Check the connection and Refresh."));
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!$("epView")) return; // not this page
    if (!isAdmin()) { try { location.replace("learning_path.html"); } catch (e) {} return; }
    if (typeof Identity !== "undefined" && Identity.applyNav) Identity.applyNav();
    wire();
    reload();
  });
})();
