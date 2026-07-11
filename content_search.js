/* ============================================================
   Content Manager — Search (admin only)
   ------------------------------------------------------------
   A self-contained search over the CURRENTLY SELECTED academy's
   content. Reads only the in-memory cache (loadContent / loadLessons,
   which academies.js already populated from Supabase) — it never calls
   Supabase. A flat in-memory index is (re)built when Content Manager
   loads and whenever the cached content changes (detected via a cheap
   signature), then filtered on each debounced keystroke.

   Scope (selected academy only): Module Number/Title/Description,
   Lesson Number/Title, Rich Text + Summary block text, Assignment Title,
   Knowledge Check prompt/scenario, Resource Link Title.

   This file does NOT modify Module/Lesson CRUD or the Block Builder — it
   only reads content and reuses the existing navigation functions
   (switchTab, fillLessonForm, fillForm, renderStructureTree) to jump to
   a result and briefly highlight it.
   ============================================================ */
(function () {
  "use strict";

  var CONTENT_KEY_LS = "sdta_content_v2"; // must match academies.js
  var LESSONS_KEY_LS = "sdta_lessons_v1"; // must match academies.js

  var INDEX = [];
  var INDEX_SIG = "";
  var LAST_RESULTS = [];
  var els = {};
  var debTimer = null;

  /* ---------- text helpers ---------- */
  // Normalize for matching: lower-case (English), strip Arabic diacritics /
  // tatweel, unify Arabic letter forms, collapse spaces, trim. Makes matching
  // case-insensitive and tolerant of Arabic orthographic variation.
  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[ً-ْٰـ]/g, "")   // harakat + superscript alef + tatweel
      .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ -> ا
      .replace(/ى/g, "ي")                  // ى -> ي
      .replace(/ؤ/g, "و")                  // ؤ -> و
      .replace(/ئ/g, "ي")                  // ئ -> ي
      .replace(/ة/g, "ه")                  // ة -> ه
      .replace(/\s+/g, " ")
      .trim();
  }

  var _tmp = document.createElement("div");
  // Extract plain text from stored HTML. The div is detached, so no scripts run
  // and no resources load — same pattern block_builder.js already uses.
  function stripHtml(html) {
    if (html == null) return "";
    var s = String(html);
    if (s.indexOf("<") < 0 && s.indexOf("&") < 0) return s; // plain text fast path
    _tmp.innerHTML = s;
    return _tmp.textContent || _tmp.innerText || "";
  }

  function escH(s) {
    return (typeof escHtml === "function") ? escHtml(s)
      : String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function cssEsc(id) { return String(id).replace(/["\\]/g, "\\$&"); }

  /* ---------- scope + change detection ---------- */
  function scopeAcademy() {
    return (typeof getSelectedAcademy === "function" ? getSelectedAcademy() : "") || "";
  }
  function rawLen(key) { try { var v = localStorage.getItem(key); return v ? v.length : 0; } catch (e) { return 0; } }
  // Cheap signature (no JSON parse): academy + raw sizes of the two stores.
  function signature() { return scopeAcademy() + "|" + rawLen(CONTENT_KEY_LS) + "|" + rawLen(LESSONS_KEY_LS); }
  function maybeRebuild() { if (signature() !== INDEX_SIG) buildIndex(); }

  /* ---------- index ---------- */
  function fieldsOf(pairs) {
    var out = [];
    for (var i = 0; i < pairs.length; i++) {
      var text = (pairs[i][1] == null) ? "" : String(pairs[i][1]);
      if (!text.trim()) continue;
      out.push({ loc: pairs[i][0], text: text, n: norm(text) });
    }
    return out;
  }

  function buildIndex() {
    var academyKey = scopeAcademy();
    var ac = (typeof academyByKey === "function") ? academyByKey(academyKey) : null;
    var acName = ac ? ac.name : academyKey;
    var modules = (typeof loadContent === "function" ? loadContent() : []).filter(function (m) { return m && m.academyKey === academyKey; });
    var lessons = (typeof loadLessons === "function" ? loadLessons() : []).filter(function (l) { return l && l.academyKey === academyKey; });
    var byModule = {};
    modules.forEach(function (m) { byModule[m.id] = m; });

    var idx = [];

    modules.forEach(function (m) {
      idx.push({
        resultType: "Module", kind: "module",
        title: "M" + (m.moduleNumber || "") + " — " + (m.moduleTitle || "بدون عنوان"),
        moduleId: m.id, academyName: acName, academyKey: academyKey,
        fields: fieldsOf([
          ["Module Number", m.moduleNumber],
          ["Module Title", m.moduleTitle],
          ["Module Description", m.shortDesc]
        ])
      });
    });

    lessons.forEach(function (l) {
      var m = byModule[l.moduleId] || {};
      var parent = m.moduleTitle ? ("M" + (m.moduleNumber || "") + " — " + m.moduleTitle) : "—";

      idx.push({
        resultType: "Lesson", kind: "lesson",
        title: "L" + (l.lessonNumber || "") + " — " + (l.lessonTitle || "بدون عنوان"),
        moduleId: l.moduleId, lessonId: l.id, parentModule: parent, academyName: acName, academyKey: academyKey,
        fields: fieldsOf([
          ["Lesson Number", l.lessonNumber],
          ["Lesson Title", l.lessonTitle]
        ])
      });

      if (l.assignment && l.assignment.title) {
        idx.push({
          resultType: "Assignment", kind: "assignment",
          title: l.assignment.title,
          moduleId: l.moduleId, lessonId: l.id, parentModule: parent, academyName: acName, academyKey: academyKey,
          fields: fieldsOf([["Assignment Title", l.assignment.title]])
        });
      }

      var blocks = Array.isArray(l.blocks) ? l.blocks : [];
      blocks.forEach(function (b) {
        if (!b) return;
        if (b.type === "richtext" || b.type === "summary") {
          var txt = stripHtml(b.data && b.data.html);
          if (!txt.trim()) return;
          var loc = (b.type === "summary") ? "Summary" : "Rich Text";
          idx.push({
            resultType: "Content", kind: "block",
            title: loc + " — " + (l.lessonTitle || ""),
            moduleId: l.moduleId, lessonId: l.id, blockId: b.id, parentModule: parent, academyName: acName, academyKey: academyKey,
            fields: fieldsOf([[loc, txt]])
          });
        } else if (b.type === "knowledge") {
          var q = stripHtml(b.data && b.data.question);
          if (!q.trim()) return;
          idx.push({
            resultType: "Knowledge Check", kind: "block",
            title: "Knowledge Check — " + (l.lessonTitle || ""),
            moduleId: l.moduleId, lessonId: l.id, blockId: b.id, parentModule: parent, academyName: acName, academyKey: academyKey,
            fields: fieldsOf([["Knowledge Check Prompt", q]])
          });
        } else if (b.type === "resource") {
          var t = (b.data && b.data.title) || "";
          if (!String(t).trim()) return;
          idx.push({
            resultType: "Content", kind: "block",
            title: "Resource — " + (t || l.lessonTitle || ""),
            moduleId: l.moduleId, lessonId: l.id, blockId: b.id, parentModule: parent, academyName: acName, academyKey: academyKey,
            fields: fieldsOf([["Resource Link Title", t]])
          });
        }
      });
    });

    INDEX = idx;
    INDEX_SIG = signature();
  }

  /* ---------- search ---------- */
  function search(q) {
    var nq = norm(q);
    if (!nq) return [];
    var out = [];
    for (var i = 0; i < INDEX.length && out.length < 50; i++) {
      var rec = INDEX[i], hit = null;
      for (var j = 0; j < rec.fields.length; j++) {
        if (rec.fields[j].n.indexOf(nq) >= 0) { hit = rec.fields[j]; break; }
      }
      if (hit) out.push({ rec: rec, loc: hit.loc, snippet: makeSnippet(hit.text, q) });
    }
    return out;
  }

  // Snippet around the (case-insensitive) match with the hit wrapped in <mark>.
  // Falls back to the field's start when the match only succeeded via Arabic
  // normalization (so indices don't line up with the original text).
  function makeSnippet(text, q) {
    var clean = String(text).replace(/\s+/g, " ").trim();
    var lc = clean.toLowerCase();
    var lq = String(q).toLowerCase().replace(/\s+/g, " ").trim();
    var idx = lq ? lc.indexOf(lq) : -1;
    if (idx < 0) return escH(clean.slice(0, 110)) + (clean.length > 110 ? "…" : "");
    var start = Math.max(0, idx - 32), end = Math.min(clean.length, idx + lq.length + 48);
    return (start > 0 ? "…" : "")
      + escH(clean.slice(start, idx))
      + "<mark>" + escH(clean.slice(idx, idx + lq.length)) + "</mark>"
      + escH(clean.slice(idx + lq.length, end))
      + (end < clean.length ? "…" : "");
  }

  /* ---------- results UI ---------- */
  function typeSlug(t) {
    return { "Module": "module", "Lesson": "lesson", "Content": "content", "Assignment": "assignment", "Knowledge Check": "kc" }[t] || "content";
  }
  function renderResults(res) {
    var box = els.results;
    if (!res.length) {
      box.innerHTML = '<div class="cm-sr-empty">No matching content found.</div>';
      box.hidden = false;
      return;
    }
    box.innerHTML = res.map(function (r, i) {
      var rec = r.rec;
      var meta = [rec.parentModule, rec.academyName, r.loc].filter(Boolean).join(" · ");
      return '<div class="cm-sr-item" data-idx="' + i + '" role="option">'
        + '<span class="cm-sr-type cm-sr-type-' + typeSlug(rec.resultType) + '">' + escH(rec.resultType) + '</span>'
        + '<div class="cm-sr-main">'
        + '<div class="cm-sr-title">' + escH(rec.title) + '</div>'
        + '<div class="cm-sr-meta">' + escH(meta) + '</div>'
        + '<div class="cm-sr-snippet">' + r.snippet + '</div>'
        + '</div>'
        + '<div class="cm-sr-actions">'
        + '<button type="button" class="cm-sr-act" data-action="open" data-idx="' + i + '">Open</button>'
        + '<button type="button" class="cm-sr-act cm-sr-edit" data-action="edit" data-idx="' + i + '">Edit</button>'
        + '</div>'
        + '</div>';
    }).join("");
    box.hidden = false;
  }
  function closeResults() { if (els.results) { els.results.hidden = true; els.results.innerHTML = ""; } }

  function run() {
    maybeRebuild();
    var q = els.input.value.trim();
    els.clear.hidden = !els.input.value;
    if (!q) { closeResults(); return; }
    LAST_RESULTS = search(q);
    renderResults(LAST_RESULTS);
  }

  /* ---------- navigation to a result ---------- */
  function findLesson(id) {
    if (typeof LESSON_ITEMS !== "undefined" && Array.isArray(LESSON_ITEMS)) {
      var l = LESSON_ITEMS.find(function (x) { return x.id === id; });
      if (l) return l;
    }
    return (typeof loadLessons === "function" ? loadLessons() : []).find(function (x) { return x.id === id; });
  }
  function findModule(id) {
    if (typeof CM_ITEMS !== "undefined" && Array.isArray(CM_ITEMS)) {
      var m = CM_ITEMS.find(function (x) { return x.id === id; });
      if (m) return m;
    }
    return (typeof loadContent === "function" ? loadContent() : []).find(function (x) { return x.id === id; });
  }
  function flash(el) {
    if (!el) return;
    el.classList.remove("cm-flash");
    void el.offsetWidth;         // restart the animation if re-flashed
    el.classList.add("cm-flash");
    setTimeout(function () { el.classList.remove("cm-flash"); }, 2000);
  }

  function openResult(rec) {
    closeResults();
    if (rec.kind === "module") {
      if (typeof switchTab === "function") switchTab("lessons");
      if (typeof CM_TREE_COLLAPSED !== "undefined" && CM_TREE_COLLAPSED.delete) CM_TREE_COLLAPSED.delete(rec.moduleId);
      if (typeof renderStructureTree === "function") renderStructureTree();
      setTimeout(function () {
        var head = document.querySelector('#cmStructure [data-tree-mod="' + cssEsc(rec.moduleId) + '"]');
        if (head) { head.scrollIntoView({ behavior: "smooth", block: "center" }); flash(head); }
      }, 60);
      return;
    }
    var lesson = findLesson(rec.lessonId);
    if (!lesson) return;
    if (typeof switchTab === "function") switchTab("lessons");
    if (typeof fillLessonForm === "function") fillLessonForm(lesson); // opens editor + highlights the tree
    // Ensure the parent module is expanded in the structure tree.
    if (typeof CM_TREE_COLLAPSED !== "undefined" && CM_TREE_COLLAPSED.delete) {
      CM_TREE_COLLAPSED.delete(rec.moduleId);
      if (typeof renderStructureTree === "function") renderStructureTree();
    }
    setTimeout(function () {
      if (rec.kind === "block" && rec.blockId) {
        var card = document.querySelector('#lBlocks .blk-card[data-block-id="' + cssEsc(rec.blockId) + '"]');
        if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); flash(card); return; }
      }
      if (rec.kind === "assignment") {
        var asg = document.querySelector('#tab-lessons .cm-asg');
        if (asg) { asg.scrollIntoView({ behavior: "smooth", block: "center" }); flash(asg); return; }
      }
      var node = document.querySelector('#cmStructure [data-tree-lesson="' + cssEsc(rec.lessonId) + '"]');
      if (node) { node.scrollIntoView({ behavior: "smooth", block: "center" }); flash(node); }
    }, 140);
  }
  function editResult(rec) {
    if (rec.kind === "module") {
      closeResults();
      var mod = findModule(rec.moduleId);
      if (!mod) return;
      if (typeof switchTab === "function") switchTab("modules");
      if (typeof fillForm === "function") fillForm(mod); // opens the Module edit form
      return;
    }
    openResult(rec); // lesson-scoped items are edited in the lesson editor (== open)
  }

  /* ---------- wire up ---------- */
  function debounce(fn, ms) { clearTimeout(debTimer); debTimer = setTimeout(fn, ms); }

  document.addEventListener("DOMContentLoaded", function () {
    var wrap = document.getElementById("cmSearch");
    if (!wrap) return; // not the Content Manager page

    // Admin only. The page itself is already admin-guarded (identity.js), but we
    // also remove the search entirely for non-admins as a hard guarantee.
    var isAdmin = (typeof Identity !== "undefined" && Identity.isAdmin && Identity.isAdmin());
    if (!isAdmin) { wrap.remove(); return; }

    els.wrap = wrap;
    els.input = document.getElementById("cmSearchInput");
    els.clear = document.getElementById("cmSearchClear");
    els.results = document.getElementById("cmSearchResults");
    wrap.hidden = false;

    buildIndex();

    els.input.addEventListener("input", function () { debounce(run, 270); });
    els.input.addEventListener("focus", function () { maybeRebuild(); if (els.input.value.trim()) run(); });
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { els.input.value = ""; els.clear.hidden = true; closeResults(); }
    });
    els.clear.addEventListener("click", function () {
      els.input.value = ""; els.clear.hidden = true; closeResults(); els.input.focus();
    });
    els.results.addEventListener("click", function (e) {
      var actBtn = e.target.closest("[data-action]");
      if (actBtn) {
        var r = LAST_RESULTS[Number(actBtn.getAttribute("data-idx"))];
        if (r) { if (actBtn.getAttribute("data-action") === "edit") editResult(r.rec); else openResult(r.rec); }
        return;
      }
      var row = e.target.closest(".cm-sr-item");
      if (row) { var r2 = LAST_RESULTS[Number(row.getAttribute("data-idx"))]; if (r2) openResult(r2.rec); }
    });
    // Close when clicking outside the search widget.
    document.addEventListener("click", function (e) { if (!wrap.contains(e.target)) closeResults(); });
  });
})();
