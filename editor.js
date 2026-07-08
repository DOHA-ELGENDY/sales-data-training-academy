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
      case "callout-info": case "callout-note": case "callout-warning": case "callout-tip":
        insertCallout(action.replace("callout-", "")); break;
    }
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

  function readImage(file) {
    const rd = new FileReader();
    rd.onload = () => insertImage(rd.result);
    rd.readAsDataURL(file);
  }
  function insertImage(dataUrl) {
    insertHTML(
      `<figure class="rte-figure"><span class="rte-img"><img src="${dataUrl}" alt=""></span>` +
      `<figcaption>Caption…</figcaption></figure><p><br></p>`);
  }
  imgInput.addEventListener("change", () => {
    if (imgInput.files && imgInput.files[0]) readImage(imgInput.files[0]);
    imgInput.value = "";
  });

  /* Drag & drop images onto the editing area. */
  area.addEventListener("dragover", e => { e.preventDefault(); area.classList.add("rte-dragover"); });
  area.addEventListener("dragleave", () => area.classList.remove("rte-dragover"));
  area.addEventListener("drop", e => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => f.type.indexOf("image/") === 0);
    if (files.length) { e.preventDefault(); files.forEach(readImage); }
    area.classList.remove("rte-dragover");
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
    const hasText = (clone.textContent || "").trim().length > 0;
    const hasMedia = clone.querySelector("img,table,hr,figure,pre");
    if (!hasText && !hasMedia) return "";
    return clone.innerHTML.trim();
  }
  function setHTML(html) { area.innerHTML = html || ""; sync(); }
  function clear() { area.innerHTML = ""; sync(); }
  function focus() { area.focus(); }

  return { getHTML, setHTML, clear, focus, area };
}
