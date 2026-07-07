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

function uid() {
  return "c" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function nowISO() { return new Date().toISOString(); }

/* ---------- Module list rendering ---------- */
function renderModuleList() {
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

function renderLessonList() {
  const list = $("lessonList");
  const moduleId = $("lModule").value;
  const mod = CM_ITEMS.find(m => m.id === moduleId);
  $("lListHeading").textContent = mod ? `Content · M${mod.moduleNumber} — ${mod.moduleTitle}` : "Content";

  if (!moduleId) {
    list.innerHTML = `
      <div class="cm-empty">
        <div class="cm-empty-ico">📄</div>
        <h3>اختر Module</h3>
        <p class="muted">أضف Module الأول من تاب <strong>Modules</strong>، بعدين تقدر تضيف محتواه هنا.</p>
      </div>`;
    return;
  }

  const order = {};
  CONTENT_TYPES.forEach((t, i) => { order[t] = i; });
  const items = LESSON_ITEMS
    .filter(l => l.moduleId === moduleId)
    .sort((a, b) => (order[a.contentType] ?? 99) - (order[b.contentType] ?? 99));

  if (!items.length) {
    list.innerHTML = `
      <div class="cm-empty">
        <div class="cm-empty-ico">📝</div>
        <h3>لا يوجد محتوى بعد</h3>
        <p class="muted">أضف أول محتوى للموديول من الفورم فوق.</p>
      </div>`;
    return;
  }

  list.innerHTML = items.map(l => `
    <div class="cm-card reveal">
      <div class="cm-card-top">
        <span class="cm-type">${escHtml(l.contentType)}</span>
        <span class="cm-status ${l.status === "Published" ? "is-pub" : "is-draft"}">${escHtml(l.status)}</span>
      </div>
      <h3 class="cm-card-title">${escHtml(l.lessonTitle) || escHtml(l.contentType)}</h3>
      <div class="cm-card-updated">Last updated: ${escHtml(fmtDate(l.updatedAt))}</div>
      <div class="cm-card-actions">
        <button class="btn btn-ghost" data-lact="edit" data-id="${l.id}">Edit</button>
        <button class="btn btn-ghost" data-lact="toggle" data-id="${l.id}">${l.status === "Published" ? "Set Draft" : "Publish"}</button>
        <button class="btn btn-ghost cm-danger" data-lact="delete" data-id="${l.id}">Delete</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".reveal").forEach((el, i) => setTimeout(() => el.classList.add("in"), 30 * i));
}

function clearLessonForm() {
  $("lId").value = "";
  $("lTitle").value = "";
  $("lBody").value = "";
  $("lType").value = CONTENT_TYPES[0];
  $("lStatus").value = "Draft";
  $("lSaveBtn").textContent = "Save Content";
  $("lMsg").textContent = "";
}

function fillLessonForm(l) {
  setSelectedAcademy(l.academyKey);
  $("lAcademy").value = l.academyKey;
  populateLessonModules(l.moduleId);
  $("lModule").value = l.moduleId;
  $("lId").value = l.id;
  $("lTitle").value = l.lessonTitle || "";
  $("lType").value = l.contentType;
  $("lBody").value = l.contentBody || "";
  $("lStatus").value = l.status || "Draft";
  $("lSaveBtn").textContent = "Update Content";
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
    msg.textContent = "Lesson Title و Content Body مطلوبين.";
    return;
  }

  const id = $("lId").value || uid();
  const mod = CM_ITEMS.find(m => m.id === moduleId);
  const item = {
    id,
    academyKey: $("lAcademy").value,
    moduleId,
    moduleNumber: mod ? mod.moduleNumber : "",
    lessonTitle: title,
    contentType: $("lType").value,
    contentBody: body,
    status: $("lStatus").value,
    updatedAt: nowISO()
  };

  const idx = LESSON_ITEMS.findIndex(l => l.id === id);
  if (idx >= 0) LESSON_ITEMS[idx] = item; else LESSON_ITEMS.push(item);
  saveLessons(LESSON_ITEMS);
  setSelectedAcademy(item.academyKey);
  pushLesson(item).then(refreshFromServer); // persist to Google Sheets, then re-sync

  clearLessonForm();
  renderLessonList();
  msg.style.color = "#16a34a";
  msg.textContent = "تم الحفظ ✓";
  setTimeout(() => { if (msg.textContent === "تم الحفظ ✓") msg.textContent = ""; }, 2500);
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
    case "toggle":
      item.status = item.status === "Published" ? "Draft" : "Published";
      item.updatedAt = nowISO();
      saveLessons(LESSON_ITEMS);
      renderLessonList();
      pushLesson(item).then(refreshFromServer);
      break;
    case "delete":
      if (confirm(`حذف "${item.lessonTitle || item.contentType}"؟ لا يمكن التراجع.`)) {
        LESSON_ITEMS = LESSON_ITEMS.filter(l => l.id !== item.id);
        saveLessons(LESSON_ITEMS);
        renderLessonList();
        deleteLessonRemote(item.id).then(refreshFromServer);
      }
      break;
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
  $("lType").innerHTML = CONTENT_TYPES.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join("");
  $("lAcademy").innerHTML = acadOptions;
  $("lAcademy").value = getSelectedAcademy() || ACADEMIES[0].key;
  LESSON_ITEMS = loadLessons();
  populateLessonModules();
  renderLessonList();
  $("lessonForm").addEventListener("submit", saveLesson);
  $("lClearBtn").addEventListener("click", clearLessonForm);
  $("lessonList").addEventListener("click", handleLessonListClick);
  $("lAcademy").addEventListener("change", () => {
    setSelectedAcademy($("lAcademy").value);
    populateLessonModules();
    renderLessonList();
  });
  $("lModule").addEventListener("change", renderLessonList);

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

  // ----- Initial sync from Google Sheets (falls back to cache) -----
  refreshFromServer();
});
