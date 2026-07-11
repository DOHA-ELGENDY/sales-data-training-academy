/* ============================================================
   Learning Path — team-aware, data-driven
   ------------------------------------------------------------
   One page serves every academy via ?team=<key>.
   - Sales Data keeps its approved static Module 0 (in the HTML).
   - Every academy also renders its Published Content-Manager
     modules. Teams with no content show a "No content yet" state.
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("learningPath");
  if (!container) return;

  const teamKey = getSelectedAcademy();
  if (!teamKey) { location.replace("index.html"); return; } // no team chosen → team selection
  const ac = academyByKey(teamKey);

  logLessonDiagnostics(teamKey); // TEMP: trace why lessons do/don't render (see console)

  /* ---- Rebrand the shell for this academy ---- */
  document.title = `Learning Path · ${ac.name}`;
  setText(".brand-text strong", ac.name);
  setText(".topbar-title", `${ac.name} — Learning Center`);
  setLogo(ac.logo);

  const head = document.querySelector(".page-head h1");
  if (head) head.textContent = `${ac.name} — Learning Path`;

  // Keep the team in the sidebar "Learning Path" link.
  const lpNav = document.querySelector('.nav-item[href^="learning_path.html"]');
  if (lpNav) lpNav.setAttribute("href", `learning_path.html?team=${teamKey}`);

  /* ---- Static content belongs to Sales Data only ---- */
  // The only .level-card elements present at load are the static ones.
  if (teamKey !== "sales-data") {
    container.querySelectorAll(".level-card").forEach(c => c.remove());
  }

  // Render from the local cache first (instant), then sync with Google Sheets.
  renderCmModules(teamKey, ac);
  renderAcademyProgress(teamKey);
  syncContentFromServer().then(ok => {
    if (ok) { renderCmModules(teamKey, ac); renderAcademyProgress(teamKey); }
  });

  // Lesson accordion: clicking a lesson header expands it and collapses the
  // others in that module (one lesson open at a time). Marks it In Progress.
  container.addEventListener("click", e => {
    const head = e.target.closest("[data-lesson-toggle]");
    if (!head || !container.contains(head)) return;
    const item = head.closest(".lesson-acc-item");
    const acc = head.closest(".lesson-acc");
    if (!item || !acc) return;
    const willOpen = !item.classList.contains("open");
    acc.querySelectorAll(".lesson-acc-item.open").forEach(it => {
      it.classList.remove("open");
      const h = it.querySelector("[data-lesson-toggle]");
      if (h) h.setAttribute("aria-expanded", "false");
    });
    if (willOpen) {
      item.classList.add("open");
      head.setAttribute("aria-expanded", "true");
      const id = item.getAttribute("data-lesson-id");
      if (id && !isLessonCompleted(teamKey, id)) {
        setLessonStatus(teamKey, id, "in-progress");
        item.classList.add("is-inprogress");
      }
    }
  });

  // Any collapsed module must have all its lessons collapsed too (so reopening a
  // module shows every lesson closed). Runs after the module accordion toggles;
  // covers a module closed directly and one closed by opening another.
  container.addEventListener("click", e => {
    const head = e.target.closest("[data-acc-toggle]");
    if (!head || !container.contains(head)) return;
    setTimeout(() => {
      container.querySelectorAll(".level-card:not(.open)").forEach(card => {
        card.querySelectorAll(".lesson-acc-item.open").forEach(it => {
          it.classList.remove("open");
          const h = it.querySelector("[data-lesson-toggle]");
          if (h) h.setAttribute("aria-expanded", "false");
        });
      });
    }, 0);
  });

  // "Mark Lesson as Completed" — record completion and refresh the counters
  // in place (no full re-render, so the open lesson stays open).
  container.addEventListener("click", e => {
    const btn = e.target.closest("[data-complete]");
    if (!btn || !container.contains(btn)) return;
    markLessonCompleted(btn.getAttribute("data-complete"), teamKey, btn);
  });

  // Submit Assignment — save the employee's submission to Supabase.
  container.addEventListener("submit", e => {
    const form = e.target.closest("[data-submit-form]");
    if (!form || !container.contains(form)) return;
    e.preventDefault();
    handleAssignmentSubmit(form, teamKey);
  });

  // Activities: save the employee's answers locally as they answer (no scoring).
  function saveActivityAnswer(actEl) {
    setResponse(teamKey, actEl.getAttribute("data-activity-id"), readActivityAnswer(actEl));
    const note = actEl.querySelector(".lp-act-saved");
    if (note) note.textContent = "✓ Saved";
  }
  container.addEventListener("change", e => {
    const actEl = e.target.closest(".lp-activity");
    if (actEl && container.contains(actEl)) saveActivityAnswer(actEl);
  });
  container.addEventListener("input", e => {
    const actEl = e.target.closest(".lp-activity");
    if (actEl && container.contains(actEl) && e.target.classList.contains("lp-act-short")) saveActivityAnswer(actEl);
  });

  // Inline Knowledge Checks: answer → immediate feedback; correct reveals the
  // gated content that follows (retry allowed on incorrect). No scoring.
  container.addEventListener("click", e => {
    const check = e.target.closest(".kc-check");
    if (check && container.contains(check)) { checkKnowledgeAnswer(check); return; }
    const cont = e.target.closest(".kc-continue");
    if (cont && container.contains(cont)) revealNextGate(cont);
  });
});

