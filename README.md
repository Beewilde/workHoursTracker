# Shiftly: Work Hours & Payout Tracker (single user, runs on your device)

A web app for the person who logs everyone's hours. It tracks daily hours for the people who share one company account, pooled OT offers, Trustpilot review bonuses and the monthly payout, and exports the monthly **Excel workbook** (one sheet per worker, live formulas).

**There is no server and no account.** All data is stored on the device you use (in the browser's own storage) and never uploaded anywhere. That is why it is free to host and why it works offline. The trade-off: the data exists only on that device, so use **Backup & Export → Download backup** regularly. The app reminds you every 30 days (changeable in Settings).

## What it does

| Area | What it does |
|---|---|
| Daily Log | One screen for all workers: Worked / RD / Not worked / Training, per-worker shift presets, OT hours, rate override with a required reason, rest days pre-marked from the month's schedule |
| Account Day / split shift | Timeline of the company shift divided between siblings; overlap is blocked (unless confirmed), gaps and a mismatch with the company's recorded hours are flagged; OT placed after or before the shift, split in time order |
| OT offers | Window, per-shift cap (all siblings together), minimum pooled hours, qualified rate, below-minimum rate (default: the worker's regular rate), "all hours" or "only past the minimum" mode; provisional until the window ends |
| Review bonuses | Per worker, default $10 but editable per review, "who was on shift at that chat time" helper |
| Rest-day schedule | Set per month, copied forward as a suggestion, confirmed by you |
| Summary & paid lock | Totals per worker; marking a worker paid locks that month for them (and is blocked while an OT offer touching the month is still running) |
| Excel export | `<Month> Invoice.xlsx`: `Summary`, one sheet per worker (columns A–K like the original, Remarks, review bonus table, rest/training colours that follow the Notes dropdown, frozen header, print setup), `OT Summary`, `Account Daily` |
| Paste notes | Messenger-style lines ("sam oct 24 8:30pm-1am ot 2h") are read into a preview; nothing saves until you confirm |
| Backup & restore | One-tap backup file (`work-hours-backup-YYYY-MM-DD.json`), restore from it, reminder banner |
| Phone | Installable ("Add to Home Screen") and works offline after the first visit |

### Paid lunch (automatic)
A full shift is **8 worked hours plus 1 hour of lunch, and the lunch is paid at the same hourly rate**. You only log the hours worked; the app adds the lunch for you:

- The lunch hour is split **equally between the workers who worked that day** and added to their time: 2 workers get +30 minutes each, 3 workers get +20 minutes each. At $5/hour that is $2.50 each for 2 workers. Each worker's own hourly rate is used.
- It is added to the paid time and pay everywhere: Daily Log, Month Summary, Calendar and the Excel export.
- It applies when the day's workers have logged a full shift (8 hours by default). A short day, such as one 4.5 hour shift, gets no lunch.
- **Training hours get no lunch** and OT hours are separate.
- You can override a single day on **Account Day** (“Paid lunch to add”): `0` means no lunch that day, `0.5` means half an hour. Leave it blank for the automatic rule.
- Rule settings (lunch length, full-shift length, on/off) are in **Settings → Paid lunch**.
- The hours the company shows for the day (for example 9 hours) include the lunch, so Account Day compares them with worked time plus lunch.
- **Existing records are not changed.** When you update from an older version, the rule starts from that day; earlier days keep their old numbers. **Settings → Paid lunch → Apply to all past days** recalculates everything on purpose (including months already marked paid), so download a backup first. If you installed the short-lived version that deducted lunch, its start date is kept and the rule now adds lunch instead.
- In the Excel export, each worker sheet has a **Paid lunch (min)** column (column H), and Total Hours is the clock time plus that lunch, as a live formula. The `Account Daily` sheet compares the paid hours with the hours the company shows.
- Pay is rounded to the cent per shift, so three workers can total a cent less than the exact amount.

**Not included:** logins for the other people, a read-only view for them, flags, importing an existing `.xlsx`, syncing between devices, notifications. (The multi-user server version has the first three.)

## Deploy for free (about 10 minutes, no command line)

The built app is just static files, so any static host works.

### Option A: GitHub Pages (everything on GitHub)
GitHub Pages is free **only for public repositories** (private ones need a paid GitHub plan). That is fine here: the repository contains no personal data (your data lives on your device), and this copy of the project has had its documents and sample names removed for that reason. The website itself is public either way.

1. Create a free GitHub account and a **new public repository**.
2. Unzip this project. On the new repository page click **uploading an existing file** and drag in the *contents* of the unzipped folder, then **Commit changes**.
3. Check that the repo has a folder `.github/workflows` containing `pages.yml`. Folders starting with a dot are hidden on some computers, so if it did not upload: click **Add file → Create new file**, type `.github/workflows/pages.yml` as the name, paste the contents of that file from this zip, and commit.
4. In the repo go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
5. Open the **Actions** tab. The "Deploy to GitHub Pages" run takes about a minute (it also runs the tests). When it is green, your app is at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`. Re-run it from the Actions tab (*Run workflow*) if it did not start by itself after step 4.

### Option B: Vercel / Netlify / Cloudflare Pages (works with a private repository)
Sign in with GitHub, import the repository and deploy. Settings: build command `npm run build`, output folder `web/dist` (Vercel reads these from the included `vercel.json`). Vercel's free Hobby plan is meant for personal, non-commercial projects.

### Can't upload folders? Use the flat website files
`npm run build:flat` builds the whole website as 8 loose files with no sub-folders (`web/dist-flat`). Upload just those files to a public GitHub repository, then **Settings → Pages → Deploy from a branch → main / (root)**. This route needs no GitHub Actions and no Node on your side. (Redeploying means uploading the new set of files; delete the old `index-….js`, `export-….js`, `index-….css` and font files first, because their names change.)

### Put it on the phone
Open the address in Chrome (Android: menu → *Install app* / *Add to Home Screen*) or Safari (iPhone: Share → *Add to Home Screen*) and then always open it from the home-screen icon.

Updating later: upload the changed files to GitHub; the site redeploys. Redeploying never touches your data, because the data lives on the device, not on the host.

## Important notes about the stored data
- Data is tied to the **address and device**: opening the app at a different address, in a different browser, or on another phone starts empty. Restore a backup file there to move your data.
- Clearing the browser's "site data" or uninstalling the home-screen app deletes it. **Keep a backup.**
- Safari on iPhone may delete data of websites that are not used for about a week *unless the app is added to the Home Screen*. Install it and keep backups.
- The Settings page tells you whether the browser is saving data and whether it has agreed to keep it. In private/incognito windows nothing is saved.
- Back up before changing phones, clearing the browser, or erasing anything. Sending the backup file to yourself on Messenger or email is a fine place to keep it.

## Run it on your own computer
```bash
npm install
npm run dev          # http://localhost:5173
npm test             # calculation rules, split shifts, pooled OT, backup/restore, Excel structure
npm run build && npm run preview   # production build
```
Needs Node 20 or newer.

## Rules implemented
- Hours = time out minus time in, past midnight handled; pay is rounded to cents per shift; hours keep full precision (shown as 0.00 in Excel).
- OT is pooled on the single company account: if the combined OT hours in an offer reach its minimum, the qualified rate applies to every OT hour in the offer; otherwise OT is paid at each worker's regular rate (or the offer's override).
- OT counts for the shift's start date, and the per-shift cap applies to the whole company shift.
- Excel grand total = regular pay + all OT rows + all review bonuses (fixes the original `SUM(K2:K29)` range).
