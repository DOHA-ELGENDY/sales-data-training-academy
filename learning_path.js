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

  // Analytics (best-effort): record the employee + academy visit.
  if (typeof Track !== "undefined") { Track.identified(); Track.academyOpened(teamKey); }

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

  // Hydrate persistent progress from Supabase (AUTHORITATIVE) into the local
  // cache BEFORE rendering, so completed sections / Knowledge Checks / unlocked
  // steps restore on any device. hydrateProgress always resolves (falls back to
  // the local cache on any error), so the page never hangs.
  const renderAll = () => { renderCmModules(teamKey, ac); renderAcademyProgress(teamKey); };
  hydrateProgress(teamKey).then(() => {
    renderAll();
    showContinueBanner(teamKey);
    syncContentFromServer().then(ok => { if (ok) renderAll(); });
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
      // Analytics: lesson opened (best-effort).
      if (id && typeof Track !== "undefined") {
        const lsn = loadLessons().find(l => l.id === id) || {};
        Track.lessonOpened({
          academyKey: teamKey, moduleId: lsn.moduleId || "",
          moduleTitle: (loadContent().find(m => m.id === lsn.moduleId) || {}).moduleTitle || "",
          lessonId: id, lessonTitle: lsn.lessonTitle || ""
        });
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
      // Analytics: module opened (best-effort) when this card ends up open.
      const card = head.closest(".level-card");
      if (card && card.classList.contains("open") && typeof Track !== "undefined") {
        const mid = card.getAttribute("data-module-id");
        Track.moduleOpened({ academyKey: teamKey, moduleId: mid || "",
          moduleTitle: (loadContent().find(m => m.id === mid) || {}).moduleTitle || "" });
      }
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
    // Show the chosen file name next to a File Upload input.
    const fileInput = e.target.closest(".lp-file-input");
    if (fileInput && container.contains(fileInput)) {
      const label = fileInput.parentNode.querySelector("[data-file-name]");
      const f = fileInput.files && fileInput.files[0];
      if (label) label.textContent = f ? ("📄 " + f.name) : "";
    }
  });
  container.addEventListener("input", e => {
    const actEl = e.target.closest(".lp-activity");
    if (actEl && container.contains(actEl) && e.target.classList.contains("lp-act-short")) saveActivityAnswer(actEl);
  });

  // Inline Knowledge Checks: answer → immediate feedback; correct reveals the
  // gated content that follows (retry allowed on incorrect). No scoring.
  container.addEventListener("click", e => {
    // Final steps (Assignment / Final Activities / Lesson Completed) — their own
    // toggles/actions, kept separate from the section/KC step handlers below.
    const finalHead = e.target.closest("[data-final-toggle]");
    if (finalHead && container.contains(finalHead)) { toggleFinalStep(finalHead); return; }
    const actFinish = e.target.closest(".lp-act-finish");
    if (actFinish && container.contains(actFinish)) { finishActivities(actFinish); return; }
    const resubBtn = e.target.closest(".lp-resubmit");
    if (resubBtn && container.contains(resubBtn)) { resubmitAssignment(resubBtn); return; }
    const stepHead = e.target.closest("[data-step-toggle]");
    if (stepHead && container.contains(stepHead)) { toggleStep(stepHead, teamKey); return; }
    const finish = e.target.closest(".lp-finish-part");
    if (finish && container.contains(finish)) { advanceFromStep(finish); return; }
    const check = e.target.closest(".kc-check");
    if (check && container.contains(check)) { checkKnowledgeAnswer(check); return; }
    const cont = e.target.closest(".kc-continue");
    if (cont && container.contains(cont)) {
      if (cont.closest(".lp-part-item")) advanceFromStep(cont); else revealNextGate(cont);
      return;
    }
  });
});

/* ============================================================
   LESSON STEPS (employee) — Module > Lesson > Section content > Knowledge Check
   ------------------------------------------------------------
   Each Part becomes TWO sequential STEPS: a CONTENT step (the section's Rich
   Text / media, ending with "Finish This Part") and — when the Part has one — a
   SEPARATE Knowledge Check step. Steps are collapsible rows, one open at a time,
   gated linearly: a step unlocks only when the previous step is completed. A
   content step completes on "Finish This Part"; a KC step completes on Continue
   after a valid submission. A Part counts as completed only when its LAST step is
   done (never merely because it was opened). Progress is persisted per employee.
   ============================================================ */
function stepsStorageKey(ctx) { return `lp:steps:${ctx.academyKey}:${ctx.moduleId}:${ctx.lessonId}:${ctx.employee}`; }
function loadCompletedSteps(ctx) {
  try { const raw = localStorage.getItem(stepsStorageKey(ctx)); return new Set(raw ? JSON.parse(raw) : []); }
  catch (e) { return new Set(); }
}
function saveCompletedStep(ctx, stepId) {
  const set = loadCompletedSteps(ctx);
  set.add(stepId);
  try { localStorage.setItem(stepsStorageKey(ctx), JSON.stringify(Array.from(set))); } catch (e) {}
  persistProgress(ctx, set, { currentSectionId: stepId }); // Supabase-authoritative mirror (idempotent)
  return set;
}

/* ============================================================
   PERSISTENT PROGRESS — Supabase authoritative, localStorage is a cache.
   On load we hydrate the localStorage step cache + lesson status from Supabase
   so a returning employee (any device) restores completed sections / KCs /
   unlocked steps. On every completion we upsert the same row (idempotent).
   ============================================================ */
/* Mirror one lesson's completed-step set to Supabase (best-effort, non-blocking). */
function persistProgress(ctx, set, opts) {
  opts = opts || {};
  if (typeof upsertLessonProgress !== "function" || !ctx || !ctx.employee || !ctx.lessonId) return;
  var ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  var lesson = (typeof loadLessons === "function" ? loadLessons() : []).find(function (l) { return l.id === ctx.lessonId; }) || {};
  try {
    upsertLessonProgress({
      employeeId: ctx.employee, employeeName: ident ? ident.employeeName : "", team: ident ? ident.team : "",
      academyKey: ctx.academyKey, moduleId: ctx.moduleId || lesson.moduleId || "", lessonId: ctx.lessonId,
      status: opts.completed ? "completed" : "in-progress",
      completedSteps: Array.from(set || []),
      currentSectionId: opts.currentSectionId || "",
      completed: !!opts.completed
    });
  } catch (e) {}
}

/* Knowledge Check restore cache: knowledge_check_id -> saved response row. */
var KC_RESTORE = {};
function cacheKcResponses(rows) {
  KC_RESTORE = {};
  (rows || []).forEach(function (r) { if (r && r.knowledge_check_id) KC_RESTORE[r.knowledge_check_id] = r; });
}
function kcRestoreFor(kcId) { return (kcId && KC_RESTORE[kcId]) || null; }
function kcNeedsResubmit(r) { return !!r && /needs revision/i.test(String(r.review_status || "")); }

/* Hydrate the localStorage progress cache from Supabase BEFORE rendering. Always
   resolves (falls back to whatever cache exists on any failure). */
