/* ============================================================
   Learning Path — team-aware, data-driven
   ------------------------------------------------------------
   One page serves every academy via ?team=<key>.
   - Sales Data keeps its approved static Module 0 (in the HTML).
   - Every academy also renders its Published Content-Manager
     modules. Teams with no content show a "No content yet" state.
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("learningPath");
  if (!container) return;

  const teamKey = getSelectedAcademy();
  if (!teamKey) { location.replace("index.html"); return; } // no team chosen → team selection
  const ac = academyByKey(teamKey);

  logLessonDiagnostics(teamKey); // TEMP: trace why lessons do/don't render (see console)

  /* ---- Rebrand the shell for this academy ---- */
  document.title = `Learning Path · ${ac.name}`;
  setText(".brand-text strong", ac.name);
  setText(".topbar-title", `${ac.name} — Learning Center`);
  setLogo(ac.logo);

  const head = document.querySelector(".page-head h1");
  if (head) head.textContent = `${ac.name} — Learning Path`;

  // Keep the team in the sidebar "Learning Path" link.
  const lpNav = document.querySelector('.nav-item[href^="learning_path.html"]');
  if (lpNav) lpNav.setAttribute("href", `learning_path.html?team=${teamKey}`);

  /* ---- Static content belongs to Sales Data only ---- */
  // The only .level-card elements present at load are the static ones.
  if (teamKey !== "sales-data") {
    container.querySelectorAll(".level-card").forEach(c => c.remove());
  }

  // Render from the local cache first (instant), then sync with Google Sheets.
  renderCmModules(teamKey, ac);
  syncContentFromServer().then(ok => { if (ok) renderCmModules(teamKey, ac); });

  // Lesson accordion: expand the clicked lesson, collapse the rest in that
  // module (one open at a time). Scoped to the module's own .lesson-acc.
  container.addEventListener("click", e => {
    const head = e.target.closest("[data-lesson-toggle]");
    if (!head || !container.contains(head)) return;
    const item = head.closest(".lesson-acc-item");
    const acc = head.closest(".lesson-acc");
    if (!item || !acc) return;
    const willOpen = !item.classList.contains("open");
    acc.querySelectorAll(".lesson-acc-item.open").forEach(it => {
      it.classList.remove("open");
      const h = it.querySelector("[data-lesson-toggle]");
      if (h) h.setAttribute("aria-expanded", "false");
    });
    if (willOpen) { item.classList.add("open"); head.setAttribute("aria-expanded", "true"); }
  });
});

/* Render (or re-render) the Content-Manager modules for a team.
   Removes previously CM-added cards, then appends the current set. */
function renderCmModules(teamKey, ac) {
  const container = document.getElementById("learningPath");
  container.querySelectorAll(".cm-added").forEach(el => el.remove());

  const modules = modulesForPath(teamKey);
  modules.forEach(m => container.insertAdjacentHTML("beforeend",
    m.status === "Locked" ? lockedCard(m) : moduleCard(m)));

  const sub = document.querySelector(".page-head .muted");
  if (!container.querySelector(".level-card")) {
    if (sub) sub.textContent = `${ac.name} — No content yet.`;
    container.insertAdjacentHTML("beforeend", `
      <div class="cm-empty cm-added">
        <div class="cm-empty-ico">🗂️</div>
        <h3>No content yet</h3>
        <p class="muted">No content has been added for this team yet.</p>
        <p class="muted">${escHtml(ac.name)} — المحتوى هيظهر هنا تلقائيًا بمجرد إضافته ونشره من <strong>Content Manager</strong>.</p>
      </div>`);
  } else if (teamKey !== "sales-data" && sub) {
    sub.textContent = `${ac.name} — اضغط على أي Module علشان يفتح محتواه.`;
  }

  container.querySelectorAll(".reveal:not(.in)").forEach((el, i) =>
    setTimeout(() => el.classList.add("in"), 30 * i));
}

/* Published module → open accordion card. */
function moduleCard(m) {
  const bodyId = "body-cm-" + m.id;
  const subtitle = m.shortDesc || m.lessonTitle || "";
  const chips = [
    m.studyTime ? `<span class="meta-chip">⏱ ${escHtml(m.studyTime)}</span>` : "",
    m.difficulty ? `<span class="meta-chip">📊 ${escHtml(m.difficulty)}</span>` : ""
  ].join("");

  const assignment = (m.asgTitle || m.asgObjective || m.asgInstructions || m.asgDeliverables) ? `
    <h4>Assignment</h4>
    ${m.asgTitle ? `<p><strong>${escHtml(m.asgTitle)}</strong></p>` : ""}
    ${m.asgObjective ? `<p><strong>Objective:</strong> ${escHtml(m.asgObjective)}</p>` : ""}
    ${m.asgInstructions ? `<p><strong>Instructions:</strong> ${escHtml(m.asgInstructions)}</p>` : ""}
    ${m.asgDeliverables ? `<p><strong>Deliverables:</strong> ${escHtml(m.asgDeliverables)}</p>` : ""}` : "";

  const resItems = [
    m.resVideo ? `<li>🎬 <a href="${escHtml(m.resVideo)}" target="_blank" rel="noopener">Video</a></li>` : "",
    m.resDrive ? `<li>📁 <a href="${escHtml(m.resDrive)}" target="_blank" rel="noopener">Google Drive</a></li>` : "",
    m.resPdf ? `<li>📄 <a href="${escHtml(m.resPdf)}" target="_blank" rel="noopener">PDF</a></li>` : "",
    ...String(m.resLinks || "").split(/\r?\n/).filter(Boolean)
      .map(l => `<li>🔗 <a href="${escHtml(l.trim())}" target="_blank" rel="noopener">${escHtml(l.trim())}</a></li>`)
  ].filter(Boolean).join("");
  const resources = resItems ? `<h4>Resources</h4><ul>${resItems}</ul>` : "";

  // Published lessons → lesson list + single content panel (one lesson at a time).
  const lessons = publishedLessonsForModule(m.id);
  let body;
  if (lessons.length) {
    body = lessonView(lessons);
  } else if (m.content || assignment || resources) {
    // Backward-compat for any legacy module-level content.
    const content = m.content ? `<h4>Learning Content</h4><div class="cm-rendered">${renderRichText(m.content)}</div>` : "";
    body = `${content}${assignment}${resources}`;
  } else {
    body = `<p class="muted" style="font-size:14px">المحتوى التفصيلي هيتضاف قريبًا.</p>`;
  }

  return `
    <div class="level-card cm-added reveal">
      <div class="level-head" data-acc-toggle role="button" tabindex="0"
           aria-expanded="false" aria-controls="${bodyId}">
        <div class="level-badge">M${escHtml(m.moduleNumber)}</div>
        <div class="level-head-text">
          <h3>Module ${escHtml(m.moduleNumber)} — ${escHtml(m.moduleTitle)}</h3>
          ${subtitle ? `<p>${escHtml(subtitle)}</p>` : ""}
        </div>
        <div class="level-toggle" aria-hidden="true">▾</div>
      </div>
      <div class="level-body" id="${bodyId}">
        ${chips ? `<div class="module-meta" style="margin-bottom:14px">${chips}</div>` : ""}
        ${body}
      </div>
    </div>`;
}

