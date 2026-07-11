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
      <select class="rte-select" data-fontfamily title="Font family">
        <option value="">Font</option>
        <option value="Arial, sans-serif">Arial</option>
        <option value="'Segoe UI', sans-serif">Segoe UI</option>
        <option value="Tahoma, sans-serif">Tahoma</option>
        <option value="Georgia, serif">Georgia</option>
        <option value="'Times New Roman', serif">Times</option>
        <option value="'Courier New', monospace">Courier</option>
        <option value="'Cairo', 'Segoe UI', sans-serif">Cairo</option>
      </select>
      <select class="rte-select" data-fontsize title="Font size">
        <option value="">Size</option>
        <option value="12">12</option><option value="14">14</option>
        <option value="16">16</option><option value="18">18</option>
        <option value="20">20</option><option value="24">24</option>
        <option value="28">28</option><option value="32">32</option>
      </select>
      <span class="rte-sep"></span>
      <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
      <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
      <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
      <label class="rte-color" title="Text color">A<input type="color" data-forecolor value="#1f2937"></label>
      <label class="rte-color" title="Highlight color">🖍️<input type="color" data-hilite value="#fde68a"></label>
      <span class="rte-sep"></span>
      <button type="button" data-cmd="insertUnorderedList" title="Bullet list">•</button>
      <button type="button" data-cmd="insertOrderedList" title="Numbered list">1.</button>
      <button type="button" data-action="blockquote" title="Quote">❝</button>
      <button type="button" data-action="pre" title="Code block">&lt;/&gt;</button>
      <span class="rte-sep"></span>
      <button type="button" data-cmd="justifyRight" title="Align right">⇥</button>
      <button type="button" data-cmd="justifyCenter" title="Align center">↔</button>
      <button type="button" data-cmd="justifyLeft" title="Align left">⇤</button>
      <button type="button" data-cmd="justifyFull" title="Justify">☰</button>
      <button type="button" data-cmd="indent" title="Increase indent">»</button>
      <button type="button" data-cmd="outdent" title="Decrease indent">«</button>
      <button type="button" data-cmd="removeFormat" title="Remove formatting"><s>T</s></button>
      <span class="rte-sep"></span>
      <button type="button" data-action="link" title="Insert link">🔗</button>
      <button type="button" data-action="table" title="Insert table">▦</button>
      <button type="button" data-action="hr" title="Horizontal divider">―</button>
      <button type="button" data-action="image" title="Insert image">🖼️</button>
      <button type="button" data-action="youtube" title="Insert YouTube video">📺</button>
      <button type="button" data-action="attach" title="Insert attachment (PDF/DOCX/PPTX/XLSX)">📎</button>
      <button type="button" data-action="resource" title="Insert resource link">🔖</button>
      <button type="button" data-action="knowledge" title="Insert Knowledge Check">❓</button>
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

  // Drop toolbar actions the caller doesn't want (e.g. the nested Scenario
  // editor excludes "knowledge" so a Knowledge Check can't nest inside itself).
  if (opts.exclude && opts.exclude.length) {
    opts.exclude.forEach(a => {
      const b = toolbar.querySelector('[data-action="' + a + '"]');
      if (b) b.remove();
    });
  }

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

  /* Keep the selection when a toolbar control is used. Buttons preventDefault so
     focus stays in the area; selects / color pickers steal focus, so we save the
     range on mousedown and restore it before applying. */
  let toolbarSel = null;
  toolbar.addEventListener("mousedown", e => {
    toolbarSel = saveRange();
    if (e.target.closest("button")) e.preventDefault();
  });

  toolbar.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.cmd) { exec(btn.dataset.cmd); return; }
    doAction(btn.dataset.action);
  });

  /* Font family / size selects + text-color / highlight color pickers. */
  toolbar.addEventListener("change", e => {
    const t = e.target;
    if (t.matches("[data-fontfamily]")) {
      if (t.value) { restoreRange(toolbarSel); applyInlineStyle("fontFamily", t.value); }
      t.selectedIndex = 0;
    } else if (t.matches("[data-fontsize]")) {
      if (t.value) { restoreRange(toolbarSel); applyInlineStyle("fontSize", t.value + "px"); }
      t.selectedIndex = 0;
    } else if (t.matches("[data-forecolor]")) {
      restoreRange(toolbarSel); exec("foreColor", t.value);
    } else if (t.matches("[data-hilite]")) {
      restoreRange(toolbarSel); applyHighlight(t.value);
    }
  });

  /* Wrap the selection in a span with an inline style (font-size / font-family).
     execCommand can't set arbitrary px sizes; this produces plain inline CSS
     that renders anywhere, including the Learning Path. */
  function applyInlineStyle(prop, value) {
    area.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    span.style[prop] = value;
    try { range.surroundContents(span); }
    catch (e) { span.appendChild(range.extractContents()); range.insertNode(span); }
    const nr = document.createRange();
    nr.selectNodeContents(span);
    sel.removeAllRanges(); sel.addRange(nr);
    sync();
  }
  function applyHighlight(color) {
    area.focus();
    try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
    if (!document.execCommand("hiliteColor", false, color)) document.execCommand("backColor", false, color);
    sync();
  }

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
      case "knowledge": insertKnowledgeCheck(); break;
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

  /* ---- Inline Knowledge Check (editable block) ----
     Inserted as an editable card (contenteditable=false island with real form
     controls). The current field values are mirrored into a data-kc attribute
     on every change; getHTML() converts the editable card to a clean stored
     block, and setHTML() converts stored blocks back to editable cards. */
  var KC_TYPES = [
    ["mcq", "Multiple Choice"],
    ["truefalse", "True / False"],
    ["short", "Short Text Answer"],
    ["doclink", "Document Link"],
    ["fileupload", "File Upload"],
    ["text_or_doc", "Text or Document Link"],
    ["text_or_file", "Text or File Upload"]
  ];
  function kcId() { return "kc_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function kcDefault() { return { id: kcId(), type: "mcq", question: "", choices: ["", ""], correct: 0, explanation: "" }; }
  function kcTypeNote(type) {
    var m = {
      short: "Employee submits a short text answer (reviewed, not auto-graded).",
      doclink: "Employee submits a document link (Google Docs / Drive / OneDrive …).",
      fileupload: "Employee uploads a file (PDF / DOCX / PPTX / XLSX).",
      text_or_doc: "Employee submits a text answer OR a document link.",
      text_or_file: "Employee submits a text answer OR an uploaded file."
    };
    return m[type] || "";
  }

  function kcChoiceRow(text, correct) {
    return `<div class="kc-f-choice">` +
      `<input type="radio" class="kc-f-cradio"${correct ? " checked" : ""}>` +
      `<input type="text" class="kc-f-ctext" placeholder="Choice" value="${esc(text)}">` +
      `<button type="button" class="kc-f-cdel" title="Remove">✕</button></div>`;
  }
  /* Correct-answer UI only for objective types (MCQ, True/False). Deliverable
     types (short text / document link / file upload / combined) are reviewed, not
     auto-graded, so they show only a hint. */
  function kcBodyHtml(kc) {
    if (kc.type === "mcq") {
      const choices = (kc.choices && kc.choices.length) ? kc.choices : ["", ""];
      const ci = Number(kc.correct);
      return choices.map((c, i) => kcChoiceRow(c, i === ci)).join("") +
        `<button type="button" class="kc-f-addchoice">+ Add choice</button>`;
    }
    if (kc.type === "truefalse") {
      const isFalse = String(kc.correct) === "false";
      return `<label class="kc-f-lbl">Correct answer <select class="kc-f-correct">` +
        `<option value="true"${isFalse ? "" : " selected"}>True</option>` +
        `<option value="false"${isFalse ? " selected" : ""}>False</option></select></label>`;
    }
    return `<p class="kc-f-note">${kcTypeNote(kc.type)}</p>`;
  }
  function kcEditHtml(kc) {
    kc = kc || kcDefault();
    if (!kc.id) kc.id = kcId();
    const opts = KC_TYPES.map(t => `<option value="${t[0]}"${kc.type === t[0] ? " selected" : ""}>${t[1]}</option>`).join("");
    return `<div class="kc-edit" contenteditable="false" data-kc="${esc(JSON.stringify(kc))}">` +
      `<div class="kc-edit-top"><span class="kc-edit-badge">Knowledge Check</span>` +
      `<select class="kc-f-type">${opts}</select>` +
      `<button type="button" class="kc-f-remove" title="Remove">✕</button></div>` +
      `<label class="kc-f-fieldlabel">Scenario / Prompt</label>` +
      `<div class="kc-f-question rte-mount"></div>` +
      `<div class="kc-f-body">${kcBodyHtml(kc)}</div>` +
      `<input type="text" class="kc-f-explanation" placeholder="Explanation (optional)" value="${esc(kc.explanation || "")}">` +
      `</div>`;
  }
  function insertKnowledgeCheck() { insertHTML(kcEditHtml(null) + "<p><br></p>"); hydrateKcQuestions(); }

  /* Turn each KC card's Scenario / Prompt mount into its own rich editor (reusing
     the same editor). Runs after a KC is inserted and after stored content loads;
     skips cards already hydrated. The nested editor's HTML is mirrored into the
     card's data-kc via syncKcBlock, so getHTML persists it like any other field. */
  function hydrateKcQuestions() {
    area.querySelectorAll(".kc-edit").forEach(card => {
      const qMount = card.querySelector(".kc-f-question");
      if (!qMount || qMount._rte) return;
      let kc = {};
      try { kc = JSON.parse(card.getAttribute("data-kc")) || {}; } catch (e) {}
      const ed = createRichEditor(qMount, {
        placeholder: "Scenario / Prompt — اكتب الحالة أو السؤال أو الـ business case…",
        exclude: ["knowledge"],
        onChange: () => { syncKcBlock(card); sync(); }
      });
      qMount._rte = ed;
      ed.setHTML(kc.question || "");
    });
  }

  /* Mirror an editable card's current field values into its data-kc attribute. */
  function syncKcBlock(block) {
    let prev = {};
    try { prev = JSON.parse(block.getAttribute("data-kc")) || {}; } catch (e) {}
    const type = block.querySelector(".kc-f-type").value;
    const qMount = block.querySelector(".kc-f-question");
    // Scenario / Prompt is a nested rich editor; read its HTML (fall back to the
    // stored value if it hasn't been hydrated yet, so nothing is lost).
    const question = (qMount && qMount._rte) ? qMount._rte.getHTML() : (prev.question || "");
    const kc = {
      id: prev.id || kcId(),
      type: type,
      question: question,
      explanation: block.querySelector(".kc-f-explanation").value
    };
    if (type === "mcq") {
      const rows = Array.from(block.querySelectorAll(".kc-f-choice"));
      kc.choices = rows.map(r => r.querySelector(".kc-f-ctext").value);
      let ci = rows.findIndex(r => r.querySelector(".kc-f-cradio").checked);
      kc.correct = ci < 0 ? 0 : ci;
    } else if (type === "truefalse") {
      kc.correct = block.querySelector(".kc-f-correct").value;
    }
    block.setAttribute("data-kc", JSON.stringify(kc));
  }

  // Editable-card interactions (delegated on the area).
  area.addEventListener("change", e => {
    const block = e.target.closest(".kc-edit");
    if (!block) return;
    if (e.target.classList.contains("kc-f-type")) {
      block.querySelector(".kc-f-body").innerHTML = kcBodyHtml({ type: e.target.value, choices: ["", ""], correct: 0 });
    } else if (e.target.classList.contains("kc-f-cradio")) {
      block.querySelectorAll(".kc-f-cradio").forEach(r => { r.checked = (r === e.target); });
    }
    syncKcBlock(block); sync();
  });
  area.addEventListener("click", e => {
    const block = e.target.closest(".kc-edit");
    if (!block) return;
    if (e.target.closest(".kc-f-addchoice")) {
      e.preventDefault();
      block.querySelector(".kc-f-addchoice").insertAdjacentHTML("beforebegin", kcChoiceRow("", false));
      syncKcBlock(block); sync();
    } else if (e.target.closest(".kc-f-cdel")) {
      e.preventDefault();
      if (block.querySelectorAll(".kc-f-choice").length > 2) { e.target.closest(".kc-f-choice").remove(); syncKcBlock(block); sync(); }
    } else if (e.target.closest(".kc-f-remove")) {
      e.preventDefault();
      block.remove(); sync();
    }
  });

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

  area.addEventListener("input", e => {
    const block = e.target.closest(".kc-edit");
    if (block) syncKcBlock(block);
    sync();
  });
  area.addEventListener("blur", sync);

  /* ---- Public API ---- */
  function getHTML() {
    // Ensure each KC card's data-kc reflects its live fields (incl. the nested
    // Scenario editor) before serializing.
    area.querySelectorAll(".kc-edit").forEach(syncKcBlock);
    const clone = area.cloneNode(true);
    clone.querySelectorAll("a[href]").forEach(a => { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); });
    clone.querySelectorAll(".rte-selected").forEach(el => el.classList.remove("rte-selected"));
    // Editable KC cards → clean stored blocks (data-kc kept in sync live).
    clone.querySelectorAll(".kc-edit").forEach(el => {
      const block = document.createElement("div");
      block.className = "kc-block";
      block.setAttribute("data-kc", el.getAttribute("data-kc") || "");
      block.innerHTML = '<span class="kc-block-badge">Knowledge Check</span>';
      el.replaceWith(block);
    });
    const hasText = (clone.textContent || "").trim().length > 0;
    const hasMedia = clone.querySelector("img,table,hr,figure,pre,iframe,.lp-embed,.lp-file,.lp-resource,.kc-block,.kc-edit");
    if (!hasText && !hasMedia) return "";
    return clone.innerHTML.trim();
  }
  function setHTML(html) {
    // Stored KC blocks → editable cards so managers can edit them inline.
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    tmp.querySelectorAll(".kc-block[data-kc]").forEach(el => {
      let kc = null;
      try { kc = JSON.parse(el.getAttribute("data-kc")); } catch (e) {}
      const wrap = document.createElement("div");
      wrap.innerHTML = kcEditHtml(kc);
      el.replaceWith(wrap.firstElementChild);
    });
    area.innerHTML = tmp.innerHTML;
    hydrateKcQuestions();
    sync();
  }
  function clear() { area.innerHTML = ""; sync(); }
  function focus() { area.focus(); }

  return { getHTML, setHTML, clear, focus, area };
}
