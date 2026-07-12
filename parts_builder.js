/* ============================================================
   Lesson Parts Builder (Content Manager — admin only)
   ------------------------------------------------------------
   Authors a Lesson as ordered PARTS. Each Part is a collapsible card
   (one open at a time) containing:
     - Part Title
     - Part Content (reuses the block builder: rich text, image, YouTube,
       file, resource, callouts, summary — the Knowledge Check block type is
       excluded here because each Part has its own dedicated Knowledge Check)
     - an optional Knowledge Check for that Part (reuses the inline KC editor)

   Public API (window.PartsBuilder):
     init(mountEl)   — build the UI once
     load(lesson)    — load a lesson's Parts (authored lesson.parts OR derived
                       from lesson.blocks / contentBody via lessonParts())
     reset()         — start a new lesson (one empty Part)
     clear()         — empty the builder
     getParts()      — current Parts (ordered, deep-copied, editors synced)
     count()         — number of Parts

   Persistence + Learning-Path rendering use lesson.parts (and a flattened
   lesson.blocks kept in sync for backward compatibility) — see academies.js.
   ============================================================ */
window.PartsBuilder = (function () {
  var mount = null, listEl = null;
  var parts = [];        // [{id, partNumber, title, order, status, blocks, knowledgeCheck, ...}]
  var openId = null;
  var kcEd = null;       // KC editor for the currently-open Part
  var kcOn = false;

  function nowISO() { return new Date().toISOString(); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function cssEsc(id) { return String(id).replace(/["\\]/g, "\\$&"); }
  function pid() { return (typeof partId === "function") ? partId() : ("part_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)); }
  function newPart(i) {
    return { id: pid(), partNumber: String(i + 1), title: "", order: i, status: "Published",
      blocks: [], knowledgeCheck: null, createdAt: nowISO(), updatedAt: nowISO() };
  }
  function find(id) { return parts.find(function (p) { return p.id === id; }); }
  function reindex() { parts.forEach(function (p, i) { p.order = i; p.partNumber = String(i + 1); }); }

  function defaultKc() {
    return (typeof kcDefaultData === "function") ? kcDefaultData()
      : { id: "kc_" + Math.random().toString(36).slice(2, 9), type: "mcq", question: "", choices: ["", ""], correct: 0, explanation: "" };
  }
  function kcSeed(kc) {
    var d = document.createElement("div"); d.className = "kc-block";
    d.setAttribute("data-kc", JSON.stringify(kc && kc.type ? kc : defaultKc()));
    return d.outerHTML;
  }
  function readKc(ed) {
    var t = document.createElement("div"); t.innerHTML = ed.getHTML();
    var el = t.querySelector(".kc-block[data-kc]");
    if (!el) return null;
    try { return JSON.parse(el.getAttribute("data-kc")); } catch (e) { return null; }
  }

  /* ---------- public ---------- */
  function init(mountEl) {
    if (!mountEl) return;
    mount = mountEl;
    mount.classList.add("parts-builder");
    mount.innerHTML =
      '<div class="parts-list" data-role="list"></div>' +
      '<div class="parts-add"><button type="button" class="btn btn-primary" data-role="add-part">+ Add Part</button></div>';
    listEl = mount.querySelector('[data-role="list"]');
    mount.querySelector('[data-role="add-part"]').addEventListener("click", function () { addPart(); });
    listEl.addEventListener("click", onListClick);
    listEl.addEventListener("input", onListInput);
    listEl.addEventListener("change", onKcToggle);
    if (!parts.length) { parts = [newPart(0)]; openId = parts[0].id; }
    render();
  }
  function load(lesson) {
    var arr = (typeof lessonParts === "function") ? lessonParts(lesson) : [];
    parts = arr.map(function (p) { return JSON.parse(JSON.stringify(p)); });
    if (!parts.length) parts = [newPart(0)];
    openId = parts[0].id;
    render();
  }
  function reset() { parts = [newPart(0)]; openId = parts[0].id; render(); }
  function clear() { parts = []; openId = null; if (listEl) listEl.innerHTML = ""; }
  function getParts() { syncOpen(); reindex(); return parts.map(function (p) { return JSON.parse(JSON.stringify(p)); }); }
  function count() { return parts.length; }

  /* Pull the currently-open Part's editors back into its object. */
  function syncOpen() {
    if (!openId || !listEl) return;
    var card = listEl.querySelector('.part-card[data-part-id="' + cssEsc(openId) + '"]');
    if (!card) return;
    var p = find(openId); if (!p) return;
    var titleEl = card.querySelector('[data-role="part-title"]'); if (titleEl) p.title = titleEl.value;
    if (window.LessonBlocks && LessonBlocks.getBlocks) {
      p.blocks = LessonBlocks.getBlocks().filter(function (b) { return b.type !== "knowledge"; });
    }
    var chk = card.querySelector('[data-role="kc-enabled"]');
    kcOn = chk ? chk.checked : kcOn;
    if (kcOn && kcEd) { var kc = readKc(kcEd); p.knowledgeCheck = kc || p.knowledgeCheck || defaultKc(); }
    else if (!kcOn) p.knowledgeCheck = null;
    p.updatedAt = nowISO();
  }

  /* ---------- render ---------- */
  function render() {
    reindex();
    if (!listEl) return;
    listEl.innerHTML = parts.map(cardHtml).join("");
    var openCard = openId ? listEl.querySelector('.part-card[data-part-id="' + cssEsc(openId) + '"]') : null;
    if (openCard) mountOpen(openCard, find(openId));
  }
  function partSummary(p) {
    var n = (Array.isArray(p.blocks) ? p.blocks.length : 0);
    return n + ' block' + (n === 1 ? '' : 's') + (p.knowledgeCheck && (p.knowledgeCheck.question || p.knowledgeCheck.type) ? ' · Knowledge Check' : '');
  }
  function cardHtml(p, i) {
    var isOpen = p.id === openId;
    return '<div class="part-card' + (isOpen ? ' is-open' : '') + '" data-part-id="' + esc(p.id) + '">' +
      '<div class="part-card-head" data-role="part-head">' +
        '<span class="part-badge">Part ' + esc(String(i + 1)) + '</span>' +
        '<span class="part-card-title">' + (esc(p.title) || 'Untitled Part') + '</span>' +
        '<span class="part-card-sub">' + esc(partSummary(p)) + '</span>' +
        '<span class="part-card-actions">' +
          '<button type="button" class="blk-act" data-part-act="up" title="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="blk-act" data-part-act="down" title="Move down"' + (i === parts.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button type="button" class="blk-act" data-part-act="dup" title="Duplicate Part">⧉</button>' +
          '<button type="button" class="blk-act blk-del" data-part-act="del" title="Delete Part">✕</button>' +
        '</span>' +
        '<span class="part-caret" aria-hidden="true">▾</span>' +
      '</div>' +
      '<div class="part-card-body"' + (isOpen ? '' : ' hidden') + '>' + (isOpen ? openBodyHtml(p) : '') + '</div>' +
    '</div>';
  }
  function openBodyHtml(p) {
    var on = !!(p.knowledgeCheck && (p.knowledgeCheck.type || p.knowledgeCheck.question));
    return '' +
      '<div class="part-field"><label>Part Title</label>' +
        '<input type="text" class="blk-input" data-role="part-title" placeholder="e.g. Purpose of Sales" value="' + esc(p.title) + '"></div>' +
      '<div class="part-field"><label>Part Content</label><div data-role="part-blocks"></div></div>' +
      '<div class="part-field part-kc-field">' +
        '<label class="part-kc-label"><input type="checkbox" data-role="kc-enabled"' + (on ? ' checked' : '') + '> Knowledge Check for this Part</label>' +
        '<div class="part-kc-mount" data-role="part-kc"' + (on ? '' : ' hidden') + '></div>' +
      '</div>';
  }
  function mountOpen(card, p) {
    if (!p) return;
    var bm = card.querySelector('[data-role="part-blocks"]');
    if (bm && window.LessonBlocks) { LessonBlocks.init(bm, { excludeTypes: ["knowledge"] }); LessonBlocks.load(p.blocks || []); }
    kcOn = !!(p.knowledgeCheck && (p.knowledgeCheck.type || p.knowledgeCheck.question));
    var km = card.querySelector('[data-role="part-kc"]');
    if (km && kcOn && typeof createRichEditor === "function") {
      kcEd = createRichEditor(km, { singleKc: true, onChange: function () { var kc = readKc(kcEd); var cur = find(openId); if (kc && cur) cur.knowledgeCheck = kc; } });
      kcEd.setHTML(kcSeed(p.knowledgeCheck));
    } else { kcEd = null; }
  }

  /* ---------- actions ---------- */
  function openPart(id) {
    if (id === openId) { syncOpen(); openId = null; render(); return; }
    syncOpen(); openId = id; render();
    var card = listEl.querySelector('.part-card[data-part-id="' + cssEsc(id) + '"]');
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function addPart() { syncOpen(); var p = newPart(parts.length); parts.push(p); openId = p.id; render(); }
  function duplicatePart(id) {
    syncOpen();
    var idx = parts.findIndex(function (p) { return p.id === id; });
    if (idx < 0) return;
    var copy = JSON.parse(JSON.stringify(parts[idx]));
    copy.id = pid();
    if (copy.knowledgeCheck) copy.knowledgeCheck.id = "kc_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
    copy.createdAt = copy.updatedAt = nowISO();
    parts.splice(idx + 1, 0, copy);
    openId = copy.id; render();
  }
  function deletePart(id) {
    if (!confirm("Delete this Part? This cannot be undone.")) return;
    syncOpen();
    parts = parts.filter(function (p) { return p.id !== id; });
    if (!parts.length) parts = [newPart(0)];
    if (openId === id) openId = parts[0].id;
    render();
  }
  function movePart(id, dir) {
    syncOpen();
    var idx = parts.findIndex(function (p) { return p.id === id; });
    var sw = idx + (dir === "up" ? -1 : 1);
    if (idx < 0 || sw < 0 || sw >= parts.length) return;
    var t = parts[idx]; parts[idx] = parts[sw]; parts[sw] = t;
    render();
  }

  function onListClick(e) {
    var act = e.target.closest("[data-part-act]");
    if (act) {
      var id = act.closest(".part-card").getAttribute("data-part-id");
      var a = act.getAttribute("data-part-act");
      if (a === "up") movePart(id, "up"); else if (a === "down") movePart(id, "down");
      else if (a === "dup") duplicatePart(id); else if (a === "del") deletePart(id);
      return;
    }
    var head = e.target.closest('[data-role="part-head"]');
    if (head) openPart(head.closest(".part-card").getAttribute("data-part-id"));
  }
  function onListInput(e) {
    var t = e.target.closest('[data-role="part-title"]');
    if (!t) return;
    var p = find(openId); if (!p) return;
    p.title = t.value;
    var titleEl = listEl.querySelector('.part-card.is-open .part-card-title');
    if (titleEl) titleEl.textContent = t.value || "Untitled Part";
  }
  function onKcToggle(e) {
    var chk = e.target.closest('[data-role="kc-enabled"]');
    if (!chk) return;
    var card = chk.closest(".part-card");
    var km = card.querySelector('[data-role="part-kc"]');
    kcOn = chk.checked;
    var p = find(openId);
    if (kcOn) {
      km.hidden = false;
      if (typeof createRichEditor === "function") {
        kcEd = createRichEditor(km, { singleKc: true, onChange: function () { var kc = readKc(kcEd); var cur = find(openId); if (kc && cur) cur.knowledgeCheck = kc; } });
        kcEd.setHTML(kcSeed(p ? p.knowledgeCheck : null));
      }
    } else {
      km.hidden = true; km.innerHTML = ""; kcEd = null;
      if (p) p.knowledgeCheck = null;
    }
  }

  return { init: init, load: load, reset: reset, clear: clear, getParts: getParts, count: count };
})();
