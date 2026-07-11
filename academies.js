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
   REMOTE BACKEND — Supabase (Postgres + PostgREST)  [production]
   ------------------------------------------------------------
   Supabase is the PRIMARY content store; localStorage is a cache +
   offline fallback. All Supabase access goes through the API layer in
   supabase.js (window.SB), which uses plain fetch (real CORS, readable
   responses — no JSONP / no no-cors).
   - Read:  SB.fetchModules() / SB.fetchLessons() → refreshes the cache.
   - Write: SB.upsert / delete helpers → persist directly to Supabase.
     Writes are optimistic (cache first); a failed write is queued in an
     outbox and retried on next load / when the browser is back online.
   - First run against an empty database with existing local data seeds
     it from the cache (one-time migration).
   Not configured (empty keys) = demo mode (localStorage only).
   Setup + schema: see SUPABASE_BACKEND.md and supabase_schema.sql.
   ============================================================ */
let remoteContentReady = false;
function backendReady() { return (typeof SB !== "undefined") && SB && SB.enabled(); }

function s_(v) { return (v === 0 || v) ? String(v) : ""; }
/* Accepts a value that may already be an object/array, a JSON string, or
   empty — returns the parsed value. */
function parseMaybe(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return fallback; } }
  return v;
}
function normModule(m) {
  const objectives = parseMaybe(m.objectives, []);
  return {
    id: s_(m.id), academyKey: s_(m.academyKey), moduleNumber: s_(m.moduleNumber),
    moduleTitle: s_(m.moduleTitle), shortDesc: s_(m.shortDesc),
    objectives: Array.isArray(objectives) ? objectives.map(s_) : [],
    studyTime: s_(m.studyTime), difficulty: s_(m.difficulty),
    prerequisites: s_(m.prerequisites), status: s_(m.status) || "Draft", updatedAt: s_(m.updatedAt)
  };
}
function normLesson(l) {
  const order = (l.order === 0 || (l.order != null && l.order !== "")) ? Number(l.order) : "";
  const activities = parseMaybe(l.activities, []);
  const blocks = parseMaybe(l.blocks, []);
  return {
    id: s_(l.id), academyKey: s_(l.academyKey), moduleId: s_(l.moduleId),
    moduleNumber: s_(l.moduleNumber), lessonNumber: s_(l.lessonNumber),
    lessonTitle: s_(l.lessonTitle), contentType: s_(l.contentType),
    contentBody: s_(l.contentBody), status: s_(l.status) || "Draft", order: order,
    assignment: parseMaybe(l.assignment, null),
    activities: Array.isArray(activities) ? activities : [],
    blocks: Array.isArray(blocks) ? blocks : [],
    updatedAt: s_(l.updatedAt)
  };
}

/* ---------- Offline write queue (outbox) ----------
   Writes that fail (offline / Supabase unreachable) are stored here and
   retried on the next load and whenever the browser comes back online. */
const OUTBOX_KEY = "sdta_outbox_v1";
function loadOutbox() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch (e) { return []; } }
function saveOutbox(q) { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q)); }
function queueWrite(payload) { const q = loadOutbox(); q.push(payload); saveOutbox(q); }
function outboxCount() { return loadOutbox().length; }

/* Apply one queued write against Supabase. */
function applyWrite(p) {
  switch (p.action) {
    case "saveModule": return SB.upsertModule(p.item);
    case "saveLesson": return SB.upsertLesson(p.item);
    case "deleteModule": return SB.deleteModule(p.id);
    case "deleteLesson": return SB.deleteLesson(p.id);
    case "bulkSave": return SB.bulkUpsert(p.modules || [], p.lessons || []);
    case "insertSubmission": return SB.upsertSubmission(p.sub);
    case "updateSubmission": return SB.updateSubmission(p.id, p.patch);
    default: return Promise.resolve();
  }
}

/* Retry every queued write in order; anything still failing stays queued. */
async function flushOutbox() {
  if (!backendReady()) return;
  const q = loadOutbox();
  if (!q.length) return;
  const remaining = [];
  for (const payload of q) {
    try { await applyWrite(payload); }
    catch (e) { remaining.push(payload); }
  }
  saveOutbox(remaining);
}

