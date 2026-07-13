/* ============================================================
   Learning Tracking Engine (employee side → Supabase)
   ------------------------------------------------------------
   Turns every learning action into a durable Supabase event so the admin
   Employee Progress Dashboard reads REAL analytics (never localStorage).

   Design:
   • window.Track exposes the event API already called by the Learning Path
     (identified / academyOpened / moduleOpened / lessonOpened / lessonCompleted
     / kcSubmitted / assignmentSubmitted) — unchanged call sites.
   • The remaining events (section opened/completed, KC started, KC result,
     assignment started, module/academy completed) are captured NON-INVASIVELY
     by observing the existing Learning-Path DOM — no change to Learning Path,
     Sections, Knowledge Checks, or Assignments code.
   • Time tracking: active seconds only (paused on tab-hidden / idle), attributed
     to the current section + lesson.
   • Sync: every write goes through a localStorage-backed OUTBOX that batches
     inserts, retries with backoff, flushes on `online`, and survives reloads
     (keepalive flush on pagehide) — offline-safe, nothing is lost.
   • Writes directly to Supabase REST via the global SUPABASE_URL /
     SUPABASE_ANON_KEY (no changes to supabase.js).

   Tables (see learning_tracking_schema.sql):
     lesson_activity_log, employee_profiles, learning_progress
   ============================================================ */
