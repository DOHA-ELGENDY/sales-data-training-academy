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
  var ORIGIN = SUPABASE_URL ? SUPABASE_URL.replace(/\/+$/, "") : "";
  var REST = ORIGIN ? ORIGIN + "/rest/v1" : "";
  var STORAGE = ORIGIN ? ORIGIN + "/storage/v1" : "";
  var IMAGE_BUCKET = "lesson-images";

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
  function subId() { return "s" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function submissionToRow(x) {
    return {
      id: s(x.id) || subId(),
      academy_key: s(x.academyKey),
      module_id: s(x.moduleId),
      module_title: s(x.moduleTitle),
      lesson_id: s(x.lessonId),
      lesson_title: s(x.lessonTitle),
      assignment_id: s(x.assignmentId),
      assignment_title: s(x.assignmentTitle),
      employee_name: s(x.employeeName),
      submission_link: s(x.submissionLink),
      text_answer: s(x.textAnswer),
      notes: s(x.notes),
      status: s(x.status) || "Pending Review",
      created_at: x.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }
  function submissionFromRow(r) {
    return {
      id: r.id, createdAt: r.created_at, academyKey: r.academy_key,
      moduleId: r.module_id, moduleTitle: r.module_title,
      lessonId: r.lesson_id, lessonTitle: r.lesson_title,
      assignmentId: r.assignment_id, assignmentTitle: r.assignment_title,
      employeeName: r.employee_name, submissionLink: r.submission_link,
      textAnswer: r.text_answer, notes: r.notes, status: r.status || "Pending Review",
      score: r.score, feedback: r.feedback, reviewedAt: r.reviewed_at, updatedAt: r.updated_at
    };
  }

  async function fetchSubmissions() {
    var res = await req("/submissions?select=*&order=created_at.desc", { headers: headers() });
    return (await res.json()).map(submissionFromRow);
  }
  async function upsertSubmission(sub) {
    await req("/submissions?on_conflict=id", { method: "POST", headers: headers(UPSERT), body: JSON.stringify(submissionToRow(sub)) });
    return true;
  }
  /* Manager review update: status / score / feedback / reviewed_at. */
  async function updateSubmission(id, patch) {
    var row = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.score !== undefined) row.score = s(patch.score);
    if (patch.feedback !== undefined) row.feedback = s(patch.feedback);
    if (patch.reviewedAt !== undefined) row.reviewed_at = patch.reviewedAt;
    await req("/submissions?id=eq." + enc(id), { method: "PATCH", headers: headers(MINIMAL), body: JSON.stringify(row) });
    return true;
  }
  /* Backward-compatible helper used by assignment_M0.html. */
  async function insertSubmission(sub) {
    return upsertSubmission({
      employeeName: sub.employeeName, assignmentId: sub.assignmentId,
      submissionLink: sub.submissionLink, notes: sub.notes, status: "Pending Review"
    });
  }

  /* ---------- Image upload (Supabase Storage, public bucket) ---------- */
  async function uploadImage(file) {
    if (!enabled()) throw new Error("Supabase not configured");
    var ext = (((file.name || "").split(".").pop()) || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    var path = "lessons/" + subId() + "." + ext;
    var res = await fetch(STORAGE + "/object/" + IMAGE_BUCKET + "/" + path, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "true"
      },
      body: file
    });
    if (!res.ok) {
      var t = ""; try { t = await res.text(); } catch (e) {}
      throw new Error("Storage upload " + res.status + " " + t);
    }
    return STORAGE + "/object/public/" + IMAGE_BUCKET + "/" + path;
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
    enabled: enabled, ping: ping, subId: subId,
    fetchModules: fetchModules, fetchLessons: fetchLessons,
    upsertModule: upsertModule, upsertLesson: upsertLesson,
    deleteModule: deleteModule, deleteLesson: deleteLesson,
    bulkUpsert: bulkUpsert,
    insertSubmission: insertSubmission, upsertSubmission: upsertSubmission,
    fetchSubmissions: fetchSubmissions, updateSubmission: updateSubmission,
    uploadImage: uploadImage,
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
