/* ============================================================
   Sales Data Team — Learning Center
   script.js  (shared across all pages — plain JavaScript)
   ============================================================ */

/* ============================================================
   GOOGLE SHEETS CONNECTION
   ------------------------------------------------------------
   Web App URL for the Assignment submission (used on
   assignment_M0.html). Leave "" to keep the form in demo mode.
   Setup: see GOOGLE_SHEETS_SETUP.md
   ============================================================ */
const GOOGLE_SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxE73p1e0ckD04kLWwpLFf7P_n8fmcqwl_OAA1e6dEH1WjvObkuhGKgyTOWvas0Y8wh/exec";

/* Where to go after a successful submission. */
const SUCCESS_PAGE = "submission_success.html";

/* ============================================================
   MOBILE SIDEBAR (portal pages)
   ============================================================ */
function openSidebar() {
  const sb = document.getElementById("sidebar");
  const bd = document.getElementById("backdrop");
  const btn = document.getElementById("menuBtn");
  if (sb) sb.classList.add("open");
  if (bd) bd.classList.add("show");
  if (btn) btn.setAttribute("aria-expanded", "true");
}
function closeSidebar() {
  const sb = document.getElementById("sidebar");
  const bd = document.getElementById("backdrop");
  const btn = document.getElementById("menuBtn");
  if (sb) sb.classList.remove("open");
  if (bd) bd.classList.remove("show");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

/* ============================================================
   ENTRANCE REVEAL (lightweight, progressive)
   ============================================================ */
function revealAll() {
  const items = document.querySelectorAll(".reveal");
  items.forEach((el, i) => setTimeout(() => el.classList.add("in"), 40 * i));
}

/* ============================================================
   ASSIGNMENT SUBMISSION  (assignment_M0.html)
   ============================================================ */
async function handleSubmit(e) {
  e.preventDefault();

  const data = {
    employeeName: (document.getElementById("empName").value || "").trim(),
    assignmentId: (document.getElementById("assignId").value || "").trim(),
    submissionLink: (document.getElementById("subLink").value || "").trim(),
    notes: (document.getElementById("notes").value || "").trim()
  };

  const msg = document.getElementById("formMsg");
  const submitBtn = e.target.querySelector('button[type="submit"]');

  // Basic validation
  if (!data.employeeName || !data.assignmentId || !data.submissionLink) {
    msg.style.color = "#dc2626";
    msg.textContent = "برجاء إدخال الاسم و Google Drive Link.";
    return;
  }

  /* GOOGLE_SHEETS_HOOK
     If no URL is set, stay in demo mode but still go to the success page. */
  if (!GOOGLE_SHEETS_WEB_APP_URL) {
    console.log("Submission (demo — no URL set):", data);
    window.location.href = SUCCESS_PAGE;
    return;
  }

  msg.style.color = "#6b7280";
  msg.textContent = "Submitting…";
  if (submitBtn) submitBtn.disabled = true;

  try {
    /* no-cors + text/plain avoids a CORS preflight (Apps Script Web Apps
       don't handle it well). We can't read the response, so once the
       request completes we move on to the confirmation page. */
    await fetch(GOOGLE_SHEETS_WEB_APP_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data)
    });
    window.location.href = SUCCESS_PAGE;
  } catch (err) {
    console.error("Submit failed:", err);
    msg.style.color = "#dc2626";
    msg.textContent = "تعذّر الإرسال. برجاء المحاولة مرة أخرى.";
    if (submitBtn) submitBtn.disabled = false;
  }
}

/* ============================================================
   LEARNING PATH ACCORDION (learning_path.html)
   Each module expands independently; only one open at a time.
   Locked modules have no [data-acc-toggle], so they don't open.
   ============================================================ */
function initAccordion() {
  const container = document.getElementById("learningPath");
  if (!container) return;

  // Event delegation so both static and dynamically-rendered modules work.
  function toggleFrom(head) {
    const card = head.parentElement;
    const willOpen = !card.classList.contains("open");

    // Collapse every open module first (one open at a time).
    container.querySelectorAll(".level-card.open").forEach(c => {
      c.classList.remove("open");
      const h = c.querySelector("[data-acc-toggle]");
      if (h) h.setAttribute("aria-expanded", "false");
    });

    // Expand the clicked one (if it was closed).
    if (willOpen) {
      card.classList.add("open");
      head.setAttribute("aria-expanded", "true");
    }
  }

  container.addEventListener("click", e => {
    const head = e.target.closest("[data-acc-toggle]");
    if (head && container.contains(head)) toggleFrom(head);
  });
  container.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const head = e.target.closest("[data-acc-toggle]");
    if (head && container.contains(head)) { e.preventDefault(); toggleFrom(head); }
  });
}

/* ============================================================
   INIT (runs on every page; guards handle missing elements)
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  revealAll();
  initAccordion();

  // Mobile sidebar (portal pages only)
  const menuBtn = document.getElementById("menuBtn");
  const backdrop = document.getElementById("backdrop");
  if (menuBtn) menuBtn.addEventListener("click", openSidebar);
  if (backdrop) backdrop.addEventListener("click", closeSidebar);

  // Assignment form (assignment_M0.html only)
  const form = document.getElementById("assignmentForm");
  if (form) form.addEventListener("submit", handleSubmit);
});