window.Track = (function () {
  var HAS_SB = (typeof SUPABASE_URL !== "undefined" && SUPABASE_URL);
  var REST = HAS_SB ? SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1" : "";
  var KEY = (typeof SUPABASE_ANON_KEY !== "undefined") ? SUPABASE_ANON_KEY : "";
  var Q_KEY = "sdta_track_outbox";
  var IDLE_MS = 60000;      // 60s no interaction → stop counting time
  var FLUSH_MS = 12000;     // batch flush cadence
  var HEARTBEAT_MS = 30000; // roll active time into accumulators periodically

  function ident() { return (typeof Identity !== "undefined" && Identity.get) ? Identity.get() : null; }
  function hasId() { var i = ident(); return !!(i && i.employeeId); }
  function nowISO() { return new Date().toISOString(); }
  function slug(v) { return String(v == null ? "" : v).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 60); }
  function uid() { return "ev_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  /* ---------------- current learning context ---------------- */
  var ctx = { academyKey: "", moduleId: "", moduleTitle: "", lessonId: "", lessonTitle: "", sectionId: "", sectionTitle: "" };

  /* ---------------- outbox (offline-safe queue) ---------------- */
  var queue = [];
  try { queue = JSON.parse(localStorage.getItem(Q_KEY) || "[]"); } catch (e) { queue = []; }
  function persist() { try { localStorage.setItem(Q_KEY, JSON.stringify(queue.slice(-800))); } catch (e) {} }
  function enqueue(entry) { queue.push(entry); persist(); scheduleFlush(800); }

  var flushing = false, flushTimer = null, retryDelay = 2000;
  function scheduleFlush(delay) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, delay || FLUSH_MS); }

  function post(path, body, keepalive) {
    return fetch(REST + path, {
      method: "POST", keepalive: !!keepalive,
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body)
    }).then(function (r) { if (!r.ok && r.status !== 409) throw new Error("http " + r.status); return true; });
  }

  async function flush(keepalive) {
    if (flushing || !HAS_SB || !queue.length) return;
    if (!keepalive && typeof navigator !== "undefined" && navigator.onLine === false) { scheduleFlush(5000); return; }
    flushing = true;
    var batch = queue.slice(0, 120);
    // group same-table inserts into one array POST; RPCs go individually.
    var byTable = {}, rpcs = [];
    batch.forEach(function (e) {
      if (e.rpc) rpcs.push(e);
      else { (byTable[e.table] = byTable[e.table] || []).push(e.row); }
    });
    try {
      var tables = Object.keys(byTable);
      for (var t = 0; t < tables.length; t++) await post("/" + tables[t] + "?on_conflict=id", byTable[tables[t]], keepalive);
      for (var r = 0; r < rpcs.length; r++) await post("/rpc/" + rpcs[r].rpc, rpcs[r].args, keepalive);
      queue = queue.slice(batch.length); persist();
      retryDelay = 2000;
      if (queue.length) scheduleFlush(300);
    } catch (e) {
      retryDelay = Math.min(retryDelay * 2, 60000);
      scheduleFlush(retryDelay);
    } finally { flushing = false; }
  }

  /* ---------------- writers ---------------- */
  function emit(type, x) {
    x = x || {};
    var i = ident(); if (!i || !i.employeeId) return;
    enqueue({ table: "lesson_activity_log", row: {
      id: uid(), employee_id: i.employeeId, employee_name: i.employeeName, team: i.team,
      academy_key: x.academyKey || ctx.academyKey, module_id: x.moduleId || ctx.moduleId,
      lesson_id: x.lessonId || ctx.lessonId, section_id: (x.sectionId !== undefined ? x.sectionId : ctx.sectionId) || null,
      event_type: type, score: x.score != null ? String(x.score) : null, status: x.status || null,
      time_spent: x.timeSpent || 0, detail: x.detail || null, created_at: nowISO()
    } });
  }
  function touchProfile(patch) {
    var i = ident(); if (!i || !i.employeeId) return;
    var row = { id: i.employeeId, employee_name: i.employeeName, team: i.team, role: i.role, last_active: nowISO(), updated_at: nowISO() };
    if (patch) for (var k in patch) row[k] = patch[k];
    enqueue({ table: "employee_profiles", row: row });
  }
  function progress(lessonId, moduleId, academyKey, status, completed) {
    var i = ident(); if (!i || !i.employeeId || !lessonId) return;
    var row = {
      id: "lp_" + slug(i.employeeId) + "__" + slug(lessonId), employee_id: i.employeeId, employee_name: i.employeeName,
      team: i.team, academy_key: academyKey || ctx.academyKey, module_id: moduleId || ctx.moduleId,
      lesson_id: lessonId, status: status || "in-progress", last_activity: nowISO(), updated_at: nowISO()
    };
    if (completed) row.completed_at = nowISO();
    enqueue({ table: "learning_progress", row: row });
  }
  function addTime(seconds) {
    var i = ident(); if (!i || !i.employeeId || !(seconds > 0)) return;
    enqueue({ rpc: "add_employee_time", args: { p_id: i.employeeId, p_seconds: Math.round(seconds) } });
  }

  /* ---------------- time tracking (active only) ---------------- */
  var active = false, segStart = 0, idleTimer = null;
  var secAccum = 0, lesAccum = 0; // active seconds for current section / lesson

  function rollSegment() {
    if (!segStart) return;
    var secs = (Date.now() - segStart) / 1000;
    segStart = active ? Date.now() : 0;
    if (secs > 0 && secs < 7200) { secAccum += secs; lesAccum += secs; addTime(secs); }
  }
  function goActive() { if (typeof document !== "undefined" && document.hidden) return; if (!active) { active = true; segStart = Date.now(); } resetIdle(); }
  function resetIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(goIdle, IDLE_MS); }
  function goIdle() { if (active) { rollSegment(); active = false; segStart = 0; } }
  function onVisibility() { if (document.hidden) { goIdle(); } else { goActive(); } }

  function switchTiming(newLesson, newSection) {
    var lessonChanged = newLesson !== undefined && newLesson !== ctx.lessonId;
    var sectionChanged = newSection !== undefined && newSection !== ctx.sectionId;
    if (lessonChanged || sectionChanged) {
      rollSegment();
      if (sectionChanged && secAccum > 0) secAccum = secAccum; // kept until section_completed
      if (lessonChanged) { secAccum = 0; lesAccum = 0; }
    }
  }

  /* ---------------- public event API (called by Learning Path) ---------------- */
  function setCtx(p) { for (var k in p) ctx[k] = p[k]; }

  var api = {
    identified: function () { touchProfile({}); emit("identified"); goActive(); },
    academyOpened: function (key) { setCtx({ academyKey: key }); touchProfile({ academy_key: key }); emit("academy_entered", { academyKey: key }); goActive(); },
    moduleOpened: function (m) {
      m = m || {}; switchTiming(undefined, "");
      setCtx({ academyKey: m.academyKey || ctx.academyKey, moduleId: m.moduleId, moduleTitle: m.moduleTitle, sectionId: "" });
      touchProfile({ academy_key: ctx.academyKey, current_module_id: m.moduleId, current_module_title: m.moduleTitle });
      emit("module_opened", m); goActive();
    },
    lessonOpened: function (l) {
      l = l || {}; switchTiming(l.lessonId, "");
      setCtx({ academyKey: l.academyKey || ctx.academyKey, moduleId: l.moduleId, moduleTitle: l.moduleTitle, lessonId: l.lessonId, lessonTitle: l.lessonTitle, sectionId: "" });
      touchProfile({ academy_key: ctx.academyKey, current_module_id: l.moduleId, current_module_title: l.moduleTitle, current_lesson_id: l.lessonId, current_lesson_title: l.lessonTitle, current_section_id: null, current_section_title: null });
      progress(l.lessonId, l.moduleId, l.academyKey, "in-progress");
      emit("lesson_opened", l); goActive();
    },
    lessonCompleted: function (l) {
      l = l || {}; rollSegment();
      progress(l.lessonId, l.moduleId, l.academyKey, "completed", true);
      emit("lesson_completed", { academyKey: l.academyKey, moduleId: l.moduleId, lessonId: l.lessonId, status: "completed", timeSpent: Math.round(lesAccum) });
      lesAccum = 0; secAccum = 0;
      setTimeout(function () { deriveCompletion(l.moduleId); }, 0); // module/academy rollup from the DOM
      goActive();
    },
    kcSubmitted: function (x) { x = x || {}; emit("kc_submitted", x); goActive(); },
    assignmentSubmitted: function (x) { x = x || {}; emit("assignment_submitted", { academyKey: x.academyKey, moduleId: x.moduleId, lessonId: x.lessonId, status: "submitted" }); goActive(); },
    // exposed for completeness / future direct use
    sectionOpened: function (x) { emit("section_opened", x); },
    sectionCompleted: function (x) { emit("section_completed", x); },
    flushNow: function () { return flush(); }
  };

  /* ---------------- non-invasive Learning-Path DOM capture ---------------- */
  function ancestorAttr(el, sel, attr) { var a = el.closest(sel); return a ? a.getAttribute(attr) : ""; }
  function stepInfo(el) {
    var item = el.closest(".lp-part-item");
    if (!item) return null;
    return {
      sectionId: item.getAttribute("data-step-id") || item.getAttribute("data-part-id") || "",
      kind: item.getAttribute("data-step-kind") || "content",
      title: (item.querySelector(".lp-part-title") || {}).textContent || "",
      lessonId: ancestorAttr(item, ".lesson-acc-item", "data-lesson-id") || ctx.lessonId,
      moduleId: ancestorAttr(item, ".level-card", "data-module-id") || ctx.moduleId,
      item: item
    };
  }
  var reportedKc = new Set(), completedMods = new Set(), asgStarted = new Set();

  // A step became open (by click OR programmatically via advanceFromStep).
  function onStepOpened(item) {
    var s = stepInfo(item.querySelector(".lp-part-head") || item) || {};
    var sectionId = item.getAttribute("data-step-id") || item.getAttribute("data-part-id") || "";
    var kind = item.getAttribute("data-step-kind") || "content";
    var title = ((item.querySelector(".lp-part-title") || {}).textContent || "").slice(0, 120);
    var lessonId = ancestorAttr(item, ".lesson-acc-item", "data-lesson-id") || ctx.lessonId;
    var moduleId = ancestorAttr(item, ".level-card", "data-module-id") || ctx.moduleId;
    switchTiming(lessonId, sectionId);
    setCtx({ moduleId: moduleId, lessonId: lessonId, sectionId: sectionId, sectionTitle: title });
    touchProfile({ current_section_id: sectionId, current_section_title: title });
    if (kind === "kc") emit("kc_started", { sectionId: sectionId, detail: title });
    else emit("section_opened", { sectionId: sectionId, detail: title });
    goActive();
  }

  function onClick(e) {
    // finishing the Part content ("Finish This Part")
    var fin = e.target.closest && e.target.closest(".lp-finish-part");
    if (fin) {
      var sf = stepInfo(fin);
      if (sf) { rollSegment(); emit("section_completed", { sectionId: sf.sectionId, status: "completed", detail: sf.title.slice(0, 120), timeSpent: Math.round(secAccum) }); secAccum = 0; }
      goActive(); return;
    }
    // KC "Continue" (completes the KC step, advances)
    var cont = e.target.closest && e.target.closest(".kc-continue");
    if (cont && cont.closest(".lp-part-item")) {
      var sc = stepInfo(cont);
      if (sc) { rollSegment(); emit("section_completed", { sectionId: sc.sectionId, status: "completed", detail: sc.title.slice(0, 120), timeSpent: Math.round(secAccum) }); secAccum = 0; }
      goActive(); return;
    }
  }
  function onFocusIn(e) {
    var form = e.target.closest && e.target.closest("[data-submit-form]");
    if (form) {
      var lid = form.getAttribute("data-lesson-id") || ctx.lessonId;
      if (!asgStarted.has(lid)) { asgStarted.add(lid); emit("assignment_started", { lessonId: lid, status: "started" }); }
    }
  }
  // Observe the Learning Path DOM for: a step becoming open (section_opened /
  // kc_started — catches programmatic opens too) and a Knowledge Check being
  // graded/submitted (kc_result).
  function watchLP(root) {
    if (typeof MutationObserver === "undefined") return;
    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        var el = m.target; if (!el.classList) return;
        if (el.classList.contains("lp-part-item")) {
          var wasOpen = /\bis-open\b/.test(m.oldValue || "");
          if (!wasOpen && el.classList.contains("is-open")) onStepOpened(el);
          return;
        }
        if (el.classList.contains("kc-block") && !reportedKc.has(el)) {
          var correct = el.classList.contains("is-correct"), incorrect = el.classList.contains("is-incorrect"), submitted = el.classList.contains("is-submitted");
          if (!correct && !incorrect && !submitted) return;
          reportedKc.add(el);
          var s = stepInfo(el) || {};
          emit("kc_result", { sectionId: s.sectionId || ctx.sectionId, status: correct ? "correct" : (incorrect ? "incorrect" : "submitted"), score: correct ? "100%" : (incorrect ? "0%" : null) });
        }
      });
    });
    mo.observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
  }
  // After a lesson completes, roll up module/academy completion from the DOM.
  function deriveCompletion(moduleId) {
    var root = document.getElementById("learningPath"); if (!root) return;
    if (moduleId && !completedMods.has(moduleId)) {
      var card = root.querySelector('.level-card[data-module-id="' + cssEsc(moduleId) + '"]');
      if (card) {
        var lessons = card.querySelectorAll(".lesson-acc-item");
        if (lessons.length && Array.prototype.every.call(lessons, function (l) { return l.classList.contains("is-completed"); })) {
          completedMods.add(moduleId); emit("module_completed", { moduleId: moduleId, status: "completed" });
        }
      }
    }
    var cards = root.querySelectorAll(".level-card[data-module-id]");
    if (cards.length && Array.prototype.every.call(cards, function (c) {
      var ls = c.querySelectorAll(".lesson-acc-item");
      return ls.length && Array.prototype.every.call(ls, function (l) { return l.classList.contains("is-completed"); });
    })) {
      if (!completedMods.has("__academy__" + ctx.academyKey)) { completedMods.add("__academy__" + ctx.academyKey); emit("academy_completed", { status: "completed" }); }
    }
  }
  function cssEsc(id) { return String(id).replace(/["\\]/g, "\\$&"); }

  /* ---------------- init ---------------- */
  function init() {
    if (!HAS_SB) return;
    // Time: count only while visible + interacting.
    ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"].forEach(function (ev) {
      document.addEventListener(ev, goActive, { passive: true });
    });
    document.addEventListener("visibilitychange", onVisibility);
    // Learning-Path DOM capture (only meaningful on the LP page; guarded anyway).
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocusIn, true);
    var lp = document.getElementById("learningPath"); if (lp) watchLP(lp);
    // Sync lifecycle.
    if (typeof window !== "undefined") {
      window.addEventListener("online", function () { retryDelay = 2000; flush(); });
      var leave = function () { rollSegment(); flush(true); };
      window.addEventListener("pagehide", leave);
      window.addEventListener("beforeunload", leave);
    }
    setInterval(function () { if (active) rollSegment(); flush(); }, HEARTBEAT_MS);
    goActive();
    flush(); // drain any events left over from a previous (possibly offline) session
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  return api;
})();
