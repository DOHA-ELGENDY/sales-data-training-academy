/* ============================================================
   Shared academy system (used by index, learning_path, content_manager)
   ------------------------------------------------------------
   One reusable Learning Center for multiple academies/teams.
   The difference between academies comes from DATA, not code.
   No backend / no auth yet — content is stored in localStorage.
   ============================================================ */

/* The active academies/teams. Add more here later — everything
   (team selection, learning paths, Content Manager) reads this list. */
const ACADEMIES = [
  {
    key: "sales-data", name: "Sales Data", team: "Sales Data Team", logo: "SD", icon: "📊",
    desc: "Training path for Sales Data, Reporting, CRM Operations and Data Analysis.",
    hasStatic: true, statusLabel: "Available"
  },
  {
    key: "sales", name: "Sales", team: "Sales Team", logo: "S", icon: "🤝",
    desc: "Sales onboarding and sales skills training.",
    hasStatic: false, statusLabel: "No content yet"
  },
  {
    key: "sales-accounting", name: "Sales Accounting", team: "Sales Accounting Team", logo: "SA", icon: "🧾",
    desc: "Training path for Sales Accounting operations and payment follow-up.",
    hasStatic: false, statusLabel: "No content yet"
  }
];

function academyByKey(key) { return ACADEMIES.find(a => a.key === key) || null; }

/* ---------- Selected academy: the single source of truth ----------
   Persisted in localStorage so navigation/refresh keeps the same team.
   NEVER falls back to Sales Data — if nothing is selected, returns null
   and the page sends the user back to team selection. */
const SELECTED_KEY = "sdta_selected_academy";
function setSelectedAcademy(key) {
  if (academyByKey(key)) localStorage.setItem(SELECTED_KEY, key);
}
function getSelectedAcademy() {
  // A ?team=… in the URL (e.g. from the team cards) wins and is persisted.
  const p = new URLSearchParams(location.search).get("team");
  if (academyByKey(p)) { setSelectedAcademy(p); return p; }
  const stored = localStorage.getItem(SELECTED_KEY);
  return academyByKey(stored) ? stored : null;
}

/* ---------- Content store (swap for Google Sheets / DB later) ---------- */
const CONTENT_KEY = "sdta_content_v2";
function loadContent() {
  try {
    const raw = localStorage.getItem(CONTENT_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt storage */ }
  return [];
}
function saveContent(items) { localStorage.setItem(CONTENT_KEY, JSON.stringify(items)); }

/* Published modules for one academy, sorted by module number. */
function publishedFor(teamKey) {
  return loadContent()
    .filter(m => m.academyKey === teamKey && m.status === "Published")
    .sort((a, b) => (parseFloat(a.moduleNumber) || 0) - (parseFloat(b.moduleNumber) || 0));
}

/* Modules shown in a Learning Path: Published + Locked (Draft is hidden),
   sorted by module number. */
function modulesForPath(teamKey) {
  return loadContent()
    .filter(m => m.academyKey === teamKey && m.status !== "Draft")
    .sort((a, b) => (parseFloat(a.moduleNumber) || 0) - (parseFloat(b.moduleNumber) || 0));
}

/* All modules for one academy (any status) — for Content Manager dropdowns. */
function modulesByAcademy(academyKey) {
  return loadContent()
    .filter(m => m.academyKey === academyKey)
    .sort((a, b) => (parseFloat(a.moduleNumber) || 0) - (parseFloat(b.moduleNumber) || 0));
}

/* ---------- Lessons / Content store ----------
   A Lesson is a manageable entity inside a Module. It has an explicit
   Lesson Number, a Title, a Status (Draft/Published) and an `order`
   used for manual reordering (Move Up / Move Down). Legacy lessons that
   only have a `contentType` still sort sensibly (see compareLessons). */

/* Legacy content types — kept only so old lessons keep their relative
   order until they are re-saved with an explicit `order`. */
const CONTENT_TYPES = [
  "Introduction", "Business Context", "Training Content", "Practical Example",
  "Common Mistakes", "Tips", "Knowledge Check", "Next Step"
];

const LESSONS_KEY = "sdta_lessons_v1";
function loadLessons() {
  try {
    const raw = localStorage.getItem(LESSONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt storage */ }
  return [];
}
function saveLessons(items) { localStorage.setItem(LESSONS_KEY, JSON.stringify(items)); }

/* Canonical lesson sort: explicit `order` first, then (for legacy lessons
   with no order) content-type order, then Lesson Number. Used everywhere
   so Content Manager and Learning Path always agree. */
function compareLessons(a, b) {
  const hasOrder = v => v === 0 || (v != null && v !== "" && !isNaN(v));
  const ao = hasOrder(a.order), bo = hasOrder(b.order);
  if (ao && bo) return Number(a.order) - Number(b.order);
  if (ao) return -1;
  if (bo) return 1;
  const ct = {};
  CONTENT_TYPES.forEach((t, i) => { ct[t] = i; });
  const at = ct[a.contentType] ?? 99, bt = ct[b.contentType] ?? 99;
  if (at !== bt) return at - bt;
  return (parseFloat(a.lessonNumber) || 0) - (parseFloat(b.lessonNumber) || 0);
}

/* All lessons for one module (any status), in display order. */
function lessonsByModule(moduleId) {
  return loadLessons().filter(l => l.moduleId === moduleId).sort(compareLessons);
}

/* Published lessons for one module, in display order (for employees). */
function publishedLessonsForModule(moduleId) {
  return loadLessons()
    .filter(l => l.moduleId === moduleId && l.status === "Published")
    .sort(compareLessons);
}

/* ---------- Lesson completion / progress (employee side) ----------
   Progress is kept SEPARATED BY ACADEMY so switching teams shows the right
   numbers. Shape: { [academyKey]: { [lessonId]: "in-progress" | "completed" } }.
   A lesson not present is "not-started". localStorage for now — this same
   shape is what will later sync to Google Sheets. */
const PROGRESS_KEY = "sdta_progress_v1";
function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) return JSON.parse(raw) || {};
  } catch (e) { /* ignore corrupt storage */ }
  return {};
}
function saveProgress(obj) { localStorage.setItem(PROGRESS_KEY, JSON.stringify(obj)); }

