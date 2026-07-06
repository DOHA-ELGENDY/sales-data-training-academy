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
      break;
    case "lock":
      item.status = "Locked"; item.updatedAt = nowISO();
      saveContent(CM_ITEMS); renderModuleList();
      break;
    case "delete":
      if (confirm(`حذف "Module ${item.moduleNumber} — ${item.moduleTitle}"؟ لا يمكن التراجع.`)) {
        CM_ITEMS = CM_ITEMS.filter(it => it.id !== item.id);
        saveContent(CM_ITEMS); renderModuleList();
      }
      break;
  }
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  if (!$("moduleForm")) return; // not the Content Manager page

  // Academy dropdown drives both where new modules go AND which list shows.
  $("mAcademy").innerHTML = ACADEMIES.map(a => `<option value="${a.key}">${escHtml(a.name)}</option>`).join("");
  $("mAcademy").value = getSelectedAcademy() || ACADEMIES[0].key;

  CM_ITEMS = loadContent();
  renderModuleList();

  $("moduleForm").addEventListener("submit", saveModule);
  $("mResetBtn").addEventListener("click", resetForm);
  $("moduleList").addEventListener("click", handleListClick);

  // Switching academy keeps the whole portal's selected team in sync.
  $("mAcademy").addEventListener("change", () => {
    setSelectedAcademy($("mAcademy").value);
    resetForm();
    $("mAcademy").value = getSelectedAcademy();
    renderModuleList();
  });
});