/* Persist a write to Supabase. The caller has already written to the local
   cache (optimistic); on network failure the write is queued for later. */
async function postContent(payload) {
  if (!backendReady()) { queueWrite(payload); return false; }
  try {
    await flushOutbox();      // drain any pending writes first (preserve order)
    await applyWrite(payload);
    return true;
  } catch (err) {
    console.warn("Supabase write failed — queued for retry.", err);
    queueWrite(payload);      // offline / unreachable — retry later
    return false;
  }
}
function pushModule(item) { return postContent({ action: "saveModule", item }); }
function pushLesson(item) { return postContent({ action: "saveLesson", item }); }
function deleteModuleRemote(id) { return postContent({ action: "deleteModule", id }); }
function deleteLessonRemote(id) { return postContent({ action: "deleteLesson", id }); }

/* ---------- Assignment submissions (Supabase primary, cache fallback) ---------- */
const SUBMISSIONS_CACHE_KEY = "sdta_submissions_v1";
function loadSubmissionsCache() {
  try { return JSON.parse(localStorage.getItem(SUBMISSIONS_CACHE_KEY)) || []; } catch (e) { return []; }
}
function saveSubmissionsCache(list) { localStorage.setItem(SUBMISSIONS_CACHE_KEY, JSON.stringify(list || [])); }

/* Employee submits an assignment: cache it locally (optimistic) then push to
   Supabase; a failed push is queued and retried. */
function pushSubmission(sub) {
  const cache = loadSubmissionsCache().filter(s => s.id !== sub.id);
  cache.unshift(sub);
  saveSubmissionsCache(cache);
  return postContent({ action: "insertSubmission", sub });
}

/* Manager updates a submission's review fields. */
function updateSubmissionRemote(id, patch) {
  const cache = loadSubmissionsCache().map(s => s.id === id ? Object.assign({}, s, patch) : s);
  saveSubmissionsCache(cache);
  return postContent({ action: "updateSubmission", id, patch });
}

/* Read all submissions — from Supabase when available (refreshing the cache),
   otherwise from the local cache. */
async function loadSubmissions() {
  if (backendReady()) {
    try {
      const subs = await SB.fetchSubmissions();
      saveSubmissionsCache(subs);
      return subs;
    } catch (e) { console.warn("Submissions fetch failed — using cache.", e); }
  }
  return loadSubmissionsCache();
}

/* One-time seed: push whatever is already in localStorage up to an empty database. */
async function migrateLocalToServer(modules, lessons) {
  try { await SB.bulkUpsert(modules, lessons); return true; }
  catch (e) { queueWrite({ action: "bulkSave", modules: modules, lessons: lessons }); return false; }
}

/* Pull all content from Supabase into the local cache. Supabase is the source
   of truth for reads; returns true on success, false when offline (in which
   case the caller keeps using the local cache). */
async function syncContentFromServer() {
  if (!backendReady()) return false;
  await flushOutbox(); // push pending offline writes before reading fresh state
  try {
    const [modules, lessons] = await Promise.all([SB.fetchModules(), SB.fetchLessons()]);
    remoteContentReady = true;
    const localModules = loadContent();
    const localLessons = loadLessons();
    // First run against an empty database but with existing local data → seed it
    // and keep the local cache (it has just become the server's content).
    if (!modules.length && !lessons.length && (localModules.length || localLessons.length)) {
      await migrateLocalToServer(localModules, localLessons);
      return true;
    }
    saveContent(modules.map(normModule));
    saveLessons(lessons.map(normLesson));
    return true;
  } catch (err) {
    console.warn("Supabase sync failed — using local cache.", err);
    return false;
  }
}

/* Retry queued writes as soon as connectivity returns. */
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("online", function () { flushOutbox(); });
}

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

/* Lesson content is now authored as HTML by the rich text editor. Render it
   as-is; fall back to the legacy markdown-ish renderer for older lessons that
   were saved as plain text. (Content is authored by managers in the Content
   Manager, so the stored HTML is trusted.) */
function looksLikeHtml(s) { return /<\/?[a-z][\s\S]*>/i.test(String(s || "")); }
function renderLessonContent(text) {
  const s = String(text == null ? "" : text);
  if (!s.trim()) return '<p class="muted">لا يوجد محتوى.</p>';
  return looksLikeHtml(s) ? s : renderRichText(s);
}

