# Sales Data Team — Learning Center

A simple, professional, front-end-only Learning Center for the Sales Division.
No backend, no database, no login, no frameworks. Just open `index.html`.

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
| `Code.gs` | Google Apps Script Web App (server side) |
| `GOOGLE_SHEETS_SETUP.md` | How to deploy the Google Sheets integration |
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

## Google Sheets integration

The submission form on `assignment_M0.html` posts to Google Sheets via an Apps
Script Web App. The Web App URL lives in **one place**:

```js
// script.js
const GOOGLE_SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/.../exec";
```

On a successful submit the browser navigates to `submission_success.html`.
Full deployment steps: see **`GOOGLE_SHEETS_SETUP.md`**.

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
