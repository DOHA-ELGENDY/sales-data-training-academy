/* ============================================================
   Content Manager — Modules tab (front-end only)
   ------------------------------------------------------------
   Define module names/metadata per academy. Saved modules show up
   in the matching academy's Learning Path only. Detailed lesson
   content / assignments / resources are separate tabs (Coming Soon).
   Shared data + helpers live in academies.js. Data → localStorage.
   ============================================================ */

let CM_ITEMS = [];
const $ = (id) => document.getElementById(id);

/* Modules collapsed in the Content Structure tree (by module id).
   Kept in memory so the tree survives live re-renders. */
const CM_TREE_COLLAPSED = new Set();

function uid() {
  return "c" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function nowISO() { return new Date().toISOString(); }

/* ---------- Module list rendering ---------- */
function renderModuleList() {
  renderStructureTree(); // keep the Content Structure tree in sync
  const list = $("moduleList");
  const academyKey = $("mAcademy").value;
  const ac = academyByKey(academyKey);
  $("mListHeading").textContent = `Modules · ${ac ? ac.name : academyKey}`;

  const items = CM_ITEMS
    .filter(it => it.academyKey === academyKey)
    .sort((a, b) => (parseFloat(a.moduleNumber) || 0) - (parseFloat(b.moduleNumber) || 0));

  if (!items.length) {
    list.innerHTML = `
      <div class="cm-empty">
        <div class="cm-empty-ico">📄</div>
        <h3>لا يوجد Modules بعد</h3>
        <p class="muted">أضف أول Module لفريق ${escHtml(ac ? ac.name : academyKey)} من الفورم فوق.</p>
      </div>`;
    return;
  }

  const statusClass = { Published: "is-pub", Draft: "is-draft", Locked: "is-locked" };

  list.innerHTML = items.map(it => `
    <div class="cm-card reveal">
      <div class="cm-card-top">
        <span class="cm-num">M${escHtml(it.moduleNumber)}</span>
        <span class="cm-status ${statusClass[it.status] || "is-draft"}">${escHtml(it.status)}</span>
      </div>
      <h3 class="cm-card-title">${escHtml(it.moduleTitle) || "بدون عنوان"}</h3>
      <p class="cm-card-sub">${escHtml(it.shortDesc) || ""}</p>
      <div class="cm-card-meta">
        <span>⏱ ${escHtml(it.studyTime) || "—"}</span>
        <span>📊 ${escHtml(it.difficulty) || "—"}</span>
      </div>
      <div class="cm-card-actions">
        <button class="btn btn-ghost" data-act="edit" data-id="${it.id}">Edit</button>
        <button class="btn btn-ghost" data-act="publish" data-id="${it.id}" ${it.status === "Published" ? "disabled" : ""}>Publish</button>
        <button class="btn btn-ghost" data-act="lock" data-id="${it.id}" ${it.status === "Locked" ? "disabled" : ""}>Lock</button>
        <button class="btn btn-ghost cm-danger" data-act="delete" data-id="${it.id}">Delete</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".reveal").forEach((el, i) => setTimeout(() => el.classList.add("in"), 30 * i));
}

/* ---------- Form ---------- */
function resetForm() {
  $("mId").value = "";
  $("mNumber").value = "";
  $("mTitle").value = "";
  $("mDesc").value = "";
  $("mTime").value = "";
  $("mDiff").value = "Foundation";
  $("mStatus").value = "Draft";
  $("mSaveBtn").textContent = "Save Module";
  $("mResetBtn").hidden = true;
  $("mMsg").textContent = "";
}

function fillForm(it) {
  $("mId").value = it.id;
  $("mAcademy").value = it.academyKey;
  $("mNumber").value = it.moduleNumber;
  $("mTitle").value = it.moduleTitle;
  $("mDesc").value = it.shortDesc || "";
  $("mTime").value = it.studyTime || "";
  $("mDiff").value = it.difficulty || "Foundation";
  $("mStatus").value = it.status || "Draft";
  $("mSaveBtn").textContent = "Update Module";
  $("mResetBtn").hidden = false;
  $("mMsg").textContent = "";
  document.querySelector(".cm-tabpanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveModule(e) {
  e.preventDefault();
  const number = $("mNumber").value.trim();
  const title = $("mTitle").value.trim();
  const msg = $("mMsg");
  if (!number || !title) {
    msg.style.color = "#dc2626";
    msg.textContent = "Module Number و Module Title مطلوبين.";
    return;
  }

  const id = $("mId").value || uid();
  const existing = CM_ITEMS.find(it => it.id === id) || {};
  // Merge onto any existing item so future detail fields (content/assignment/…) are preserved.
  const item = Object.assign({}, existing, {
    id,
    academyKey: $("mAcademy").value,
    moduleNumber: number,
    moduleTitle: title,
    shortDesc: $("mDesc").value.trim(),
    studyTime: $("mTime").value.trim(),
    difficulty: $("mDiff").value,
    status: $("mStatus").value,
    updatedAt: nowISO()
  });

  const idx = CM_ITEMS.findIndex(it => it.id === id);
  if (idx >= 0) CM_ITEMS[idx] = item; else CM_ITEMS.push(item);
  saveContent(CM_ITEMS);
  setSelectedAcademy(item.academyKey);
  pushModule(item).then(refreshFromServer); // persist to Google Sheets, then re-sync

  resetForm();
  renderModuleList();
  msg.style.color = "#16a34a";
  msg.textContent = "تم الحفظ ✓";
  setTimeout(() => { if (msg.textContent === "تم الحفظ ✓") msg.textContent = ""; }, 2500);
}

/* ---------- Card actions ---------- */
function handleListClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const item = CM_ITEMS.find(it => it.id === btn.dataset.id);
  if (!item) return;

  switch (btn.dataset.act) {
    case "edit":
      fillForm(item);
      break;
    case "publish":
      item.status = "Published"; item.updatedAt = nowISO();
      saveContent(CM_ITEMS); renderModuleList();
      pushModule(item).then(refreshFromServer);
      break;
    case "lock":
      item.status = "Locked"; item.updatedAt = nowISO();
      saveContent(CM_ITEMS); renderModuleList();
      pushModule(item).then(refreshFromServer);
      break;
    case "delete":
      if (confirm(`حذف "Module ${item.moduleNumber} — ${item.moduleTitle}"؟ لا يمكن التراجع.`)) {
        CM_ITEMS = CM_ITEMS.filter(it => it.id !== item.id);
        saveContent(CM_ITEMS); renderModuleList();
        deleteModuleRemote(item.id).then(refreshFromServer);
      }
      break;
  }
}

/* ============================================================
   LESSONS / CONTENT TAB
   ============================================================ */
let LESSON_ITEMS = [];

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString("en-GB",
      { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return iso; }
}

/* Fill the Module dropdown with modules for the selected academy. */
function populateLessonModules(preferId) {
  const academyKey = $("lAcademy").value;
  const mods = modulesByAcademy(academyKey);
  const sel = $("lModule");
  if (!mods.length) {
    sel.innerHTML = `<option value="">لا توجد Modules بعد — أضفها من تاب Modules</option>`;
    return;
  }
  sel.innerHTML = mods.map(m =>
    `<option value="${m.id}">M${escHtml(m.moduleNumber)} — ${escHtml(m.moduleTitle)}</option>`).join("");
  if (preferId && mods.some(m => m.id === preferId)) sel.value = preferId;
}

/* Give every lesson in a module a clean sequential `order` (0,1,2,…) that
   matches its current display order. Runs before rendering so Move Up/Down
   and legacy lessons (with no order) always behave predictably. */
function ensureLessonOrder(moduleId) {
  const sorted = LESSON_ITEMS.filter(l => l.moduleId === moduleId).sort(compareLessons);
  let changed = false;
  sorted.forEach((l, i) => { if (l.order !== i) { l.order = i; changed = true; } });
  if (changed) saveLessons(LESSON_ITEMS);
  return sorted;
}

function renderLessonList() {
  renderStructureTree(); // keep the Content Structure tree in sync
  const list = $("lessonList");
  const moduleId = $("lModule").value;
  const mod = CM_ITEMS.find(m => m.id === moduleId);
  $("lListHeading").textContent = mod ? `Lessons · M${mod.moduleNumber} — ${mod.moduleTitle}` : "Lessons";

  if (!moduleId) {
    list.innerHTML = `
      <div class="cm-empty">
        <div class="cm-empty-ico">📄</div>
        <h3>اختر Module</h3>
        <p class="muted">أضف Module الأول من تاب <strong>Modules</strong>، بعدين تقدر تضيف دروسه هنا.</p>
      </div>`;
    return;
  }

  const items = ensureLessonOrder(moduleId);

  if (!items.length) {
    list.innerHTML = `
      <div class="cm-empty">
        <div class="cm-empty-ico">📝</div>
        <h3>لا يوجد دروس بعد</h3>
        <p class="muted">أضف أول درس للموديول من الفورم فوق.</p>
      </div>`;
    return;
  }

  list.innerHTML = items.map((l, i) => `
    <div class="cm-card reveal">
      <div class="cm-card-top">
        <span class="cm-num">L${escHtml(l.lessonNumber) || (i + 1)}</span>
        <span class="cm-status ${l.status === "Published" ? "is-pub" : "is-draft"}">${escHtml(l.status)}</span>
      </div>
      <h3 class="cm-card-title">${escHtml(l.lessonTitle) || "بدون عنوان"}</h3>
      ${l.assignment ? `<div class="cm-card-updated">📋 Assignment: ${escHtml(l.assignment.status || "Draft")}${l.assignment.title ? " — " + escHtml(l.assignment.title) : ""}</div>` : ""}
      <div class="cm-card-updated">Last updated: ${escHtml(fmtDate(l.updatedAt))}</div>
      <div class="cm-card-actions">
        <button class="btn btn-ghost" data-lact="up" data-id="${l.id}" ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
        <button class="btn btn-ghost" data-lact="down" data-id="${l.id}" ${i === items.length - 1 ? "disabled" : ""} title="Move down">↓</button>
        <button class="btn btn-ghost" data-lact="edit" data-id="${l.id}">Edit</button>
        <button class="btn btn-ghost" data-lact="toggle" data-id="${l.id}">${l.status === "Published" ? "Set Draft" : "Publish"}</button>
        <button class="btn btn-ghost cm-danger" data-lact="delete" data-id="${l.id}">Delete</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".reveal").forEach((el, i) => setTimeout(() => el.classList.add("in"), 30 * i));
}

/* Next free Lesson Number for a module (max existing + 1). */
function nextLessonNumber(moduleId) {
  const nums = LESSON_ITEMS
    .filter(l => l.moduleId === moduleId)
    .map(l => parseFloat(l.lessonNumber))
    .filter(n => !isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function clearLessonForm() {
  $("lId").value = "";
  $("lNumber").value = nextLessonNumber($("lModule").value);
  $("lTitle").value = "";
  $("lBody").value = "";
  $("lStatus").value = "Draft";
  $("lSaveBtn").textContent = "Save Lesson";
  $("lMsg").textContent = "";
  clearAssignmentFields();
}

function fillLessonForm(l) {
  setSelectedAcademy(l.academyKey);
  $("lAcademy").value = l.academyKey;
  populateLessonModules(l.moduleId);
  $("lModule").value = l.moduleId;
  $("lId").value = l.id;
  $("lNumber").value = l.lessonNumber || "";
  $("lTitle").value = l.lessonTitle || "";
  $("lBody").value = l.contentBody || "";
  $("lStatus").value = l.status || "Draft";
  $("lSaveBtn").textContent = "Update Lesson";
  fillAssignmentForm(l.assignment);
  renderLessonList();
  document.querySelector("#tab-lessons").scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveLesson(e) {
  e.preventDefault();
  const moduleId = $("lModule").value;
  const title = $("lTitle").value.trim();
  const body = $("lBody").value;
  const msg = $("lMsg");

  if (!moduleId) {
    msg.style.color = "#dc2626";
    msg.textContent = "اختر Module الأول (أضفه من تاب Modules).";
    return;
  }
  if (!title || !body.trim()) {
    msg.style.color = "#dc2626";
    msg.textContent = "Lesson Title و Lesson Content مطلوبين.";
    return;
  }

  const id = $("lId").value || uid();
  const mod = CM_ITEMS.find(m => m.id === moduleId);
  const existing = LESSON_ITEMS.find(l => l.id === id) || {};
  // Merge onto any existing lesson so its order (and any legacy fields) survive edits.
  const item = Object.assign({}, existing, {
    id,
    academyKey: $("lAcademy").value,
    moduleId,
    moduleNumber: mod ? mod.moduleNumber : "",
    lessonNumber: $("lNumber").value.trim(),
    lessonTitle: title,
    contentBody: body,
    status: $("lStatus").value,
    // New lessons go to the end of the module; existing ones keep their place.
    order: (existing.order === 0 || existing.order) ? existing.order
      : LESSON_ITEMS.filter(l => l.moduleId === moduleId).length,
    updatedAt: nowISO()
  });

  const idx = LESSON_ITEMS.findIndex(l => l.id === id);
  if (idx >= 0) LESSON_ITEMS[idx] = item; else LESSON_ITEMS.push(item);
  saveLessons(LESSON_ITEMS);
  setSelectedAcademy(item.academyKey);
  pushLesson(item); // best-effort persist; localStorage stays authoritative for now

  clearLessonForm();
  renderLessonList();
  msg.style.color = "#16a34a";
  msg.textContent = "تم الحفظ ✓";
  setTimeout(() => { if (msg.textContent === "تم الحفظ ✓") msg.textContent = ""; }, 2500);
}

/* Move a lesson up/down within its module (swaps order with its neighbour). */
function moveLesson(id, dir) {
  const item = LESSON_ITEMS.find(l => l.id === id);
  if (!item) return;
  const sorted = LESSON_ITEMS.filter(l => l.moduleId === item.moduleId).sort(compareLessons);
  const idx = sorted.findIndex(l => l.id === id);
  const swap = idx + (dir === "up" ? -1 : 1);
  if (swap < 0 || swap >= sorted.length) return;
  const a = sorted[idx], b = sorted[swap];
  const t = a.order; a.order = b.order; b.order = t;
  a.updatedAt = b.updatedAt = nowISO();
  saveLessons(LESSON_ITEMS);
  renderLessonList();
}

/* ---------- Lesson Assignment (nested inside the lesson) ---------- */
function clearAssignmentFields() {
  $("aTitle").value = "";
  $("aInstructions").value = "";
  $("aDeliverables").value = "";
  $("aTime").value = "";
  $("aMinScore").value = "";
  $("aSubmission").value = "File Link";
  $("aStatus").value = "Draft";
  $("aMsg").textContent = "";
}

function fillAssignmentForm(asg) {
  asg = asg || {};
  $("aTitle").value = asg.title || "";
  $("aInstructions").value = asg.instructions || "";
  $("aDeliverables").value = asg.deliverables || "";
  $("aTime").value = asg.estTime || "";
  $("aMinScore").value = asg.minScore || "";
  $("aSubmission").value = asg.submissionType || "File Link";
  $("aStatus").value = asg.status || "Draft";
  $("aMsg").textContent = "";
}

function saveAssignment() {
  const id = $("lId").value;
  const msg = $("aMsg");
  const lesson = id ? LESSON_ITEMS.find(l => l.id === id) : null;
  if (!lesson) {
    msg.style.color = "#dc2626";
    msg.textContent = "احفظ الدرس الأول (Save Lesson)، بعدين افتحه بـ Edit وأضف الـ Assignment.";
    return;
  }
  const title = $("aTitle").value.trim();
  const instructions = $("aInstructions").value.trim();
  if (!title || !instructions) {
    msg.style.color = "#dc2626";
    msg.textContent = "Assignment Title و Instructions مطلوبين.";
    return;
  }

  lesson.assignment = {
    title,
    instructions,
    deliverables: $("aDeliverables").value.trim(),
    estTime: $("aTime").value.trim(),
    minScore: $("aMinScore").value.trim(),
    submissionType: $("aSubmission").value,
    status: $("aStatus").value,
    updatedAt: nowISO()
  };
  lesson.updatedAt = nowISO();
  saveLessons(LESSON_ITEMS);
  pushLesson(lesson); // best-effort; localStorage stays authoritative
  renderLessonList();

  msg.style.color = "#16a34a";
  msg.textContent = "تم حفظ الـ Assignment ✓";
  setTimeout(() => { if (msg.textContent === "تم حفظ الـ Assignment ✓") msg.textContent = ""; }, 2500);
}

function removeAssignment() {
  const id = $("lId").value;
  const msg = $("aMsg");
  const lesson = id ? LESSON_ITEMS.find(l => l.id === id) : null;
  if (!lesson || !lesson.assignment) {
    clearAssignmentFields();
    msg.style.color = "#dc2626";
    msg.textContent = "مفيش Assignment على الدرس ده.";
    setTimeout(() => { if (msg.textContent) msg.textContent = ""; }, 2000);
    return;
  }
  if (!confirm("إزالة الـ Assignment من الدرس ده؟ لا يمكن التراجع.")) return;

  delete lesson.assignment;
  lesson.updatedAt = nowISO();
  saveLessons(LESSON_ITEMS);
  pushLesson(lesson);
  clearAssignmentFields();
  renderLessonList();

  msg.style.color = "#16a34a";
  msg.textContent = "تم إزالة الـ Assignment ✓";
  setTimeout(() => { if (msg.textContent === "تم إزالة الـ Assignment ✓") msg.textContent = ""; }, 2500);
}

function handleLessonListClick(e) {
  const btn = e.target.closest("[data-lact]");
  if (!btn) return;
  const item = LESSON_ITEMS.find(l => l.id === btn.dataset.id);
  if (!item) return;

  switch (btn.dataset.lact) {
    case "edit":
      fillLessonForm(item);
      break;
    case "up":
    case "down":
      moveLesson(item.id, btn.dataset.lact);
      break;
    case "toggle":
      item.status = item.status === "Published" ? "Draft" : "Published";
      item.updatedAt = nowISO();
      saveLessons(LESSON_ITEMS);
      renderLessonList();
      pushLesson(item);
      break;
    case "delete":
      if (confirm(`حذف الدرس "${item.lessonTitle || item.lessonNumber}"؟ لا يمكن التراجع.`)) {
        LESSON_ITEMS = LESSON_ITEMS.filter(l => l.id !== item.id);
        saveLessons(LESSON_ITEMS);
        renderLessonList();
        deleteLessonRemote(item.id);
      }
      break;
  }
}

/* ============================================================
   CONTENT STRUCTURE TREE (Academy → Modules → Lessons)
   ------------------------------------------------------------
   A navigation panel on the left of the Lessons tab. Clicking a
   lesson opens it in the editor; the tree re-renders on every data
   change (add / edit / delete / reorder) via renderModuleList /
   renderLessonList, so it always mirrors the current content.
   ============================================================ */
function renderStructureTree() {
  const host = $("cmStructure");
  if (!host) return;
  const academyKey = ($("lAcademy") && $("lAcademy").value) || getSelectedAcademy();
  const ac = academyByKey(academyKey);
  if (!ac) { host.innerHTML = ""; return; }

  const selectedId = $("lId") ? $("lId").value : "";
  const modules = modulesByAcademy(academyKey);

  const modulesHtml = modules.map(m => {
    const lessons = lessonsByModule(m.id);
    const collapsed = CM_TREE_COLLAPSED.has(m.id);
    const lessonsHtml = lessons.length
      ? lessons.map((l, i) => `
          <li>
            <button type="button" class="cm-tree-lesson${l.id === selectedId ? " is-selected" : ""}" data-tree-lesson="${l.id}">
              <span class="cm-tree-dot ${l.status === "Published" ? "is-pub" : "is-draft"}" aria-hidden="true"></span>
              <span class="cm-tree-lesson-title">L${escHtml(l.lessonNumber) || (i + 1)} — ${escHtml(l.lessonTitle) || "بدون عنوان"}</span>
            </button>
          </li>`).join("")
      : `<li class="cm-tree-empty">لا يوجد دروس</li>`;

    return `
      <li class="cm-tree-module${collapsed ? " is-collapsed" : ""}">
        <button type="button" class="cm-tree-mod-head" data-tree-mod="${m.id}" aria-expanded="${collapsed ? "false" : "true"}">
          <span class="cm-tree-caret" aria-hidden="true">▾</span>
          <span class="cm-tree-mod-title">M${escHtml(m.moduleNumber)} — ${escHtml(m.moduleTitle) || "بدون عنوان"}</span>
          <span class="cm-tree-count">${lessons.length}</span>
        </button>
        <ul class="cm-tree-lessons">${lessonsHtml}</ul>
      </li>`;
  }).join("");

  host.innerHTML = `
    <div class="cm-tree-head">
      <span class="cm-tree-academy">🏛️ ${escHtml(ac.name)}</span>
      <span class="cm-tree-sub">${modules.length} Modules</span>
    </div>
    <ul class="cm-tree-modules">
      ${modules.length ? modulesHtml : `<li class="cm-tree-empty">لا يوجد Modules — أضفها من تاب Modules</li>`}
    </ul>`;
}

function handleTreeClick(e) {
  const modHead = e.target.closest("[data-tree-mod]");
  if (modHead) {
    const id = modHead.dataset.treeMod;
    if (CM_TREE_COLLAPSED.has(id)) CM_TREE_COLLAPSED.delete(id);
    else CM_TREE_COLLAPSED.add(id);
    renderStructureTree();
    return;
  }
  const lessonBtn = e.target.closest("[data-tree-lesson]");
  if (lessonBtn) {
    const lesson = LESSON_ITEMS.find(l => l.id === lessonBtn.dataset.treeLesson);
    if (lesson) fillLessonForm(lesson); // opens it in the editor + highlights the tree
  }
}

/* ============================================================
   TABS
   ============================================================ */
function switchTab(tab) {
  document.querySelectorAll(".cm-tab").forEach(b => {
    if (!b.dataset.tab) return;
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  ["modules", "lessons"].forEach(t => {
    const panel = document.getElementById("tab-" + t);
    if (panel) panel.hidden = (t !== tab);
  });
}

/* ============================================================
   EXPORT / IMPORT (localStorage ↔ JSON file) — no backend
   ============================================================ */
function ioMsg(text, ok) {
  const el = $("cmIoMsg");
  if (!el) return;
  el.style.color = ok ? "#16a34a" : "#dc2626";
  el.textContent = text;
  setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 5000);
}

function exportContent() {
  const data = {
    app: "sales-data-training-academy",
    type: "content-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    modules: loadContent(),
    lessons: loadLessons()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "academy-content-backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  ioMsg(`تم تصدير academy-content-backup.json (${data.modules.length} Modules · ${data.lessons.length} Lessons) ✓`, true);
}

function importContent(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch (e) { ioMsg("الملف مش صالح (JSON غير صحيح).", false); return; }

    const modules = Array.isArray(data.modules) ? data.modules : [];
    const lessons = Array.isArray(data.lessons) ? data.lessons : [];
    if (!modules.length && !lessons.length) {
      ioMsg("الملف مافيهوش Modules أو Lessons.", false);
      return;
    }
    if (!confirm(`استيراد ${modules.length} Module و ${lessons.length} Lesson؟ ده هيستبدل المحتوى الحالي على الجهاز ده.`)) return;

    // Load into localStorage (the current storage) and re-render Content Manager.
    saveContent(modules);
    saveLessons(lessons);
    CM_ITEMS = loadContent();
    LESSON_ITEMS = loadLessons();
    renderModuleList();
    populateLessonModules($("lModule").value);
    renderLessonList();
    ioMsg(`تم الاستيراد: ${modules.length} Modules · ${lessons.length} Lessons ✓ — افتح Learning Path لرؤية المحتوى.`, true);
  };
  reader.readAsText(file);
}

/* Pull the latest content from the server and re-render both lists. */
function refreshFromServer() {
  syncContentFromServer().then(ok => {
    if (!ok) return;
    CM_ITEMS = loadContent();
    LESSON_ITEMS = loadLessons();
    renderModuleList();
    populateLessonModules($("lModule").value);
    renderLessonList();
  });
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  if (!$("moduleForm")) return; // not the Content Manager page

  const acadOptions = ACADEMIES.map(a => `<option value="${a.key}">${escHtml(a.name)}</option>`).join("");
  CM_ITEMS = loadContent();

  // ----- Modules tab -----
  $("mAcademy").innerHTML = acadOptions;
  $("mAcademy").value = getSelectedAcademy() || ACADEMIES[0].key;
  renderModuleList();
  $("moduleForm").addEventListener("submit", saveModule);
  $("mResetBtn").addEventListener("click", resetForm);
  $("moduleList").addEventListener("click", handleListClick);
  $("mAcademy").addEventListener("change", () => {
    setSelectedAcademy($("mAcademy").value);
    resetForm();
    renderModuleList();
  });

  // ----- Lessons / Content tab -----
  $("lAcademy").innerHTML = acadOptions;
  $("lAcademy").value = getSelectedAcademy() || ACADEMIES[0].key;
  LESSON_ITEMS = loadLessons();
  populateLessonModules();
  renderLessonList();
  clearLessonForm();
  $("lessonForm").addEventListener("submit", saveLesson);
  $("lClearBtn").addEventListener("click", clearLessonForm);
  $("lessonList").addEventListener("click", handleLessonListClick);
  $("aSaveBtn").addEventListener("click", saveAssignment);
  $("aRemoveBtn").addEventListener("click", removeAssignment);
  $("cmStructure").addEventListener("click", handleTreeClick);
  renderStructureTree();
  $("lAcademy").addEventListener("change", () => {
    setSelectedAcademy($("lAcademy").value);
    populateLessonModules();
    renderLessonList();
    clearLessonForm();
  });
  $("lModule").addEventListener("change", () => {
    renderLessonList();
    clearLessonForm();
  });

  // ----- Tabs -----
  document.querySelectorAll(".cm-tab[data-tab]").forEach(b => b.addEventListener("click", () => {
    switchTab(b.dataset.tab);
    if (b.dataset.tab === "lessons") {
      // Reflect the current academy + any newly-added modules.
      CM_ITEMS = loadContent();
      $("lAcademy").value = getSelectedAcademy() || $("lAcademy").value;
      populateLessonModules($("lModule").value);
      renderLessonList();
    } else if (b.dataset.tab === "modules") {
      $("mAcademy").value = getSelectedAcademy() || $("mAcademy").value;
      renderModuleList();
    }
  }));

  // ----- Export / Import content backup -----
  $("cmExportBtn").addEventListener("click", exportContent);
  $("cmImportBtn").addEventListener("click", () => $("cmImportFile").click());
  $("cmImportFile").addEventListener("change", e => {
    if (e.target.files && e.target.files[0]) importContent(e.target.files[0]);
    e.target.value = ""; // allow re-importing the same file
  });

  // ----- Initial sync from Google Sheets (falls back to cache) -----
  refreshFromServer();
});