/* ============================================================
   LESSON BLOCKS — ordered, manageable content blocks
   ------------------------------------------------------------
   A lesson's content is an ordered array `lesson.blocks`. Each block:
     { id, type, order, status, data, createdAt, updatedAt }
   Legacy lessons (contentBody, no blocks) are treated as ONE Rich Text
   block automatically (lessonBlocks()) — nothing to rebuild by hand, and
   contentBody is never removed. Each block renders to the SAME HTML the
   app already uses, so the Learning Path renderer + Knowledge Check
   gating are reused unchanged.
   ============================================================ */
const BLOCK_TYPES = [
  { type: "richtext",         label: "Rich Text",            icon: "📝" },
  { type: "image",            label: "Image",                icon: "🖼️" },
  { type: "youtube",          label: "YouTube Video",        icon: "📺" },
  { type: "file",             label: "PDF / File",           icon: "📎" },
  { type: "resource",         label: "Resource Link",        icon: "🔗" },
  { type: "knowledge",        label: "Knowledge Check",      icon: "❓" },
  { type: "callout-info",     label: "Information Callout",  icon: "ℹ️" },
  { type: "callout-tip",      label: "Tip Callout",          icon: "💡" },
  { type: "callout-warning",  label: "Warning Callout",      icon: "⚠️" },
  { type: "divider",          label: "Divider",              icon: "―" },
  { type: "summary",          label: "Summary",              icon: "📌" }
];
function blockTypeMeta(type) { return BLOCK_TYPES.find(t => t.type === type) || { type: type, label: type, icon: "▪" }; }
function blockId() { return "b" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function kcDefaultData() {
  return { id: "kc_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
           type: "mcq", question: "", choices: ["", ""], correct: 0, explanation: "" };
}
function defaultBlockData(type) {
  switch (type) {
    case "image":  return { url: "", caption: "", size: "medium" };
    case "youtube": return { url: "", videoId: "" };
    case "file":   return { url: "", name: "" };
    case "resource": return { title: "", url: "", description: "" };
    case "knowledge": return kcDefaultData();
    case "callout-info": case "callout-tip": case "callout-warning": return { title: "", body: "" };
    case "divider": return {};
    case "richtext": case "summary": default: return { html: "" };
  }
}
function newBlock(type) {
  const now = new Date().toISOString();
  return { id: blockId(), type: type, order: 0, status: "Published", data: defaultBlockData(type), createdAt: now, updatedAt: now };
}

/* Blocks for a lesson, in order. Legacy lessons → one synthesized Rich Text
   block from contentBody (never mutates the stored lesson). */
function lessonBlocks(lesson) {
  if (lesson && Array.isArray(lesson.blocks) && lesson.blocks.length) {
    return lesson.blocks.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  }
  const html = lesson ? String(lesson.contentBody || "") : "";
  if (!html.trim()) return [];
  const now = (lesson && lesson.updatedAt) || new Date().toISOString();
  return [{
    id: "legacy-" + ((lesson && lesson.id) || "x"), type: "richtext", order: 0, status: "Published",
    data: { html: looksLikeHtml(html) ? html : renderRichText(html) }, createdAt: now, updatedAt: now
  }];
}

/* Attribute-safe escaping for values placed inside an HTML attribute. */
function escAttr(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function ytVideoId(url) {
  const u = String(url || "").trim();
  let m = u.match(/[?&]v=([A-Za-z0-9_-]{6,})/); if (m) return m[1];
  m = u.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/); if (m) return m[1];
  m = u.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/); if (m) return m[1];
  m = u.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/); if (m) return m[1];
  return null;
}
function blockFileIcon(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "📕";
  if (n.endsWith(".docx") || n.endsWith(".doc")) return "📘";
  if (n.endsWith(".pptx") || n.endsWith(".ppt")) return "📙";
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return "📗";
  return "📎";
}

/* Render ONE block to the HTML fragment used by the Learning Path (and, when
   flattened, by the rollback-safe contentBody). Formats match the existing
   inline editor output so all current rendering/gating keeps working. */
