/* ============================================================
   Content Manager — front-end only (no backend / no auth yet)
   ------------------------------------------------------------
   Data is simulated with plain JS objects and persisted in
   localStorage. Swap loadAll()/saveAll() for a Google Sheets or
   database layer later — nothing else needs to change.
   ============================================================ */

/* Academies this manager can handle (future-ready). */
const CM_ACADEMIES = [
  "Sales Data Academy",
  "Sales Academy",
  "Sales Accounting Academy",
  "Coordinator Academy",
  "Team Leader Academy",
  "Manager Academy"
];

const CM_STORAGE_KEY = "sdta_content_v1";

/* ---------- Data layer (replace these two later) ---------- */
function loadAll() {
  try {
    const raw = localStorage.getItem(CM_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt storage */ }
  return seed();
}
function saveAll(items) {
  localStorage.setItem(CM_STORAGE_KEY, JSON.stringify(items));
}

/* One example item so the list isn't empty on first load. */
function seed() {
  const items = [{
    id: uid(),
    academy: "Sales Data Academy",
    moduleNumber: "0",
    moduleTitle: "Entry Assessment",
    lessonTitle: "Entry Assessment",
    studyTime: "60–90 min",
    difficulty: "Easy",
    status: "Published",
    content: "# Entry Assessment\nتقييم عملي بسيط لتحديد المستوى الحالي قبل بداية التدريب.\n\n## What You'll Do\n- Business Knowledge\n- Excel & Google Sheets\n- Data Cleaning\n- Logical Thinking",
    asgTitle: "Assignment M0-A",
    asgObjective: "تجهيز ملف Leads خام وتوضيح المهارات الأساسية.",
    asgInstructions: "نظّف البيانات وجاوب على الأسئلة العملية.",
    asgDeliverables: "ملف Excel بعد التنظيف + Business Answers (Word/PDF).",
    asgTime: "60–90 min",
    asgScore: "—",
    asgFiles: "Google Sheet + Word/PDF",
    resVideo: "",
    resDrive: "",
    resPdf: "",
    resLinks: "",
    updatedAt: new Date().toISOString()
  }];
  saveAll(items);
  return items;
}

/* ---------- Helpers ---------- */
function uid() {
  return "c" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function nowISO() { return new Date().toISOString(); }
function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return iso; }
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Minimal "rich text" renderer for the Learning Content textarea.
   Supports: # H1, ## H2, - bullets, 1. numbered, blank line = paragraph.
   Designed so a real WYSIWYG editor can replace it later. */
function renderContent(text) {
  const lines = String(text || "").split(/\r?\n/);
  let html = "", listType = null;
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  for (const line of lines) {
    const t = line.trim();
    if (t === "") { closeList(); continue; }
    if (/^#\s+/.test(t)) { closeList(); html += `<h3>${esc(t.replace(/^#\s+/, ""))}</h3>`; }
    else if (/^##\s+/.test(t)) { closeList(); html += `<h4>${esc(t.replace(/^##\s+/, ""))}</h4>`; }
    else if (/^[-*]\s+/.test(t)) {
      if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; }
      html += `<li>${esc(t.replace(/^[-*]\s+/, ""))}</li>`;
    }
    else if (/^\d+\.\s+/.test(t)) {
      if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; }
      html += `<li>${esc(t.replace(/^\d+\.\s+/, ""))}</li>`;
    }
    else { closeList(); html += `<p>${esc(t)}</p>`; }
  }
  closeList();
  return html || '<p class="muted">لا يوجد محتوى.</p>';
}

/* ============================================================
   STATE + DOM
   ============================================================ */
let CM_ITEMS = [];
const $ = (id) => document.getElementById(id);

/* ---------- List rendering ---------- */
function renderList() {
  const list = $("cmList");
  const academy = $("cmAcademyFilter").value;
  const items = CM_ITEMS
    .filter(it => it.academy === academy)
    .sort((a, b) => (parseFloat(a.moduleNumber) || 0) - (parseFloat(b.moduleNumber) || 0));

  if (!items.length) {
    list.innerHTML = `
      <div class="cm-empty">
        <div class="cm-empty-ico">📄</div>
        <h3>لا يوجد محتوى بعد</h3>
        <p class="muted">اضغط <strong>+ Add Content</strong> لإنشاء أول Module في ${esc(academy)}.</p>
      </div>`;
    return;
  }

  list.innerHTML = items.map(it => `
    <div class="cm-card reveal">
      <div class="cm-card-top">
        <span class="cm-num">M${esc(it.moduleNumber)}</span>
        <span class="cm-status ${it.status === "Published" ? "is-pub" : "is-draft"}">${esc(it.status)}</span>
      </div>
      <h3 class="cm-card-title">${esc(it.moduleTitle) || "بدون عنوان"}</h3>
      <p class="cm-card-sub">${esc(it.lessonTitle) || ""}</p>
      <div class="cm-card-meta">
        <span>⏱ ${esc(it.studyTime) || "—"}</span>
        <span>📊 ${esc(it.difficulty)}</span>
      </div>
      <div class="cm-card-updated">Last updated: ${esc(fmtDate(it.updatedAt))}</div>
      <div class="cm-card-actions">
        <button class="btn btn-ghost" data-act="edit" data-id="${it.id}">Edit</button>
        <button class="btn btn-ghost" data-act="duplicate" data-id="${it.id}">Duplicate</button>
        <button class="btn btn-ghost" data-act="preview" data-id="${it.id}">Preview</button>
        <button class="btn btn-ghost cm-danger" data-act="delete" data-id="${it.id}">Delete</button>
      </div>
    </div>
  `).join("");

  // re-trigger the entrance animation for freshly injected cards
  list.querySelectorAll(".reveal").forEach((el, i) => setTimeout(() => el.classList.add("in"), 30 * i));
}

/* ============================================================
   SLIDE-OVER PANEL (Add / Edit)
   ============================================================ */
function openPanel(item) {
  const editing = !!item;
  $("cmPanelTitle").textContent = editing ? "Edit Content" : "Add Content";
  $("cmId").value = editing ? item.id : "";
  $("cmAcademy").value = editing ? item.academy : $("cmAcademyFilter").value;
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
    academy: $("cmAcademy").value,
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
  saveAll(CM_ITEMS);
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
      saveAll(CM_ITEMS);
      renderList();
      break;
    }
    case "delete":
      if (confirm(`حذف "${item.moduleTitle}"؟ لا يمكن التراجع.`)) {
        CM_ITEMS = CM_ITEMS.filter(it => it.id !== item.id);
        saveAll(CM_ITEMS);
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
  const resources = [
    it.resVideo && `<li>🎬 <a href="${esc(it.resVideo)}" target="_blank" rel="noopener">Video</a></li>`,
    it.resDrive && `<li>📁 <a href="${esc(it.resDrive)}" target="_blank" rel="noopener">Google Drive</a></li>`,
    it.resPdf && `<li>📄 <a href="${esc(it.resPdf)}" target="_blank" rel="noopener">PDF</a></li>`,
    ...String(it.resLinks || "").split(/\r?\n/).filter(Boolean).map(l => `<li>🔗 <a href="${esc(l.trim())}" target="_blank" rel="noopener">${esc(l.trim())}</a></li>`)
  ].filter(Boolean).join("");

  $("cmPreviewBody").innerHTML = `
    <div class="module-header">
      <div class="module-header-top">
        <span class="module-badge">M${esc(it.moduleNumber)}</span>
        <div class="module-heading">
          <span class="module-eyebrow">${esc(it.academy)}</span>
          <h1>Module ${esc(it.moduleNumber)} — ${esc(it.moduleTitle)}</h1>
        </div>
      </div>
      <div class="module-meta">
        <span class="meta-chip">⏱ ${esc(it.studyTime) || "—"}</span>
        <span class="meta-chip ${it.difficulty.toLowerCase()}">📊 ${esc(it.difficulty)}</span>
        <span class="meta-chip">${esc(it.status)}</span>
      </div>
    </div>

    <h2 class="block-title">Learning Content</h2>
    <div class="card cm-rendered">${renderContent(it.content)}</div>

    ${it.asgTitle || it.asgObjective ? `
    <h2 class="block-title">Assignment</h2>
    <div class="card">
      ${it.asgTitle ? `<h3 style="margin-bottom:8px">${esc(it.asgTitle)}</h3>` : ""}
      ${it.asgObjective ? `<p class="muted" style="font-size:14px"><strong>Objective:</strong> ${esc(it.asgObjective)}</p>` : ""}
      ${it.asgInstructions ? `<p class="muted" style="font-size:14px"><strong>Instructions:</strong> ${esc(it.asgInstructions)}</p>` : ""}
      ${it.asgDeliverables ? `<p class="muted" style="font-size:14px"><strong>Deliverables:</strong> ${esc(it.asgDeliverables)}</p>` : ""}
      <div class="level-meta" style="margin-top:12px">
        ${it.asgTime ? `<span class="pill time">⏱ ${esc(it.asgTime)}</span>` : ""}
        ${it.asgScore ? `<span class="pill pass">Minimum Required Score: ${esc(it.asgScore)}</span>` : ""}
        ${it.asgFiles ? `<span class="pill">Files: ${esc(it.asgFiles)}</span>` : ""}
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
  // find start of the current line
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

  // Populate academy selectors
  const optionsHtml = CM_ACADEMIES.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  $("cmAcademyFilter").innerHTML = optionsHtml;
  $("cmAcademy").innerHTML = optionsHtml;

  CM_ITEMS = loadAll();
  renderList();

  // Toolbar
  $("cmAddBtn").addEventListener("click", () => openPanel(null));
  $("cmAcademyFilter").addEventListener("change", renderList);

  // List actions (event delegation)
  $("cmList").addEventListener("click", handleListClick);

  // Panel controls
  $("cmCloseBtn").addEventListener("click", closePanel);
  $("cmCancelBtn").addEventListener("click", closePanel);
  $("cmOverlay").addEventListener("click", closePanel);
  $("cmSaveDraftBtn").addEventListener("click", () => saveWithStatus("Draft"));
  $("cmPublishBtn").addEventListener("click", () => saveWithStatus("Published"));

  // Faux toolbar
  document.querySelectorAll(".cm-faux-toolbar [data-fmt]").forEach(b =>
    b.addEventListener("click", () => applyFmt(b.dataset.fmt))
  );

  // Preview controls
  $("cmPreviewClose").addEventListener("click", closePreview);
  $("cmPreviewOverlay").addEventListener("click", e => { if (e.target === $("cmPreviewOverlay")) closePreview(); });

  // Escape closes panel / preview
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closePanel(); closePreview(); }
  });
});