function hydrateProgress(teamKey) {
  var ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  var empId = ident ? (ident.employeeId || "") : "";
  if (!empId) return Promise.resolve();
  var jobs = [];
  if (typeof fetchLessonProgress === "function") {
    jobs.push(fetchLessonProgress(empId).then(function (rows) {
      (rows || []).forEach(function (row) {
        var steps = [];
        try { steps = JSON.parse(row.completed_steps || "[]"); } catch (e) { steps = []; }
        if (Array.isArray(steps) && steps.length) {
          var academyForKey = row.academy_key || teamKey || "";
          var key = "lp:steps:" + academyForKey + ":" + (row.module_id || "") + ":" + (row.lesson_id || "") + ":" + empId;
          try {
            var cur = []; try { cur = JSON.parse(localStorage.getItem(key) || "[]"); } catch (e2) {}
            localStorage.setItem(key, JSON.stringify(Array.from(new Set(cur.concat(steps))))); // union — never lose local progress
          } catch (e3) {}
        }
        if (row.lesson_id && typeof setLessonStatus === "function") {
          if (row.status === "completed") setLessonStatus(teamKey, row.lesson_id, "completed");
          else if (row.status === "in-progress" && !(typeof isLessonCompleted === "function" && isLessonCompleted(teamKey, row.lesson_id))) setLessonStatus(teamKey, row.lesson_id, "in-progress");
        }
      });
    }).catch(function () {}));
  }
  if (typeof loadSubmissions === "function") jobs.push(loadSubmissions().catch(function () {})); // assignment restore (refresh cache)
  if (typeof fetchKcResponsesFor === "function") jobs.push(fetchKcResponsesFor(empId).then(cacheKcResponses).catch(function () {}));
  return Promise.all(jobs).catch(function () {});
}

