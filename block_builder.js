/* ============================================================
   Lesson Block Builder (Content Manager — admin only)
   ------------------------------------------------------------
   Turns the single long Lesson Content document into ordered,
   manageable content blocks. Reuses the existing Rich Text Editor
   (createRichEditor) for text/summary/callout bodies and the
   inline Knowledge Check card (singleKc mode) for KC blocks.

   Block model (shared, see academies.js):
     { id, type, order, status, data, createdAt, updatedAt }

   Public API (window.LessonBlocks):
     init(mountEl)     — build the builder UI once
     load(blocks)      — render an existing lesson's blocks
     reset()           — start a new lesson (one empty Rich Text block)
     clear()           — empty the builder
     getBlocks()       — current blocks (ordered, deep-copied)
     count()           — number of blocks

   Rendering to the Learning Path and rollback contentBody is done by
   blocksToHtml()/blockToHtml() in academies.js, so this file only
   handles authoring.
   ============================================================ */
window.LessonBlocks = (function () {
  var mount = null, listEl = null, addMenuEl = null;
  var state = [];              // ordered array of block objects
  var editors = new Map();     // blockId -> { kind: "rte"|"callout"|"kc", ed }

  function nowISO() { return new Date().toISOString(); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------- state helpers ---------- */
  function normalizeBlock(b, i) {
    b = b || {};
    var type = b.type || "richtext";
    var data = (b.data && typeof b.data === "object") ? b.data : defaultBlockData(type);
    return {
      id: b.id || blockId(),
      type: type,
      order: i,
      status: b.status || "Published",
      data: JSON.parse(JSON.stringify(data)),
      createdAt: b.createdAt || nowISO(),
      updatedAt: b.updatedAt || nowISO()
    };
  }
  function findBlock(id) { return state.find(function (b) { return b.id === id; }); }
  function touch(b) { if (b) b.updatedAt = nowISO(); }

  /* Pull every live editor's content into its block (before re-render / read). */
  function syncEditorsToState() {
    editors.forEach(function (rec, id) {
      var b = findBlock(id);
      if (!b) return;
      if (rec.kind === "rte") b.data.html = rec.ed.getHTML();
      else if (rec.kind === "callout") b.data.body = rec.ed.getHTML();
      else if (rec.kind === "kc") { var kc = readKc(rec.ed); if (kc) b.data = kc; }
    });
  }

  /* ---------- Knowledge Check block seed / read ---------- */
  function kcSeedHtml(kc) {
    var d = document.createElement("div");
    d.className = "kc-block";
    d.setAttribute("data-kc", JSON.stringify(kc && kc.type ? kc : kcDefaultData()));
    return d.outerHTML;
  }
  function readKc(ed) {
    var tmp = document.createElement("div");
    tmp.innerHTML = ed.getHTML();
    var el = tmp.querySelector(".kc-block[data-kc]");
    if (!el) return null;
    try { return JSON.parse(el.getAttribute("data-kc")); } catch (e) { return null; }
  }

  /* ---------- card markup ---------- */
  function cardHtml(b, i, total) {
    var meta = blockTypeMeta(b.type);
    var d = b.data || {};
    var body;
    switch (b.type) {
      case "richtext":
        body = '<div class="blk-rte" data-role="rte"></div>';
        break;
      case "summary":
        body = '<p class="blk-hint">تلخيص الدرس — يظهر كقسم ختامي مميّز.</p><div class="blk-rte" data-role="rte"></div>';
        break;
      case "knowledge":
        body = '<div class="blk-kc" data-role="kc"></div>';
        break;
      case "callout-info": case "callout-tip": case "callout-warning":
        body =
          '<input type="text" class="blk-input" data-role="callout-title" placeholder="Title (optional)" value="' + esc(d.title || "") + '">' +
          '<div class="blk-rte" data-role="callout-body"></div>';
        break;
      case "image":
        body =
          '<div class="blk-media">' +
            '<div class="blk-preview" data-role="img-preview">' + (d.url ? '<img src="' + esc(d.url) + '" alt="">' : '<span class="blk-empty">لا توجد صورة بعد</span>') + '</div>' +
            '<div class="blk-row">' +
              '<button type="button" class="btn btn-ghost" data-role="img-btn">⬆ Upload Image</button>' +
              '<select class="blk-input blk-size" data-role="img-size">' +
                '<option value="small"' + (d.size === "small" ? " selected" : "") + '>Small</option>' +
                '<option value="medium"' + (!d.size || d.size === "medium" ? " selected" : "") + '>Medium</option>' +
                '<option value="large"' + (d.size === "large" ? " selected" : "") + '>Large</option>' +
              '</select>' +
              '<input type="file" accept="image/*" hidden data-role="img-file">' +
            '</div>' +
            '<input type="text" class="blk-input" data-role="img-caption" placeholder="Caption (optional)" value="' + esc(d.caption || "") + '">' +
            '<span class="blk-msg" data-role="msg" aria-live="polite"></span>' +
          '</div>';
        break;
      case "youtube":
        body =
          '<input type="url" class="blk-input" data-role="yt-url" placeholder="https://www.youtube.com/watch?v=…  أو  https://youtu.be/…" value="' + esc(d.url || "") + '">' +
          '<div class="blk-preview blk-embed" data-role="yt-preview"></div>';
        break;
      case "file":
        body =
          '<div class="blk-media">' +
            '<div class="blk-filecard" data-role="file-card">' + (d.url ? fileCardInner(d) : '<span class="blk-empty">لا يوجد ملف بعد</span>') + '</div>' +
            '<button type="button" class="btn btn-ghost" data-role="file-btn">⬆ Upload PDF / File</button>' +
            '<input type="file" accept=".pdf,.docx,.pptx,.xlsx,application/pdf" hidden data-role="file-input">' +
            '<span class="blk-msg" data-role="msg" aria-live="polite"></span>' +
          '</div>';
        break;
      case "resource":
        body =
          '<input type="text" class="blk-input" data-role="res-title" placeholder="Title" value="' + esc(d.title || "") + '">' +
          '<input type="url" class="blk-input" data-role="res-url" placeholder="https://…" value="' + esc(d.url || "") + '">' +
          '<input type="text" class="blk-input" data-role="res-desc" placeholder="Description (optional)" value="' + esc(d.description || "") + '">';
        break;
      case "divider":
        body = '<div class="blk-divider-demo"><hr></div>';
        break;
      default:
        body = '<p class="blk-hint">Unknown block.</p>';
    }
    return '' +
      '<div class="blk-card" data-block-id="' + esc(b.id) + '" data-block-type="' + esc(b.type) + '">' +
        '<div class="blk-head">' +
          '<span class="blk-icon" aria-hidden="true">' + meta.icon + '</span>' +
          '<span class="blk-name">' + esc(meta.label) + '</span>' +
          '<span class="blk-order">#' + (i + 1) + '</span>' +
          '<div class="blk-actions">' +
            '<button type="button" class="blk-act" data-blk="up" title="Move up"' + (i === 0 ? " disabled" : "") + '>↑</button>' +
            '<button type="button" class="blk-act" data-blk="down" title="Move down"' + (i === total - 1 ? " disabled" : "") + '>↓</button>' +
            '<button type="button" class="blk-act" data-blk="dup" title="Duplicate">⧉</button>' +
            '<button type="button" class="blk-act blk-del" data-blk="del" title="Delete">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="blk-body">' + body + '</div>' +
      '</div>';
  }
  function fileCardInner(d) {
    var nm = d.name || "File";
    var ext = (String(nm).split(".").pop() || "FILE").toUpperCase();
    return '<span class="blk-file-ico">' + blockFileIcon(nm) + '</span>' +
      '<span class="blk-file-meta"><span class="blk-file-name">' + esc(nm) + '</span>' +
      '<span class="blk-file-sub">' + esc(ext) + '</span></span>';
  }

  /* ---------- mount per-block editors + wire inputs ---------- */
  function mountBlock(card, b) {
    var d = b.data || {};
    if (b.type === "richtext" || b.type === "summary") {
      var m = card.querySelector('[data-role="rte"]');
      var ed = createRichEditor(m, {
        placeholder: b.type === "summary" ? "اكتب ملخص الدرس…" : "اكتب محتوى الدرس هنا…",
        onChange: function (html) { b.data.html = html; touch(b); }
      });
      ed.setHTML(d.html || "");
      editors.set(b.id, { kind: "rte", ed: ed });
    } else if (b.type === "knowledge") {
      var mk = card.querySelector('[data-role="kc"]');
      var ked = createRichEditor(mk, {
        singleKc: true,
        onChange: function () { var kc = readKc(ked); if (kc) b.data = kc; touch(b); }
      });
      ked.setHTML(kcSeedHtml(d));
      editors.set(b.id, { kind: "kc", ed: ked });
    } else if (b.type === "callout-info" || b.type === "callout-tip" || b.type === "callout-warning") {
      var titleEl = card.querySelector('[data-role="callout-title"]');
      titleEl.addEventListener("input", function () { b.data.title = titleEl.value; touch(b); });
      var mb = card.querySelector('[data-role="callout-body"]');
      var ced = createRichEditor(mb, { placeholder: "نص التنبيه…", onChange: function (html) { b.data.body = html; touch(b); } });
      ced.setHTML(d.body || "");
      editors.set(b.id, { kind: "callout", ed: ced });
    } else if (b.type === "image") {
      wireImage(card, b);
    } else if (b.type === "youtube") {
      wireYouTube(card, b);
    } else if (b.type === "file") {
      wireFile(card, b);
    } else if (b.type === "resource") {
      wireResource(card, b);
    }
  }

  function wireImage(card, b) {
    var btn = card.querySelector('[data-role="img-btn"]');
    var file = card.querySelector('[data-role="img-file"]');
    var preview = card.querySelector('[data-role="img-preview"]');
    var caption = card.querySelector('[data-role="img-caption"]');
    var size = card.querySelector('[data-role="img-size"]');
    var msg = card.querySelector('[data-role="msg"]');
    btn.addEventListener("click", function () { file.click(); });
    caption.addEventListener("input", function () { b.data.caption = caption.value; touch(b); });
    size.addEventListener("change", function () { b.data.size = size.value; touch(b); });
    file.addEventListener("change", function () {
      var f = file.files && file.files[0]; file.value = "";
      if (!f) return;
      if (!(typeof SB !== "undefined" && SB.enabled && SB.enabled() && SB.uploadImage)) { msg.textContent = "رفع الصور يحتاج Supabase Storage."; return; }
      msg.textContent = "Uploading…";
      SB.uploadImage(f).then(function (url) {
        b.data.url = url; touch(b);
        preview.innerHTML = '<img src="' + esc(url) + '" alt="">';
        msg.textContent = "✓ Uploaded";
      }).catch(function (e) { console.error(e); msg.textContent = "تعذّر رفع الصورة."; });
    });
  }
  function wireYouTube(card, b) {
    var url = card.querySelector('[data-role="yt-url"]');
    var preview = card.querySelector('[data-role="yt-preview"]');
    function refresh() {
      b.data.url = url.value; b.data.videoId = ytVideoId(url.value) || ""; touch(b);
      if (b.data.videoId) {
        preview.innerHTML = '<iframe src="https://www.youtube.com/embed/' + esc(b.data.videoId) + '" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
      } else {
        preview.innerHTML = url.value.trim() ? '<span class="blk-empty">رابط YouTube غير صالح</span>' : "";
      }
    }
    url.addEventListener("input", refresh);
    refresh();
  }
  function wireFile(card, b) {
    var btn = card.querySelector('[data-role="file-btn"]');
    var input = card.querySelector('[data-role="file-input"]');
    var cardEl = card.querySelector('[data-role="file-card"]');
    var msg = card.querySelector('[data-role="msg"]');
    btn.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      var f = input.files && input.files[0]; input.value = "";
      if (!f) return;
      if (!(typeof SB !== "undefined" && SB.enabled && SB.enabled() && SB.uploadFile)) { msg.textContent = "رفع الملفات يحتاج Supabase Storage."; return; }
      msg.textContent = "Uploading…";
      SB.uploadFile(f).then(function (url) {
        b.data.url = url; b.data.name = f.name; touch(b);
        cardEl.innerHTML = fileCardInner(b.data);
        msg.textContent = "✓ Uploaded";
      }).catch(function (e) { console.error(e); msg.textContent = "تعذّر رفع الملف."; });
    });
  }
  function wireResource(card, b) {
    var t = card.querySelector('[data-role="res-title"]');
    var u = card.querySelector('[data-role="res-url"]');
    var de = card.querySelector('[data-role="res-desc"]');
    t.addEventListener("input", function () { b.data.title = t.value; touch(b); });
    u.addEventListener("input", function () { b.data.url = u.value; touch(b); });
    de.addEventListener("input", function () { b.data.description = de.value; touch(b); });
  }

  /* ---------- render ---------- */
  function render() {
    editors.clear();
    if (!listEl) return;
    if (!state.length) {
      listEl.innerHTML = '<div class="blk-empty-state"><div class="blk-empty-ico">🧱</div>' +
        '<p>لا يوجد بلوكات بعد. استخدم <strong>+ Add Block</strong> لإضافة أول بلوك.</p></div>';
      return;
    }
    var total = state.length;
    listEl.innerHTML = state.map(function (b, i) { return cardHtml(b, i, total); }).join("");
    state.forEach(function (b) {
      var card = listEl.querySelector('.blk-card[data-block-id="' + cssEsc(b.id) + '"]');
      if (card) mountBlock(card, b);
    });
  }
  function cssEsc(id) { return String(id).replace(/["\\]/g, "\\$&"); }

  /* ---------- actions ---------- */
  function moveBlock(id, dir) {
    syncEditorsToState();
    var idx = state.findIndex(function (b) { return b.id === id; });
    var swap = idx + (dir === "up" ? -1 : 1);
    if (idx < 0 || swap < 0 || swap >= state.length) return;
    var t = state[idx]; state[idx] = state[swap]; state[swap] = t;
    reindex(); render();
    scrollToBlock(id);
  }
  function duplicateBlock(id) {
    syncEditorsToState();
    var idx = state.findIndex(function (b) { return b.id === id; });
    if (idx < 0) return;
    var src = state[idx];
    var copy = normalizeBlock(JSON.parse(JSON.stringify(src)), idx + 1);
    copy.id = blockId();
    if (copy.type === "knowledge" && copy.data) copy.data.id = "kc_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    copy.createdAt = copy.updatedAt = nowISO();
    state.splice(idx + 1, 0, copy);
    reindex(); render();
    scrollToBlock(copy.id);
  }
  function deleteBlock(id) {
    var b = findBlock(id);
    var meta = b ? blockTypeMeta(b.type) : null;
    if (!confirm("حذف بلوك" + (meta ? " (" + meta.label + ")" : "") + "؟ لا يمكن التراجع.")) return;
    syncEditorsToState();
    state = state.filter(function (x) { return x.id !== id; });
    reindex(); render();
  }
  function addBlock(type) {
    syncEditorsToState();
    var b = newBlock(type);
    state.push(b); reindex(); render();
    scrollToBlock(b.id);
  }
  function reindex() { state.forEach(function (b, i) { b.order = i; }); }
  function scrollToBlock(id) {
    if (!listEl) return;
    var card = listEl.querySelector('.blk-card[data-block-id="' + cssEsc(id) + '"]');
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function onListClick(e) {
    var btn = e.target.closest("[data-blk]");
    if (!btn || !listEl.contains(btn)) return;
    var card = btn.closest(".blk-card");
    if (!card) return;
    var id = card.getAttribute("data-block-id");
    switch (btn.getAttribute("data-blk")) {
      case "up": moveBlock(id, "up"); break;
      case "down": moveBlock(id, "down"); break;
      case "dup": duplicateBlock(id); break;
      case "del": deleteBlock(id); break;
    }
  }

  /* ---------- add-block menu ---------- */
  function buildAddMenu() {
    return '<div class="blk-add-menu" data-role="add-menu" hidden>' +
      BLOCK_TYPES.map(function (t) {
        return '<button type="button" class="blk-add-item" data-add-type="' + t.type + '">' +
          '<span class="blk-add-ico">' + t.icon + '</span>' + esc(t.label) + '</button>';
      }).join("") + '</div>';
  }
  function toggleAddMenu(force) {
    if (!addMenuEl) return;
    var show = (force === undefined) ? addMenuEl.hidden : force;
    addMenuEl.hidden = !show;
  }

  /* ---------- public ---------- */
  function init(mountEl) {
    if (!mountEl) return;
    mount = mountEl;
    mount.classList.add("blk-builder");
    mount.innerHTML =
      '<div class="blk-list" data-role="list"></div>' +
      '<div class="blk-add">' +
        '<button type="button" class="btn btn-primary blk-add-btn" data-role="add-btn">+ Add Block</button>' +
        buildAddMenu() +
      '</div>';
    listEl = mount.querySelector('[data-role="list"]');
    addMenuEl = mount.querySelector('[data-role="add-menu"]');
    listEl.addEventListener("click", onListClick);
    mount.querySelector('[data-role="add-btn"]').addEventListener("click", function () { toggleAddMenu(); });
    addMenuEl.addEventListener("click", function (e) {
      var item = e.target.closest("[data-add-type]");
      if (!item) return;
      toggleAddMenu(false);
      addBlock(item.getAttribute("data-add-type"));
    });
    // Close the menu when clicking elsewhere.
    document.addEventListener("click", function (e) {
      if (addMenuEl && !addMenuEl.hidden && !mount.querySelector(".blk-add").contains(e.target)) toggleAddMenu(false);
    });
    render();
  }
  function load(blocks) {
    state = (Array.isArray(blocks) ? blocks : []).map(normalizeBlock);
    reindex(); render();
  }
  function reset() { state = [normalizeBlock(newBlock("richtext"), 0)]; render(); }
  function clear() { state = []; render(); }
  function getBlocks() {
    syncEditorsToState();
    reindex();
    return state.map(function (b) { return JSON.parse(JSON.stringify(b)); });
  }
  function count() { return state.length; }

  return { init: init, load: load, reset: reset, clear: clear, getBlocks: getBlocks, count: count };
})();