function getLessonStatus(academyKey, lessonId) {
  const p = loadProgress();
  return (p[academyKey] && p[academyKey][lessonId]) || "not-started";
}
function isLessonCompleted(academyKey, lessonId) {
  return getLessonStatus(academyKey, lessonId) === "completed";
}
/* Set a lesson's status for an academy. "not-started" clears the entry. */
function setLessonStatus(academyKey, lessonId, status) {
  const p = loadProgress();
  if (!p[academyKey]) p[academyKey] = {};
  if (status === "not-started") delete p[academyKey][lessonId];
  else p[academyKey][lessonId] = status;
  saveProgress(p);
}

/* Completed / total Published lessons for one module (what the employee sees). */
function moduleProgress(academyKey, moduleId) {
  const lessons = publishedLessonsForModule(moduleId);
  const done = lessons.filter(l => isLessonCompleted(academyKey, l.id)).length;
  return { done, total: lessons.length };
}

/* Academy-wide progress across a team's Published modules.
   A module counts as "completed" when all its Published lessons are done.
   Empty modules (no Published lessons) are excluded from the module tally. */
function academyProgress(academyKey) {
  let lessonsDone = 0, lessonsTotal = 0, modulesDone = 0, modulesTotal = 0;
  publishedFor(academyKey).forEach(m => {
    const { done, total } = moduleProgress(academyKey, m.id);
    lessonsDone += done; lessonsTotal += total;
    if (total > 0) { modulesTotal++; if (done === total) modulesDone++; }
  });
  const percent = lessonsTotal ? Math.round((lessonsDone / lessonsTotal) * 100) : 0;
  return { lessonsDone, lessonsTotal, modulesDone, modulesTotal, percent };
}

/* ---------- Lesson Activities (quizzes) ----------
   Activities live on the lesson as `lesson.activities` (an ordered array).
   Each activity: { id, question, type, points, choices[], correct, status }.
   Types: mcq | truefalse | multiselect | short. Ordering = array position. */
const ACTIVITY_TYPES = [
  { value: "mcq", label: "Multiple Choice (MCQ)" },
  { value: "truefalse", label: "True / False" },
  { value: "multiselect", label: "Multiple Select" },
  { value: "short", label: "Short Answer" }
];
function activityTypeLabel(t) {
  const f = ACTIVITY_TYPES.find(x => x.value === t);
  return f ? f.label : t;
}
function lessonActivities(lesson) {
  return (lesson && Array.isArray(lesson.activities)) ? lesson.activities : [];
}
function publishedActivities(lesson) {
  return lessonActivities(lesson).filter(a => a.status === "Published");
}

/* ---------- Activity responses (employee answers) ----------
   Separated by academy. Shape: { [academyKey]: { [activityId]: answer } }.
   Answers are saved as-is; scoring comes later. localStorage for now. */
