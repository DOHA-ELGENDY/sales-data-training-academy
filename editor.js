/* ============================================================
   Lightweight Rich Text Editor (dependency-free)
   ------------------------------------------------------------
   A self-contained contenteditable editor used ONLY for the Lesson
   Content field in the Content Manager. Stores content as HTML, which
   the Learning Path renders as-is. No external library, no backend.

   Usage:
     const ed = createRichEditor(mountEl, { placeholder, onChange });
     ed.getHTML(); ed.setHTML(html); ed.clear(); ed.focus();
   ============================================================ */
function createRichEditor(mount, opts) {
  if (!mount) return null;
  opts = opts || {};
  const onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};

  const TOOLBAR = `
    <div class="rte-toolbar">
      <button type="button" data-action="h1" title="Heading 1">H1</button>
      <button type="button" data-action="h2" title="Heading 2">H2</button>
      <button type="button" data-action="h3" title="Heading 3">H3</button>
      <button type="button" data-action="p" title="Paragraph">¶</button>
      <span class="rte-sep"></span>
      <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
      <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
      <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
      <button type="button" data-action="highlight" title="Highlight">🖍️</button>
      <span class="rte-sep"></span>
      <button type="button" data-cmd="insertUnorderedList" title="Bullet list">•</button>
      <button type="button" data-cmd="insertOrderedList" title="Numbered list">1.</button>
      <button type="button" data-action="blockquote" title="Quote">❝</button>
      <button type="button" data-action="pre" title="Code block">&lt;/&gt;</button>
      <span class="rte-sep"></span>
      <button type="button" data-cmd="justifyRight" title="Align right">⇥</button>
      <button type="button" data-cmd="justifyCenter" title="Align center">↔</button>
      <button type="button" data-cmd="justifyLeft" title="Align left">⇤</button>
      <span class="rte-sep"></span>
      <button type="button" data-action="link" title="Insert link">🔗</button>
      <button type="button" data-action="table" title="Insert table">▦</button>
      <button type="button" data-action="hr" title="Horizontal divider">―</button>
      <button type="button" data-action="image" title="Insert image">🖼️</button>
      <button type="button" data-action="youtube" title="Insert YouTube video">📺</button>
      <button type="button" data-action="attach" title="Insert attachment (PDF/DOCX/PPTX/XLSX)">📎</button>
      <button type="button" data-action="resource" title="Insert resource link">🔖</button>
      <span class="rte-sep"></span>
      <button type="button" data-action="callout-info" title="Info callout">ℹ️</button>
      <button type="button" data-action="callout-note" title="Note callout">🗒️</button>
      <button type="button" data-action="callout-warning" title="Warning callout">⚠️</button>
      <button type="button" data-action="callout-tip" title="Tip callout">💡</button>
      <span class="rte-sep"></span>
      <button type="button" data-cmd="undo" title="Undo">↶</button>
      <button type="button" data-cmd="redo" title="Redo">↷</button>
    </div>`;

  mount.classList.add("rte");
  mount.innerHTML = TOOLBAR +
    `<div class="rte-area" contenteditable="true" data-placeholder="${(opts.placeholder || "").replace(/"/g, "&quot;")}"></div>`;

  const toolbar = mount.querySelector(".rte-toolbar");
  const area = mount.querySelector(".rte-area");

  // Hidden file input for image insertion.
  const imgInput = document.createElement("input");
  imgInput.type = "file";
  imgInput.accept = "image/*";
  imgInput.hidden = true;
  mount.appendChild(imgInput);

  // Hidden file input for document attachments.
  const attachInput = document.createElement("input");
  attachInput.type = "file";
  attachInput.accept = ".pdf,.docx,.pptx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  attachInput.hidden = true;
  mount.appendChild(attachInput);

  /* Small HTML escaper for values placed into inserted blocks. */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  try { document.execCommand("styleWithCSS", false, true); } catch (e) { /* older browsers */ }

  function sync() { onChange(getHTML()); }
  function exec(cmd, val) {
    area.focus();
    try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
    document.execCommand(cmd, false, val === undefined ? null : val);
    sync();
  }
  function insertHTML(html) {
    area.focus();
    document.execCommand("insertHTML", false, html);
    sync();
  }

  /* Keep the selection when a toolbar button is pressed. */
  toolbar.addEventListener("mousedown", e => { if (e.target.closest("button")) e.preventDefault(); });

  toolbar.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.cmd) { exec(btn.dataset.cmd); return; }
    doAction(btn.dataset.action);
  });

  function doAction(action) {
    switch (action) {
      case "h1": case "h2": case "h3": case "p": case "blockquote":
        exec("formatBlock", action); break;
      case "pre":
        insertHTML('<pre class="rte-code"><code>code…</code></pre><p><br></p>'); break;
      case "highlight":
        area.focus();
        try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
        if (!document.execCommand("hiliteColor", false, "#fde68a")) document.execCommand("backColor", false, "#fde68a");
        sync();
        break;
      case "link": {
        const url = prompt("Link URL:", "https://");
        if (url) { exec("createLink", url); normalizeLinks(); }
        break;
      }
      case "hr": exec("insertHorizontalRule"); break;
      case "table": insertTable(); break;
      case "image": imgInput.click(); break;
      case "youtube": insertYouTube(); break;
      case "attach": attachInput.click(); break;
      case "resource": insertResource(); break;
      case "callout-info": case "callout-note": case "callout-warning": case "callout-tip":
        insertCallout(action.replace("callout-", "")); break;
    }
  }

  /* ---- YouTube embed (youtube.com/watch?v= or youtu.be/) ---- */
  function youTubeId(url) {
    const s = String(url || "").trim();
    let m = s.match(/[?&]v=([A-Za-z0-9_-]{6,})/);            // watch?v=
    if (m) return m[1];
    m = s.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);            // youtu.be/
    if (m) return m[1];
    m = s.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/);  // /embed/
    if (m) return m[1];
    m = s.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/); // /shorts/
    if (m) return m[1];
    return null;
  }
  function insertYouTube() {
    const url = prompt("YouTube URL (watch?v=… or youtu.be/…):", "https://");
    if (!url) return;
    const id = youTubeId(url);
    if (!id) { alert("رابط YouTube غير صالح."); return; }
    insertHTML(
      `<div class="lp-embed" contenteditable="false"><iframe src="https://www.youtube.com/embed/${esc(id)}" ` +
      `title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ` +
      `allowfullscreen></iframe></div><p><br></p>`);
  }

  /* ---- Attachment card (uploaded to Supabase Storage) ---- */
  function fileIconFor(name) {
    const n = String(name || "").toLowerCase();
    if (n.endsWith(".pdf")) return "📕";
    if (n.endsWith(".docx") || n.endsWith(".doc")) return "📘";
    if (n.endsWith(".pptx") || n.endsWith(".ppt")) return "📙";
    if (n.endsWith(".xlsx") || n.endsWith(".xls")) return "📗";
    return "📎";
  }
  function insertAttachment(url, name) {
    const ext = (String(name).split(".").pop() || "FILE").toUpperCase();
    insertHTML(
      `<div class="lp-file" contenteditable="false"><a href="${esc(url)}" target="_blank" rel="noopener" download>` +
      `<span class="lp-file-ico">${fileIconFor(name)}</span>` +
      `<span class="lp-file-meta"><span class="lp-file-name">${esc(name)}</span>` +
      `<span class="lp-file-sub">${esc(ext)} · Download</span></span></a></div><p><br></p>`);
  }
  function handleAttachFile(file) {
    if (!file) return;
    const range = saveRange();
    if (typeof SB !== "undefined" && SB && SB.enabled && SB.enabled() && SB.uploadFile) {
      SB.uploadFile(file).then(url => { restoreRange(range); insertAttachment(url, file.name); })
        .catch(err => { console.error("Attachment upload failed", err); alert("تعذّر رفع الملف إلى Supabase Storage."); });
    } else {
      alert("رفع الملفات يحتاج Supabase (شغّل storage_setup.sql).");
    }
  }
  attachInput.addEventListener("change", () => {
    if (attachInput.files && attachInput.files[0]) handleAttachFile(attachInput.files[0]);
    attachInput.value = "";
  });

  /* ---- External resource link card ---- */
  function insertResource() {
    const title = prompt("Resource title:");
    if (!title) return;
    const url = prompt("Resource URL:", "https://");
    if (!url) return;
    const desc = prompt("Short description (optional):") || "";
    insertHTML(
      `<div class="lp-resource" contenteditable="false"><a href="${esc(url)}" target="_blank" rel="noopener">` +
      `<span class="lp-resource-ico">🔗</span><span class="lp-resource-body">` +
      `<span class="lp-resource-title">${esc(title)}</span>` +
      (desc ? `<span class="lp-resource-desc">${esc(desc)}</span>` : "") +
      `<span class="lp-resource-url">${esc(url)}</span></span></a></div><p><br></p>`);
  }

  function insertTable() {
    const rows = parseInt(prompt("Number of rows (including header):", "3"), 10);
    const cols = parseInt(prompt("Number of columns:", "3"), 10);
    if (!rows || !cols || rows < 1 || cols < 1) return;
    let html = '<table class="rte-table"><tbody>';
    for (let i = 0; i < rows; i++) {
      html += "<tr>";
      for (let j = 0; j < cols; j++) html += i === 0 ? "<th>Header</th>" : "<td>Cell</td>";
      html += "</tr>";
    }
    html += "</tbody></table><p><br></p>";
    insertHTML(html);
  }

  function insertCallout(type) {
    const labels = { info: "ℹ️ Info", note: "🗒️ Note", warning: "⚠️ Warning", tip: "💡 Tip" };
    insertHTML(`<div class="callout callout-${type}"><p>${labels[type] || ""} — اكتب هنا…</p></div><p><br></p>`);
  }

  /* Save/restore the caret across the async upload so the image lands where
     the cursor was. */
  function saveRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && area.contains(sel.anchorNode)) return sel.getRangeAt(0).cloneRange();
    return null;
  }
  function restoreRange(range) {
    area.focus();
    if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
  }
  function insertImage(url) {
    insertHTML(
      `<figure class="rte-figure rte-size-md"><img src="${url}" alt="">` +
      `<figcaption>Caption…</figcaption></figure><p><br></p>`);
  }

  /* Upload the image to Supabase Storage, then insert its URL at the caret.
     No base64 — the lesson HTML stores the URL only. */
  function handleImageFile(file) {
    if (!file || file.type.indexOf("image/") !== 0) return;
    const range = saveRange();
    if (typeof SB !== "undefined" && SB && SB.enabled && SB.enabled() && SB.uploadImage) {
      SB.uploadImage(file).then(url => {
        restoreRange(range);
        insertImage(url);
      }).catch(err => {
        console.error("Image upload failed", err);
        alert("تعذّر رفع الصورة إلى Supabase Storage. تأكد إن bucket \"lesson-images\" متعمل (شغّل storage_setup.sql).");
      });
    } else {
      // Demo mode only (Supabase not configured): fall back to a data URL.
      const rd = new FileReader();
      rd.onload = () => { restoreRange(range); insertImage(rd.result); };
      rd.readAsDataURL(file);
    }
  }
  imgInput.addEventListener("change", () => {
    if (imgInput.files && imgInput.files[0]) handleImageFile(imgInput.files[0]);
    imgInput.value = "";
  });

  /* Drag & drop images onto the editing area. */
  area.addEventListener("dragover", e => { e.preventDefault(); area.classList.add("rte-dragover"); });
  area.addEventListener("dragleave", () => area.classList.remove("rte-dragover"));
  area.addEventListener("drop", e => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => f.type.indexOf("image/") === 0);
    if (files.length) { e.preventDefault(); files.forEach(handleImageFile); }
    area.classList.remove("rte-dragover");
  });

  /* ---- Image resize (small / medium / large) ---- */
  let imgBar = null, selectedFig = null;
  function clearImgBar() {
    if (selectedFig) selectedFig.classList.remove("rte-selected");
    if (imgBar) { imgBar.remove(); imgBar = null; }
    selectedFig = null;
  }
  function positionImgBar() {
    if (!imgBar || !selectedFig) return;
    const fr = selectedFig.getBoundingClientRect(), mr = mount.getBoundingClientRect();
    imgBar.style.top = (fr.top - mr.top + 6) + "px";
    imgBar.style.left = (fr.left - mr.left + 6) + "px";
  }
  function showImgBar(fig) {
    clearImgBar();
    selectedFig = fig;
    fig.classList.add("rte-selected");
    imgBar = document.createElement("div");
    imgBar.className = "rte-imgbar";
    imgBar.innerHTML =
      '<button type="button" data-size="sm">S</button>' +
      '<button type="button" data-size="md">M</button>' +
      '<button type="button" data-size="lg">L</button>' +
      '<button type="button" data-imgdel title="Remove">✕</button>';
    mount.appendChild(imgBar);
    positionImgBar();
  }
  area.addEventListener("click", e => {
    const fig = e.target.closest("figure.rte-figure");
    if (fig && area.contains(fig)) showImgBar(fig); else clearImgBar();
  });
  area.addEventListener("scroll", positionImgBar);
  mount.addEventListener("mousedown", e => {
    if (imgBar && imgBar.contains(e.target)) return;   // handled below
    if (!e.target.closest("figure.rte-figure")) clearImgBar();
  });
  // (imgBar built lazily above; delegate its clicks here)
  mount.addEventListener("click", e => {
    if (!imgBar || !imgBar.contains(e.target)) return;
    const b = e.target.closest("button");
    if (!b || !selectedFig) return;
    if (b.dataset.size) {
      selectedFig.className = "rte-figure rte-size-" + b.dataset.size + " rte-selected";
      sync(); positionImgBar();
    } else if (b.hasAttribute("data-imgdel")) {
      selectedFig.remove(); clearImgBar(); sync();
    }
  });

  function normalizeLinks() {
    area.querySelectorAll("a[href]").forEach(a => { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); });
    sync();
  }

  area.addEventListener("input", sync);
  area.addEventListener("blur", sync);

  /* ---- Public API ---- */
  function getHTML() {
    const clone = area.cloneNode(true);
    clone.querySelectorAll("a[href]").forEach(a => { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); });
    clone.querySelectorAll(".rte-selected").forEach(el => el.classList.remove("rte-selected"));
    const hasText = (clone.textContent || "").trim().length > 0;
    const hasMedia = clone.querySelector("img,table,hr,figure,pre,iframe,.lp-embed,.lp-file,.lp-resource");
    if (!hasText && !hasMedia) return "";
    return clone.innerHTML.trim();
  }
  function setHTML(html) { area.innerHTML = html || ""; sync(); }
  function clear() { area.innerHTML = ""; sync(); }
  function focus() { area.focus(); }

  return { getHTML, setHTML, clear, focus, area };
}
