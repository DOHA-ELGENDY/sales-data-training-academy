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

/* ---------- Lessons / Content store ---------- */
/* Content types, in the order they should appear inside a module. */
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

/* Published lessons for one module, ordered by content type. */
function publishedLessonsForModule(moduleId) {
  const order = {};
  CONTENT_TYPES.forEach((t, i) => { order[t] = i; });
  return loadLessons()
    .filter(l => l.moduleId === moduleId && l.status === "Published")
    .sort((a, b) => (order[a.contentType] ?? 99) - (order[b.contentType] ?? 99));
}

/* ---------- Shared helpers ---------- */
function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