const RESPONSES_KEY = "sdta_responses_v1";
function loadResponses() {
  try {
    const raw = localStorage.getItem(RESPONSES_KEY);
    if (raw) return JSON.parse(raw) || {};
  } catch (e) { /* ignore corrupt storage */ }
  return {};
}
function saveResponses(obj) { localStorage.setItem(RESPONSES_KEY, JSON.stringify(obj)); }
function getResponse(academyKey, activityId) {
  const r = loadResponses();
  return (r[academyKey] && r[academyKey][activityId] !== undefined) ? r[academyKey][activityId] : null;
}
function setResponse(academyKey, activityId, value) {
  const r = loadResponses();
  if (!r[academyKey]) r[academyKey] = {};
  r[academyKey][activityId] = value;
  saveResponses(r);
}

/* ============================================================
   REMOTE BACKEND (Google Sheets via Apps Script Web App)
   ------------------------------------------------------------
   localStorage is a CACHE; Google Sheets is the source of truth.
   - Read:  GET  ?action=content   → refreshes the local cache.
   - Write: POST {type, item|id}    → persists to the Sheet.
   Writes only go out AFTER a successful read proves the server
   supports content (so we never pollute the Submissions tab on an
   old deployment). Empty URL = demo mode (localStorage only).
   ============================================================ */
const CONTENT_API_URL = "https://script.google.com/macros/s/AKfycbxE73p1e0ckD04kLWwpLFf7P_n8fmcqwl_OAA1e6dEH1WjvObkuhGKgyTOWvas0Y8wh/exec";
let remoteContentReady = false;

function s_(v) { return (v === 0 || v) ? String(v) : ""; }
function normModule(m) {
  return {
    id: s_(m.id), academyKey: s_(m.academyKey), moduleNumber: s_(m.moduleNumber),
    moduleTitle: s_(m.moduleTitle), shortDesc: s_(m.shortDesc),
    objectives: Array.isArray(m.objectives) ? m.objectives.map(s_) : [],
    studyTime: s_(m.studyTime), difficulty: s_(m.difficulty),
    prerequisites: s_(m.prerequisites), status: s_(m.status) || "Draft", updatedAt: s_(m.updatedAt)
  };
}
function normLesson(l) {
  const order = (l.order === 0 || (l.order != null && l.order !== "")) ? Number(l.order) : "";
  return {
    id: s_(l.id), academyKey: s_(l.academyKey), moduleId: s_(l.moduleId),
    moduleNumber: s_(l.moduleNumber), lessonNumber: s_(l.lessonNumber),
    lessonTitle: s_(l.lessonTitle), contentType: s_(l.contentType),
    contentBody: s_(l.contentBody), status: s_(l.status) || "Draft",
    order: order, updatedAt: s_(l.updatedAt)
  };
}

/* JSONP GET — reads cross-origin via a <script> tag, so it works from the
   live Render site with NO CORS setup on Apps Script. */