/* Make every inline Knowledge Check interactive, then gate the content that
   follows each one (hidden until answered correctly). */
function processKnowledgeChecks(root) {
  root.querySelectorAll(".lesson-acc-body > .cm-rendered").forEach(rendered => {
    rendered.querySelectorAll(".kc-block[data-kc]").forEach(enhanceKnowledgeCheck);
    liftKcBlocks(rendered);   // pasted content nests blocks — lift KCs to top level
    gateLessonContent(rendered);
  });
}
function enhanceKnowledgeCheck(block) {
  if (block.getAttribute("data-kc-ready")) return;
  let kc;
  try { kc = JSON.parse(block.getAttribute("data-kc")); } catch (e) { return; }
  block.setAttribute("data-kc-ready", "1");
  block.innerHTML = kcWidgetHtml(kc);
}
/* Make each KC a direct child of `rendered`. A KC nested inside wrapper elements
   (common with pasted content) is lifted out by splitting its ancestors: the
   wrapper keeps the content BEFORE the KC, a shallow clone (same tag/styles)
   takes the content AFTER it, and the KC is moved between them — repeated up to
   `rendered`. Document order and surrounding styling are preserved. */
function liftKcBlocks(rendered) {
  Array.from(rendered.querySelectorAll(".kc-block")).forEach(block => {
    let guard = 0;
    while (block.parentElement && block.parentElement !== rendered && guard++ < 50) {
      const parent = block.parentElement;
      const grandparent = parent.parentElement;
      if (!grandparent) break;
      const after = parent.cloneNode(false); // same tag + attributes, no children
      let sib = block.nextSibling;
      while (sib) { const next = sib.nextSibling; after.appendChild(sib); sib = next; }
      grandparent.insertBefore(block, parent.nextSibling);
      if (after.childNodes.length) grandparent.insertBefore(after, block.nextSibling);
      if (!parent.childNodes.length) parent.remove();
    }
  });
}
/* Move everything after each KC into a hidden gate (nested for multiple KCs). */
function gateLessonContent(rendered) {
  if (rendered.getAttribute("data-kc-gated")) return;
  rendered.setAttribute("data-kc-gated", "1");
  let target = rendered;
  Array.from(rendered.children).forEach(el => {
    if (target !== rendered) target.appendChild(el);
    if (el.classList && el.classList.contains("kc-block")) {
      const gate = document.createElement("div");
      gate.className = "kc-gate";
      gate.hidden = true;
      gate.style.display = "none"; // JS-driven hide (independent of CSS)
      el.after(gate);
      target = gate;
    }
  });
}
/* Objective types are auto-graded (Correct/Incorrect). All other types are
   deliverables: reviewed by a manager, not auto-graded. */
var KC_OBJECTIVE = ["mcq", "truefalse"];
function kcIsObjective(kc) { return KC_OBJECTIVE.indexOf(kc && kc.type) >= 0; }
function kcWants(type) {
  return {
    text: type === "short" || type === "text_or_doc" || type === "text_or_file",
    doc: type === "doclink" || type === "text_or_doc",
    file: type === "fileupload" || type === "text_or_file",
    combined: type === "text_or_doc" || type === "text_or_file"
  };
}

function kcWidgetHtml(kc) {
  const name = "kc-" + Math.random().toString(36).slice(2, 9);
  const type = kc.type || "mcq";
  let body = "", btnLabel = "Submit Response";
  if (type === "mcq") {
    btnLabel = "Check Answer";
    body = (kc.choices || []).map((c, i) =>
      `<label class="kc-opt"><input type="radio" name="${name}" value="${i}"><span>${escHtml(c)}</span></label>`).join("");
  } else if (type === "truefalse") {
    btnLabel = "Check Answer";
    body = ["true", "false"].map(v =>
      `<label class="kc-opt"><input type="radio" name="${name}" value="${v}"><span>${v === "true" ? "True" : "False"}</span></label>`).join("");
  } else {
    const w = kcWants(type);
    const parts = [];
    if (w.text) parts.push(`<textarea class="kc-text-input" rows="3" placeholder="اكتب إجابتك…"></textarea>`);
    if (w.combined) parts.push(`<div class="kc-or">— أو —</div>`);
    if (w.doc) parts.push(`<input type="url" class="kc-url-input" placeholder="https://docs.google.com/…">`);
    if (w.file) parts.push(`<input type="file" class="kc-file-input" accept=".pdf,.docx,.pptx,.xlsx">`);
    body = `<div class="kc-deliver">${parts.join("")}</div>`;
  }
  return `
    <div class="kc-head"><span class="kc-badge">Knowledge Check</span></div>
    <div class="kc-q kc-q-rich">${kc.question || ""}</div>
    <div class="kc-opts">${body}</div>
    ${kc.explanation ? `<div class="kc-explain" hidden><strong>💡</strong> ${escHtml(kc.explanation)}</div>` : ""}
    <div class="kc-actions">
      <button type="button" class="btn btn-primary kc-check">${btnLabel}</button>
      <button type="button" class="btn kc-continue" hidden>Continue to the next part →</button>
      <span class="kc-feedback" aria-live="polite"></span>
    </div>`;
}
/* Route a KC submission: objective types are graded; deliverable types are
   validated, saved to Supabase, and marked "submitted for review". */
