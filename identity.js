/* ============================================================
   Identification Provider (temporary — until WMS integration)
   ------------------------------------------------------------
   Identifies WHO is using the Learning Center and their ROLE. This is
   NOT real auth (no passwords). Everything else (Assignments, Activities,
   Progress, Submissions, navigation, page guards) reads identity through
   window.Identity, so later you can replace ONLY this file with a
   Workforce-Management provider that supplies the logged-in user + role.

   TEMPORARY ROLE RULE: employeeName === "admin" → role "admin", else "employee".

   Interface:
     Identity.isIdentified() -> boolean
     Identity.get()          -> { employeeId, employeeName, team, role } | null
     Identity.getCurrentUser() -> same as get()
     Identity.set({employeeName, team}) -> saved record (role derived)
     Identity.clear()        -> forget (Switch Employee: name + team + role)
     Identity.stamp(payload) -> payload + {employeeId, employeeName, team, timestamp}
     Identity.isAdmin()      -> boolean
     Identity.requireAdmin() -> true, or redirects to Learning Path and returns false
     Identity.isAdminPage(p) -> is a page admin-only (defaults to current page)
     Identity.applyNav()     -> hide admin-only nav links for non-admins
     Identity.teams / employees / ADMIN_PAGES  -> config (single source of truth)
   ============================================================ */
