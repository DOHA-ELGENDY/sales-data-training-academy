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
  const staticCards = Array.from(container.querySelectorAll(".level-card"));
  if (teamKey !== "sales-data") {
    staticCards.forEach(c => c.remove());
  }

  /* ---- Append this academy's modules from Content Manager ----
     Published → open module card · Locked → Coming Soon · Draft → hidden. */
  const modules = modulesForPath(teamKey);
  modules.forEach(m => container.insertAdjacentHTML("beforeend",
    m.status === "Locked" ? lockedCard(m) : moduleCard(m)));

  /* ---- Empty state if nothing to show ---- */
  if (!container.querySelector(".level-card")) {
    const sub = document.querySelector(".page-head .muted");
    if (sub) sub.textContent = `${ac.name} — لسه مفيش Modules منشورة.`;
    container.insertAdjacentHTML("beforeend", `
      <div class="cm-empty">
        <div class="cm-empty-ico">🗂️</div>
        <h3>No content yet</h3>
        <p class="muted">No content has been added for this team yet.</p>
        <p class="muted">${escHtml(ac.name)} — المحتوى هيظهر هنا تلقائيًا بمجرد إضافته ونشره من <strong>Content Manager</strong>.</p>
      </div>`);
  }

  // Entrance animation for any freshly added cards.
  container.querySelectorAll(".reveal:not(.in)").forEach((el, i) =>
    setTimeout(() => el.classList.add("in"), 30 * i));
});

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

  const content = m.content ? `<h4>Learning Content</h4><div class="cm-rendered">${renderRichText(m.content)}</div>` : "";
  const hasDetail = content || assignment || resources;
  const body = hasDetail
    ? `${content}${assignment}${resources}`
    : `<p class="muted" style="font-size:14px">المحتوى التفصيلي هيتضاف قريبًا.</p>`;

  return `
    <div class="level-card reveal">
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

/* Locked module → header-only "Coming Soon" card (not expandable). */
function lockedCard(m) {
  const subtitle = m.shortDesc || "";
  return `
    <div class="level-card locked-module reveal" aria-disabled="true">
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

/* ---- small DOM helpers ---- */
function setText(sel, text) { const el = document.querySelector(sel); if (el) el.textContent = text; }
function setLogo(initials) {
  document.querySelectorAll(".brand-logo, .topbar-logo").forEach(el => { el.textContent = initials; });
}