function checkKnowledgeAnswer(btn) {
  const block = btn.closest(".kc-block");
  if (!block) return;
  let kc;
  try { kc = JSON.parse(block.getAttribute("data-kc")); } catch (e) { return; }
  if (kcIsObjective(kc)) gradeObjectiveKc(block, kc);
  else submitDeliverableKc(block, kc, btn);
}
/* Reveal the Continue button once a KC is answered (only if there is gated
   content after it). */
function revealContinue(block) {
  const gate = block.nextElementSibling;
  const cont = block.querySelector(".kc-continue");
  if (cont && gate && gate.classList.contains("kc-gate") && gate.children.length) cont.hidden = false;
}
/* MCQ / True-False: immediate Correct/Incorrect. Any submitted answer reveals
   Continue (participation, not blocking). Incorrect allows retry. */
function gradeObjectiveKc(block, kc) {
  const fb = block.querySelector(".kc-feedback");
  const sel = block.querySelector('input[type="radio"]:checked');
  if (!sel) { fb.textContent = "اختَر إجابة الأول."; fb.className = "kc-feedback kc-warn"; return; }
  const correct = kc.type === "mcq"
    ? (Number(sel.value) === Number(kc.correct))
    : (String(sel.value) === String(kc.correct));
  block.classList.remove("is-correct", "is-incorrect");
  block.classList.add("is-answered", correct ? "is-correct" : "is-incorrect");
  fb.textContent = correct ? "✓ Correct" : "✗ Incorrect — you can try again or continue";
  fb.className = "kc-feedback " + (correct ? "kc-correct" : "kc-incorrect");
  const explain = block.querySelector(".kc-explain"); if (explain) explain.hidden = false;
  revealContinue(block);
}
/* Lesson context for a KC (academy / module / lesson) from its accordion item. */
function kcResponseContext(block) {
  const item = block.closest(".lesson-acc-item");
  const lessonId = item ? (item.getAttribute("data-lesson-id") || "") : "";
  const lesson = (typeof loadLessons === "function" ? loadLessons() : []).find(l => l.id === lessonId) || {};
  const teamKey = (typeof getSelectedAcademy === "function") ? getSelectedAcademy() : "";
  return { lessonId: lessonId, moduleId: lesson.moduleId || "", academyKey: lesson.academyKey || teamKey || "" };
}
/* Short text / document link / file upload / combined: validate, upload any
   file to Supabase Storage, save the response, then reveal Continue. Not graded
   — the manager reviews it later. Content stays gated until the save succeeds. */