function blockToHtml(b) {
  if (!b) return "";
  const d = b.data || {};
  switch (b.type) {
    case "richtext": return d.html || "";
    case "summary":
      return (d.html && d.html.trim())
        ? `<div class="lesson-summary"><h4 class="lesson-summary-title">📌 Summary</h4>${d.html}</div>` : "";
    case "image": {
      if (!d.url) return "";
      const sz = ({ small: "sm", medium: "md", large: "lg" })[d.size || "medium"] || "md";
      return `<figure class="rte-figure rte-size-${sz}"><img src="${escAttr(d.url)}" alt="${escAttr(d.caption || "")}">` +
        (d.caption ? `<figcaption>${escHtml(d.caption)}</figcaption>` : "") + `</figure>`;
    }
    case "youtube": {
      const id = d.videoId || ytVideoId(d.url);
      if (!id) return d.url ? `<p><a href="${escAttr(d.url)}" target="_blank" rel="noopener">${escHtml(d.url)}</a></p>` : "";
      return `<div class="lp-embed"><iframe src="https://www.youtube.com/embed/${escAttr(id)}" ` +
        `title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    }
    case "file": {
      if (!d.url) return "";
      const nm = d.name || "File";
      const ext = (String(nm).split(".").pop() || "FILE").toUpperCase();
      return `<div class="lp-file"><a href="${escAttr(d.url)}" target="_blank" rel="noopener" download>` +
        `<span class="lp-file-ico">${blockFileIcon(nm)}</span><span class="lp-file-meta">` +
        `<span class="lp-file-name">${escHtml(nm)}</span><span class="lp-file-sub">${escHtml(ext)} · Download</span></span></a></div>`;
    }
    case "resource": {
      if (!d.url && !d.title) return "";
      return `<div class="lp-resource"><a href="${escAttr(d.url || "#")}" target="_blank" rel="noopener">` +
        `<span class="lp-resource-ico">🔗</span><span class="lp-resource-body">` +
        `<span class="lp-resource-title">${escHtml(d.title || d.url || "")}</span>` +
        (d.description ? `<span class="lp-resource-desc">${escHtml(d.description)}</span>` : "") +
        (d.url ? `<span class="lp-resource-url">${escHtml(d.url)}</span>` : "") +
        `</span></a></div>`;
    }
    case "knowledge":
      return `<div class="kc-block" data-kc="${escAttr(JSON.stringify(d || {}))}"></div>`;
    case "callout-info": case "callout-tip": case "callout-warning": {
      const kind = b.type.replace("callout-", "");
      const title = d.title ? `<p class="callout-title"><strong>${escHtml(d.title)}</strong></p>` : "";
      const body = (d.body && d.body.trim()) ? d.body : "";
      if (!title && !body) return "";
      return `<div class="callout callout-${kind}">${title}${body}</div>`;
    }
    case "divider": return `<hr class="lesson-divider">`;
    default: return "";
  }
}
/* Flatten blocks to one HTML string (skips Draft blocks). */
function blocksToHtml(blocks) {
  return (blocks || []).filter(b => b && b.status !== "Draft").map(blockToHtml).join("");
}
/* Learning-Path lesson content: from blocks when present, else legacy contentBody. */
function renderLessonBlocksHtml(lesson) {
  const blocks = lessonBlocks(lesson);
  if (!blocks.length) return renderLessonContent(lesson ? lesson.contentBody : "");
  const html = blocksToHtml(blocks);
  return (html && html.trim()) ? html : '<p class="muted">لا يوجد محتوى.</p>';
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
  // Regular employees are locked to their own academy — no team switcher.
  if (typeof Identity !== "undefined" && Identity.isIdentified() && !Identity.isAdmin()) return;
  const key = getSelectedAcademy();
  const ac = key ? academyByKey(key) : null;
  const wrap = document.createElement("div");
  wrap.className = "switch-team-wrap";
  wrap.innerHTML =
    (ac ? `<div class="switch-team-current">Team: <strong>${escHtml(ac.name)}</strong></div>` : "") +
    `<a class="btn btn-light switch-team" href="index.html">↺ Switch Team</a>`;
  foot.appendChild(wrap);
}