window.Identity = (function () {
  var KEY = "sdta_identity_v1";

  var TEAMS = ["Sales", "Sales Data", "Sales Accounting"];

  // Option A: fill this with { name, team } to get a searchable dropdown.
  // Empty (Option B) → the Name field is a free-text input.
  var EMPLOYEES = [
    // { name: "Doha Elgendy", team: "Sales" },
  ];

  // Single source of truth for admin-only pages (used by the guard AND the nav).
  var ADMIN_PAGES = ["content_manager.html", "dashboard.html"];
  var FALLBACK_PAGE = "learning_path.html";

  // Team → academy key. A regular employee is locked to their own team's academy.
  var TEAM_ACADEMY = { "Sales": "sales", "Sales Data": "sales-data", "Sales Accounting": "sales-accounting" };
  var SELECTED_ACADEMY_KEY = "sdta_selected_academy"; // must match academies.js

  function uid() { return "emp_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  /* STABLE employee id derived from the typed identity, so the SAME person keys
     to the SAME progress on any browser/device (cross-device resume).
       "ECO233 - ROWIDA"  -> "ECO233"      (leading employee code)
       "#EC0093-Mariem Nagy" -> "EC0093"
       "EMAN"             -> "emp_eman"    (stable slug when no code)
     Never random — so it does not change per browser. */
  function stableEmployeeId(name) {
    var n = String(name || "").trim();
    if (!n) return uid();
    var m = n.match(/^#?\s*([A-Za-z]{1,6}\d{2,7})/); // leading code like ECO233 / EC0093 / SA0022
    if (m) return m[1].toUpperCase();
    var slug = n.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "_").replace(/^_+|_+$/g, "");
    return slug ? ("emp_" + slug) : uid();
  }
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return null;
  }
  /* Role for a record: stored role, else derived from the name (backward compat). */
  function roleOf(rec) {
    if (!rec) return null;
    if (rec.role) return rec.role;
    return String(rec.employeeName || "").trim().toLowerCase() === "admin" ? "admin" : "employee";
  }

  function get() {
    var r = load();
    if (!r) return null;
    return {
      employeeId: r.employeeId || "", employeeName: r.employeeName || "",
      team: r.team || "", role: roleOf(r)
    };
  }
  function isIdentified() { var r = load(); return !!(r && r.employeeName && r.team); }
  function isAdmin() { return roleOf(load()) === "admin"; }
  function role() { return roleOf(load()); }

  function set(info) {
    info = info || {};
    var existing = load() || {};
    var name = String(info.employeeName || "").trim();
    // Always derive a STABLE id from the typed name (ignore any old random id) so
    // the same employee resumes their Supabase progress across devices.
    var stableId = stableEmployeeId(name);
    var rec = {
      employeeId: stableId || existing.employeeId || uid(),
      employeeName: name,
      team: String(info.team || "").trim(),
      role: name.toLowerCase() === "admin" ? "admin" : "employee",
      identifiedAt: new Date().toISOString()
    };
    localStorage.setItem(KEY, JSON.stringify(rec));
    return rec;
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /* Merge the current identity + a fresh timestamp into any payload. */
  function stamp(payload) {
    var r = load() || {};
    var out = {};
    if (payload) for (var k in payload) out[k] = payload[k];
    out.employeeId = r.employeeId || "";
    out.employeeName = r.employeeName || "";
    out.team = r.team || "";
    out.timestamp = new Date().toISOString();
    return out;
  }

  /* ---------- Team → academy access ---------- */
  function teamAcademyKey() { var r = load(); return r ? (TEAM_ACADEMY[r.team] || null) : null; }
  function academyKey() { return teamAcademyKey(); }

  /* Lock a regular employee to their own team's academy. Returns true if allowed
     to stay; redirects (and returns false) if they requested a different academy
     via ?team= or a stale stored selection. Admins may view any academy. */
  function enforceAcademy() {
    if (isAdmin()) return true;
    var mine = teamAcademyKey();
    if (!mine) return true; // no mapped team → leave to the page's normal flow
    var requested = null;
    try { requested = new URLSearchParams(location.search).get("team"); } catch (e) {}
    if (!requested) { try { requested = localStorage.getItem(SELECTED_ACADEMY_KEY); } catch (e) {} }
    if (requested && requested !== mine) {
      try { location.replace("learning_path.html?team=" + encodeURIComponent(mine)); } catch (e) {}
      return false;
    }
    try { localStorage.setItem(SELECTED_ACADEMY_KEY, mine); } catch (e) {}
    return true;
  }

  /* ---------- Role-based navigation / access ---------- */
  function currentPage() {
    var p = "";
    try { p = (location.pathname || "").split("/").pop(); } catch (e) {}
    return p || "index.html";
  }
  function isAdminPage(page) { return ADMIN_PAGES.indexOf(page || currentPage()) >= 0; }

  /* Guard an admin-only page: non-admins are redirected to the Learning Path. */
  function requireAdmin() {
    if (isAdmin()) return true;
    try { location.replace(FALLBACK_PAGE); } catch (e) {}
    return false;
  }

  /* Hide admin-only nav links for non-admins (config-driven, no per-page checks). */
  function applyNav() {
    if (typeof document === "undefined") return;
    var admin = isAdmin();
    var links = document.querySelectorAll(".nav .nav-item[href]");
    for (var i = 0; i < links.length; i++) {
      var href = (links[i].getAttribute("href") || "").split("?")[0].split("/").pop();
      if (ADMIN_PAGES.indexOf(href) >= 0 && !admin) links[i].style.display = "none";
    }
  }

  var api = {
    isIdentified: isIdentified, get: get, getCurrentUser: get,
    set: set, clear: clear, stamp: stamp,
    isAdmin: isAdmin, role: role, requireAdmin: requireAdmin,
    isAdminPage: isAdminPage, applyNav: applyNav,
    academyKey: academyKey, teamAcademyKey: teamAcademyKey, enforceAcademy: enforceAcademy,
    teams: TEAMS, employees: EMPLOYEES, ADMIN_PAGES: ADMIN_PAGES
  };

  // Guard direct access as early as possible (identity.js loads in <head>):
  (function () {
    var page = currentPage();
    if (isAdminPage(page) && !isAdmin()) {                       // admin page, not admin
      try { location.replace(FALLBACK_PAGE); } catch (e) {}
    } else if (page === "learning_path.html") {                  // lock employee to own academy
      enforceAcademy();
    } else if (page === "index.html") {                          // employee skips team selection
      if (isIdentified() && !isAdmin()) {
        var mine = teamAcademyKey();
        if (mine) { try { location.replace("learning_path.html?team=" + encodeURIComponent(mine)); } catch (e) {} }
      }
    }
  })();

  return api;
})();
