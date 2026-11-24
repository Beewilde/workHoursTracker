# Shiftly — setup guide

Shiftly is an Android and iPhone app (built with Capacitor from this React code). Each phone keeps its own copy of the records, so it works without signal. With **Family sync** on, every change also goes to your Supabase project and reaches the other phones.

You only do steps 1–3 once. Step 4 is how you put a new version on the phones.

---

## 1. Install the tools (on your computer)

| What | Why | Get it |
|---|---|---|
| Node.js 20 or newer | builds the app | nodejs.org |
| Android Studio | builds the Android app (.apk / .aab) | developer.android.com/studio |
| Xcode (Mac only) | builds the iPhone app | Mac App Store |

Then in this folder:

```bash
npm install            # also updates package-lock.json — commit it, the GitHub Pages build needs it
npx cap add android
npx cap add ios        # Mac only
```

## 2. Create the Supabase project (free)

1. Sign up at supabase.com and click **New project**. Pick the region closest to you (Singapore for the Philippines).
2. **SQL Editor → New query**: run the files in `supabase/migrations/` in order: `0001_init.sql`, then `0002_harden.sql`, then `0003_policies.sql`. (Already done for the `shiftly` project.)
3. **Authentication → Sign In / Providers → Email**: keep it on and turn **Confirm email** off. The app signs in with **email + password**, so Supabase never needs to send an email (the free plan only lets you edit email templates after you connect your own email sender).
4. **Forgotten password:** in **Authentication → Users**, delete that user. They create the account again with a new password and join with the family's invite code. No records are lost, because records belong to the family, not to the login. Signed-in users can change their password under Family sync → Your account.
5. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

Then create `.env` in this folder (copy `.env.example`):

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

The anon key is meant to sit inside the app; row-level security keeps each family's data private. **Never** use the `service_role` key in the app.

### Keep the free project awake
Supabase pauses free projects after 7 days without activity. `.github/workflows/keep-alive.yaml` pings it once a day. In GitHub go to **Settings → Secrets and variables → Actions** and add the secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The website build uses the same two secrets.

### Backups
The free plan has no automatic database backups. Every phone already holds a full copy, and **Import / Export → Backup** still works. Download one now and then.

## 3. First run

1. Build and install on **your** phone (step 4). Open **More → Family sync**, create an account (email + password), then **Create family**. If this phone already has records from the old web version (use Restore backup first), they're uploaded.
2. On each other phone: install the app, go to **More → Family sync**, create an account with **their own** email and password, and enter the **invite code** shown on your phone. Their phone downloads the family's records.

## 4. Build and install

### Android
```bash
npm run android        # builds, copies into the Android project, opens Android Studio
```
- Testing: plug in the phone (USB debugging on) and press ▶ Run in Android Studio. Or run `npm run android:run`.
- Share with family without the Play Store: **Build → Generate Signed App Bundle / APK → APK**, then send the .apk. They have to allow "Install unknown apps".
- Google Play: create a Play Console account ($25 one-time fee) and upload a signed **.aab** to the **Internal testing** track. Up to 100 testers you add by email install it from the Play Store, with no 14-day closed test needed. A public production release from a new personal account first needs a 14-day closed test with 12 testers.

### iPhone (needs a Mac)
```bash
npm run ios            # opens Xcode
```
- Your own iPhone: plug it in, choose your Apple ID under Signing & Capabilities, and Run. With a free Apple ID the app stops opening after 7 days and must be re-installed.
- Family iPhones: you need the Apple Developer Program ($99/year). Then upload to **TestFlight** and invite them. Each TestFlight build works for 90 days, so upload a fresh one before it expires.
- No Mac or no Apple fee: iPhone users can open the website version (GitHub Pages), tap Share → **Add to Home Screen**, and use Family sync from there. It's the same app and the same family data.

### App icon and name
`capacitor.config.json` sets the app id (`com.beewilde.shiftly`) and name. **Change the id before your first Play/App Store upload**, because it can never change after that. To make icons from `web/public/icon-512.png`: `npx @capacitor/assets generate`.

## How pay is worked out

- **Shift:** set per month in Settings (default 4pm–1am = 9 paid hours, lunch included). New months copy the last one.
- **Logging a day:** enter who covered which part of the shift, as times or with **Enter hours only** (times are filled in from the shift start, in order). The parts should add up to the shift. If they don't, the app warns you.
- **Lunch hour:** the shift pays 8 hours of work + 1 paid lunch hour. Enter **work hours** (4h + 4h), and the lunch is added on top: +30 min each by default. If you enter **times that include the lunch** (4:00–8:30 + 8:30–1:00), the app sees that and takes the hour out first, so it's never paid twice. On any day you can give the lunch to **one person** instead (e.g. ate, when she does the calls) or set **custom** minutes. Whoever gets it, nobody else does.
- **Account owner:** set under Workers & Rates. Review bonuses go to the owner by default, and the owner gets the one-tap lunch option. The owner can also log shift hours like anyone else.
- **OT:** log it on any day, as after-shift hours or as **RD OT** on a rest day. Everyone's OT is added up:
  - OT on days covered by an **OT offer that has its own minimum** counts toward that offer.
  - All other OT counts toward the **month's minimum** (Settings → this month).
  - Minimum reached → **every** OT hour in that group is paid the OT rate. Below it → the regular rate. OT stays "provisional" until the offer or month is over.
- **Leave:** "Mark as leave (no work)" on the day. Nobody is paid, and it doesn't count as a missing day.
- **Older records** (before this version) keep the old rule, where the lunch was added on top of the times, so their totals don't change.

## How sync behaves (so nothing surprises you)

- Every phone saves first, then uploads a few seconds later. Other phones pick changes up every minute, when the app is opened, or when they get signal back.
- If two phones edit **the same worker on the same day** while both are offline, the one that syncs **last** wins.
- **Marked paid** months are locked on the server too. If someone edits a paid month while offline, the server refuses that change when it arrives. Their phone switches back to the family version and shows why.
- **Erase all data** and **Restore backup** only affect that phone. The next sync merges with the family copy; it never deletes the family's records.
- **Sign out** keeps the records on the phone and stops syncing.

## Tests

```bash
npm test               # pay rules, engine, Excel export, the bug fixes, and sync (two simulated phones)
```
