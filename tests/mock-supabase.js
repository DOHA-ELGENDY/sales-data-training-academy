/* ============================================================
   Test fixture — isolated, in-memory Supabase mock.
   ------------------------------------------------------------
   WHY: automated/headless tests must NEVER write to the production Supabase
   project. A row like employee_name "Ola" (employee_id "x"/"e1", lesson
   "pt_les"/"st_les") once leaked into prod because a harness ran against the
   real REST endpoint. This fixture prevents that by:

     1. Replacing window.fetch with an in-memory PostgREST-ish mock (GET/POST/
        PATCH/DELETE on /rest/v1/<table>). No network, no real DB.
     2. HARD-BLOCKING any request to a real host (https://*.supabase.co or any
        absolute http(s) URL) — so even a misconfigured harness cannot reach prod.
     3. Forcing a clearly-prefixed, non-production identity (TEST_*) so any data a
        test does create is unmistakably test data.
     4. Stubbing window.SB with the same in-memory store + no-op uploads.

   USAGE: load this BEFORE the app scripts in any headless/browser test harness:

       <script src="tests/mock-supabase.js"></script>
       <script>installTestSupabaseMock({ knowledge_check_responses: [...] });</script>
       <script src="academies.js"></script>
       <script src="learning_path.js"></script>

   Never set window.SUPABASE_URL to the real project URL in a test.
   ============================================================ */
(function () {
  "use strict";

  // In-memory tables. Seed via installTestSupabaseMock({ table: [rows] }).
  var DB = {};
  function table(name) { return (DB[name] = DB[name] || []); }

  // Clearly-prefixed, non-production identity. Real users are emp_<slug>; tests
  // are TEST_* so they can never be mistaken for (or collide with) real data.
  var TEST_IDENTITY = {
    employeeId: "TEST_" + "fixture",
    employeeName: "TEST_USER",
    team: "TEST_TEAM"
  };

  function isRealHost(url) {
    var u = String(url || "");
    // Any absolute http(s) URL is off-limits in a test (that includes *.supabase.co).
    return /^https?:\/\//i.test(u);
  }
  function parseTable(url) {
    var m = String(url).match(/\/rest\/v1\/([a-z_]+)/i);
    return m ? m[1] : null;
  }
  function parseIdEq(url) {
    var m = String(url).match(/[?&]id=eq\.([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function json(status, body) {
    return Promise.resolve({
      ok: status >= 200 && status < 300, status: status,
      json: function () { return Promise.resolve(body); },
      text: function () { return Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)); }
    });
  }

  function mockFetch(url, opts) {
    opts = opts || {};
    var method = (opts.method || "GET").toUpperCase();

    // Requests to any real host are refused outright — tests cannot touch prod.
    // (Checked FIRST: a real Supabase URL also contains /rest/v1/<table>, so this
    // must run before table parsing. Only the mock's own host is allowed.)
    if (isRealHost(url) && String(url).indexOf("http://mock.local") !== 0) {
      return Promise.reject(new Error("[mock-supabase] BLOCKED real request in test: " + method + " " + url));
    }
    var t = parseTable(url);
    if (!t) return json(200, []); // storage / other → empty ok

    var rows = table(t), body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch (e) { body = null; }

    if (method === "GET") return json(200, rows.slice());
    if (method === "POST") { // upsert (on_conflict=id)
      (Array.isArray(body) ? body : [body]).forEach(function (r) {
        if (!r) return;
        var i = rows.findIndex(function (x) { return x.id === r.id; });
        if (i >= 0) rows[i] = Object.assign({}, rows[i], r); else rows.push(r);
      });
      return json(201, []);
    }
    if (method === "PATCH") {
      var id = parseIdEq(url);
      rows.forEach(function (x) { if (!id || x.id === id) Object.assign(x, body || {}); });
      return json(204, []);
    }
    if (method === "DELETE") {
      var did = parseIdEq(url);
      DB[t] = rows.filter(function (x) { return did ? x.id !== did : false; });
      return json(204, []);
    }
    return json(200, []);
  }

  // Public installer. Optionally pass a seed: { tableName: [rows], ... }.
  window.installTestSupabaseMock = function (seed) {
    DB = {};
    if (seed && typeof seed === "object") Object.keys(seed).forEach(function (k) { DB[k] = (seed[k] || []).slice(); });

    // Never let a test point at prod: force a non-production URL marker.
    window.SUPABASE_URL = "http://mock.local"; // not a real host; mockFetch handles it
    window.SUPABASE_ANON_KEY = "TEST_ANON_KEY";

    window.fetch = mockFetch;

    // In-memory SB matching the surface the app uses. Uploads return a fake URL.
    window.SB = {
      enabled: function () { return true; },
      ping: function () { return Promise.resolve(true); },
      subId: function () { return "TEST_" + Math.random().toString(36).slice(2, 10); },
      fetchModules: function () { return Promise.resolve(table("modules").slice()); },
      fetchLessons: function () { return Promise.resolve(table("lessons").slice()); },
      fetchSubmissions: function () { return Promise.resolve(table("submissions").slice()); },
      fetchKcResponses: function () { return Promise.resolve(table("knowledge_check_responses").slice()); },
      uploadFile: function (f) { return Promise.resolve("http://mock.local/storage/test/" + ((f && f.name) || "file")); },
      uploadImage: function (f) { return Promise.resolve("http://mock.local/storage/test/" + ((f && f.name) || "img")); },
      uploadKcFile: function (f) { return Promise.resolve("http://mock.local/storage/test/" + ((f && f.name) || "kc")); }
    };

    // Clearly-prefixed test identity — never a real employee.
    window.Identity = {
      get: function () { return Object.assign({}, TEST_IDENTITY); },
      stamp: function (o) { o = o || {}; o.employeeId = TEST_IDENTITY.employeeId; o.employeeName = TEST_IDENTITY.employeeName; o.team = TEST_IDENTITY.team; o.timestamp = "2020-01-01T00:00:00.000Z"; return o; },
      isIdentified: function () { return true; },
      isAdmin: function () { return true; },
      applyNav: function () {}
    };

    return { db: DB, identity: TEST_IDENTITY };
  };

  // Read helper for assertions.
  window.getTestDb = function (t) { return t ? table(t).slice() : DB; };
})();