/* ---------- Employee identification gate (index.html) ---------- */
function renderEntryUser() {
  const el = document.getElementById("entryUser");
  if (!el || typeof Identity === "undefined") return;
  const id = Identity.get();
  if (!id) { el.innerHTML = ""; return; }
  el.innerHTML =
    `<div class="entry-user-info"><span class="entry-user-ico">👤</span>` +
    `<span class="entry-user-text"><strong>${escHtml(id.employeeName)}</strong><span>${escHtml(id.team)}</span></span></div>` +
    `<button type="button" class="btn btn-ghost entry-user-switch" data-switch-employee>Switch Employee</button>`;
}
function initIdentityGate() {
  const idView = document.getElementById("identifyView");
  const teamsView = document.getElementById("teamsView");
  if (!idView || !teamsView || typeof Identity === "undefined") return;

  function showTeams() { idView.hidden = true; teamsView.hidden = false; renderEntryUser(); renderTeamCards(); }
  function showIdentify() {
    teamsView.hidden = true; idView.hidden = false;
    const dl = document.getElementById("empList");
    if (dl) dl.innerHTML = (Identity.employees || []).map(e => `<option value="${escHtml(e.name)}"></option>`).join("");
    const nm = document.getElementById("idName"), tm = document.getElementById("idTeam"), m = document.getElementById("idMsg");
    if (nm) { nm.value = ""; nm.focus(); }
    if (tm) tm.value = "";
    if (m) m.textContent = "";
  }
  // Admins pick from the three academies; a regular employee goes straight to
  // their own team's Learning Path (they never see the team-selection cards).
  function proceed() {
    if (Identity.isAdmin()) { showTeams(); return; }
    const key = Identity.academyKey ? Identity.academyKey() : null;
    if (key) location.replace("learning_path.html?team=" + encodeURIComponent(key));
    else showTeams();
  }

  if (Identity.isIdentified()) proceed(); else showIdentify();

  const form = document.getElementById("identifyForm");
  if (form) form.addEventListener("submit", e => {
    e.preventDefault();
    const name = (document.getElementById("idName").value || "").trim();
    const team = (document.getElementById("idTeam").value || "").trim();
    const msg = document.getElementById("idMsg");
    if (!name) { msg.style.color = "#dc2626"; msg.textContent = "Employee Name مطلوب."; return; }
    if (!team) { msg.style.color = "#dc2626"; msg.textContent = "Team مطلوب."; return; }
    Identity.set({ employeeName: name, team: team });
    proceed();
  });

  // If the chosen name matches a configured employee, prefill their team.
  const nameInput = document.getElementById("idName");
  if (nameInput) nameInput.addEventListener("change", () => {
    const match = (Identity.employees || []).find(e => e.name === nameInput.value.trim());
    if (match && match.team) document.getElementById("idTeam").value = match.team;
  });

  teamsView.addEventListener("click", e => {
    if (e.target.closest("[data-switch-employee]")) { Identity.clear(); showIdentify(); }
  });
}

/* ---------- Employee chip (injected into every portal sidebar) ---------- */
function injectEmployeeChip() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || typeof Identity === "undefined" || sidebar.querySelector(".emp-chip")) return;
  const id = Identity.get();
  if (!id) return;
  const chip = document.createElement("div");
  chip.className = "emp-chip";
  chip.innerHTML =
    `<span class="emp-chip-ico">👤</span>` +
    `<span class="emp-chip-text"><strong>${escHtml(id.employeeName)}</strong><span>${escHtml(id.team)}</span></span>` +
    `<button type="button" class="emp-chip-switch" title="Switch Employee">↺</button>`;
  const brand = sidebar.querySelector(".brand");
  if (brand) brand.after(chip); else sidebar.prepend(chip);
  chip.querySelector(".emp-chip-switch").addEventListener("click", () => {
    Identity.clear();
    location.href = "index.html";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initIdentityGate();     // Learning Center welcome/identification gate
  if (!document.getElementById("identifyView")) renderTeamCards(); // other pages that use #teamGrid
  injectSwitchTeam();
  injectEmployeeChip();
  if (typeof Identity !== "undefined") Identity.applyNav(); // hide admin nav for employees
});