/* Small CSS.escape fallback for querySelector by id. */
function lpCssEsc(v) { return String(v == null ? "" : v).replace(/["\\\]]/g, "\\$&"); }

/* "Continue Learning" — restore current position from employee_profiles. */
function showContinueBanner(teamKey) {
  var ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  if (!ident || !ident.employeeId || typeof fetchEmployeeProfile !== "function") return;
  fetchEmployeeProfile(ident.employeeId).then(function (p) {
    if (!p || !p.current_lesson_id) return;
    if (document.getElementById("lpContinue")) return;
    var head = document.querySelector(".page-head"); if (!head) return;
    var b = document.createElement("div");
    b.id = "lpContinue"; b.className = "lp-continue reveal";
    b.innerHTML = '<div class="lp-continue-text">مرحبًا بعودتك، <strong>' + escHtml(ident.employeeName) + '</strong>' +
      (p.current_lesson_title ? ' — <span class="lp-continue-where">' + escHtml(p.current_lesson_title) + '</span>' : '') + '</div>' +
      '<button type="button" class="btn btn-primary" id="lpContinueBtn">Continue Learning →</button>';
    head.parentNode.insertBefore(b, head.nextSibling);
    var btn = document.getElementById("lpContinueBtn");
    if (btn) btn.addEventListener("click", function () { openLessonAt(p.current_module_id, p.current_lesson_id); });
  }).catch(function () {});
}

/* Open a specific module + lesson and its first available step (resume). */
function openLessonAt(moduleId, lessonId) {
  var container = document.getElementById("learningPath"); if (!container) return;
  var card = moduleId ? container.querySelector('.level-card[data-module-id="' + lpCssEsc(moduleId) + '"]') : null;
  if (card && !card.classList.contains("open")) { var h = card.querySelector("[data-acc-toggle], .level-head"); if (h) h.click(); }
  setTimeout(function () {
    var item = container.querySelector('.lesson-acc-item[data-lesson-id="' + lpCssEsc(lessonId) + '"]');
    if (!item) return;
    if (!item.classList.contains("open")) { var lh = item.querySelector("[data-lesson-toggle]"); if (lh) lh.click(); }
    item.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () {
      var host = item.querySelector(".lp-parts");
      var avail = host ? host.querySelector(".lp-part-item.is-available .lp-part-head") : null;
      if (avail) avail.click();
    }, 220);
  }, 160);
}

/* ---- Section presentation helpers (display only — no data/model changes) ---- */
var _lpSectionTmp = document.createElement("div");
/* Clean section name: the authored Part title, else the first heading / opening
   line of its content (like Coursera/LinkedIn Learning). Never "Part 1". */
function sectionDisplayTitle(part) {
  var t = (part && part.title ? String(part.title) : "").trim();
  if (t && !/^part\s*\d+$/i.test(t)) return t; // a real authored title
  var name = "";
  (part && part.blocks ? part.blocks : []).some(function (b) {
    if ((b.type === "richtext" || b.type === "summary") && b.data && b.data.html) {
      _lpSectionTmp.innerHTML = b.data.html;
      var h = _lpSectionTmp.querySelector("h1,h2,h3,h4,h5,strong,b");
      if (h && h.textContent.trim()) { name = h.textContent.trim(); return true; }
      var txt = (_lpSectionTmp.textContent || "").trim();
      if (txt) { name = txt.split(/[.!?\n]/)[0].trim().slice(0, 70); return true; }
    }
    return false;
  });
  return name || (t || "Section");
}
/* Estimated time for a section: ~200 wpm reading + ~1 min per media/check. */
function sectionTimeLabel(part) {
  var words = 0, media = 0;
  (part && part.blocks ? part.blocks : []).forEach(function (b) {
    var d = b.data || {};
    if (b.type === "richtext" || b.type === "summary") {
      _lpSectionTmp.innerHTML = d.html || "";
      var txt = (_lpSectionTmp.textContent || "").trim();
      words += txt ? txt.split(/\s+/).length : 0;
    } else if (b.type === "youtube" || b.type === "file" || b.type === "image") { media += 1; }
  });
  if (part && part.knowledgeCheck && (part.knowledgeCheck.type || part.knowledgeCheck.question)) media += 1;
  return Math.max(1, Math.ceil(words / 200) + media) + " min";
}

/* Ordered steps for a lesson's Parts: each Part → a CONTENT step, plus a
   separate KNOWLEDGE CHECK step when the Part has one. Display only. */
function lessonSteps(parts) {
  const steps = [];
  (parts || []).forEach((p, i) => {
    const title = sectionDisplayTitle(p);
    steps.push({ id: p.id + ":content", kind: "content", partId: p.id, partIndex: i, part: p, title: title });
    if (p.knowledgeCheck && (p.knowledgeCheck.type || p.knowledgeCheck.question)) {
      steps.push({ id: p.id + ":kc", kind: "kc", partId: p.id, partIndex: i, part: p, title: "Knowledge Check — " + title });
    }
  });
  return steps;
}

/* Build the step rows for every lesson (content step + separate KC step). */
function renderLessonParts(root) {
  root.querySelectorAll(".lp-parts[data-lesson-parts]").forEach(host => {
    if (host.getAttribute("data-parts-built")) return;
    host.setAttribute("data-parts-built", "1");
    const lessonId = host.getAttribute("data-lesson-parts");
    const lesson = (typeof loadLessons === "function" ? loadLessons() : []).find(l => l.id === lessonId);
    if (!lesson) return;
    const steps = lessonSteps((typeof lessonParts === "function") ? lessonParts(lesson) : []);
    const ctx = hostRevealContext(host);
    const done = loadCompletedSteps(ctx);
    // A lesson already marked complete shows every step as completed.
    if (typeof isLessonCompleted === "function" && isLessonCompleted(ctx.academyKey, lessonId)) {
      steps.forEach(s => done.add(s.id));
    }

    host.innerHTML = "";
    const prog = document.createElement("div");
    prog.className = "lp-parts-progress";
    host.appendChild(prog);

    steps.forEach(step => {
      const item = document.createElement("div");
      item.className = "lp-part-item lp-step-" + step.kind;
      item.setAttribute("data-step-id", step.id);
      item.setAttribute("data-step-kind", step.kind);
      item.setAttribute("data-part-id", step.partId);
      item.setAttribute("data-part-index", String(step.partIndex));
      const head = document.createElement("button");
      head.type = "button";
      head.className = "lp-part-head";
      head.setAttribute("data-step-toggle", "");
      head.setAttribute("aria-expanded", "false");
      const timeHtml = step.kind === "content"
        ? '<span class="lp-part-time">🕐 ' + escHtml(sectionTimeLabel(step.part)) + '</span>' : '';
      head.innerHTML =
        '<span class="lp-part-ico" aria-hidden="true"></span>' +
        '<span class="lp-part-main">' +
          '<span class="lp-part-title">' + escHtml(step.title) + '</span>' + timeHtml +
        '</span>' +
        '<span class="lp-part-status"></span>' +
        '<span class="lp-part-caret" aria-hidden="true">▶</span>';
      const body = document.createElement("div");
      body.className = "lp-part-body cm-rendered"; // cm-rendered → inherit rich-text styling
      body.hidden = true;
      if (step.kind === "content") fillContentStep(body, step.part);
      else fillKcStep(body, step.part);
      item.appendChild(head);
      item.appendChild(body);
      host.appendChild(item);
    });
    applyStepsGating(host, done);
  });
}

/* Content step body: the section's blocks, then "Finish This Part". The
   Knowledge Check is NOT shown here — it is its own step after this one. */
function fillContentStep(bodyEl, part) {
  (part.blocks || []).forEach(b => {
    const w = document.createElement("div");
    w.className = "lesson-block";
    if (b.id) w.setAttribute("data-block-id", b.id);
    w.innerHTML = blockToHtml(b);
    bodyEl.appendChild(w);
  });
  const wrap = document.createElement("div");
  wrap.className = "lp-part-actions";
  wrap.innerHTML = '<button type="button" class="btn btn-primary lp-finish-part">Finish This Part →</button>';
  bodyEl.appendChild(wrap);
}
/* Knowledge Check step body: the interactive KC widget for this Part. */
function fillKcStep(bodyEl, part) {
  const kcEl = document.createElement("div");
  kcEl.className = "kc-block lp-part-kc";
  kcEl.setAttribute("data-kc", JSON.stringify(part.knowledgeCheck || {}));
  bodyEl.appendChild(kcEl);
  enhanceKnowledgeCheck(kcEl);
}

/* A Part is completed only when its LAST step is done. Returns done/total Parts. */
function lessonPartsProgress(host, done) {
  const items = Array.from(host.querySelectorAll(".lp-part-item"));
  const order = [], groups = {};
  items.forEach(it => {
    const pid = it.getAttribute("data-part-id");
    if (!groups[pid]) { groups[pid] = []; order.push(pid); }
    groups[pid].push(it);
  });
  let doneCount = 0;
  order.forEach(pid => {
    const arr = groups[pid];
    if (done.has(arr[arr.length - 1].getAttribute("data-step-id"))) doneCount++;
  });
  return { done: doneCount, total: order.length };
}

/* Recompute lock/available/completed per STEP + icons + progress + after-Parts. */
function applyStepsGating(host, done) {
  const items = Array.from(host.querySelectorAll(".lp-part-item"));
  items.forEach((item, idx) => {
    const sid = item.getAttribute("data-step-id");
    const isDone = done.has(sid);
    const prevDone = idx === 0 || done.has(items[idx - 1].getAttribute("data-step-id"));
    const locked = !isDone && !prevDone;
    item.classList.toggle("is-completed", isDone);
    item.classList.toggle("is-locked", locked);
    item.classList.toggle("is-available", !isDone && !locked);
    const head = item.querySelector(".lp-part-head");
    if (head) { head.disabled = locked; head.setAttribute("aria-disabled", locked ? "true" : "false"); }
    const ico = item.querySelector(".lp-part-ico");
    if (ico) ico.textContent = isDone ? "✓" : (locked ? "🔒" : "○");
    const st = item.querySelector(".lp-part-status");
    if (st) st.textContent = isDone ? "Completed" : (locked ? "Locked" : (item.classList.contains("is-open") ? "In Progress" : "Not Started"));
  });
  updateStepsProgressAndAfter(host, done);
}

/* "Parts completed X / Y" (by Part, not step) + reveal after-Parts once every
   step is done + enable the complete button. */
function updateStepsProgressAndAfter(host, done) {
  const p = lessonPartsProgress(host, done);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const prog = host.querySelector(".lp-parts-progress");
  if (prog) {
    prog.innerHTML =
      '<span class="lp-parts-label">Parts completed: ' + p.done + ' / ' + p.total + '</span>' +
      '<div class="lp-parts-bar"><span style="width:' + pct + '%"></span></div>';
  }
  // The section / Knowledge Check steps drive the parts bar above; once every
  // one is done the Assignment step unlocks. ALL final-step gating lives in
  // applyFinalGating so the section flow itself is never altered.
  const bodyRoot = host.closest(".lesson-acc-body");
  if (bodyRoot) applyFinalGating(bodyRoot);
}

/* Open a step (collapse the others — one open at a time). Locked steps do
   nothing. Opening marks the lesson In Progress but never completes a step. */
function toggleStep(head, teamKey) {
  const item = head.closest(".lp-part-item");
  if (!item || item.classList.contains("is-locked")) return;
  const host = head.closest(".lp-parts");
  const willOpen = !item.classList.contains("is-open");
  host.querySelectorAll(".lp-part-item.is-open").forEach(it => {
    it.classList.remove("is-open");
    const b = it.querySelector(".lp-part-body"); if (b) b.hidden = true;
    const h = it.querySelector(".lp-part-head"); if (h) h.setAttribute("aria-expanded", "false");
  });
  if (willOpen) {
    item.classList.add("is-open");
    const b = item.querySelector(".lp-part-body"); if (b) b.hidden = false;
    head.setAttribute("aria-expanded", "true");
    const lessonItem = item.closest(".lesson-acc-item");
    const lessonId = lessonItem ? lessonItem.getAttribute("data-lesson-id") : "";
    if (lessonId && typeof isLessonCompleted === "function" && !isLessonCompleted(teamKey, lessonId)) {
      setLessonStatus(teamKey, lessonId, "in-progress");
      lessonItem.classList.add("is-inprogress");
    }
  }
  applyStepsGating(host, loadCompletedSteps(hostRevealContext(host)));
  if (willOpen) item.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* Complete the current step (Finish This Part, or KC Continue), unlock + open
   the next step — or reveal the Assignment / Activities after the last step. */
function advanceFromStep(el) {
  const stepItem = el.closest(".lp-part-item");
  if (!stepItem) return;
  const host = stepItem.closest(".lp-parts");
  const ctx = hostRevealContext(host);
  const done = saveCompletedStep(ctx, stepItem.getAttribute("data-step-id"));
  applyStepsGating(host, done);

  stepItem.classList.remove("is-open");
  const b = stepItem.querySelector(".lp-part-body"); if (b) b.hidden = true;
  const h = stepItem.querySelector(".lp-part-head"); if (h) h.setAttribute("aria-expanded", "false");

  let next = stepItem.nextElementSibling;
  while (next && !next.classList.contains("lp-part-item")) next = next.nextElementSibling;
  if (next && !next.classList.contains("is-locked")) {
    next.classList.add("is-open");
    const nb = next.querySelector(".lp-part-body"); if (nb) nb.hidden = false;
    const nh = next.querySelector(".lp-part-head"); if (nh) nh.setAttribute("aria-expanded", "true");
    applyStepsGating(host, loadCompletedSteps(ctx));
    next.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    updateStepsProgressAndAfter(host, loadCompletedSteps(ctx));
    // Last section / Knowledge Check done → open the newly-unlocked Assignment step.
    const bodyRoot = host.closest(".lesson-acc-body");
    if (bodyRoot) openFirstAvailableFinal(bodyRoot);
  }
}

/* Render every block-based lesson from lesson.blocks — the ONLY authoritative
   source once blocks is non-empty (contentBody is ignored for these lessons).
   The blocks are split into gated segments and the DOM is built once by
   buildSegmentedLesson (see academies.js): content blocks in isolated wrappers,
   each Knowledge Check gating the segment after it. Segments already passed (per
   the saved revealed-state in localStorage) are shown; the rest stay hidden.
   There is NO post-render DOM moving and NO DOM scanning to hide — visibility is
   decided entirely at build time from the ordered blocks + revealed set. */
function renderBlockLessons(root) {
  root.querySelectorAll(".cm-rendered[data-lesson-blocks]").forEach(host => {
    if (host.getAttribute("data-blocks-built")) return;
    host.setAttribute("data-blocks-built", "1");
    const lessonId = host.getAttribute("data-lesson-blocks");
    const lesson = (typeof loadLessons === "function" ? loadLessons() : []).find(l => l.id === lessonId);
    if (!lesson || !hasRealBlocks(lesson)) { console.warn("[blocks] no blocks for lesson", lessonId); return; }
    const ctx = hostRevealContext(host);
    const revealed = loadRevealedSet(ctx);
    const kcEls = buildSegmentedLesson(host, lesson.blocks, revealed);
    kcEls.forEach(enhanceKnowledgeCheck); // make each Knowledge Check interactive
    console.debug("[blocks] render lesson", lessonId, "→ segments:", lessonSegments(lesson.blocks).length);
  });
}

/* Make every LEGACY (contentBody) Knowledge Check interactive and gate the
   content after it. Block-based lessons are fully handled by renderBlockLessons
   and are skipped here — they never go through liftKcBlocks / gateLessonContent. */
function processKnowledgeChecks(root) {
  root.querySelectorAll(".lesson-acc-body > .cm-rendered").forEach(rendered => {
    if (rendered.getAttribute("data-blocks")) return; // block lesson → already rendered
    rendered.querySelectorAll(".kc-block[data-kc]").forEach(enhanceKnowledgeCheck);
    liftKcBlocks(rendered);   // legacy pasted content nests blocks — lift KCs to top level
    gateLessonContent(rendered);
  });
}

/* ---- Revealed-segment persistence (temporary, localStorage) ----
   Which Knowledge Checks an employee has already passed is keyed by
   academyKey · moduleId · lessonId · employee identity, so revealed content
   survives a refresh and is scoped to the individual employee. */
function hostRevealContext(hostOrBlock) {
  const item = hostOrBlock.closest ? hostOrBlock.closest(".lesson-acc-item") : null;
  const lessonId = item ? (item.getAttribute("data-lesson-id") || "") : "";
  const lesson = (typeof loadLessons === "function" ? loadLessons() : []).find(l => l.id === lessonId) || {};
  const teamKey = (typeof getSelectedAcademy === "function") ? getSelectedAcademy() : "";
  const ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  return {
    academyKey: lesson.academyKey || teamKey || "",
    moduleId: lesson.moduleId || "",
    lessonId: lessonId,
    employee: ident ? (ident.employeeId || ident.employeeName || "anon") : "anon"
  };
}
function revealStorageKey(ctx) {
  return `lp:revealed:${ctx.academyKey}:${ctx.moduleId}:${ctx.lessonId}:${ctx.employee}`;
}
function loadRevealedSet(ctx) {
  try {
    const raw = localStorage.getItem(revealStorageKey(ctx));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (e) { return new Set(); }
}
/* Keep a failed Knowledge Check submission locally so it is never lost when the
   backend save fails (e.g. a stale table schema). Best-effort; capped. */
function stashPendingKcResponse(resp) {
  try {
    const raw = localStorage.getItem("sdta_kc_pending");
    const arr = raw ? JSON.parse(raw) : [];
    arr.push(resp);
    localStorage.setItem("sdta_kc_pending", JSON.stringify(arr.slice(-100)));
  } catch (e) { /* storage full / unavailable — non-fatal */ }
}
function persistRevealed(block) {
  let kc; try { kc = JSON.parse(block.getAttribute("data-kc")); } catch (e) { return; }
  const ctx = hostRevealContext(block);
  const set = loadRevealedSet(ctx);
  set.add(kc.id || "");
  try { localStorage.setItem(revealStorageKey(ctx), JSON.stringify(Array.from(set))); } catch (e) {}
}
function enhanceKnowledgeCheck(block) {
  if (block.getAttribute("data-kc-ready")) return;
  let kc;
  try { kc = JSON.parse(block.getAttribute("data-kc")); } catch (e) { return; }
  block.setAttribute("data-kc-ready", "1");
  // RESTORE: if this employee already submitted this Knowledge Check, show it
  // completed + read-only (unless the manager asked for a revision) — never
  // re-ask. The response row is keyed by employee_id + knowledge_check_id, so no
  // duplicate row is created on reload.
  var saved = (typeof kcRestoreFor === "function") ? kcRestoreFor(kc.id) : null;
  if (saved && !kcNeedsResubmit(saved)) {
    block.classList.add("is-answered", "is-submitted");
    if (saved.is_correct === true) block.classList.add("is-correct");
    else if (saved.is_correct === false) block.classList.add("is-incorrect");
    block.innerHTML = kcCompletedHtml(kc, saved);
    // If the step itself isn't marked done yet, still let them proceed.
    var stepItem = block.closest(".lp-part-item");
    var host = block.closest(".lp-parts");
    if (stepItem && host) {
      var done = loadCompletedSteps(hostRevealContext(host));
      if (!done.has(stepItem.getAttribute("data-step-id"))) { var c = block.querySelector(".kc-continue"); if (c) c.hidden = false; }
    }
    return;
  }
  block.innerHTML = kcWidgetHtml(kc);
}

/* Read-only "Knowledge Check Completed" card for a restored submission. */
function kcCompletedHtml(kc, r) {
  var reviewed = /reviewed/i.test(String(r.review_status || "")) && !/needs revision/i.test(String(r.review_status || ""));
  var result = (r.is_correct === true) ? '<span class="kc-restore-ok">✔ Correct</span>'
    : (r.is_correct === false) ? '<span class="kc-restore-bad">✗ Incorrect</span>'
    : '<span class="kc-restore-pending">' + escHtml(r.review_status || "Submitted") + '</span>';
  var ans = r.text_answer ? escHtml(r.text_answer)
    : (r.file_name ? ('📄 ' + escHtml(r.file_name))
    : (r.document_url ? ('<a href="' + escHtml(r.document_url) + '" target="_blank" rel="noopener">Open document ↗</a>')
    : (r.file_url ? ('<a href="' + escHtml(r.file_url) + '" target="_blank" rel="noopener">Open file ↗</a>')
    : (r.is_correct != null ? 'Answered' : '—'))));
  var rows =
    '<div class="kc-restore-row"><span>Your answer</span><span>' + ans + '</span></div>' +
    '<div class="kc-restore-row"><span>Result</span><span>' + result + '</span></div>' +
    '<div class="kc-restore-row"><span>Submitted</span><span>' + escHtml(fmtSubmissionDate(r.submitted_at)) + '</span></div>' +
    (reviewed && r.score ? '<div class="kc-restore-row"><span>Score</span><span>' + escHtml(r.score) + '</span></div>' : '') +
    (reviewed && r.feedback ? '<div class="kc-restore-row"><span>Feedback</span><span>' + escHtml(r.feedback) + '</span></div>' : '');
  return '<div class="kc-head"><span class="kc-badge kc-badge-done">✅ Knowledge Check Completed</span></div>' +
    '<div class="kc-q kc-q-rich">' + (kc.question || "") + '</div>' +
    '<div class="kc-restore">' + rows + '</div>' +
    '<div class="kc-actions"><button type="button" class="btn kc-continue" hidden>Continue →</button></div>';
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
/* Reveal the Continue button once a KC is answered — but only when there is a
   next segment (block lessons) or gated content (legacy) to reveal. */
function revealContinue(block) {
  const cont = block.querySelector(".kc-continue");
  if (!cont) return;
  const stepItem = block.closest(".lp-part-item");
  if (stepItem) { // KC step answered → just offer Continue (completion happens on Continue).
    let next = stepItem.nextElementSibling;
    while (next && !next.classList.contains("lp-part-item")) next = next.nextElementSibling;
    cont.textContent = next ? "Continue →" : "Finish — show Assignment →";
    cont.hidden = false;
    return;
  }
  const seg = block.closest(".kc-segment");
  if (seg) { // block-based lesson: is there a following segment to reveal?
    const next = seg.nextElementSibling;
    if (next && next.classList.contains("kc-segment")) cont.hidden = false;
    return;
  }
  const gate = block.nextElementSibling; // legacy contentBody gate
  if (gate && gate.classList.contains("kc-gate") && gate.children.length) cont.hidden = false;
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

  // Persist the objective answer (best-effort) for admin analytics.
  const chosen = kc.type === "mcq"
    ? ((kc.choices || [])[Number(sel.value)] || String(sel.value))
    : (String(sel.value) === "true" ? "True" : "False");
  const answer = kc.type === "mcq"
    ? ((kc.choices || [])[Number(kc.correct)] || String(kc.correct))
    : (String(kc.correct) === "true" ? "True" : "False");
  saveObjectiveKcResponse(block, kc, chosen, answer, correct);
}
/* Save an MCQ / True-False answer to Supabase (fire-and-forget). */
function saveObjectiveKcResponse(block, kc, chosen, correctAnswer, isCorrect) {
  if (!(typeof SB !== "undefined" && SB.enabled && SB.enabled() && SB.insertKcResponse)) return;
  const ctx = kcResponseContext(block);
  const ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  SB.insertKcResponse({
    employeeId: ident ? ident.employeeId : "", employeeName: ident ? ident.employeeName : "",
    team: ident ? ident.team : "", academyKey: ctx.academyKey, moduleId: ctx.moduleId, lessonId: ctx.lessonId,
    knowledgeCheckId: kc.id || "", question: kc.question || "", responseType: kc.type,
    textAnswer: chosen, correctAnswer: correctAnswer, isCorrect: isCorrect,
    reviewStatus: "Auto Graded", submittedAt: new Date().toISOString()
  }).catch(function () {});
  if (typeof Track !== "undefined") Track.kcSubmitted({ academyKey: ctx.academyKey, moduleId: ctx.moduleId, lessonId: ctx.lessonId });
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

  // Persist the response (best-effort). A VALID answer must always unlock the
  // next segment: a backend write failure must never trap the lesson content
  // behind this Knowledge Check. The file (if any) is already uploaded above; a
  // failed row save is stashed locally for retry instead of blocking the reader.
  let saved = false;
  try {
    if (typeof SB !== "undefined" && SB.enabled && SB.enabled() && SB.insertKcResponse) {
      await SB.insertKcResponse(resp); saved = true;
    }
  } catch (e) { saved = false; }
  if (!saved) stashPendingKcResponse(resp);

  // Submitted — lock inputs, show status, reveal Continue (unblock either way).
  block.classList.add("is-answered", "is-submitted");
  [textEl, urlEl, fileEl].forEach(el => { if (el) el.disabled = true; });
  btn.hidden = true;
  fb.textContent = saved ? "✓ Response submitted for review." : "✓ تم استلام إجابتك — الحفظ هيتم لاحقًا.";
  fb.className = "kc-feedback kc-correct";
  const explain = block.querySelector(".kc-explain"); if (explain) explain.hidden = false;
  revealContinue(block);
  if (typeof Track !== "undefined") Track.kcSubmitted({ academyKey: ctx.academyKey, moduleId: ctx.moduleId, lessonId: ctx.lessonId });
}
/* Reveal the content gated behind a KC when the employee clicks Continue.
   Block lessons reveal the next pre-built segment (a single hidden→shown toggle,
   no node moving) and persist that the KC was passed; legacy lessons reveal the
   inline .kc-gate that follows the KC. */
function revealNextGate(cont) {
  const block = cont.closest(".kc-block");
  if (!block) return;
  cont.hidden = true;
  const seg = block.closest(".kc-segment");
  if (seg) { // block-based lesson: reveal the next segment
    const next = seg.nextElementSibling;
    if (next && next.classList.contains("kc-segment")) {
      next.hidden = false;
      next.style.display = "";
      next.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    persistRevealed(block);
    return;
  }
  const gate = block.nextElementSibling; // legacy contentBody gate
  if (gate && gate.classList.contains("kc-gate")) {
    gate.hidden = false;
    gate.style.display = "";
    gate.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/* Collect the submission form + lesson context and save it to Supabase. Validates
   against the assignment's Submission Type (at least one allowed method), uploads
   any file to Supabase Storage, and persists the submission row. */
async function handleAssignmentSubmit(form, teamKey) {
  const msg = form.querySelector(".lp-submit-msg");
  const val = name => { const f = form.querySelector('[name="' + name + '"]'); return f ? (f.value || "").trim() : ""; };
  const ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  const employeeName = (ident && ident.employeeName) || val("employeeName");

  const lessonId = form.getAttribute("data-lesson-id");
  const lesson = loadLessons().find(l => l.id === lessonId) || {};
  const asg = lesson.assignment || {};
  const m = submissionMethods(asg.submissionType);
  const err = t => { msg.style.color = "#dc2626"; msg.textContent = t; };

  if (!employeeName) { err("اكتب اسمك الأول · Enter your name."); return; }

  const submissionLink = m.link ? val("submissionLink") : "";
  const textAnswer = m.text ? val("textAnswer") : "";
  const fileInput = m.file ? form.querySelector('input[name="file"]') : null;
  const file = (fileInput && fileInput.files && fileInput.files[0]) || null;

  // Validate: at least one allowed method provided (combined types accept EITHER).
  if (m.link && submissionLink && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(submissionLink)) {
    err("أضف رابط صحيح يبدأ بـ http/https · Enter a valid http(s) document URL."); return;
  }
  if (file) {
    const ext = ((file.name || "").split(".").pop() || "").toLowerCase();
    if (ASG_FILE_EXT.indexOf(ext) < 0) { err("Allowed files: PDF, DOCX, PPTX, XLSX."); return; }
    if (file.size > ASG_FILE_MAX) { err("File too large — max 10 MB."); return; }
  }
  const provided = (m.text && textAnswer) || (m.link && submissionLink) || (m.file && file);
  if (!provided) {
    const need = [m.text ? "Text Answer" : "", m.link ? "Document Link" : "", m.file ? "File Upload" : ""].filter(Boolean).join(" or ");
    err("Add your submission — " + need + "."); return;
  }

  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  msg.style.color = "#6b7280";
  msg.textContent = file ? "Uploading…" : "Submitting…";

  // File Upload → Supabase Storage (multipart, never base64). Store file metadata.
  let fileMeta = null;
  if (file) {
    try {
      if (!(typeof SB !== "undefined" && SB.uploadFile)) throw new Error("upload unavailable");
      const url = await SB.uploadFile(file);
      fileMeta = { file_url: url, file_name: file.name, file_type: file.type || "", file_size: file.size };
    } catch (e) {
      if (btn) btn.disabled = false;
      err("File upload failed — check your connection and try again."); return;
    }
    msg.textContent = "Submitting…";
  }

  const mod = loadContent().find(x => x.id === lesson.moduleId) || {};
  // Resubmission updates the existing row (no version history built this sprint).
  const existing = currentSubmission(lessonId);
  const sub = (typeof Identity !== "undefined" ? Identity.stamp({}) : {});
  // DETERMINISTIC id per employee+lesson → a refresh or a different device upserts
  // the SAME row (no duplicate assignment submissions), even when the local cache
  // is empty. Falls back to a random id only if identity is missing.
  const detId = (ident && ident.employeeId && lessonId)
    ? ("sub_" + String(ident.employeeId).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40) + "__" + String(lessonId).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40))
    : "";
  sub.id = (existing && existing.id) || detId ||
    ((typeof SB !== "undefined" && SB.subId) ? SB.subId() : ("s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)));
  sub.academyKey = teamKey;
  sub.moduleId = lesson.moduleId || "";
  sub.moduleTitle = mod.moduleTitle || "";
  sub.lessonId = lessonId;
  sub.lessonTitle = lesson.lessonTitle || "";
  sub.assignmentTitle = asg.title || "";
  sub.employeeName = employeeName;
  sub.submissionLink = submissionLink;
  sub.textAnswer = textAnswer;
  sub.submissionType = asg.submissionType || "";
  sub.notes = "";
  sub.status = "Pending Review";
  if (fileMeta) { sub.file_url = fileMeta.file_url; sub.file_name = fileMeta.file_name; sub.file_type = fileMeta.file_type; sub.file_size = fileMeta.file_size; }

  await pushSubmission(sub);
  // Optimistically cached even when offline — reflect "Submitted" immediately
  // (it will sync when the connection returns) and unlock Final Activities.
  onAssignmentSubmitted(form, sub);
  if (typeof Track !== "undefined") Track.assignmentSubmitted({ academyKey: teamKey, moduleId: sub.moduleId, lessonId: sub.lessonId });
}

/* Record a lesson as completed and update its accordion item + progress meters. */
function markLessonCompleted(lessonId, teamKey, btn) {
  setLessonStatus(teamKey, lessonId, "completed");

  // Analytics: lesson completed (best-effort).
  if (typeof Track !== "undefined") {
    const lsn = loadLessons().find(l => l.id === lessonId) || {};
    Track.lessonCompleted({ academyKey: teamKey, moduleId: lsn.moduleId || "", lessonId: lessonId });
  }
  // Persist "completed" to Supabase (authoritative) so it restores across devices.
  const ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  if (ident && ident.employeeId) {
    const lsn2 = loadLessons().find(l => l.id === lessonId) || {};
    const ctx = { employee: ident.employeeId, academyKey: lsn2.academyKey || teamKey, moduleId: lsn2.moduleId || "", lessonId: lessonId };
    persistProgress(ctx, loadCompletedSteps(ctx), { completed: true });
  }

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

  // Every lesson renders as ordered Parts (authored lesson.parts, or derived
  // from lesson.blocks / contentBody for legacy lessons). Each Part gates the
  // next until its Knowledge Check is submitted.
  renderLessonParts(container);
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

/* ============================================================
   FINAL LESSON STEPS — Assignment → Final Activities → Lesson Completed
   ------------------------------------------------------------
   Each is its OWN gated card in the lesson navigation, revealed IN ORDER after
   the last Knowledge Check:
     • Assignment unlocks once every section + KC step is done.
     • Final Activities unlock only after a successful Assignment submission.
     • Lesson Completed unlocks only after the Activities are finished.
   This never touches the section/KC steps in .lp-parts, their gating, or the
   Continue logic — those are untouched. Cards use the .lp-final-step class (NOT
   .lp-part-item) so neither the parts gating nor the tracking observer treat
   them as sections. Existing lessons need no rebuilding: a card is emitted only
   when the lesson actually has that piece.
   ============================================================ */

/* The employee's latest submission for a lesson, read from the local
   submissions cache (which mirrors Supabase) so the "Submitted" state resumes. */
function currentSubmission(lessonId) {
  var ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  var empId = ident ? (ident.employeeId || ident.employeeName || "") : "";
  var name = ident ? (ident.employeeName || "") : "";
  var list = (typeof loadSubmissionsCache === "function" ? loadSubmissionsCache() : [])
    .filter(function (s) {
      return s && s.lessonId === lessonId &&
        (!empId || s.employeeId === empId || (name && s.employeeName === name));
    });
  list.sort(function (a, b) { return new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0); });
  return list[0] || null;
}

function fmtSubmissionDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return "—"; }
}
/* Allowed submission methods for an authored Submission Type (legacy values
   "File Link"/"Both" map onto the current set). Combined types allow EITHER —
   at least one is enough. */
function submissionMethods(type) {
  switch (String(type || "")) {
    case "Text Answer": return { text: true };
    case "Document Link": case "File Link": return { link: true };
    case "File Upload": return { file: true };
    case "Text Answer OR Document Link": case "Both": return { text: true, link: true };
    case "Document Link OR File Upload": return { link: true, file: true };
    case "Any Submission Method": return { text: true, link: true, file: true };
    default: return { text: true, link: true };   // safe default for unknown/blank
  }
}
var ASG_FILE_EXT = ["pdf", "docx", "pptx", "xlsx"];
var ASG_FILE_MAX = 10 * 1024 * 1024; // 10 MB

function submissionTypeLabel(sub, asg) {
  if (sub) {
    if (sub.file_url || sub.fileUrl) return "File Upload";
    if (sub.submissionLink) return "Document Link";
    if (sub.textAnswer) return "Text Answer";
    if (sub.submissionType) return sub.submissionType;
  }
  var t = asg && asg.submissionType;
  if (t === "File Link") return "Document Link";
  return t || "—";
}

/* The Assignment "page" — ONLY the assignment's own fields (never lesson
   content). Renders whatever the Content Manager authored. */
function assignmentPageMarkup(asg) {
  if (!asg) return "";
  var field = function (label, html) {
    return html ? '<div class="lp-asg-field"><h6>' + escHtml(label) + '</h6><div class="cm-rendered">' + html + '</div></div>' : "";
  };
  var chips = [
    asg.estTime ? '<span class="meta-chip">⏱ ' + escHtml(asg.estTime) + '</span>' : "",
    asg.submissionType ? '<span class="meta-chip">📤 ' + escHtml(asg.submissionType) + '</span>' : "",
    asg.minScore ? '<span class="meta-chip">✅ Min score ' + escHtml(asg.minScore) + '</span>' : ""
  ].filter(Boolean).join("");
  return '' +
    '<div class="lp-asg-page">' +
      '<h4 class="lp-asg-title">' + (asg.title ? escHtml(asg.title) : "Lesson Assignment") + '</h4>' +
      (asg.objective ? field("Objective", renderRichText(asg.objective)) : "") +
      (asg.instructions ? field("Instructions", renderRichText(asg.instructions)) : "") +
      (asg.deliverables ? field("Submission Requirements", renderRichText(asg.deliverables)) : "") +
      (chips ? '<div class="lp-asg-meta">' + chips + '</div>' : "") +
    '</div>';
}

/* Read-only "Assignment Submitted" status card shown after submission. Shows the
   submitted response (text / link / file), the review state, and — when allowed
   or when the manager asked for changes — a Resubmit button. The response stays
   visible in every state. */
function submissionStatusCard(sub, asg) {
  var row = function (k, v) { return '<div><div class="k">' + escHtml(k) + '</div><div class="v">' + v + '</div></div>'; };
  var date = fmtSubmissionDate(sub && (sub.createdAt || sub.timestamp || sub.created_at));
  var type = submissionTypeLabel(sub, asg);
  var status = (sub && sub.status) || "Pending Review";
  var needsRevision = /needs revision/i.test(status);
  var reviewed = /reviewed/i.test(status) && !needsRevision;

  // What the employee actually submitted (any/all present, per submission type).
  var text = sub && sub.textAnswer;
  var link = sub && sub.submissionLink;
  var fileUrl = sub && (sub.file_url || sub.fileUrl);
  var fileName = sub && (sub.file_name || sub.fileName);
  var content = "";
  if (text) content += row("Submitted Text", '<span class="lp-status-text">' + escHtml(text) + '</span>');
  if (link) content += row("Document Link", '<a href="' + escHtml(link) + '" target="_blank" rel="noopener">Open Document ↗</a>');
  if (fileUrl) content += row("File", '<a href="' + escHtml(fileUrl) + '" target="_blank" rel="noopener">Download / Open ' + (fileName ? escHtml(fileName) : "file") + ' ↗</a>');

  // Review-dependent rows.
  var reviewText = needsRevision ? "Needs Revision" : (reviewed ? "Reviewed" : "Pending Review");
  var reviewSlug = needsRevision ? "revision" : (reviewed ? "done" : "pending");
  var reviewRows = "";
  if (reviewed) {
    reviewRows =
      (sub.score ? row("Score", escHtml(String(sub.score))) : "") +
      (sub.feedback ? row("Feedback", escHtml(sub.feedback)) : "") +
      ((sub.reviewedBy || sub.reviewed_by) ? row("Reviewed By", escHtml(sub.reviewedBy || sub.reviewed_by)) : "") +
      ((sub.reviewedAt || sub.reviewed_at) ? row("Reviewed At", escHtml(fmtSubmissionDate(sub.reviewedAt || sub.reviewed_at))) : "");
  } else if (needsRevision && sub.feedback) {
    reviewRows = row("Manager Feedback", escHtml(sub.feedback));
  }

  // Resubmit when the assignment allows it, or when the manager asked for changes.
  var allowResubmit = (asg && (asg.allowResubmit === true || asg.allowResubmit === "true" || asg.allowResubmit === "Yes")) || needsRevision;
  return '' +
    '<div class="lp-status-card">' +
      '<h5>✅ Assignment Submitted</h5>' +
      '<div class="lp-status-grid">' +
        row("Assignment", escHtml((asg && asg.title) || (sub && sub.assignmentTitle) || "Lesson Assignment")) +
        row("Submitted At", escHtml(date)) +
        row("Submission Type", escHtml(type)) +
        content +
        row("Review Status", '<span class="lp-review lp-review-' + reviewSlug + '">' + escHtml(reviewText) + '</span>') +
        reviewRows +
      '</div>' +
      (allowResubmit ? '<div class="lp-status-actions"><button type="button" class="btn btn-light lp-resubmit">Resubmit Assignment</button></div>' : "") +
    '</div>';
}

/* A single final-step card (starts locked; applyFinalGating sets its real state). */
function finalStepCard(kind, title, bodyHtml) {
  return '' +
    '<div class="lp-final-step lp-final-' + kind + ' is-locked" data-final="' + kind + '">' +
      '<button type="button" class="lp-part-head" data-final-toggle aria-expanded="false" aria-disabled="true" disabled>' +
        '<span class="lp-part-ico" aria-hidden="true">🔒</span>' +
        '<span class="lp-part-main"><span class="lp-part-title">' + escHtml(title) + '</span></span>' +
        '<span class="lp-part-status">Locked</span>' +
        '<span class="lp-part-caret" aria-hidden="true">▶</span>' +
      '</button>' +
      '<div class="lp-part-body" hidden>' + bodyHtml + '</div>' +
    '</div>';
}

/* Build the Assignment → Activities → Completed cards for a lesson. */
function finalStepsMarkup(l, academyKey, completed) {
  var asg = (l && l.assignment && l.assignment.status === "Published") ? l.assignment : null;
  var acts = (typeof publishedActivities === "function") ? publishedActivities(l) : [];
  var html = "";

  if (asg) {
    var sub = currentSubmission(l.id);
    var region = (sub || completed) ? submissionStatusCard(sub, asg) : submissionForm(l);
    var body = assignmentPageMarkup(asg) + '<div class="lp-asg-submit-region" data-asg-region>' + region + '</div>';
    html += finalStepCard("assignment", "📝 " + (asg.title || "Lesson Assignment"), body);
  }
  if (acts.length) {
    var rows = acts.map(function (a, i) { return activityHtml(a, i, academyKey); }).join("");
    var abody = '<div class="lp-activities-body">' + rows + '</div>' +
      '<div class="lp-act-actions"><button type="button" class="btn btn-primary lp-act-finish">Finish Activities →</button></div>';
    html += finalStepCard("activities", "Final Activities", abody);
  }
  html += finalStepCard("complete", "Lesson Completed",
    '<div class="lesson-complete">' +
      '<button type="button" class="btn ' + (completed ? "is-done" : "btn-primary") + ' lesson-complete-btn" data-complete="' + escHtml(l.id) + '" disabled>' +
        (completed ? "✓ Lesson Completed" : "Mark Lesson as Completed") +
      '</button>' +
    '</div>');
  return html;
}

/* Lesson context for the final steps (reuses the parts host context helper). */
function finalCtxOf(bodyRoot) {
  var host = bodyRoot.querySelector(".lp-parts");
  return hostRevealContext(host || bodyRoot);
}

/* Recompute lock / available / completed for the three final cards. */
function applyFinalGating(bodyRoot) {
  var wrap = bodyRoot.querySelector(".lp-final-steps");
  if (!wrap) return;
  var ctx = finalCtxOf(bodyRoot);
  var lesson = (typeof loadLessons === "function" ? loadLessons() : []).find(function (l) { return l.id === ctx.lessonId; }) || {};
  var completedLesson = (typeof isLessonCompleted === "function") && isLessonCompleted(ctx.academyKey, ctx.lessonId);

  var host = bodyRoot.querySelector(".lp-parts");
  var partItems = host ? Array.prototype.slice.call(host.querySelectorAll(".lp-part-item")) : [];
  var partsDone = partItems.length === 0 ? true : partItems.every(function (it) { return it.classList.contains("is-completed"); });

  var asgExists = !!(lesson.assignment && lesson.assignment.status === "Published");
  var actsExist = ((typeof publishedActivities === "function") ? publishedActivities(lesson) : []).length > 0;
  var submitted = completedLesson || !!currentSubmission(ctx.lessonId);
  var actsDone = completedLesson || loadCompletedSteps(ctx).has("final:activities");
  var asgSatisfied = !asgExists || submitted;
  var actsSatisfied = !actsExist || actsDone;

  var setCard = function (kind, state, ico, status) {
    var card = wrap.querySelector('.lp-final-step[data-final="' + kind + '"]');
    if (!card) return;
    card.classList.toggle("is-completed", state === "completed");
    card.classList.toggle("is-locked", state === "locked");
    card.classList.toggle("is-available", state === "available");
    if (state === "locked") {
      card.classList.remove("is-open");
      var b = card.querySelector(".lp-part-body"); if (b) b.hidden = true;
    }
    var head = card.querySelector(".lp-part-head");
    if (head) { head.disabled = state === "locked"; head.setAttribute("aria-disabled", state === "locked" ? "true" : "false"); }
    var ic = card.querySelector(".lp-part-ico"); if (ic) ic.textContent = ico;
    var st = card.querySelector(".lp-part-status"); if (st) st.textContent = status;
  };

  if (asgExists) {
    if (submitted) setCard("assignment", "completed", "✓", "Submitted");
    else if (partsDone) setCard("assignment", "available", "📝", "Start");
    else setCard("assignment", "locked", "🔒", "Locked");
  }
  if (actsExist) {
    if (actsDone) setCard("activities", "completed", "✓", "Completed");
    else if (partsDone && asgSatisfied) setCard("activities", "available", "○", "Start");
    else setCard("activities", "locked", "🔒", "Locked");
  }
  var completeCard = wrap.querySelector('.lp-final-step[data-final="complete"]');
  if (completeCard) {
    var btn = completeCard.querySelector(".lesson-complete-btn");
    if (completedLesson) {
      setCard("complete", "completed", "✓", "Completed");
      if (btn) { btn.disabled = true; btn.classList.remove("btn-primary"); btn.classList.add("is-done"); btn.textContent = "✓ Lesson Completed"; }
    } else if (partsDone && asgSatisfied && actsSatisfied) {
      setCard("complete", "available", "○", "Ready");
      if (btn) btn.disabled = false;
    } else {
      setCard("complete", "locked", "🔒", "Locked");
      if (btn) btn.disabled = true;
    }
  }
}

/* Toggle a final card open/closed (one open at a time, within the final list). */
function toggleFinalStep(head) {
  var card = head.closest(".lp-final-step");
  if (!card || card.classList.contains("is-locked")) return;
  var wrap = card.closest(".lp-final-steps");
  var willOpen = !card.classList.contains("is-open");
  if (wrap) wrap.querySelectorAll(".lp-final-step.is-open").forEach(function (it) {
    it.classList.remove("is-open");
    var b = it.querySelector(".lp-part-body"); if (b) b.hidden = true;
    var h = it.querySelector(".lp-part-head"); if (h) h.setAttribute("aria-expanded", "false");
  });
  if (willOpen) {
    card.classList.add("is-open");
    var b = card.querySelector(".lp-part-body"); if (b) b.hidden = false;
    head.setAttribute("aria-expanded", "true");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/* Open the first available (unlocked, not-yet-completed) final card. */
function openFirstAvailableFinal(bodyRoot) {
  applyFinalGating(bodyRoot);
  var wrap = bodyRoot.querySelector(".lp-final-steps");
  if (!wrap) return;
  var card = wrap.querySelector(".lp-final-step.is-available");
  if (card) { var head = card.querySelector(".lp-part-head"); if (head) toggleFinalStep(head); }
}

/* Employee finished the Final Activities step → mark it done, unlock completion. */
function finishActivities(btn) {
  var bodyRoot = btn.closest(".lesson-acc-body");
  if (!bodyRoot) return;
  saveCompletedStep(finalCtxOf(bodyRoot), "final:activities");
  openFirstAvailableFinal(bodyRoot);
}

/* Assignment submitted → swap the form for the read-only status card and unlock
   the next step. */
function onAssignmentSubmitted(form, sub) {
  var bodyRoot = form.closest(".lesson-acc-body");
  var region = form.closest("[data-asg-region]");
  if (region) {
    var lessonId = bodyRoot ? finalCtxOf(bodyRoot).lessonId : form.getAttribute("data-lesson-id");
    var lesson = (typeof loadLessons === "function" ? loadLessons() : []).find(function (l) { return l.id === lessonId; }) || {};
    region.innerHTML = submissionStatusCard(sub, lesson.assignment || {});
  }
  if (bodyRoot) openFirstAvailableFinal(bodyRoot);
}

/* Employee chose to resubmit — restore the submission form. */
function resubmitAssignment(btn) {
  var region = btn.closest("[data-asg-region]");
  var item = btn.closest(".lesson-acc-item");
  var lessonId = item ? item.getAttribute("data-lesson-id") : "";
  var lesson = (typeof loadLessons === "function" ? loadLessons() : []).find(function (l) { return l.id === lessonId; }) || {};
  if (region) region.innerHTML = submissionForm(lesson);
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
        <!-- Lesson steps (built by renderLessonParts): each Part is a Content step
             + a separate Knowledge Check step; steps unlock one after another.
             UNCHANGED — the section / Knowledge Check flow is identical. -->
        <div class="lp-parts" data-lesson-parts="${escHtml(l.id)}"></div>
        <!-- Assignment → Final Activities → Lesson Completed: each is its OWN gated
             step/card in the lesson navigation, unlocked in order by
             applyFinalGating after the last Knowledge Check. -->
        <div class="lp-final-steps" data-final-steps="${escHtml(l.id)}">
          ${finalStepsMarkup(l, academyKey, completed)}
        </div>
      </div>
    </div>`;
}

/* Submit-Assignment form, shown under a Published assignment. Only the inputs
   allowed by the assignment's Submission Type are rendered. Returns "" when there
   is no published assignment (so no form appears). */
function submissionForm(l) {
  if (!(l && l.assignment && l.assignment.status === "Published")) return "";
  const asg = l.assignment;
  const m = submissionMethods(asg.submissionType);
  // Employee identity is auto-attached from the Identification Provider — show it
  // (read-only) rather than asking again; only prompt for the name if unidentified.
  const ident = (typeof Identity !== "undefined") ? Identity.get() : null;
  const nameRow = ident
    ? `<div class="lp-submit-as">👤 <strong>${escHtml(ident.employeeName)}</strong> · ${escHtml(ident.team)}</div>`
    : `<input type="text" name="employeeName" placeholder="اسمك · Employee Name" autocomplete="name" required />`;

  const parts = [];
  if (m.text) parts.push(
    `<label class="lp-submit-label">Text Answer</label>` +
    `<textarea name="textAnswer" rows="4" placeholder="اكتب إجابتك هنا · Type your answer"></textarea>`);
  if (m.link) parts.push(
    `<label class="lp-submit-label">Document Link</label>` +
    `<input type="url" name="submissionLink" inputmode="url" placeholder="https://docs.google.com/…  ·  Drive / OneDrive / URL" />`);
  if (m.file) parts.push(
    `<label class="lp-submit-label">File Upload</label>` +
    `<input type="file" name="file" class="lp-file-input" accept=".pdf,.docx,.pptx,.xlsx,application/pdf" />` +
    `<span class="lp-file-name" data-file-name></span>` +
    `<p class="lp-submit-hint">PDF, DOCX, PPTX, or XLSX · max 10 MB</p>`);

  const methodKeys = Object.keys(m).join(",");
  const eitherHint = (Object.keys(m).length > 1)
    ? `<p class="lp-submit-hint">You may submit any one of the options above — you don't need all of them.</p>` : "";
  return `
    <form class="lp-submit" data-submit-form data-lesson-id="${escHtml(l.id)}" data-methods="${methodKeys}">
      <h5 class="lp-submit-title">Submit Assignment</h5>
      ${nameRow}
      ${parts.join("\n      ")}
      ${eitherHint}
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