async function submitDeliverableKc(block, kc, btn) {
  const fb = block.querySelector(".kc-feedback");
  const setErr = t => { fb.textContent = t; fb.className = "kc-feedback kc-warn"; };
  const type = kc.type, w = kcWants(type);
  const textEl = block.querySelector(".kc-text-input");
  const urlEl = block.querySelector(".kc-url-input");
  const fileEl = block.querySelector(".kc-file-input");
  const text = textEl ? textEl.value.trim() : "";
  const url = urlEl ? urlEl.value.trim() : "";
  const file = (fileEl && fileEl.files) ? fileEl.files[0] : null;
  const hasText = !!text, hasUrl = !!url, hasFile = !!file;

  // Presence: single types need their own input; combined types need ≥1 (not both).
  if (type === "short" && !hasText) return setErr("اكتب إجابتك أولاً.");
  if (type === "doclink" && !hasUrl) return setErr("أضف رابط المستند.");
  if (type === "fileupload" && !hasFile) return setErr("أرفق ملفًا.");
  if (type === "text_or_doc" && !hasText && !hasUrl) return setErr("اكتب إجابة أو أضف رابط مستند.");
  if (type === "text_or_file" && !hasText && !hasFile) return setErr("اكتب إجابة أو أرفق ملفًا.");
  // Format checks.
  if (hasUrl && !/^https?:\/\/\S+/i.test(url)) return setErr("الرابط لازم يبدأ بـ http أو https.");
  if (hasFile) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (["pdf", "docx", "pptx", "xlsx"].indexOf(ext) < 0) return setErr("الملف لازم يكون PDF أو DOCX أو PPTX أو XLSX.");
    if (file.size > 10 * 1024 * 1024) return setErr("أقصى حجم للملف 10 ميجابايت.");
  }

  const ctx = kcResponseContext(block);
  const ident = (typeof Identity !== "undefined") ? Identity.get() : null;

  btn.disabled = true;
  fb.textContent = hasFile ? "Uploading…" : "Submitting…"; fb.className = "kc-feedback";

  // Upload the file first (a failed upload is a hard error — nothing is saved).
  let fileUrl = "", fileName = "";
  if (hasFile) {
    try {
      if (!(typeof SB !== "undefined" && SB.enabled && SB.enabled() && SB.uploadKcFile)) throw new Error("no-storage");
      fileUrl = await SB.uploadKcFile(file);
      fileName = file.name;
    } catch (e) { btn.disabled = false; return setErr("تعذّر رفع الملف — حاول مرة أخرى."); }
  }

  const resp = {
    id: (typeof SB !== "undefined" && SB.subId) ? SB.subId() : ("kcr" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
    employeeId: ident ? ident.employeeId : "",
    employeeName: ident ? ident.employeeName : "",
    team: ident ? ident.team : "",
    academyKey: ctx.academyKey,
    moduleId: ctx.moduleId,
    lessonId: ctx.lessonId,
    knowledgeCheckId: kc.id || "",
    question: kc.question || "",
    responseType: type,
    textAnswer: text,
    documentUrl: url,
    fileUrl: fileUrl,
    fileName: fileName,
    reviewStatus: "Pending Review",
    submittedAt: new Date().toISOString()
  };

  let saved = false;
  try {
    if (typeof SB !== "undefined" && SB.enabled && SB.enabled() && SB.insertKcResponse) {
      await SB.insertKcResponse(resp); saved = true;
    }
  } catch (e) { saved = false; }
  if (!saved) { btn.disabled = false; return setErr("تعذّر حفظ الإجابة — حاول مرة أخرى."); }

  // Submitted for review — lock inputs, show status, reveal Continue.
  block.classList.add("is-answered", "is-submitted");
  [textEl, urlEl, fileEl].forEach(el => { if (el) el.disabled = true; });
  btn.hidden = true;
  fb.textContent = "✓ Response submitted for review.";
  fb.className = "kc-feedback kc-correct";
  const explain = block.querySelector(".kc-explain"); if (explain) explain.hidden = false;
  revealContinue(block);
}
/* Reveal the gate that follows a KC when the employee clicks Continue Reading. */
function revealNextGate(cont) {
  const block = cont.closest(".kc-block");
  const gate = block ? block.nextElementSibling : null;
  cont.hidden = true;
  if (gate && gate.classList.contains("kc-gate")) {
    gate.hidden = false;
    gate.style.display = "";
    gate.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/* Collect the submission form + lesson context and save it to Supabase. */
function handleAssignmentSubmit(form, teamKey) {
  const msg = form.querySelector(".lp-submit-msg");
  const val = name => { const f = form.querySelector('[name="' + name + '"]'); return f ? (f.value || "").trim() : ""; };
  const ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  // Employee identity comes from the Identification Provider (no extra typing);
  // fall back to the form field only if not identified yet.
  const employeeName = (ident && ident.employeeName) || val("employeeName");
  const submissionLink = val("submissionLink");
  const textAnswer = val("textAnswer");
  const notes = val("notes");

  const err = t => { msg.style.color = "#dc2626"; msg.textContent = t; };
  if (!employeeName) { err("اكتب اسمك الأول."); return; }
  if (!submissionLink && !textAnswer) { err("أضف Submission Link أو Text Answer."); return; }

  const lessonId = form.getAttribute("data-lesson-id");
  const lesson = loadLessons().find(l => l.id === lessonId) || {};
  const mod = loadContent().find(m => m.id === lesson.moduleId) || {};
  // Auto-attach employeeId / employeeName / team / timestamp from the provider.
  const sub = (typeof Identity !== "undefined" ? Identity.stamp({}) : {});
  sub.id = (typeof SB !== "undefined" && SB.subId) ? SB.subId() : ("s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  sub.academyKey = teamKey;
  sub.moduleId = lesson.moduleId || "";
  sub.moduleTitle = mod.moduleTitle || "";
  sub.lessonId = lessonId;
  sub.lessonTitle = lesson.lessonTitle || "";
  sub.assignmentTitle = (lesson.assignment && lesson.assignment.title) || "";
  sub.employeeName = employeeName;   // provider value (or typed fallback)
  sub.submissionLink = submissionLink;
  sub.textAnswer = textAnswer;
  sub.notes = notes;
  sub.status = "Pending Review";

  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  msg.style.color = "#6b7280";
  msg.textContent = "Submitting…";
  pushSubmission(sub).then(ok => {
    form.reset();
    if (btn) btn.disabled = false;
    msg.style.color = "#16a34a";
    msg.textContent = ok ? "تم إرسال التسليم ✓" : "تم الحفظ محليًا — هيتزامن أول ما النت يرجع ✓";
    setTimeout(() => { if (msg.textContent.indexOf("✓") >= 0) msg.textContent = ""; }, 5000);
  });
}

/* Record a lesson as completed and update its accordion item + progress meters. */
function markLessonCompleted(lessonId, teamKey, btn) {
  setLessonStatus(teamKey, lessonId, "completed");

  btn.disabled = true;
  btn.classList.remove("btn-primary");
  btn.classList.add("is-done");
  btn.textContent = "✓ Lesson Completed";

  // Reflect completion on this lesson's accordion item (green check).
  const item = btn.closest(".lesson-acc-item");
  if (item) { item.classList.remove("is-inprogress"); item.classList.add("is-completed"); }

  const card = btn.closest(".level-card");
  if (card) {
    // Refresh this module's counter.
    const moduleId = card.getAttribute("data-module-id");
    const el = card.querySelector(".mod-progress");
    if (moduleId && el) {
      const { done, total } = moduleProgress(teamKey, moduleId);
      if (total) el.innerHTML = moduleProgressMarkup(done, total);
    }
  }
  renderAcademyProgress(teamKey);
}

/* Academy progress summary at the top of the Learning Path. */
function renderAcademyProgress(teamKey) {
  const el = document.getElementById("academyProgress");
  if (!el) return;
  const p = academyProgress(teamKey);
  if (!p.lessonsTotal) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = `
    <div class="ap-stat">
      <span class="ap-num">${p.lessonsDone} / ${p.lessonsTotal}</span>
      <span class="ap-label">Lessons Completed</span>
    </div>
    <div class="ap-stat">
      <span class="ap-num">${p.modulesDone} / ${p.modulesTotal}</span>
      <span class="ap-label">Modules Completed</span>
    </div>
    <div class="ap-stat ap-overall">
      <div class="ap-overall-top">
        <span class="ap-label">Overall Progress</span>
        <span class="ap-num">${p.percent}%</span>
      </div>
      <div class="ap-bar"><span style="width:${p.percent}%"></span></div>
    </div>`;

  // Mirror into the sidebar "Overall Progress" widget.
  const footPct = document.querySelector(".foot-percent");
  const footBar = document.querySelector(".foot-progress .progress-bar span");
  if (footPct) footPct.textContent = p.percent + "%";
  if (footBar) footBar.style.width = p.percent + "%";
}

/* Render (or re-render) the Content-Manager modules for a team.
   Removes previously CM-added cards, then appends the current set. */
function renderCmModules(teamKey, ac) {
  const container = document.getElementById("learningPath");
  container.querySelectorAll(".cm-added").forEach(el => el.remove());

  const modules = modulesForPath(teamKey);
  modules.forEach(m => container.insertAdjacentHTML("beforeend",
    m.status === "Locked" ? lockedCard(m) : moduleCard(m)));

  const sub = document.querySelector(".page-head .muted");
  if (!container.querySelector(".level-card")) {
    if (sub) sub.textContent = `${ac.name} — No content yet.`;
    container.insertAdjacentHTML("beforeend", `
      <div class="cm-empty cm-added">
        <div class="cm-empty-ico">🗂️</div>
        <h3>No content yet</h3>
        <p class="muted">No content has been added for this team yet.</p>
        <p class="muted">${escHtml(ac.name)} — المحتوى هيظهر هنا تلقائيًا بمجرد إضافته ونشره من <strong>Content Manager</strong>.</p>
      </div>`);
  } else if (teamKey !== "sales-data" && sub) {
    sub.textContent = `${ac.name} — اضغط على أي Module علشان يفتح محتواه.`;
  }

  container.querySelectorAll(".reveal:not(.in)").forEach((el, i) =>
    setTimeout(() => el.classList.add("in"), 30 * i));

  // Make inline Knowledge Checks interactive + gate the content after them.
  processKnowledgeChecks(container);
}

/* Published module → open accordion card. */
function moduleCard(m) {
  const bodyId = "body-cm-" + m.id;
  const subtitle = m.shortDesc || m.lessonTitle || "";

  const assignment = (m.asgTitle || m.asgObjective || m.asgInstructions || m.asgDeliverables) ? `
    <h4>Assignment</h4>
    ${m.asgTitle ? `<p><strong>${escHtml(m.asgTitle)}</strong></p>` : ""}
    ${m.asgObjective ? `<p><strong>Objective:</strong> ${escHtml(m.asgObjective)}</p>` : ""}
    ${m.asgInstructions ? `<p><strong>Instructions:</strong> ${escHtml(m.asgInstructions)}</p>` : ""}
    ${m.asgDeliverables ? `<p><strong>Deliverables:</strong> ${escHtml(m.asgDeliverables)}</p>` : ""}` : "";

  const resItems = [
    m.resVideo ? `<li>🎬 <a href="${escHtml(m.resVideo)}" target="_blank" rel="noopener">Video</a></li>` : "",
    m.resDrive ? `<li>📁 <a href="${escHtml(m.resDrive)}" target="_blank" rel="noopener">Google Drive</a></li>` : "",
    m.resPdf ? `<li>📄 <a href="${escHtml(m.resPdf)}" target="_blank" rel="noopener">PDF</a></li>` : "",
    ...String(m.resLinks || "").split(/\r?\n/).filter(Boolean)
      .map(l => `<li>🔗 <a href="${escHtml(l.trim())}" target="_blank" rel="noopener">${escHtml(l.trim())}</a></li>`)
  ].filter(Boolean).join("");
  const resources = resItems ? `<h4>Resources</h4><ul>${resItems}</ul>` : "";

  // Module Overview (description, objectives, duration, difficulty, prerequisites).
  const overview = moduleOverview(m);

  // Published lessons → each lesson is its own accordion (one open at a time).
  const lessons = publishedLessonsForModule(m.id);
  let lessonsSection;
  if (lessons.length) {
    lessonsSection = `<h4 class="module-lessons-title">Lessons</h4>${lessonAccordion(lessons, m.academyKey)}`;
  } else if (m.content || assignment || resources) {
    // Backward-compat for any legacy module-level content.
    const content = m.content ? `<h4>Learning Content</h4><div class="cm-rendered">${renderRichText(m.content)}</div>` : "";
    lessonsSection = `${content}${assignment}${resources}`;
  } else {
    lessonsSection = `<p class="muted" style="font-size:14px">المحتوى التفصيلي هيتضاف قريبًا.</p>`;
  }
  const body = `${overview}${lessonsSection}`;

  const prog = moduleProgress(m.academyKey, m.id);
  const progRow = prog.total
    ? `<div class="mod-progress" id="prog-cm-${m.id}">${moduleProgressMarkup(prog.done, prog.total)}</div>`
    : "";

  return `
    <div class="level-card cm-added reveal" data-module-id="${m.id}">
      <div class="level-head" data-acc-toggle role="button" tabindex="0"
           aria-expanded="false" aria-controls="${bodyId}">
        <div class="level-badge">M${escHtml(m.moduleNumber)}</div>
        <div class="level-head-text">
          <h3>Module ${escHtml(m.moduleNumber)} — ${escHtml(m.moduleTitle)}</h3>
          ${subtitle ? `<p>${escHtml(subtitle)}</p>` : ""}
          ${progRow}
        </div>
        <div class="level-toggle" aria-hidden="true">▾</div>
      </div>
      <div class="level-body" id="${bodyId}">
        ${body}
      </div>
    </div>`;
}

/* Clean Module Overview shown at the top of an expanded module, before Lessons.
   Shows description, learning objectives, duration, difficulty, prerequisites.
   Returns "" when the module has none of these. */
function moduleOverview(m) {
  const objectives = Array.isArray(m.objectives) ? m.objectives.filter(Boolean) : [];
  const desc = m.shortDesc ? `<p>${escHtml(m.shortDesc)}</p>` : "";
  const objHtml = objectives.length
    ? `<h4>Learning Objectives</h4><ul>${objectives.map(o => `<li>${escHtml(o)}</li>`).join("")}</ul>`
    : "";
  const meta = [
    m.studyTime ? `<span class="meta-chip">⏱ ${escHtml(m.studyTime)}</span>` : "",
    m.difficulty ? `<span class="meta-chip">📊 ${escHtml(m.difficulty)}</span>` : ""
  ].filter(Boolean).join("");
  const prereq = m.prerequisites ? `<h4>Prerequisites</h4><p>${escHtml(m.prerequisites)}</p>` : "";
  if (!desc && !objHtml && !meta && !prereq) return "";
  return `
    <div class="module-overview">
      ${desc}
      ${objHtml}
      ${meta ? `<div class="module-meta" style="margin-top:12px">${meta}</div>` : ""}
      ${prereq}
    </div>`;
}

/* Compact "done / total Lessons" label + mini bar for a module head. */
function moduleProgressMarkup(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `
    <span class="mod-progress-label">${done} / ${total} Lessons</span>
    <div class="mod-bar"><span style="width:${pct}%"></span></div>`;
}

/* Lessons as accordions inside a module — like the Module accordion. Each
   lesson expands/collapses; only one is open at a time (the first is open by
   default). Open shows Content, Assignment, Activities, and the complete action. */
function lessonAccordion(lessons, academyKey) {
  // Every lesson starts collapsed — the employee clicks one to open it.
  return `<div class="lesson-acc">${lessons.map((l, i) => lessonAccItem(l, i, academyKey, false)).join("")}</div>`;
}

function lessonAccItem(l, i, academyKey, openByDefault) {
  const status = getLessonStatus(academyKey, l.id);
  const completed = status === "completed";
  const state = completed ? " is-completed" : (status === "in-progress" ? " is-inprogress" : "");
  const open = openByDefault ? " open" : "";
  return `
    <div class="lesson-acc-item${state}${open}" data-lesson-id="${escHtml(l.id)}">
      <button type="button" class="lesson-acc-head" data-lesson-toggle aria-expanded="${openByDefault ? "true" : "false"}">
        <span class="lesson-acc-caret" aria-hidden="true">▶</span>
        <span class="lesson-acc-title">
          <span class="lesson-check" aria-hidden="true">✓</span><span class="lesson-dot" aria-hidden="true">●</span>Lesson ${escHtml(l.lessonNumber) || (i + 1)} — ${escHtml(l.lessonTitle || l.contentType || "")}
        </span>
      </button>
      <div class="lesson-acc-body">
        <div class="cm-rendered">${renderLessonBlocksHtml(l)}</div>
        ${assignmentBlock(l.assignment)}
        ${submissionForm(l)}
        ${activitiesBlock(l, academyKey)}
        <div class="lesson-complete">
          <button type="button" class="btn ${completed ? "is-done" : "btn-primary"} lesson-complete-btn"
                  data-complete="${escHtml(l.id)}" ${completed ? "disabled" : ""}>
            ${completed ? "✓ Lesson Completed" : "Mark Lesson as Completed"}
          </button>
        </div>
      </div>
    </div>`;
}

/* Submit-Assignment form, shown under a Published assignment. Returns "" when
   there is no published assignment (so no form appears). */
function submissionForm(l) {
  if (!(l && l.assignment && l.assignment.status === "Published")) return "";
  // Employee identity is auto-attached from the Identification Provider — show it
  // (read-only) rather than asking again; only prompt for the name if unidentified.
  const ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  const nameRow = ident
    ? `<div class="lp-submit-as">👤 <strong>${escHtml(ident.employeeName)}</strong> · ${escHtml(ident.team)}</div>`
    : `<input type="text" name="employeeName" placeholder="اسمك · Employee Name" autocomplete="name" required />`;
  return `
    <form class="lp-submit" data-submit-form data-lesson-id="${escHtml(l.id)}">
      <h5 class="lp-submit-title">Submit Assignment</h5>
      ${nameRow}
      <input type="text" name="submissionLink" placeholder="Submission Link (Google Drive / URL)" />
      <textarea name="textAnswer" rows="3" placeholder="Text Answer — اكتب إجابتك هنا"></textarea>
      <textarea name="notes" rows="2" placeholder="Notes (اختياري)"></textarea>
      <div class="lp-submit-actions">
        <button type="submit" class="btn btn-primary">Submit Assignment</button>
        <span class="lp-submit-msg" role="status" aria-live="polite"></span>
      </div>
    </form>`;
}

/* Lesson assignment shown under the lesson content — only when Published.
   Returns "" when there is no assignment or it is still a Draft, so no
   empty assignment block ever appears for employees. */
function assignmentBlock(asg) {
  if (!asg || asg.status !== "Published") return "";
  const chips = [
    asg.estTime ? `<span class="meta-chip">⏱ ${escHtml(asg.estTime)}</span>` : "",
    asg.minScore ? `<span class="meta-chip">✅ Min ${escHtml(asg.minScore)}</span>` : "",
    asg.submissionType ? `<span class="meta-chip">📤 ${escHtml(asg.submissionType)}</span>` : ""
  ].filter(Boolean).join("");

  return `
    <div class="lesson-assignment">
      <h4>Assignment${asg.title ? " — " + escHtml(asg.title) : ""}</h4>
      ${asg.instructions ? `<div class="cm-rendered">${renderRichText(asg.instructions)}</div>` : ""}
      ${asg.deliverables ? `<p><strong>Deliverables</strong></p><div class="cm-rendered">${renderRichText(asg.deliverables)}</div>` : ""}
      ${chips ? `<div class="module-meta" style="margin-top:10px">${chips}</div>` : ""}
    </div>`;
}

/* Published activities under the lesson content. Employees can answer; answers
   are saved locally (no scoring yet). Returns "" when there is nothing to show. */
function activitiesBlock(lesson, academyKey) {
  const acts = publishedActivities(lesson);
  if (!acts.length) return "";
  const rows = acts.map((a, i) => activityHtml(a, i, academyKey)).join("");
  return `<div class="lp-activities"><h4>Activities</h4>${rows}</div>`;
}

function activityHtml(a, i, academyKey) {
  const resp = getResponse(academyKey, a.id);
  const name = "lpact-" + a.id;
  let body = "";

  if (a.type === "mcq") {
    body = (a.choices || []).map((c, ci) => `
      <label class="lp-act-option">
        <input type="radio" name="${name}" value="${ci}" ${resp != null && Number(resp) === ci ? "checked" : ""} />
        <span>${escHtml(c)}</span>
      </label>`).join("");
  } else if (a.type === "truefalse") {
    body = ["true", "false"].map(v => `
      <label class="lp-act-option">
        <input type="radio" name="${name}" value="${v}" ${String(resp) === v ? "checked" : ""} />
        <span>${v === "true" ? "True" : "False"}</span>
      </label>`).join("");
  } else if (a.type === "multiselect") {
    const arr = Array.isArray(resp) ? resp.map(Number) : [];
    body = (a.choices || []).map((c, ci) => `
      <label class="lp-act-option">
        <input type="checkbox" name="${name}" value="${ci}" ${arr.indexOf(ci) >= 0 ? "checked" : ""} />
        <span>${escHtml(c)}</span>
      </label>`).join("");
  } else if (a.type === "short") {
    body = `<input type="text" class="lp-act-short" value="${escHtml(resp || "")}" placeholder="اكتب إجابتك…" />`;
  }

  const pts = (a.points == null) ? "" : `<span class="lp-act-points">${escHtml(String(a.points))} pts</span>`;
  return `
    <div class="lp-activity" data-activity-id="${escHtml(a.id)}" data-act-type="${escHtml(a.type)}">
      <div class="lp-act-q"><span class="lp-act-num">Q${i + 1}</span> ${escHtml(a.question)} ${pts}</div>
      <div class="lp-act-body">${body}</div>
      <div class="lp-act-saved" aria-live="polite"></div>
    </div>`;
}

/* Read the employee's current answer for one .lp-activity element. */
function readActivityAnswer(actEl) {
  const type = actEl.getAttribute("data-act-type");
  if (type === "mcq" || type === "truefalse") {
    const checked = actEl.querySelector('input[type="radio"]:checked');
    if (!checked) return null;
    return type === "mcq" ? Number(checked.value) : checked.value;
  }
  if (type === "multiselect") {
    return Array.from(actEl.querySelectorAll('input[type="checkbox"]:checked')).map(c => Number(c.value));
  }
  if (type === "short") {
    const t = actEl.querySelector(".lp-act-short");
    return t ? t.value : "";
  }
  return null;
}

/* Locked module → header-only "Coming Soon" card (not expandable). */
function lockedCard(m) {
  const subtitle = m.shortDesc || "";
  return `
    <div class="level-card locked-module cm-added reveal" aria-disabled="true">
      <div class="level-head">
        <div class="level-badge locked-badge">M${escHtml(m.moduleNumber)}</div>
        <div class="level-head-text">
          <h3>Module ${escHtml(m.moduleNumber)} — ${escHtml(m.moduleTitle)}</h3>
          ${subtitle ? `<p>${escHtml(subtitle)}</p>` : ""}
        </div>
        <span class="pill locked-pill">🔒 Locked</span>
      </div>
    </div>`;
}

/* ============================================================
   TEMP DIAGNOSTICS — remove once lessons are confirmed working.
   Prints exactly why lessons do / don't appear for this team.
   Re-run any time in the console with:  lpDiag()
   ============================================================ */
function logLessonDiagnostics(teamKey) {
  try {
    const allModules = (typeof loadContent === "function") ? loadContent() : [];
    const allLessons = (typeof loadLessons === "function") ? loadLessons() : [];
    const teamModules = allModules.filter(m => m.academyKey === teamKey);

    console.group("%c[LessonDiag] Learning Path content trace", "color:#2563eb;font-weight:bold");
    console.log("Team:", teamKey);
    console.log("remoteContentReady (Google Sheets active?):", typeof remoteContentReady !== "undefined" ? remoteContentReady : "n/a");
    console.log("Modules in localStorage for this team:", teamModules.length,
      teamModules.map(m => ({ id: m.id, number: m.moduleNumber, title: m.moduleTitle, status: m.status })));
    console.log("ALL lessons in localStorage:", allLessons.length,
      allLessons.map(l => ({ id: l.id, moduleId: l.moduleId, title: l.lessonTitle, type: l.contentType, status: l.status })));

    if (!teamModules.length) {
      console.warn("→ No modules cached for this team yet. They load from Supabase — check the SUPABASE_URL / anon key in supabase.js, then refresh.");
    }
    teamModules.forEach(m => {
      const linked = allLessons.filter(l => l.moduleId === m.id);
      const published = linked.filter(l => l.status === "Published");
      console.log(`Module "${m.moduleTitle}" [status=${m.status}] id=${m.id} → ${linked.length} linked lesson(s), ${published.length} Published`);
      if (m.status === "Draft") console.warn(`   • Module is DRAFT → hidden from Learning Path. Set it to Published.`);
      if (m.status === "Locked") console.warn(`   • Module is LOCKED → shows as "Coming Soon" with no lesson body.`);
      if (linked.length && !published.length) console.warn(`   • Lessons exist but all are DRAFT → hidden. Open Content Manager → Lessons → Publish them.`);
      if (!linked.length && allLessons.some(l => l.academyKey === m.academyKey)) console.warn(`   • Lessons exist for this academy but none point to this module's id (moduleId mismatch).`);
    });
    console.groupEnd();
  } catch (e) { console.warn("[LessonDiag] error:", e); }
}
try { window.lpDiag = () => logLessonDiagnostics(getSelectedAcademy()); } catch (e) {}

/* ---- small DOM helpers ---- */
function setText(sel, text) { const el = document.querySelector(sel); if (el) el.textContent = text; }
function setLogo(initials) {
  document.querySelectorAll(".brand-logo, .topbar-logo").forEach(el => { el.textContent = initials; });
}
