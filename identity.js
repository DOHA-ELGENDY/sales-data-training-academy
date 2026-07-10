/* ============================================================
   Identification Provider (temporary — until WMS integration)
   ------------------------------------------------------------
   Identifies WHO is using the Learning Center. This is NOT auth.
   Everything else (Assignments, Activities, Progress, Submissions)
   reads identity through window.Identity, so later you can replace
   ONLY this file with a Workforce-Management provider that fills
   employeeId / employeeName / team from the real login — no other
   feature changes.

   Interface:
     Identity.isIdentified() -> boolean
     Identity.get()          -> { employeeId, employeeName, team } | null
     Identity.set({employeeName, team}) -> saved record
     Identity.clear()        -> forget (Switch Employee)
     Identity.stamp(payload) -> payload + {employeeId, employeeName, team, timestamp}
     Identity.teams          -> allowed teams
     Identity.employees      -> configurable employee list (empty = free text)
   ============================================================ */
window.Identity = (function () {
  var KEY = "sdta_identity_v1";

  var TEAMS = ["Sales", "Sales Data", "Sales Accounting"];

  // Option A: fill this with { name, team } to get a searchable dropdown.
  // Empty (Option B) → the Name field is a free-text input.
  var EMPLOYEES = [
    // { name: "Doha Elgendy", team: "Sales" },
  ];

  function uid() { return "emp_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return null;
  }
  function get() { return load(); }
  function isIdentified() { var r = load(); return !!(r && r.employeeName && r.team); }
  function set(info) {
    info = info || {};
    var existing = load() || {};
    var rec = {
      employeeId: existing.employeeId || uid(),
      employeeName: String(info.employeeName || "").trim(),
      team: String(info.team || "").trim(),
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

  return {
    isIdentified: isIdentified, get: get, set: set, clear: clear, stamp: stamp,
    teams: TEAMS, employees: EMPLOYEES
  };
})();
