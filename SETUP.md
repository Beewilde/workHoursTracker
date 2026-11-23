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
2. **SQL Editor → New query**: paste all of `supabase/migrations/0001_init.sql` and click **Run**.
3. **Authentication → Sign In / Providers → Email**: keep it on. Turn **Confirm email** off, since the 6-digit code already confirms it.
4. **Authentication → Email Templates → Magic Link**: the app signs in with a **code**, so make sure the email includes it. Replace the body with something like:
   ```html
   <h2>Your Shiftly sign-in code</h2>
   <p><strong>{{ .Token }}</strong></p>
   ```
   Note: Supabase's built-in email sender only sends a few emails per hour. That's plenty for a family. If you ever hit the limit, add your own SMTP under Authentication → SMTP Settings.
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

1. Build and install on **your** phone (step 4). Open **More → Family sync**, sign in with your email, then **Create family**. If this phone already has records from the old web version (use Restore backup first), they're uploaded.
2. On each other phone: install the app, go to **More → Family sync**, sign in with **their own** email, and enter the **invite code** shown on your phone. Their phone downloads the family's records.

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
