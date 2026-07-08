# Sales Data Team — Learning Center

A professional Learning Center + Content Manager for the Sales Division.
Static front-end (no build step, no framework) backed by **Supabase** (Postgres)
for shared content storage, deployed on Render. `localStorage` is used as a
cache / offline fallback.

Multi-page experience — each major step is its own HTML page. Navigation uses
real page links (not scrolling between sections).

## Pages

| File | Purpose |
|------|---------|
| `index.html` | **Team Selection** — Learning Center entry (Sales Data / Sales / Sales Accounting) |
| `learning_path.html` | **Learning Path** — accordion of modules; each expands independently (one open at a time) |
| `assignment_M0.html` | **Assignment M0-A** — tasks and submission form |
| `submission_success.html` | **Confirmation** page after submitting |
| `module_template.html` | Reference: accordion module-item template for future modules |
| `styles.css` | Shared styling (corporate look, responsive, RTL) |
| `script.js` | Shared logic (mobile sidebar, reveal, accordion, form submission) |
| `content_manager.html` | **Content Manager** — author academies, modules, lessons, assignments, activities |
| `dashboard.html` | **Academy Dashboard** — manager stats, content health, completeness |
| `academies.js` | Shared data model, cache, and Supabase sync |
| `supabase.js` | Supabase REST API layer (content CRUD + submissions) |
| `supabase_schema.sql` | Database schema (tables, RLS, seed) |
| `SUPABASE_BACKEND.md` | How to set up and connect the Supabase backend |
| `README.md` | This file |

## Flow

```
index.html  (Select Team → Sales Data Team)
   ↓
learning_path.html  (accordion of modules → expand Module 0)
   ↓  Submit Assignment
assignment_M0.html  (do the tasks → Submit)
   ↓  on submit
submission_success.html  (confirmation)
```

The Learning Path shows all modules as an accordion. Only **Module 0** is
available (expanded by default); **Modules 1–8** appear as **Locked / Coming
Soon** headers. Sales Team and Sales Accounting Team also appear as Coming Soon.

## How to run

Double-click **`index.html`** (or open it in any browser). That's it.

## Backend (Supabase)

All Academy content (academies, modules, lessons, assignments, activities) is
stored in **Supabase** (Postgres) and read/written directly from the browser via
its REST API. Configure the project in **one place**:

```js
// supabase.js
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
```

Run `supabase_schema.sql` once in the Supabase SQL editor to create the tables.
Assignment submissions (`assignment_M0.html`) go to the `submissions` table.
Full setup: see **`SUPABASE_BACKEND.md`**.

## Module accordion template

Modules live **inside `learning_path.html`** as accordion items (Microsoft
Learn / Coursera style). Each expands independently; only one is open at a time.
When collapsed, only the module title shows.

An expanded module keeps the same section order (drop any it doesn't need):
Introduction · Why This Module · Business Context · Learning Objectives ·
Training Content · Practical Example · Tips · Common Mistakes · Assignment ·
What You'll Submit · How It Will Be Reviewed · Next Step.

The reusable markup is in **`module_template.html`** (a reference snippet, not
linked in the app).

## Adding future modules

1. In `learning_path.html`, replace a locked placeholder card (e.g. M1) with the
   full `level-card` block from `module_template.html`, and fill the sections.
2. Copy `assignment_M0.html` → `assignment_M1.html` (update content + the form's
   Assignment ID), and point the module's **Submit Assignment** button at it.

Shared `styles.css` and `script.js` work as-is — no layout changes needed.

## Notes

- Content is in simple professional Egyptian Arabic; technical terms kept in
  English (Lead, CRM, Dashboard, XLOOKUP, COUNTIFS, Apps Script, etc.).
- Progress values are static demo data for now.
- Responsive: works on desktop and mobile (collapsible sidebar).
- Future: connect team selection to permissions / role-based access.