/* Lessons as child accordions inside a module. Each lesson collapses/expands
   like the module itself; only one lesson is open at a time (per module). */
function lessonView(lessons) {
  const items = lessons.map((l, i) => `
    <div class="lesson-acc-item">
      <button type="button" class="lesson-acc-head" data-lesson-toggle aria-expanded="false">
        <span class="lesson-acc-title">Lesson ${i + 1} — ${escHtml(l.lessonTitle || l.contentType)}</span>
        <span class="lesson-acc-caret" aria-hidden="true">▾</span>
      </button>
      <div class="lesson-acc-body">
        <div class="cm-rendered">${renderRichText(l.contentBody)}</div>
      </div>
    </div>`).join("");

  return `<div class="lesson-acc">${items}</div>`;
}

/* Locked module → header-only "Coming Soon" card (not expandable). */
function lockedCard(m) {
  const subtitle = m.shortDesc || "";
  return `
    <div class="level-card locked-module cm-added reveal" aria-disabled="true">
      <div class="level-head">
        <div class="level-badge locked-badge">M${escHtml(m.moduleNumber)}</div>
        <div class="level-head-text">
          <h3>Module ${escHtml(m.moduleNumber)} — ${escHtml(m.moduleTitle)}</h3>
          ${subtitle ? `<p>${escHtml(subtitle)}</p>` : ""}
        </div>
        <span class="pill locked-pill">🔒 Locked</span>
      </div>
    </div>`;
}

/* ============================================================
   TEMP DIAGNOSTICS — remove once lessons are confirmed working.
   Prints exactly why lessons do / don't appear for this team.
   Re-run any time in the console with:  lpDiag()
   ============================================================ */
function logLessonDiagnostics(teamKey) {
  try {
    const allModules = (typeof loadContent === "function") ? loadContent() : [];
    const allLessons = (typeof loadLessons === "function") ? loadLessons() : [];
    const teamModules = allModules.filter(m => m.academyKey === teamKey);

    console.group("%c[LessonDiag] Learning Path content trace", "color:#2563eb;font-weight:bold");
    console.log("Team:", teamKey);
    console.log("remoteContentReady (Google Sheets active?):", typeof remoteContentReady !== "undefined" ? remoteContentReady : "n/a");
    console.log("Modules in localStorage for this team:", teamModules.length,
      teamModules.map(m => ({ id: m.id, number: m.moduleNumber, title: m.moduleTitle, status: m.status })));
    console.log("ALL lessons in localStorage:", allLessons.length,
      allLessons.map(l => ({ id: l.id, moduleId: l.moduleId, title: l.lessonTitle, type: l.contentType, status: l.status })));

    if (!teamModules.length) {
      console.warn("→ No modules for this team ON THIS DEVICE. If you created them on another laptop, localStorage does NOT sync — use Content Manager → Import Content here, or deploy the Apps Script backend.");
    }
    teamModules.forEach(m => {
      const linked = allLessons.filter(l => l.moduleId === m.id);
      const published = linked.filter(l => l.status === "Published");
      console.log(`Module "${m.moduleTitle}" [status=${m.status}] id=${m.id} → ${linked.length} linked lesson(s), ${published.length} Published`);
      if (m.status === "Draft") console.warn(`   • Module is DRAFT → hidden from Learning Path. Set it to Published.`);
      if (m.status === "Locked") console.warn(`   • Module is LOCKED → shows as "Coming Soon" with no lesson body.`);
      if (linked.length && !published.length) console.warn(`   • Lessons exist but all are DRAFT → hidden. Open Content Manager → Lessons → Publish them.`);
      if (!linked.length && allLessons.some(l => l.academyKey === m.academyKey)) console.warn(`   • Lessons exist for this academy but none point to this module's id (moduleId mismatch).`);
    });
    console.groupEnd();
  } catch (e) { console.warn("[LessonDiag] error:", e); }
}
try { window.lpDiag = () => logLessonDiagnostics(getSelectedAcademy()); } catch (e) {}

/* ---- small DOM helpers ---- */
function setText(sel, text) { const el = document.querySelector(sel); if (el) el.textContent = text; }
function setLogo(initials) {
  document.querySelectorAll(".brand-logo, .topbar-logo").forEach(el => { el.textContent = initials; });
}
