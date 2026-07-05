# Connect the Submission Form to Google Sheets

This connects the Assignments form to a Google Sheet using a **Google Apps Script Web App**.
No servers, no cost. Follow the 5 steps in order — takes about 10 minutes.

---

## 1. Google Sheet structure

Create a new Google Sheet (Drive → New → Google Sheets). Name it e.g.
**`Sales Data — Assignment Submissions`**.

You don't need to add columns by hand — the script creates a tab called
**`Submissions`** (bold + frozen header row) automatically on the first
submission, with 10 columns (A → J):

| Col | Header | Filled by |
|-----|--------|-----------|
| A | Timestamp | auto (submission time) |
| B | Employee Name | form |
| C | Assignment ID | form |
| D | Submission Link | form |
| E | Notes | form |
| F | Status | auto → `Pending Review` |
| G | Score | manager (review) |
| H | Manager Feedback | manager (review) |
| I | Reviewed By | manager (review) |
| J | Reviewed At | manager (review) |

Columns **A–F** are written on submission; the review columns **G–J** start
empty for the manager to fill in later.

> The script is idempotent: if a `Submissions` tab already exists with an older
> (shorter) header row, it upgrades it to the current 10-column layout safely.

---

## 2. Add the Apps Script code

1. In the Sheet, open **Extensions → Apps Script**.
2. Delete any starter code in `Code.gs`.
3. Open the **`Code.gs`** file from this project, copy **all** of it, and paste it in.
4. Click the **💾 Save** icon.

That code:
- `doPost(e)` → receives the form data and appends a row.
- `doGet()` → health check (returns `{"result":"ready"}`).
- auto-creates the `Submissions` tab with headers if it doesn't exist.

---

## 3. Deploy as a Web App

1. In Apps Script, click **Deploy → New deployment**.
2. Click the ⚙️ gear next to "Select type" → choose **Web app**.
3. Fill in:
   - **Description:** `Training Portal form`
   - **Execute as:** **Me** (your account)
   - **Who has access:** **Anyone**  ← required so the form can post
4. Click **Deploy**.
5. Click **Authorize access** → pick your Google account → if you see
   "Google hasn't verified this app", click **Advanced → Go to (project) → Allow**.
   (This is normal for your own scripts.)
6. Copy the **Web app URL**. It looks like:
   `https://script.google.com/macros/s/AKfyc..../exec`

> **Every time you change `Code.gs`**, do **Deploy → Manage deployments → Edit
> (pencil) → Version: New version → Deploy** so the changes go live. The URL stays the same.

---

## 4. Connect script.js

1. Open **`script.js`** in this project.
2. Near the top, find:
   ```js
   const GOOGLE_SHEETS_WEB_APP_URL = "";
   ```
3. Paste your Web App URL between the quotes:
   ```js
   const GOOGLE_SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfyc..../exec";
   ```
4. Save the file.

That's the only code change needed — the form logic is already wired up.

---

## 5. Test it (end-to-end flow)

1. Open **`index.html`** in your browser (double-click it).
2. Click **Sales Data Team → Open Learning Path**.
3. On **Module 0**, click **Start Assignment →** (opens `assignment_M0.html`).
4. Fill the submission form:
   - **Employee Name:** your name
   - **Assignment ID:** `M0-A` (fixed on this page)
   - **Google Drive Link:** any link (e.g. a Google Drive/Sheet URL)
   - **Notes:** optional
5. Click **Submit Assignment**. On success you're taken to
   **`submission_success.html`** (the confirmation page).
6. Open your Google Sheet → the **`Submissions`** tab → a new row appears with
   your data (Status = `Pending Review`, review columns G–J empty). ✅

### Quick checks if it doesn't work

- **No row appears:** confirm the URL ends with `/exec` (not `/dev`), and that
  **Who has access** was set to **Anyone**.
- **Changed the code but nothing updates:** you must **redeploy a new version**
  (step 3 note above).
- **Want to confirm the Web App is live:** open the Web App URL directly in a
  browser — it should show `{"result":"ready"}`.
- The success message shows even offline because we use `mode:"no-cors"` (the
  browser can't read the response). Always verify by checking the Sheet.

---

That's it — submissions now flow straight into Google Sheets, one row each,
marked **Pending Review** for you to grade in the Status column.