function jsonp(action) {
  return new Promise((resolve, reject) => {
    if (!CONTENT_API_URL) { reject(new Error("no-url")); return; }
    const cb = "__cmcb_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const script = document.createElement("script");
    let done = false;
    const cleanup = () => {
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    window[cb] = (data) => { done = true; cleanup(); resolve(data); };
    script.onerror = () => { if (!done) { cleanup(); reject(new Error("jsonp-error")); } };
    script.src = CONTENT_API_URL + "?action=" + encodeURIComponent(action) + "&callback=" + cb;
    document.head.appendChild(script);
    setTimeout(() => { if (!done) { cleanup(); reject(new Error("jsonp-timeout")); } }, 15000);
  });
}

/* Pull modules + lessons from the Sheet into the local cache. Returns true on success. */
async function syncContentFromServer() {
  if (!CONTENT_API_URL) return false;
  try {
    const [mRes, lRes] = await Promise.all([jsonp("getModules"), jsonp("getLessons")]);
    if (mRes && mRes.result === "success" && lRes && lRes.result === "success") {
      remoteContentReady = true;
      // Module-level objectives/prerequisites are managed locally for now (no
      // Sheet columns yet). Preserve them across a sync so they aren't lost.
      const localModById = {};
      loadContent().forEach(m => { localModById[m.id] = m; });
      const modules = (mRes.modules || []).map(normModule).map(m => {
        const local = localModById[m.id];
        if (local) {
          if ((!m.objectives || !m.objectives.length) && local.objectives && local.objectives.length) m.objectives = local.objectives;
          if (!m.prerequisites && local.prerequisites) m.prerequisites = local.prerequisites;
        }
        return m;
      });
      saveContent(modules);
      // Lesson ordering/number are managed locally for now (no Sheet columns
      // yet). Preserve them across a sync so reordering isn't lost.
      const localById = {};
      loadLessons().forEach(l => { localById[l.id] = l; });
      const lessons = (lRes.lessons || []).map(normLesson).map(l => {
        const local = localById[l.id];
        if (local) {
          if (l.order === "" && (local.order === 0 || local.order)) l.order = local.order;
          if (!l.lessonNumber && local.lessonNumber) l.lessonNumber = local.lessonNumber;
          if (!l.assignment && local.assignment) l.assignment = local.assignment;
          if (!l.activities && local.activities) l.activities = local.activities;
        }
        return l;
      });
      saveLessons(lessons);
      return true;
    }
  } catch (err) {
    console.warn("Content sync failed — using local cache.", err);
  }
  return false;
}

/* Fire a write to the Sheet (no-cors: the request is processed even though
   we can't read the opaque response; callers re-sync to confirm). Writes only
   go out once a read has proven the content backend is deployed. */
async function postContent(payload) {
  if (!CONTENT_API_URL) return false;
  if (!remoteContentReady) { await syncContentFromServer(); }
  if (!remoteContentReady) return false;
  try {
    await fetch(CONTENT_API_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    return true;
  } catch (err) {
    console.warn("Content push failed.", err);
    return false;
  }
}
function pushModule(item) { return postContent({ action: "saveModule", item }); }
function pushLesson(item) { return postContent({ action: "saveLesson", item }); }
function deleteModuleRemote(id) { return postContent({ action: "deleteModule", id }); }
function deleteLessonRemote(id) { return postContent({ action: "deleteLesson", id }); }

/* ---------- Shared helpers ---------- */
function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---- Attachment helpers (shared by Content Manager + Learning Path) ---- */
function fileIcon(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "📕";
  if (n.endsWith(".docx") || n.endsWith(".doc")) return "📘";
  if (n.endsWith(".pptx") || n.endsWith(".ppt")) return "📙";
  if (/\.(jpg|jpeg|png)$/.test(n)) return "🖼️";
  return "📎";
}
function humanSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

/* Minimal "rich text" renderer for the Learning Content field.
   Supports: # H1, ## H2, - bullets, 1. numbered, blank line = paragraph.
   Designed so a real WYSIWYG editor can replace it later. */
function renderRichText(text) {
  const lines = String(text || "").split(/\r?\n/);
  let html = "", listType = null;
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  for (const line of lines) {
    const t = line.trim();
    if (t === "") { closeList(); continue; }
    if (/^#\s+/.test(t)) { closeList(); html += `<h3>${escHtml(t.replace(/^#\s+/, ""))}</h3>`; }
    else if (/^##\s+/.test(t)) { closeList(); html += `<h4>${escHtml(t.replace(/^##\s+/, ""))}</h4>`; }
    else if (/^[-*]\s+/.test(t)) {
      if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; }
      html += `<li>${escHtml(t.replace(/^[-*]\s+/, ""))}</li>`;
    }
    else if (/^\d+\.\s+/.test(t)) {
      if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; }
      html += `<li>${escHtml(t.replace(/^\d+\.\s+/, ""))}</li>`;
    }
    else { closeList(); html += `<p>${escHtml(t)}</p>`; }
  }
  closeList();
  return html || '<p class="muted">لا يوجد محتوى.</p>';
}

/* ---------- Team selection cards (index.html) ---------- */
function renderTeamCards() {
  const grid = document.getElementById("teamGrid");
  if (!grid) return;
  grid.innerHTML = ACADEMIES.map(a => `
    <div class="team-card reveal">
      <div class="team-ico">${a.icon}</div>
      <h3>${escHtml(a.team)}</h3>
      <p>${escHtml(a.desc)}</p>
      <span class="team-status ${a.hasStatic ? "available" : "soon"}">Status: ${escHtml(a.statusLabel)}</span>
      <a class="btn btn-primary team-open" href="learning_path.html?team=${a.key}">Open Learning Path →</a>
    </div>`).join("");
}

/* ---------- Switch Team control (injected into every portal sidebar) ---------- */
function injectSwitchTeam() {
  const foot = document.querySelector(".sidebar-foot");
  if (!foot || foot.querySelector(".switch-team")) return;
  const key = getSelectedAcademy();
  const ac = key ? academyByKey(key) : null;
  const wrap = document.createElement("div");
  wrap.className = "switch-team-wrap";
  wrap.innerHTML =
    (ac ? `<div class="switch-team-current">Team: <strong>${escHtml(ac.name)}</strong></div>` : "") +
    `<a class="btn btn-light switch-team" href="index.html">↺ Switch Team</a>`;
  foot.appendChild(wrap);
}

document.addEventListener("DOMContentLoaded", () => {
  renderTeamCards();
  injectSwitchTeam();
});
