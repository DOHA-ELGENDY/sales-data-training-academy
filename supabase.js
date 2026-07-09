/* ============================================================
   Supabase API layer (production backend)
   ------------------------------------------------------------
   Talks to Supabase over its auto-generated REST API (PostgREST)
   with plain fetch — no SDK, no build step, works on Render as a
   static site. Exposes window.SB with content CRUD + submissions.

   1) Create a Supabase project.
   2) Run supabase_schema.sql in the SQL editor (tables + RLS + seed).
   3) Project Settings ▸ API → copy the Project URL and the anon key
      into the two constants below.
   Setup details: SUPABASE_BACKEND.md
   ============================================================ */
const SUPABASE_URL = "https://vdbbwhymywlndhvxzels.supabase.co";       // e.g. "https://abcdxyz.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_yB_VEN5Qo1LlkkqqjEkc8Q_cEUmHPGj";  // the project's public "anon" key

window.SB = (function () {
  var REST = SUPABASE_URL ? SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1" : "";

  function enabled() { return !!(SUPABASE_URL && SUPABASE_ANON_KEY); }
  function enc(v) { return encodeURIComponent(v); }
  function s(v) { return (v === 0 || v) ? String(v) : ""; }
  function headers(extra) {
    var h = {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  async function req(path, opts) {
    var res = await fetch(REST + path, opts);
    if (!res.ok) {
      var t = "";
      try { t = await res.text(); } catch (e) {}
      throw new Error("Supabase " + res.status + " " + t);
    }
    return res;
  }

  /* ---------- Row <-> app-object mappers ---------- */
  function moduleToRow(m) {
    return {
      id: s(m.id),
      academy_key: s(m.academyKey),
      module_number: s(m.moduleNumber),
      module_title: s(m.moduleTitle),
      short_desc: s(m.shortDesc),
      objectives: Array.isArray(m.objectives) ? m.objectives : [],
      study_time: s(m.studyTime),
      difficulty: s(m.difficulty),
      prerequisites: s(m.prerequisites),
      status: s(m.status) || "Draft",
      updated_at: m.updatedAt || new Date().toISOString()
    };
  }
  function moduleFromRow(r) {
    return {
      id: r.id, academyKey: r.academy_key, moduleNumber: r.module_number,
      moduleTitle: r.module_title, shortDesc: r.short_desc,
      objectives: Array.isArray(r.objectives) ? r.objectives : [],
      studyTime: r.study_time, difficulty: r.difficulty,
      prerequisites: r.prerequisites, status: r.status || "Draft",
      updatedAt: r.updated_at
    };
  }
  function lessonToRow(l) {
    var order = (l.order === 0 || (l.order != null && l.order !== "")) ? Number(l.order) : null;
    return {
      id: s(l.id),
      academy_key: s(l.academyKey),
      module_id: s(l.moduleId),
      module_number: s(l.moduleNumber),
      lesson_number: s(l.lessonNumber),
      lesson_title: s(l.lessonTitle),
      content_type: s(l.contentType),
      content_body: s(l.contentBody),
      status: s(l.status) || "Draft",
      sort_order: order,
      assignment: l.assignment || null,
      activities: Array.isArray(l.activities) ? l.activities : [],
      updated_at: l.updatedAt || new Date().toISOString()
    };
  }
  function lessonFromRow(r) {
    return {
      id: r.id, academyKey: r.academy_key, moduleId: r.module_id,
      moduleNumber: r.module_number, lessonNumber: r.lesson_number,
      lessonTitle: r.lesson_title, contentType: r.content_type,
      contentBody: r.content_body, status: r.status || "Draft",
      order: (r.sort_order === null || r.sort_order === undefined) ? "" : r.sort_order,
      assignment: r.assignment || null,
      activities: Array.isArray(r.activities) ? r.activities : [],
      updatedAt: r.updated_at
    };
  }

  var UPSERT = { "Prefer": "resolution=merge-duplicates,return=minimal" };
  var MINIMAL = { "Prefer": "return=minimal" };

  /* ---------- Content CRUD ---------- */
  async function fetchModules() {
    var res = await req("/modules?select=*", { headers: headers() });
    return (await res.json()).map(moduleFromRow);
  }
  async function fetchLessons() {
    var res = await req("/lessons?select=*", { headers: headers() });
    return (await res.json()).map(lessonFromRow);
  }
  async function upsertModule(m) {
    await req("/modules?on_conflict=id", { method: "POST", headers: headers(UPSERT), body: JSON.stringify(moduleToRow(m)) });
    return true;
  }
  async function upsertLesson(l) {
    await req("/lessons?on_conflict=id", { method: "POST", headers: headers(UPSERT), body: JSON.stringify(lessonToRow(l)) });
    return true;
  }
  async function deleteModule(id) {
    await req("/lessons?module_id=eq." + enc(id), { method: "DELETE", headers: headers(MINIMAL) }); // cascade
    await req("/modules?id=eq." + enc(id), { method: "DELETE", headers: headers(MINIMAL) });
    return true;
  }
  async function deleteLesson(id) {
    await req("/lessons?id=eq." + enc(id), { method: "DELETE", headers: headers(MINIMAL) });
    return true;
  }
  async function bulkUpsert(modules, lessons) {
    if (modules && modules.length) {
      await req("/modules?on_conflict=id", { method: "POST", headers: headers(UPSERT), body: JSON.stringify(modules.map(moduleToRow)) });
    }
    if (lessons && lessons.length) {
      await req("/lessons?on_conflict=id", { method: "POST", headers: headers(UPSERT), body: JSON.stringify(lessons.map(lessonToRow)) });
    }
    return true;
  }

  /* ---------- Assignment submissions ---------- */
  async function insertSubmission(sub) {
    await req("/submissions", {
      method: "POST", headers: headers(MINIMAL),
      body: JSON.stringify({
        employee_name: s(sub.employeeName),
        assignment_id: s(sub.assignmentId),
        submission_link: s(sub.submissionLink),
        notes: s(sub.notes),
        status: "Pending Review"
      })
    });
    return true;
  }

  /* ---------- Connection test ---------- */
  async function ping() {
    if (!enabled()) return false;
    try {
      var res = await fetch(REST + "/academies?select=key&limit=1", { headers: headers() });
      return res.ok;
    } catch (e) { return false; }
  }

  return {
    enabled: enabled, ping: ping,
    fetchModules: fetchModules, fetchLessons: fetchLessons,
    upsertModule: upsertModule, upsertLesson: upsertLesson,
    deleteModule: deleteModule, deleteLesson: deleteLesson,
    bulkUpsert: bulkUpsert, insertSubmission: insertSubmission,
    moduleFromRow: moduleFromRow, lessonFromRow: lessonFromRow
  };
})();

/* ------------------------------------------------------------
   Debug connection indicator — shows "Connected to Supabase"
   (green) when the REST API answers on startup, otherwise
   "Offline Mode" (grey). Debug aid only; remove any time.
   ------------------------------------------------------------ */
(function () {
  if (typeof window === "undefined" || !window.addEventListener) return;
  function show(connected) {
    if (typeof document === "undefined" || !document.body) return;
    var el = document.getElementById("sbStatus");
    if (!el) {
      el = document.createElement("div");
      el.id = "sbStatus";
      el.style.cssText =
        "position:fixed;bottom:12px;left:12px;z-index:99999;" +
        "font:600 12px/1 system-ui,Segoe UI,sans-serif;padding:7px 12px;" +
        "border-radius:999px;color:#fff;box-shadow:0 4px 12px rgba(15,37,64,.2);" +
        "pointer-events:none;opacity:.92;";
      document.body.appendChild(el);
    }
    el.textContent = connected ? "Connected to Supabase" : "Offline Mode";
    el.style.background = connected ? "#16a34a" : "#6b7280";
  }
  window.addEventListener("DOMContentLoaded", function () {
    SB.ping().then(show).catch(function () { show(false); });
  });
})();
