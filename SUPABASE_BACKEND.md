# Supabase Backend (Permanent Production Storage)

All Academy content lives in **Supabase** (Postgres). This replaces the previous
Google Sheets / Apps Script backend entirely. The site stays a **static app on
Render** — it talks to Supabase's auto-generated REST API (PostgREST) with plain
`fetch`, so there is no build step and no server to run.

- **Primary store:** Supabase Postgres.
- **Cache / offline fallback:** `localStorage`. If Supabase is unreachable the app
  keeps working from the cache and **queues writes**, flushing them automatically
  when the connection returns.

Files: [`supabase_schema.sql`](supabase_schema.sql) (tables + RLS + seed) ·
[`supabase.js`](supabase.js) (API layer) · sync/outbox logic in
[`academies.js`](academies.js).

---

## 1. Create the database

1. Create a project at <https://supabase.com> (free tier is fine).
2. **SQL Editor ▸ New query** → paste all of [`supabase_schema.sql`](supabase_schema.sql)
   → **Run**. This creates the tables, indexes, RLS policies, and seeds the
   three academies.

### Tables

| Table | Purpose |
|-------|---------|
| `academies` | key, name, team, icon, logo, description, sort_order |
| `modules` | module metadata incl. `objectives` (jsonb), `prerequisites`, `status` |
| `lessons` | lesson + rich-HTML `content_body`, `sort_order`, `assignment` (jsonb), `activities` (jsonb) |
| `submissions` | assignment submissions from `assignment_M0.html` |

Nested data (`objectives`, `assignment`, `activities`) is stored as **jsonb**.
Deleting a module cascades to its lessons (handled in the app).

---

## 2. Connect the front-end

In [`supabase.js`](supabase.js), set the two values from **Project Settings ▸
API**:

```js
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";   // the public "anon" key
```

That is the only configuration needed. Leaving them empty runs the app in demo
mode (localStorage only).

- **Content Manager** saves/deletes go straight to Supabase (`upsertModule`,
  `upsertLesson`, `deleteModule`, `deleteLesson`).
- **Learning Path** and **Dashboard** render the cache instantly, then refresh
  directly from Supabase (`syncContentFromServer`).
- **Assignment submissions** insert into the `submissions` table.

### First-run migration

The first time the app loads against an **empty** database while a browser still
has content in `localStorage`, that content is pushed up automatically (bulk
upsert) so nothing is lost. After that, Supabase is the source of truth.

### Offline fallback & auto-sync

Failed writes are stored in an **outbox** (`sdta_outbox_v1`) and retried on the
next load and on the browser's `online` event.

---

## 3. Deploy on Render (unchanged)

No change to hosting. Render keeps serving the static files; commit + push and
Render redeploys. The app now reaches Supabase directly from the browser — no
backend service to run. Supabase sends proper CORS headers, so requests work
from the Render domain out of the box.

---

## 4. Security note

The app has no user login and uses the public **anon** key, so the content
tables are world-readable/writable (the same exposure as the old "Anyone"
Web App). `submissions` is insert-only (not publicly readable). When
authentication is added later, tighten the RLS policies in
`supabase_schema.sql` (e.g. writes restricted to authenticated managers).

> **Large images:** lesson `content_body` can embed base64 images. Postgres
> `text` has no small per-cell limit (unlike Sheets), but keep images modest
> until they move to Supabase Storage / Drive in a later sprint.
