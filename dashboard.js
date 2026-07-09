/* ============================================================
   Academy Dashboard — manager summary (read-only)
   ------------------------------------------------------------
   Built entirely from existing localStorage data via academies.js.
   No backend / no Google Sheets. Summarizes the selected academy:
   counts, content-health warnings, and build completeness.
   ============================================================ */

/* Parse a free-text duration ("30 min", "1 hour", "1.5 hrs") to minutes.
   Heuristic: a Latin "h" or Arabic "ساع" means hours; otherwise minutes. */
function parseDurationMinutes(str) {
  const s = String(str || "").toLowerCase().trim();
  if (!s) return 0;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (/h|ساع/.test(s)) return Math.round(n * 60);
  return Math.round(n); // minutes (or a bare number)
}
function formatMinutes(total) {
  if (!total) return "—";
  const h = Math.floor(total / 60), m = Math.round(total % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m} min`;
}

/* Crunch every metric for one academy from localStorage. */
function computeDashboard(key) {
  const modules = loadContent().filter(m => m.academyKey === key);
  const lessons = loadLessons().filter(l => l.academyKey === key);

  // Lessons grouped by their module (for per-module checks).
  const lessonsByMod = {};
  lessons.forEach(l => { (lessonsByMod[l.moduleId] = lessonsByMod[l.moduleId] || []).push(l); });

  // Module status counts.
  const modPublished = modules.filter(m => m.status === "Published").length;
  const modDraft = modules.filter(m => m.status === "Draft").length;
  const modLocked = modules.filter(m => m.status === "Locked").length;

  // Lesson status counts.
  const lesPublished = lessons.filter(l => l.status === "Published").length;
  const lesDraft = lessons.filter(l => l.status === "Draft").length;

  // Assignments (one optional assignment per lesson).
  const withAssignment = lessons.filter(l => l.assignment);
  const publishedAssignments = withAssignment.filter(l => l.assignment.status === "Published").length;

  // Knowledge checks = activities.
  let totalKC = 0, publishedKC = 0;
  lessons.forEach(l => {
    const acts = Array.isArray(l.activities) ? l.activities : [];
    totalKC += acts.length;
    publishedKC += acts.filter(a => a.status === "Published").length;
  });

  // Estimated study time = sum of module durations.
  let totalMinutes = 0;
  modules.forEach(m => { totalMinutes += parseDurationMinutes(m.studyTime); });

  // Completeness inputs.
  const modulesWithLessons = modules.filter(m => (lessonsByMod[m.id] || []).length > 0).length;
  const lessonsWithContent = lessons.filter(l => l.contentBody && l.contentBody.trim()).length;
  const lessonsWithKC = lessons.filter(l => Array.isArray(l.activities) && l.activities.length).length;

  const pct = (num, den) => den ? Math.round((num / den) * 100) : 0;
  const pctModules = pct(modulesWithLessons, modules.length);
  const pctLessons = pct(lessonsWithContent, lessons.length);
  const pctAssignments = pct(withAssignment.length, lessons.length);
  const pctKC = pct(lessonsWithKC, lessons.length);
  const overall = Math.round((pctModules + pctLessons + pctAssignments + pctKC) / 4);

  // Content-health warnings.
  const warnings = [];
  modules.forEach(m => {
    const ml = lessonsByMod[m.id] || [];
    const mLabel = `Module ${m.moduleNumber} — ${m.moduleTitle || "بدون عنوان"}`;
    if (!ml.length) warnings.push(`${mLabel}: has no lessons`);
    const drafts = ml.filter(l => l.status === "Draft").length;
    const pubs = ml.filter(l => l.status === "Published").length;
    if (m.status === "Published" && drafts) warnings.push(`${mLabel}: published module contains ${drafts} draft lesson${drafts > 1 ? "s" : ""}`);
    if (m.status === "Draft" && pubs) warnings.push(`${mLabel}: draft module contains ${pubs} published lesson${pubs > 1 ? "s" : ""}`);
  });
  lessons.forEach(l => {
    const lLabel = l.lessonNumber
      ? `Lesson ${l.lessonNumber} — ${l.lessonTitle || "بدون عنوان"}`
      : (l.lessonTitle || "بدون عنوان");
    if (!l.contentBody || !l.contentBody.trim()) warnings.push(`${lLabel}: has no content`);
    if (!l.assignment) warnings.push(`${lLabel}: has no assignment`);
    if (!(Array.isArray(l.activities) && l.activities.length)) warnings.push(`${lLabel}: has no knowledge check`);
  });

  return {
    totalModules: modules.length, modPublished, modDraft, modLocked,
    totalLessons: lessons.length, lesPublished, lesDraft,
    totalAssignments: withAssignment.length, publishedAssignments,
    totalKC, publishedKC,
    studyTime: formatMinutes(totalMinutes),
    completeness: { pctModules, pctLessons, pctAssignments, pctKC, overall },
    warnings
  };
}

/* ---------- Rendering ---------- */
function statTile(num, label, cls) {
  return `
    <div class="dash-stat ${cls || ""}">
      <span class="dash-stat-num">${escHtml(String(num))}</span>
      <span class="dash-stat-label">${escHtml(label)}</span>
    </div>`;
}

function barRow(label, pct) {
  return `
    <div class="dash-bar-row">
      <span class="dash-bar-label">${escHtml(label)}</span>
      <div class="dash-bar"><span style="width:${pct}%"></span></div>
      <span class="dash-bar-pct">${pct}%</span>
    </div>`;
}

function renderDashboard(key) {
  const ac = academyByKey(key);
  if (!ac) return;
  const d = computeDashboard(key);

  document.title = `Academy Dashboard · ${ac.name}`;
  const nameEl = document.getElementById("dashAcademyName");
  if (nameEl) nameEl.textContent = ac.name;

  // Rebrand the shell to the selected academy (same pattern as Learning Path).
  const bstrong = document.querySelector(".brand-text strong");
  if (bstrong) bstrong.textContent = ac.name;
  document.querySelectorAll(".brand-logo, .topbar-logo").forEach(el => { el.textContent = ac.logo; });
  const topTitle = document.querySelector(".topbar-title");
  if (topTitle) topTitle.textContent = `${ac.name} — Learning Center`;

  // ----- Stats -----
  document.getElementById("dashStats").innerHTML =
    statTile(d.totalModules, "Total Modules") +
    statTile(d.modPublished, "Published Modules", "is-pub") +
    statTile(d.modDraft, "Draft Modules", "is-draft") +
    statTile(d.modLocked, "Locked Modules", "is-locked") +
    statTile(d.totalLessons, "Total Lessons") +
    statTile(d.lesPublished, "Published Lessons", "is-pub") +
    statTile(d.lesDraft, "Draft Lessons", "is-draft") +
    statTile(d.totalAssignments, "Total Assignments") +
    statTile(d.publishedAssignments, "Published Assignments", "is-pub") +
    statTile(d.totalKC, "Total Knowledge Checks") +
    statTile(d.publishedKC, "Published Knowledge Checks", "is-pub") +
    statTile(d.studyTime, "Estimated Study Time", "is-wide");

  // ----- Completeness -----
  const c = d.completeness;
  document.getElementById("dashCompleteness").innerHTML = `
    ${barRow("Modules", c.pctModules)}
    ${barRow("Lessons", c.pctLessons)}
    ${barRow("Assignments", c.pctAssignments)}
    ${barRow("Knowledge Checks", c.pctKC)}
    <div class="dash-overall">
      <div class="dash-overall-top">
        <span class="dash-overall-label">Overall Academy Build Progress</span>
        <span class="dash-overall-pct">${c.overall}%</span>
      </div>
      <div class="dash-overall-bar"><span style="width:${c.overall}%"></span></div>
    </div>`;

  // ----- Health -----
  const health = document.getElementById("dashHealth");
  if (!d.warnings.length) {
    health.innerHTML = `<div class="dash-ok"><span class="dash-ok-ico">✓</span> كل الفحوصات تمام — لا توجد تحذيرات.</div>`;
  } else {
    health.innerHTML = `
      <div class="dash-health-count">${d.warnings.length} warning${d.warnings.length > 1 ? "s" : ""}</div>
      ${d.warnings.map(w => `<div class="dash-warn"><span class="dash-warn-ico" aria-hidden="true">⚠</span> ${escHtml(w)}</div>`).join("")}`;
  }

  // ----- Quick actions -----
  document.getElementById("dashActions").innerHTML = `
    <a class="dash-action" href="content_manager.html">
      <span class="dash-action-ico">＋</span>
      <span class="dash-action-text"><strong>Create Module</strong><span>ابدأ موديول جديد</span></span>
    </a>
    <a class="dash-action" href="content_manager.html#lessons">
      <span class="dash-action-ico">✎</span>
      <span class="dash-action-text"><strong>Continue Editing</strong><span>افتح محرر الدروس</span></span>
    </a>
    <a class="dash-action" href="learning_path.html?team=${encodeURIComponent(key)}">
      <span class="dash-action-ico">▶</span>
      <span class="dash-action-text"><strong>View Learning Path</strong><span>اعرض تجربة المتدرب</span></span>
    </a>`;
}

/* ---------- Manager review: assignment submissions ---------- */
const SUB_STATUSES = ["Pending Review", "Reviewed", "Needs Revision"];

function fmtDateTime(iso) {
  try {
    return new Date(iso).toLocaleString("en-GB",
      { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return iso || ""; }
}
function subStatusClass(s) {
  return s === "Reviewed" ? "is-pub" : (s === "Needs Revision" ? "is-locked" : "is-draft");
}

function submissionCard(sub) {
  const link = sub.submissionLink
    ? `<div class="sub-field"><strong>Link:</strong> <a href="${escHtml(sub.submissionLink)}" target="_blank" rel="noopener">${escHtml(sub.submissionLink)}</a></div>`
    : "";
  const answer = sub.textAnswer
    ? `<div class="sub-field"><strong>Text Answer:</strong><div class="sub-answer">${escHtml(sub.textAnswer)}</div></div>`
    : "";
  const notes = sub.notes ? `<div class="sub-field"><strong>Notes:</strong> ${escHtml(sub.notes)}</div>` : "";
  const ctx = [sub.moduleTitle, sub.lessonTitle, sub.assignmentTitle].filter(Boolean).map(escHtml).join(" · ");
  const opts = SUB_STATUSES.map(s => `<option value="${s}" ${sub.status === s ? "selected" : ""}>${s}</option>`).join("");
  return `
    <div class="sub-card" data-sub-id="${escHtml(sub.id)}">
      <div class="sub-top">
        <span class="sub-emp">${escHtml(sub.employeeName) || "—"}</span>
        <span class="cm-status ${subStatusClass(sub.status)}">${escHtml(sub.status)}</span>
        <span class="sub-date">${escHtml(fmtDateTime(sub.createdAt))}</span>
      </div>
      ${ctx ? `<div class="sub-ctx">${ctx}</div>` : ""}
      ${link}${answer}${notes}
      <div class="sub-review">
        <div class="field">
          <label>Status</label>
          <select data-sub-field="status">${opts}</select>
        </div>
        <div class="field">
          <label>Score</label>
          <input type="text" data-sub-field="score" value="${escHtml(sub.score || "")}" placeholder="e.g. 85 / 100" />
        </div>
        <div class="field field-full">
          <label>Feedback</label>
          <textarea data-sub-field="feedback" rows="2" placeholder="Feedback للمتدرب…">${escHtml(sub.feedback || "")}</textarea>
        </div>
        <div class="sub-review-actions">
          <button type="button" class="btn btn-primary" data-sub-save>Save Review</button>
          <span class="sub-msg" role="status" aria-live="polite"></span>
        </div>
      </div>
    </div>`;
}

function renderSubmissions(key) {
  const host = document.getElementById("dashSubmissions");
  if (!host) return;
  if (typeof loadSubmissions !== "function") { host.innerHTML = ""; return; }
  loadSubmissions().then(all => {
    const subs = (all || []).filter(s => s.academyKey === key);
    if (!subs.length) {
      host.innerHTML = `<p class="cm-hint">لا يوجد تسليمات لهذه الأكاديمية بعد.</p>`;
      return;
    }
    host.innerHTML = `<div class="sub-count">${subs.length} submission${subs.length > 1 ? "s" : ""}</div>` +
      subs.map(submissionCard).join("");
  });
}

/* Save a manager review (status / score / feedback) for one submission. */
function handleSubmissionSave(btn) {
  const card = btn.closest(".sub-card");
  if (!card) return;
  const id = card.getAttribute("data-sub-id");
  const get = f => { const el = card.querySelector('[data-sub-field="' + f + '"]'); return el ? el.value : ""; };
  const patch = { status: get("status"), score: get("score"), feedback: get("feedback"), reviewedAt: new Date().toISOString() };
  const msg = card.querySelector(".sub-msg");
  btn.disabled = true;
  if (msg) { msg.style.color = "#6b7280"; msg.textContent = "Saving…"; }
  Promise.resolve(updateSubmissionRemote(id, patch)).then(ok => {
    btn.disabled = false;
    // Reflect the status pill immediately.
    const pill = card.querySelector(".cm-status");
    if (pill) { pill.textContent = patch.status; pill.className = "cm-status " + subStatusClass(patch.status); }
    if (msg) { msg.style.color = "#16a34a"; msg.textContent = ok ? "Saved ✓" : "Saved locally ✓"; setTimeout(() => { msg.textContent = ""; }, 4000); }
  });
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const stats = document.getElementById("dashStats");
  if (!stats) return; // not the dashboard page

  const sel = document.getElementById("dashAcademy");
  sel.innerHTML = ACADEMIES.map(a => `<option value="${a.key}">${escHtml(a.name)}</option>`).join("");
  const key = getSelectedAcademy() || ACADEMIES[0].key;
  sel.value = key;
  setSelectedAcademy(key);

  sel.addEventListener("change", () => {
    setSelectedAcademy(sel.value);
    renderDashboard(sel.value);
    renderSubmissions(sel.value);
  });

  // Manager review: save status/score/feedback per submission.
  const subsHost = document.getElementById("dashSubmissions");
  if (subsHost) {
    subsHost.addEventListener("click", e => {
      const btn = e.target.closest("[data-sub-save]");
      if (btn) handleSubmissionSave(btn);
    });
  }

  renderDashboard(key);
  renderSubmissions(key);

  // Render from the local cache first (instant), then refresh from Supabase.
  if (typeof syncContentFromServer === "function") {
    syncContentFromServer().then(ok => { if (ok) renderDashboard(sel.value); });
  }

  // Reveal any newly-injected sections.
  document.querySelectorAll(".reveal:not(.in)").forEach((el, i) =>
    setTimeout(() => el.classList.add("in"), 40 * i));
});
