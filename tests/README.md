# Automated tests — isolation rules

Automated / headless tests **must never** write to the production Supabase project.

A leaked test row (`employee_name: "Ola"`, `employee_id: "x"`/`"e1"`, lesson
`pt_les`/`st_les`) reached production once because a harness ran against the real
REST endpoint. To prevent a repeat, every browser/headless test must isolate its
data.

## The rule

1. **Load `tests/mock-supabase.js` first**, before any app script, and call
   `installTestSupabaseMock(seed)`:

   ```html
   <script src="tests/mock-supabase.js"></script>
   <script>
     installTestSupabaseMock({
       knowledge_check_responses: [ /* seed rows */ ],
       submissions: [ /* seed rows */ ],
       modules: [ /* … */ ], lessons: [ /* … */ ]
     });
   </script>
   <!-- only now load the app under test -->
   <script src="academies.js"></script>
   <script src="learning_path.js"></script>
   ```

2. **Never** set `window.SUPABASE_URL` to the real project URL in a test. The mock
   forces `http://mock.local` and **hard-blocks any request to a real `http(s)`
   host** (including `*.supabase.co`) — so even a misconfigured harness cannot
   reach prod.

3. **Test identities are `TEST_`-prefixed** (`TEST_USER` / `TEST_TEAM` /
   `employeeId TEST_*`). Real users are `emp_<slug>`; anything `TEST_*` is
   unmistakably test data and can be filtered/deleted safely.

## What the mock provides

- In-memory PostgREST-style `window.fetch` (GET/POST/PATCH/DELETE on
  `/rest/v1/<table>`), so reads and writes stay in memory.
- `window.SB` with the same store + no-op file uploads (return fake URLs).
- A `TEST_*` `window.Identity`.
- `getTestDb(table)` to assert on what a test wrote.

Do not point a harness at the live database. If a test genuinely needs a real
backend, use a separate **non-production** Supabase project — never the app's
production URL/key.
