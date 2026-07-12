/* ============================================================
   Learning Path — Search (employee)
   ------------------------------------------------------------
   Searches ONLY the employee's currently-selected academy, using the
   already-loaded cache (loadContent / loadLessons) — never Supabase.
   A flat in-memory index is built on load and rebuilt when the cached
   content changes (cheap signature check), then filtered per debounced
   keystroke.

   Scope: Module Title/Description, Lesson Title, Rich Text + Summary
   block text, Knowledge Check prompt/scenario, Assignment Title,
   Resource Link Title — for PUBLISHED modules + lessons only.

   Navigation RESPECTS Knowledge Check gating: if a match sits behind a
   locked gate, it opens the lesson, scrolls to the nearest visible point
   and shows a message instead of revealing the gated content.
   ============================================================ */
(function () {
  "use strict";

  var CONTENT_KEY_LS = "sdta_content_v2"; // must match academies.js
  var LESSONS_KEY_LS = "sdta_lessons_v1"; // must match academies.js

  var INDEX = [], INDEX_SIG = "", LAST = [], els = {}, debTimer = null, toastTimer = null;

  /* ---------- text ---------- */
  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[ً-ْٰـ]/g, "")
      .replace(/[آأإٱ]/g, "ا")
      .replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ة/g, "ه")
      .replace(/\s+/g, " ").trim();
  }
  var _tmp = document.createElement("div");
  function stripHtml(html) {
    if (html == null) return "";
    var s = String(html);
    if (s.indexOf("<") < 0 && s.indexOf("&") < 0) return s;
    _tmp.innerHTML = s;
    return _tmp.textContent || _tmp.innerText || "";
  }
  function escH(s) {
    return (typeof escHtml === "function") ? escHtml(s)
      : String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function cssEsc(id) { return String(id).replace(/["\\]/g, "\\$&"); }

  /* ---------- scope + change detection ---------- */
  function scope() { return (typeof getSelectedAcademy === "function" ? getSelectedAcademy() : "") || ""; }
  function rawLen(k) { try { var v = localStorage.getItem(k); return v ? v.length : 0; } catch (e) { return 0; } }
  function signature() { return scope() + "|" + rawLen(CONTENT_KEY_LS) + "|" + rawLen(LESSONS_KEY_LS); }
  function maybeRebuild() { if (signature() !== INDEX_SIG) buildIndex(); }

  /* ---------- index ---------- */
  function fieldsOf(pairs) {
    var out = [];
    for (var i = 0; i < pairs.length; i++) {
      var t = (pairs[i][1] == null) ? "" : String(pairs[i][1]);
      if (!t.trim()) continue;
      out.push({ loc: pairs[i][0], text: t, n: norm(t) });
    }
    return out;
  }
  function buildIndex() {
    var academyKey = scope();
    // Employees only reach Published modules + Published lessons.
    var modules = (typeof loadContent === "function" ? loadContent() : [])
      .filter(function (m) { return m && m.academyKey === academyKey && m.status === "Published"; });
    var byId = {}; modules.forEach(function (m) { byId[m.id] = m; });
    var lessons = (typeof loadLessons === "function" ? loadLessons() : [])
      .filter(function (l) { return l && l.academyKey === academyKey && l.status === "Published" && byId[l.moduleId]; });

    var idx = [];
    modules.forEach(function (m) {
      idx.push({
        resultType: "Module", kind: "module",
        title: "M" + (m.moduleNumber || "") + " — " + (m.moduleTitle || ""),
        moduleId: m.id,
        fields: fieldsOf([["Module Title", m.moduleTitle], ["Module Description", m.shortDesc]])
      });
    });
    lessons.forEach(function (l) {
      var m = byId[l.moduleId] || {};
      var parent = "M" + (m.moduleNumber || "") + " — " + (m.moduleTitle || "");
      idx.push({
        resultType: "Lesson", kind: "lesson",
        title: "L" + (l.lessonNumber || "") + " — " + (l.lessonTitle || ""),
        moduleId: l.moduleId, lessonId: l.id, parentModule: parent,
        fields: fieldsOf([["Lesson Title", l.lessonTitle]])
      });
      if (l.assignment && l.assignment.status === "Published" && l.assignment.title) {
        idx.push({
          resultType: "Assignment", kind: "assignment",
          title: l.assignment.title,
          moduleId: l.moduleId, lessonId: l.id, parentModule: parent,
          fields: fieldsOf([["Assignment Title", l.assignment.title]])
        });
      }
      var blocks = Array.isArray(l.blocks) ? l.blocks : [];
      blocks.forEach(function (b) {
        if (!b || b.status === "Draft") return;
        if (b.type === "richtext" || b.type === "summary") {
          var txt = stripHtml(b.data && b.data.html);
          if (!txt.trim()) return;
          idx.push({
            resultType: "Topic", kind: "block",
            title: (b.type === "summary" ? "Summary" : "Topic") + " — " + (l.lessonTitle || ""),
            moduleId: l.moduleId, lessonId: l.id, blockId: b.id, parentModule: parent,
            fields: fieldsOf([[b.type === "summary" ? "Summary" : "Rich Text", txt]])
          });
        } else if (b.type === "knowledge") {
          var q = stripHtml(b.data && b.data.question);
          if (!q.trim()) return;
          idx.push({
            resultType: "Knowledge Check", kind: "block", isKc: true,
            title: "Knowledge Check — " + (l.lessonTitle || ""),
            // match the Part's knowledgeCheck by its data id (not the block id)
            moduleId: l.moduleId, lessonId: l.id, blockId: (b.data && b.data.id) || b.id, parentModule: parent,
            fields: fieldsOf([["Knowledge Check Prompt", q]])
          });
        } else if (b.type === "resource") {
          var t = (b.data && b.data.title) || "";
          if (!String(t).trim()) return;
          idx.push({
            resultType: "Topic", kind: "block",
            title: "Resource — " + (t || l.lessonTitle || ""),
            moduleId: l.moduleId, lessonId: l.id, blockId: b.id, parentModule: parent,
            fields: fieldsOf([["Resource Link Title", t]])
          });
        }
      });
    });
    INDEX = idx; INDEX_SIG = signature();
  }

  /* ---------- search ---------- */
  function search(q) {
    var nq = norm(q); if (!nq) return [];
    var out = [];
    for (var i = 0; i < INDEX.length && out.length < 50; i++) {
      var rec = INDEX[i], hit = null;
      for (var j = 0; j < rec.fields.length; j++) { if (rec.fields[j].n.indexOf(nq) >= 0) { hit = rec.fields[j]; break; } }
      if (hit) out.push({ rec: rec, loc: hit.loc, snippet: makeSnippet(hit.text, q) });
    }
    return out;
  }
  function makeSnippet(text, q) {
    var clean = String(text).replace(/\s+/g, " ").trim();
    var lc = clean.toLowerCase(), lq = String(q).toLowerCase().replace(/\s+/g, " ").trim();
    var i = lq ? lc.indexOf(lq) : -1;
    if (i < 0) return escH(clean.slice(0, 110)) + (clean.length > 110 ? "…" : "");
    var s = Math.max(0, i - 32), e = Math.min(clean.length, i + lq.length + 48);
    return (s > 0 ? "…" : "") + escH(clean.slice(s, i)) + "<mark>" + escH(clean.slice(i, i + lq.length)) + "</mark>"
      + escH(clean.slice(i + lq.length, e)) + (e < clean.length ? "…" : "");
  }

  /* ---------- results UI ---------- */
  function typeSlug(t) {
    return { "Module": "module", "Lesson": "lesson", "Topic": "content", "Assignment": "assignment", "Knowledge Check": "kc" }[t] || "content";
  }
  function renderResults(res) {
    var box = els.results;
    if (!res.length) {
      box.innerHTML = '<div class="cm-sr-empty">No matching content found in this learning path.</div>';
      box.hidden = false; return;
    }
    box.innerHTML = res.map(function (r, i) {
      var rec = r.rec;
      var meta = [rec.parentModule, r.loc].filter(Boolean).join(" · ");
      return '<div class="cm-sr-item" data-idx="' + i + '" role="option">'
        + '<span class="cm-sr-type cm-sr-type-' + typeSlug(rec.resultType) + '">' + escH(rec.resultType) + '</span>'
        + '<div class="cm-sr-main">'
        + '<div class="cm-sr-title">' + escH(rec.title) + '</div>'
        + '<div class="cm-sr-meta">' + escH(meta) + '</div>'
        + '<div class="cm-sr-snippet">' + r.snippet + '</div>'
        + '</div></div>';
    }).join("");
    box.hidden = false;
  }
  function closeResults() { if (els.results) { els.results.hidden = true; els.results.innerHTML = ""; } }
  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg; els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 6000);
  }

  function run() {
    maybeRebuild();
    var q = els.input.value.trim();
    els.clear.hidden = !els.input.value;
    if (!q) { closeResults(); return; }
    LAST = search(q);
    renderResults(LAST);
  }

  /* ---------- navigation (gating-aware) ---------- */
  function flash(el) {
    if (!el) return;
    el.classList.remove("cm-flash"); void el.offsetWidth; el.classList.add("cm-flash");
    setTimeout(function () { el.classList.remove("cm-flash"); }, 2000);
  }
  function openModule(moduleId) {
    var card = document.querySelector('#learningPath .level-card[data-module-id="' + cssEsc(moduleId) + '"]');
    if (!card) return null;
    if (!card.classList.contains("open")) {
      var head = card.querySelector(".level-head[data-acc-toggle]");
      if (head) head.click(); // uses the real one-open-at-a-time accordion logic
    }
    return card;
  }
  function openLesson(card, lessonId) {
    if (!card) return null;
    var item = card.querySelector('.lesson-acc-item[data-lesson-id="' + cssEsc(lessonId) + '"]');
    if (!item) return null;
    if (!item.classList.contains("open")) {
      var head = item.querySelector(".lesson-acc-head[data-lesson-toggle]");
      if (head) head.click();
    }
    return item;
  }
  // Which Part (0-based) holds this block, and whether it IS the Part's KC.
  function partPosOfBlock(lesson, blockId) {
    if (typeof lessonParts !== "function") return { idx: 0, isKc: false };
    var parts = lessonParts(lesson);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.knowledgeCheck && (p.knowledgeCheck.id === blockId)) return { idx: i, isKc: true };
      var bs = p.blocks || [];
      for (var j = 0; j < bs.length; j++) if (bs[j].id === blockId) return { idx: i, isKc: false };
    }
    return { idx: 0, isKc: false };
  }

  function openResult(rec) {
    closeResults();
    if (els.toast) els.toast.hidden = true;
    var card = openModule(rec.moduleId);
    if (!card) { toast("تعذّر فتح هذا الـ Module."); return; }
    if (rec.kind === "module") {
      setTimeout(function () { card.scrollIntoView({ behavior: "smooth", block: "start" }); flash(card.querySelector(".level-head") || card); }, 380);
      return;
    }
    var item = openLesson(card, rec.lessonId);
    if (!item) { setTimeout(function () { card.scrollIntoView({ behavior: "smooth", block: "start" }); }, 380); return; }

    setTimeout(function () {
      if (rec.kind === "lesson") {
        item.scrollIntoView({ behavior: "smooth", block: "center" });
        flash(item.querySelector(".lesson-acc-head") || item);
        return;
      }
      if (rec.kind === "assignment") {
        var asg = item.querySelector(".lesson-assignment");
        if (asg) { asg.scrollIntoView({ behavior: "smooth", block: "center" }); flash(asg); }
        else { item.scrollIntoView({ behavior: "smooth", block: "center" }); }
        return;
      }
      // block / topic / knowledge check — navigate to the Part, respecting gating.
      var host = item.querySelector('.lp-parts[data-lesson-parts="' + cssEsc(rec.lessonId) + '"]');
      var lesson = (typeof loadLessons === "function" ? loadLessons() : []).find(function (l) { return l.id === rec.lessonId; }) || {};
      var pos = partPosOfBlock(lesson, rec.blockId);
      var partItem = host ? host.querySelector('.lp-part-item[data-part-index="' + pos.idx + '"]') : null;
      if (!partItem) { item.scrollIntoView({ behavior: "smooth", block: "center" }); return; }

      if (partItem.classList.contains("is-locked")) {
        // Gated: do NOT open. Scroll to the nearest reachable Part + explain.
        var reachable = host.querySelector(".lp-part-item.is-open") ||
          Array.prototype.filter.call(host.querySelectorAll(".lp-part-item.is-available, .lp-part-item.is-completed"), function () { return true; }).pop();
        (reachable || partItem).scrollIntoView({ behavior: "smooth", block: "center" });
        toast("Complete the previous Knowledge Check to continue to this section.");
        return;
      }
      // Reachable Part → open it, then scroll to the block / KC inside it.
      if (!partItem.classList.contains("is-open")) {
        var ph = partItem.querySelector(".lp-part-head"); if (ph) ph.click();
      }
      setTimeout(function () {
        var target = pos.isKc ? partItem.querySelector(".kc-block")
          : partItem.querySelector('[data-block-id="' + cssEsc(rec.blockId) + '"]');
        target = target || partItem;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        flash(target);
      }, 160);
    }, 420);
  }

  /* ---------- wire up ---------- */
  function debounce(fn, ms) { clearTimeout(debTimer); debTimer = setTimeout(fn, ms); }

  document.addEventListener("DOMContentLoaded", function () {
    var wrap = document.getElementById("lpSearch");
    if (!wrap || !document.getElementById("learningPath")) return;
    els.wrap = wrap;
    els.input = document.getElementById("lpSearchInput");
    els.clear = document.getElementById("lpSearchClear");
    els.results = document.getElementById("lpSearchResults");
    els.toast = document.getElementById("lpSearchToast");

    buildIndex();

    els.input.addEventListener("input", function () { debounce(run, 270); });
    els.input.addEventListener("focus", function () { maybeRebuild(); if (els.input.value.trim()) run(); });
    els.input.addEventListener("keydown", function (e) { if (e.key === "Escape") { els.input.value = ""; els.clear.hidden = true; closeResults(); } });
    els.clear.addEventListener("click", function () { els.input.value = ""; els.clear.hidden = true; closeResults(); els.input.focus(); });
    els.results.addEventListener("click", function (e) {
      var row = e.target.closest(".cm-sr-item"); if (!row) return;
      var r = LAST[Number(row.getAttribute("data-idx"))]; if (r) openResult(r.rec);
    });
    document.addEventListener("click", function (e) { if (!wrap.contains(e.target)) closeResults(); });
  });
})();
