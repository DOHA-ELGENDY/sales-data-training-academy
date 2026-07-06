/* ============================================================
   Content Manager — front-end only (no backend / no auth yet)
   ------------------------------------------------------------
   Manages content for ALL academies from one place. Each item is
   tagged with academyKey and appears only under that academy's
   learning path. Shared data + helpers live in academies.js.
   ============================================================ */

let CM_ITEMS = [];
const $ = (id) => document.getElementById(id);

/* ---------- small helpers ---------- */
function uid() {
  return "c" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function nowISO() { return new Date().toISOString(); }
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString("en-GB",
      { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return iso; }
}

/* ---------- List rendering ---------- */
function renderList() {
  const list = $("cmList");
  const academyKey = $("cmAcademyFilter").value;
  const ac = academyByKey(academyKey);
  const items = CM_ITEMS
    .filter(it => it.academyKey === academyKey)
    .sort((a, b) => (parseFloat(a.moduleNumber) || 0) - (parseFloat(b.moduleNumber) || 0));

  if (!items.length) {
    list.innerHTML = `
      <div class="cm-empty">
        <div class="cm-empty-ico">📄</div>
        <h3>لا يوجد محتوى بعد</h3>
        <p class="muted">اضغط <strong>+ Add Content</strong> لإنشاء أول Module في ${escHtml(ac ? ac.name : academyKey)}.</p>
      </div>`;
    return;
  }

  list.innerHTML = items.map(it => `
    <div class="cm-card reveal">
      <div class="cm-card-top">
        <span class="cm-num">M${escHtml(it.moduleNumber)}</span>
        <span class="cm-status ${it.status === "Published" ? "is-pub" : "is-draft"}">${escHtml(it.status)}</span>
      </div>
      <h3 class="cm-card-title">${escHtml(it.moduleTitle) || "بدون عنوان"}</h3>
      <p class="cm-card-sub">${escHtml(it.lessonTitle) || ""}</p>
      <div class="cm-card-meta">
        <span>⏱ ${escHtml(it.studyTime) || "—"}</span>
        <span>📊 ${escHtml(it.difficulty)}</span>
      </div>
      <div class="cm-card-updated">Last updated: ${escHtml(fmtDate(it.updatedAt))}</div>
      <div class="cm-card-actions">
        <button class="btn btn-ghost" data-act="edit" data-id="${it.id}">Edit</button>
        <button class="btn btn-ghost" data-act="duplicate" data-id="${it.id}">Duplicate</button>
        <button class="btn btn-ghost" data-act="preview" data-id="${it.id}">Preview</button>
        <button class="btn btn-ghost cm-danger" data-act="delete" data-id="${it.id}">Delete</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".reveal").forEach((el, i) => setTimeout(() => el.classList.add("in"), 30 * i));
}

/* ============================================================
   SLIDE-OVER PANEL (Add / Edit)
   ============================================================ */
function openPanel(item) {
  const editing = !!item;
  $("cmPanelTitle").textContent = editing ? "Edit Content" : "Add Content";
  $("cmId").value = editing ? item.id : "";
  $("cmAcademy").value = editing ? item.academyKey : $("cmAcademyFilter").value;
  $("cmModuleNumber").value = editing ? item.moduleNumber : "";
  $("cmModuleTitle").value = editing ? item.moduleTitle : "";
  $("cmLessonTitle").value = editing ? item.lessonTitle : "";
  $("cmStudyTime").value = editing ? item.studyTime : "";
  $("cmDifficulty").value = editing ? item.difficulty : "Medium";
  $("cmStatus").value = editing ? item.status : "Draft";
  $("cmContent").value = editing ? item.content : "";
  $("cmAsgTitle").value = editing ? item.asgTitle : "";
  $("cmAsgObjective").value = editing ? item.asgObjective : "";
  $("cmAsgInstructions").value = editing ? item.asgInstructions : "";
  $("cmAsgDeliverables").value = editing ? item.asgDeliverables : "";
  $("cmAsgTime").value = editing ? item.asgTime : "";
  $("cmAsgScore").value = editing ? item.asgScore : "";
  $("cmAsgFiles").value = editing ? item.asgFiles : "";
  $("cmResVideo").value = editing ? item.resVideo : "";
  $("cmResDrive").value = editing ? item.resDrive : "";
  $("cmResPdf").value = editing ? item.resPdf : "";
  $("cmResLinks").value = editing ? item.resLinks : "";

  $("cmPanel").classList.add("open");
  $("cmOverlay").classList.add("show");
  $("cmPanel").setAttribute("aria-hidden", "false");
  $("cmPanel").scrollTop = 0;
  $("cmModuleNumber").focus();
}
function closePanel() {
  $("cmPanel").classList.remove("open");
  $("cmOverlay").classList.remove("show");
  $("cmPanel").setAttribute("aria-hidden", "true");
}

function collectForm() {
  return {
    id: $("cmId").value || uid(),
    academyKey: $("cmAcademy").value,
    moduleNumber: $("cmModuleNumber").value.trim(),
    moduleTitle: $("cmModuleTitle").value.trim(),
    lessonTitle: $("cmLessonTitle").value.trim(),
    studyTime: $("cmStudyTime").value.trim(),
    difficulty: $("cmDifficulty").value,
    status: $("cmStatus").value,
    content: $("cmContent").value,
    asgTitle: $("cmAsgTitle").value.trim(),
    asgObjective: $("cmAsgObjective").value.trim(),
    asgInstructions: $("cmAsgInstructions").value.trim(),
    asgDeliverables: $("cmAsgDeliverables").value.trim(),
    asgTime: $("cmAsgTime").value.trim(),
    asgScore: $("cmAsgScore").value.trim(),
    asgFiles: $("cmAsgFiles").value.trim(),
    resVideo: $("cmResVideo").value.trim(),
    resDrive: $("cmResDrive").value.trim(),
    resPdf: $("cmResPdf").value.trim(),
    resLinks: $("cmResLinks").value.trim(),
    updatedAt: nowISO()
  };
}

function saveWithStatus(status) {
  const data = collectForm();
  if (!data.moduleNumber || !data.moduleTitle) {
    alert("Module Number و Module Title مطلوبين.");
    return;
  }
  data.status = status;
  const idx = CM_ITEMS.findIndex(it => it.id === data.id);
  if (idx >= 0) CM_ITEMS[idx] = data; else CM_ITEMS.push(data);
  saveContent(CM_ITEMS);

  // Jump the list filter to the academy we just saved into, so it's visible,
  // and keep it as the portal's selected team.
  setSelectedAcademy(data.academyKey);
  $("cmAcademyFilter").value = data.academyKey;
  closePanel();
  renderList();
}

/* ============================================================
   CARD ACTIONS
   ============================================================ */
function handleListClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const item = CM_ITEMS.find(it => it.id === btn.dataset.id);
  if (!item) return;

  switch (btn.dataset.act) {
    case "edit":
      openPanel(item);
      break;
    case "duplicate": {
      const copy = Object.assign({}, item, {
        id: uid(),
        moduleTitle: item.moduleTitle + " (Copy)",
        status: "Draft",
        updatedAt: nowISO()
      });
      CM_ITEMS.push(copy);
      saveContent(CM_ITEMS);
      renderList();
      break;
    }
    case "delete":
      if (confirm(`حذف "${item.moduleTitle}"؟ لا يمكن التراجع.`)) {
        CM_ITEMS = CM_ITEMS.filter(it => it.id !== item.id);
        saveContent(CM_ITEMS);
        renderList();
      }
      break;
    case "preview":
      openPreview(item);
      break;
  }
}

/* ============================================================
   PREVIEW
   ============================================================ */
function openPreview(it) {
  const ac = academyByKey(it.academyKey);
  const resources = [
    it.resVideo && `<li>🎬 <a href="${escHtml(it.resVideo)}" target="_blank" rel="noopener">Video</a></li>`,
    it.resDrive && `<li>📁 <a href="${escHtml(it.resDrive)}" target="_blank" rel="noopener">Google Drive</a></li>`,
    it.resPdf && `<li>📄 <a href="${escHtml(it.resPdf)}" target="_blank" rel="noopener">PDF</a></li>`,
    ...String(it.resLinks || "").split(/\r?\n/).filter(Boolean).map(l => `<li>🔗 <a href="${escHtml(l.trim())}" target="_blank" rel="noopener">${escHtml(l.trim())}</a></li>`)
  ].filter(Boolean).join("");

  $("cmPreviewBody").innerHTML = `
    <div class="module-header">
      <div class="module-header-top">
        <span class="module-badge">M${escHtml(it.moduleNumber)}</span>
        <div class="module-heading">
          <span class="module-eyebrow">${escHtml(ac ? ac.name : it.academyKey)}</span>
          <h1>Module ${escHtml(it.moduleNumber)} — ${escHtml(it.moduleTitle)}</h1>
        </div>
      </div>
      <div class="module-meta">
        <span class="meta-chip">⏱ ${escHtml(it.studyTime) || "—"}</span>
        <span class="meta-chip ${String(it.difficulty).toLowerCase()}">📊 ${escHtml(it.difficulty)}</span>
        <span class="meta-chip">${escHtml(it.status)}</span>
      </div>
    </div>

    <h2 class="block-title">Learning Content</h2>
    <div class="card cm-rendered">${renderRichText(it.content)}</div>

    ${it.asgTitle || it.asgObjective ? `
    <h2 class="block-title">Assignment</h2>
    <div class="card">
      ${it.asgTitle ? `<h3 style="margin-bottom:8px">${escHtml(it.asgTitle)}</h3>` : ""}
      ${it.asgObjective ? `<p class="muted" style="font-size:14px"><strong>Objective:</strong> ${escHtml(it.asgObjective)}</p>` : ""}
      ${it.asgInstructions ? `<p class="muted" style="font-size:14px"><strong>Instructions:</strong> ${escHtml(it.asgInstructions)}</p>` : ""}
      ${it.asgDeliverables ? `<p class="muted" style="font-size:14px"><strong>Deliverables:</strong> ${escHtml(it.asgDeliverables)}</p>` : ""}
      <div class="level-meta" style="margin-top:12px">
        ${it.asgTime ? `<span class="pill time">⏱ ${escHtml(it.asgTime)}</span>` : ""}
        ${it.asgScore ? `<span class="pill pass">Minimum Required Score: ${escHtml(it.asgScore)}</span>` : ""}
        ${it.asgFiles ? `<span class="pill">Files: ${escHtml(it.asgFiles)}</span>` : ""}
      </div>
    </div>` : ""}

    ${resources ? `
    <h2 class="block-title">Resources</h2>
    <div class="card"><ul class="assess-list">${resources}</ul></div>` : ""}
  `;
  $("cmPreviewOverlay").classList.add("show");
}
function closePreview() { $("cmPreviewOverlay").classList.remove("show"); }

/* ============================================================
   FAUX RICH-TEXT TOOLBAR
   ============================================================ */
function applyFmt(marker) {
  const ta = $("cmContent");
  const start = ta.selectionStart;
  const val = ta.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  ta.value = val.slice(0, lineStart) + marker + val.slice(lineStart);
  ta.focus();
  const pos = lineStart + marker.length;
  ta.setSelectionRange(pos, pos);
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  if (!$("cmList")) return; // not the Content Manager page

  // Populate academy selectors from the shared academies list.
  const optionsHtml = ACADEMIES.map(a => `<option value="${a.key}">${escHtml(a.name)}</option>`).join("");
  $("cmAcademyFilter").innerHTML = optionsHtml;
  $("cmAcademy").innerHTML = optionsHtml;

  // Start on the currently selected team (the single source of truth).
  $("cmAcademyFilter").value = getSelectedAcademy() || ACADEMIES[0].key;

  CM_ITEMS = loadContent();
  renderList();

  $("cmAddBtn").addEventListener("click", () => openPanel(null));
  // Changing the filter changes the whole portal's selected team too.
  $("cmAcademyFilter").addEventListener("change", () => {
    setSelectedAcademy($("cmAcademyFilter").value);
    renderList();
  });
  $("cmList").addEventListener("click", handleListClick);

  $("cmCloseBtn").addEventListener("click", closePanel);
  $("cmCancelBtn").addEventListener("click", closePanel);
  $("cmOverlay").addEventListener("click", closePanel);
  $("cmSaveDraftBtn").addEventListener("click", () => saveWithStatus("Draft"));
  $("cmPublishBtn").addEventListener("click", () => saveWithStatus("Published"));

  document.querySelectorAll(".cm-faux-toolbar [data-fmt]").forEach(b =>
    b.addEventListener("click", () => applyFmt(b.dataset.fmt)));

  $("cmPreviewClose").addEventListener("click", closePreview);
  $("cmPreviewOverlay").addEventListener("click", e => { if (e.target === $("cmPreviewOverlay")) closePreview(); });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closePanel(); closePreview(); }
  });
});
