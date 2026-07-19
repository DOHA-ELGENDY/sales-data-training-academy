/* ============================================================
   Learning Dashboard — real management overview (admin only, read-only)
   ------------------------------------------------------------
   Org-wide manager view built LIVE from Supabase (read-only — no writes, no
   business-logic changes). Sections: Academy Overview, Team Progress, Attention
   Required, Recent Activity, Learning Analytics.
   Sources: employee_profiles, learning_progress, knowledge_check_responses,
   submissions, lesson_activity_log, modules, lessons.
   ============================================================ */
(function () {
  "use strict";

  var S = { profiles: [], progress: [], kcs: [], subs: [], activity: [], modules: [], lessons: [], rows: [] };
  var INACTIVE_DAYS = 7;
  var NA = "Not available";

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
  function fmtDateTime(iso) { if (!iso) return NA; try { return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return NA; } }
  function timeAgo(iso) {
    if (!iso) return "Never";
    var mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "Just now"; if (mins < 60) return Math.round(mins) + "m ago";
    if (mins < 1440) return Math.round(mins / 60) + "h ago"; var d = Math.round(mins / 1440); return d + (d === 1 ? " day ago" : " days ago");
  }
  function fmtDur(sec) { sec = Number(sec) || 0; if (sec <= 0) return "0m"; var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); if (h) return h + "h " + m + "m"; if (m) return m + "m"; return Math.round(sec) + "s"; }
  function stripHtml(v) { var t = String(v == null ? "" : v); if (t.indexOf("<") < 0 && t.indexOf("&") < 0) return t; return t.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim(); }
  function bar(pct) { pct = Math.max(0, Math.min(100, Math.round(pct || 0))); return '<div class="ld-bar' + (pct >= 100 ? " is-done" : "") + '"><span style="width:' + pct + '%"></span></div>'; }
  function initials(n) { return (String(n || "?").trim()[0] || "?").toUpperCase(); }

  /* ---------- data ---------- */
  function fetchActivity() {
    try {
      if (typeof SUPABASE_URL === "undefined" || !SUPABASE_URL) return Promise.resolve([]);
      var url = SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/lesson_activity_log?select=*&order=created_at.desc&limit=10000";
      return fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY } })
        .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    } catch (e) { return Promise.resolve([]); }
  }
  function safe(p) { return p.then(function (v) { return Array.isArray(v) ? v : []; }).catch(function () { return []; }); }
  function loadAll() {
    return Promise.all([
      safe(SB.fetchProfiles()), safe(SB.fetchProgress()), safe(SB.fetchKcResponses()),
      safe(SB.fetchSubmissions()), safe(SB.fetchModules()), safe(SB.fetchLessons()), safe(fetchActivity())
    ]).then(function (r) {
      S.profiles = (r[0] || []).filter(function (p) { return p && (p.role || "") !== "admin"; });
      S.progress = r[1] || []; S.kcs = r[2] || []; S.subs = r[3] || [];
      S.modules = r[4] || []; S.lessons = r[5] || []; S.activity = r[6] || [];
      computeRows();
    });
  }
  function pubLessons(academy) { return S.lessons.filter(function (l) { return l && l.academyKey === academy && l.status === "Published"; }); }
  function moduleById(id) { return S.modules.find(function (m) { return m.id === id; }); }
  function lessonById(id) { return S.lessons.find(function (l) { return l.id === id; }); }
  function progressFor(id) { return S.progress.filter(function (p) { return p.employee_id === id; }); }
  function subsFor(id) { return S.subs.filter(function (s) { return s.employeeId === id; }); }
  function activityFor(id) { return S.activity.filter(function (a) { return a.employee_id === id; }); }
  function isPending(x) { return /pending|revision/i.test(String(x.status || x.review_status || "")); }

  function computeRows() {
    S.rows = S.profiles.map(function (p) {
      var academy = p.academy_key || "";
      var prog = progressFor(p.id);
      var pub = pubLessons(academy); var total = pub.length;
      var pubIds = {}; pub.forEach(function (l) { pubIds[l.id] = 1; });
      var done = prog.filter(function (pr) { return pr.status === "completed" && (pubIds[pr.lesson_id] || total === 0); }).length;
      var overall = total ? Math.round((done / total) * 100) : (done ? 100 : 0);
      var started = prog.length > 0 || activityFor(p.id).length > 0;
      var status = !started ? "Not Started" : (total > 0 && done >= total ? "Completed" : (daysSince(p.last_active) > INACTIVE_DAYS ? "Inactive" : "In Progress"));
      return { id: p.id, name: p.employee_name || NA, team: p.team || "—", overall: overall,
        started: started, status: status, lastActive: p.last_active, totalTime: p.total_time_seconds || 0, _p: p };
    });
  }
  function kcPct(k) { if (k.is_correct === true) return 100; if (k.is_correct === false) return 0; var m = String(k.score || "").match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : null; }

  /* ---------- 1) Academy Overview ---------- */
  function renderOverview() {
    var rows = S.rows;
    var activeToday = rows.filter(function (r) { return isToday(r.lastActive); }).length;
    var learning = rows.filter(function (r) { return r.status === "In Progress"; }).length;
    var pendingSubs = S.subs.filter(isPending).length;
    var pendingKc = S.kcs.filter(function (k) { return isPending(k); }).length;
    var avgProg = rows.length ? Math.round(rows.reduce(function (a, r) { return a + r.overall; }, 0) / rows.length) : 0;
    var kcScores = S.kcs.map(kcPct).filter(function (v) { return v != null; });
    var avgKc = kcScores.length ? Math.round(kcScores.reduce(function (a, b) { return a + b; }, 0) / kcScores.length) : null;

    var cards = [
      { l: "Active Employees Today", v: activeToday, ico: "🟢" },
      { l: "Currently Learning", v: learning, ico: "📖" },
      { l: "Pending Reviews", v: pendingSubs + pendingKc, ico: "📋", warn: (pendingSubs + pendingKc) > 0 },
      { l: "Assignments Waiting", v: pendingSubs, ico: "📝", warn: pendingSubs > 0 },
      { l: "Average Progress", v: avgProg + "%", ico: "📈" },
      { l: "Average KC Score", v: (avgKc == null ? "—" : avgKc + "%"), ico: "🎯" }
    ];
    $("ldOverview").innerHTML = cards.map(function (c) {
      return '<div class="ld-card' + (c.warn ? " is-warn" : "") + '"><span class="ld-card-ico" aria-hidden="true">' + c.ico + '</span>' +
        '<span class="ld-card-v">' + esc(c.v) + '</span><span class="ld-card-l">' + esc(c.l) + '</span></div>';
    }).join("");
    var foot = $("ldFoot"); if (foot) foot.textContent = rows.length + " employees";
  }

  /* ---------- 2) Team Progress ---------- */
  function renderTeams() {
    var teams = Array.from(new Set(S.rows.map(function (r) { return r.team; }).filter(function (t) { return t && t !== "—"; }))).sort();
    if (!teams.length) { $("ldTeams").innerHTML = empty("🏷️", "No team data yet."); return; }
    $("ldTeams").innerHTML = teams.map(function (t) {
      var emps = S.rows.filter(function (r) { return r.team === t; });
      var avg = emps.length ? Math.round(emps.reduce(function (a, r) { return a + r.overall; }, 0) / emps.length) : 0;
      var done = emps.filter(function (r) { return r.status === "Completed"; }).length;
      return '<div class="ld-team"><div class="ld-team-top"><span class="ld-team-name">' + esc(t) + '</span>' +
        '<span class="ld-team-meta">' + emps.length + ' employees · ' + done + ' completed</span></div>' +
        '<div class="ld-team-bar">' + bar(avg) + '<span class="ld-team-pct">' + avg + '%</span></div></div>';
    }).join("");
  }

  /* ---------- 3) Attention Required ---------- */
  function renderAttention() {
    var items = [];
    S.rows.forEach(function (r) {
      if (r.started && r.status !== "Completed" && daysSince(r.lastActive) > INACTIVE_DAYS) {
        items.push({ ico: "😴", who: r.name, team: r.team, what: "Inactive for " + Math.round(daysSince(r.lastActive)) + " days", slug: "warn" });
      }
    });
    S.subs.filter(isPending).forEach(function (s) {
      items.push({ ico: "📋", who: s.employeeName || NA, team: s.team || "", what: (/revision/i.test(s.status) ? "Assignment needs revision" : "Assignment pending review") + (s.assignmentTitle ? " — " + stripHtml(s.assignmentTitle) : ""), slug: "prog" });
    });
    var failedByEmp = {};
    S.kcs.filter(function (k) { return k.is_correct === false; }).forEach(function (k) { failedByEmp[k.employee_id] = (failedByEmp[k.employee_id] || 0) + 1; });
    Object.keys(failedByEmp).forEach(function (eid) {
      var r = S.rows.find(function (x) { return x.id === eid; }); if (!r) return;
      items.push({ ico: "❌", who: r.name, team: r.team, what: failedByEmp[eid] + " failed Knowledge Check" + (failedByEmp[eid] > 1 ? "s" : ""), slug: "warn" });
    });
    if (!items.length) { $("ldAttention").innerHTML = '<div class="ld-ok">✓ Nothing needs attention right now.</div>'; return; }
    $("ldAttention").innerHTML = items.slice(0, 30).map(function (i) {
      return '<div class="ld-att"><span class="ld-att-ico" aria-hidden="true">' + i.ico + '</span>' +
        '<span class="ld-att-main"><span class="ld-att-who">' + esc(i.who) + (i.team ? ' <span class="ld-att-team">· ' + esc(i.team) + '</span>' : '') + '</span>' +
        '<span class="ld-att-what">' + esc(i.what) + '</span></span>' +
        '<span class="ld-chip ld-chip-' + i.slug + '">Attention</span></div>';
    }).join("");
  }

  /* ---------- 4) Recent Activity ---------- */
  function nameOf(eid, fallback) { var r = S.rows.find(function (x) { return x.id === eid; }); return r ? r.name : (fallback || NA); }
  function renderActivity() {
    var ev = [];
    var LABEL = { section_completed: "completed a section", lesson_completed: "completed a lesson", module_completed: "completed a module", academy_completed: "completed the academy", assignment_submitted: "submitted an assignment", assignment_started: "started an assignment", module_opened: "started a module", lesson_opened: "started a lesson" };
    S.activity.forEach(function (a) {
      if (a.event_type === "identified" || a.event_type === "time") return;
      var lbl = a.event_type === "kc_result" ? (a.status === "correct" ? "passed a Knowledge Check" : (a.status === "incorrect" ? "failed a Knowledge Check" : "submitted a Knowledge Check")) : LABEL[a.event_type];
      if (!lbl) return;
      var les = a.lesson_id ? lessonById(a.lesson_id) : null;
      ev.push({ at: a.created_at, who: nameOf(a.employee_id, a.employee_name), verb: lbl, ctx: les ? ("L" + (les.lessonNumber || "") + " — " + (les.lessonTitle || "")) : "" });
    });
    S.kcs.forEach(function (k) {
      var lbl = k.is_correct === true ? "passed a Knowledge Check" : (k.is_correct === false ? "failed a Knowledge Check" : "submitted a Knowledge Check");
      var les = lessonById(k.lesson_id);
      ev.push({ at: k.submitted_at, who: nameOf(k.employee_id, k.employee_name), verb: lbl, ctx: les ? (les.lessonTitle || "") : "" });
    });
    S.subs.forEach(function (s) {
      var les = lessonById(s.lessonId);
      ev.push({ at: s.createdAt, who: nameOf(s.employeeId, s.employeeName), verb: "submitted an assignment", ctx: (s.assignmentTitle ? stripHtml(s.assignmentTitle) : (les ? les.lessonTitle : "")) });
    });
    ev.sort(function (a, b) { return new Date(b.at || 0) - new Date(a.at || 0); });
    var seen = {}, out = [];
    ev.forEach(function (e) { var k = e.who + "|" + e.verb + "|" + e.ctx; if (seen[k]) return; seen[k] = 1; out.push(e); });
    if (!out.length) { $("ldActivity").innerHTML = empty("🗒️", "No recent learning activity yet."); return; }
    $("ldActivity").innerHTML = '<div class="ld-feed">' + out.slice(0, 18).map(function (e) {
      return '<div class="ld-feed-item"><span class="ld-avatar" aria-hidden="true">' + esc(initials(e.who)) + '</span>' +
        '<span class="ld-feed-main"><span class="ld-feed-text"><strong>' + esc(e.who) + '</strong> ' + esc(e.verb) + (e.ctx ? ' <span class="ld-feed-ctx">· ' + esc(e.ctx) + '</span>' : '') + '</span></span>' +
        '<span class="ld-feed-when" title="' + esc(fmtDateTime(e.at)) + '">' + esc(timeAgo(e.at)) + '</span></div>';
    }).join("") + '</div>';
  }

  /* ---------- 5) Learning Analytics ---------- */
  function renderAnalytics() {
    var lessonsToday = S.activity.filter(function (a) { return a.event_type === "lesson_completed" && isToday(a.created_at); }).length
      || S.progress.filter(function (p) { return p.status === "completed" && isToday(p.completed_at); }).length;
    var kcPassedToday = S.kcs.filter(function (k) { return k.is_correct === true && isToday(k.submitted_at); }).length;
    var asgToday = S.subs.filter(function (s) { return isToday(s.createdAt); }).length;
    var times = S.rows.filter(function (r) { return r.started && r.totalTime > 0; }).map(function (r) { return r.totalTime; });
    var avgTime = times.length ? Math.round(times.reduce(function (a, b) { return a + b; }, 0) / times.length) : 0;

    var cards = [
      { l: "Lessons Completed Today", v: lessonsToday, ico: "✅" },
      { l: "Knowledge Checks Passed", v: kcPassedToday, ico: "🎯" },
      { l: "Assignments Submitted", v: asgToday, ico: "📤" },
      { l: "Average Time Spent", v: avgTime ? fmtDur(avgTime) : "—", ico: "🕐" }
    ];
    $("ldAnalytics").innerHTML = cards.map(function (c) {
      return '<div class="ld-card"><span class="ld-card-ico" aria-hidden="true">' + c.ico + '</span>' +
        '<span class="ld-card-v">' + esc(c.v) + '</span><span class="ld-card-l">' + esc(c.l) + '</span></div>';
    }).join("");
  }

  function empty(ico, msg) { return '<div class="ld-empty"><span class="ld-empty-ico">' + ico + '</span>' + esc(msg) + '</div>'; }

  function renderAll() { renderOverview(); renderTeams(); renderAttention(); renderActivity(); renderAnalytics(); }

  function reload() {
    ["ldOverview", "ldTeams", "ldAttention", "ldActivity", "ldAnalytics"].forEach(function (id) { var el = $(id); if (el) el.innerHTML = '<div class="ld-skel"></div><div class="ld-skel"></div>'; });
    loadAll().then(renderAll).catch(function () { var o = $("ldOverview"); if (o) o.innerHTML = empty("⚠️", "Could not load data from Supabase. Check the connection and Refresh."); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!$("ldOverview")) return;
    if (!isAdmin()) { try { location.replace("learning_path.html"); } catch (e) {} return; }
    if (typeof Identity !== "undefined" && Identity.applyNav) Identity.applyNav();
    var rf = $("ldRefresh"); if (rf) rf.addEventListener("click", reload);
    reload();
  });
})();
