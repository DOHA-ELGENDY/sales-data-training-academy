# Google Sheets Backend (Sprint 2 — Shared Content Storage)

This moves all Academy content out of a single browser's `localStorage` and into
a **Google Sheet**, so content created on one device is available everywhere.

- **Primary store:** Google Sheets (via an Apps Script Web App).
- **Cache / offline fallback:** `localStorage`. If Sheets is unreachable the app
  keeps working from the cache and **queues writes**, flushing them automatically
  when the connection returns.

Files: [`Code.gs`](Code.gs) (Apps Script) · storage/sync logic in
[`academies.js`](academies.js) (`CONTENT_API_URL`, `syncContentFromServer`,
`postContent`, outbox).

---

## 1. Google Sheet structure

Create one spreadsheet (any name, e.g. **"Sales Data Academy — Content"**). The
Apps Script `setup()` creates these tabs and headers automatically, but for
reference:

**Academies**

| key | name | team | icon | order |
|-----|------|------|------|-------|

**Modules**

| id | academyKey | moduleNumber | moduleTitle | shortDesc | objectives | studyTime | difficulty | prerequisites | status | updatedAt |
|----|-----------|--------------|-------------|-----------|------------|-----------|------------|---------------|--------|-----------|

**Lessons**

| id | academyKey | moduleId | moduleNumber | lessonNumber | lessonTitle | contentType | contentBody | status | order | assignment | activities | updatedAt |
|----|-----------|----------|--------------|--------------|-------------|-------------|-------------|--------|-------|------------|------------|-----------|

**Submissions** (existing assignment-submission tab — unchanged)

Nested data is stored as **JSON strings** in a single cell:
`Modules.objectives` (array), `Lessons.assignment` (object), `Lessons.activities`
(array). `Lessons.contentBody` holds the rich-text **HTML**.

---

> ⚠️ **Upgrading from an earlier backend?** The Modules/Lessons **columns
> changed** this sprint (added `objectives`, `prerequisites`, `lessonNumber`,
> `order`, `assignment`, `activities`). If you reuse a spreadsheet that already
> has old-format Module/Lesson rows, **delete the `Modules` and `Lessons` tabs
> first** (then `setup()` recreates them empty). Otherwise old data stays in the
> old column positions and misaligns. The cleanest path is a **fresh
> spreadsheet** — the first browser that had the content will re-seed it
> automatically (see *First-run migration* below).

## 2. Apps Script — deploy the Web App

1. Open the spreadsheet → **Extensions ▸ Apps Script**.
2. Delete any default code, paste the contents of [`Code.gs`](Code.gs), **Save**.
3. Select the function **`setup`** in the toolbar and click **Run** once.
   Approve the permission prompt (it needs access to *this* spreadsheet).
   This creates the tabs, headers, and seeds the three academies.
4. **Deploy ▸ New deployment** → type **Web app**:
   - **Description:** Academy content API
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**
   - **Deploy**, then copy the **Web app URL** (ends in `/exec`).

> Updating later: **Deploy ▸ Manage deployments ▸ edit ▸ New version ▸ Deploy**.
> The URL stays the same, so you don't need to touch the front-end again.

### Endpoints (for reference)

Reads are JSONP `GET` (no CORS setup needed); writes are `POST`:

- `GET ?action=getAll` → `{ result, academies, modules, lessons }`
- `POST { action:"saveModule", item }` · `{ action:"deleteModule", id }`
- `POST { action:"saveLesson", item }` · `{ action:"deleteLesson", id }`
- `POST { action:"bulkSave", modules, lessons, academies }` (first-run migration)

---

## 3. Front-end integration

Set the deployed URL in [`academies.js`](academies.js):

```js
const CONTENT_API_URL = "https://script.google.com/macros/s/XXXXXXXX/exec";
```

(Leave it `""` to run in demo mode — `localStorage` only.)

That's all the wiring the app needs:

- **Content Manager** saves/deletes go straight to the Sheet (`pushModule`,
  `pushLesson`, `deleteModuleRemote`, `deleteLessonRemote`) and re-sync.
- **Learning Path** and **Dashboard** render the cache instantly, then refresh
  from the Sheet (`syncContentFromServer`).

### First-run migration

The first time the app loads against an **empty** Sheet while the browser still
has content in `localStorage`, that local content is pushed up automatically
(`bulkSave`) so nothing is lost. After that, the Sheet is the source of truth.

### Offline fallback & auto-sync

- Reads: if the Sheet is unreachable, the app keeps using the `localStorage`
  cache.
- Writes: a failed write is stored in an **outbox** (`sdta_outbox_v1`) and
  retried on the next load and on the browser's `online` event.

---

## 4. Notes & limits

- **Employee progress** (lesson completion) and **activity answers** remain in
  `localStorage` per device — this sprint is about *content* storage only.
- **Academies** are seeded in the Sheet and still listed in `academies.js` for
  the UI dropdowns; they're identical, and the code list is already shared via
  git.
- **Google Sheets cell limit is 50,000 characters.** A lesson whose `contentBody`
  embeds large base64 images can exceed this. Keep editor images small until
  image files move to Drive/Attachments in a later sprint.
- The Web App also still receives **assignment submissions** (POST with no
  `action`) into the **Submissions** tab — unchanged.
