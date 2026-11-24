# Shiftly — work hours & payout tracker

Tracks a organization's shared work-account hours, OT offers, paid lunch and review bonuses, and exports the monthly Excel invoice.

- **App:** Android and iPhone (Capacitor). Works offline.
- **Organization:** Supabase (free tier). Everyone sees the same records.
- **Website:** the same code also runs as a website (GitHub Pages), for iPhones without a store build.

Start with **[SETUP.md](SETUP.md)**.

| Folder | What's inside |
|---|---|
| `shared/` | pay rules (`calc.js`), Excel export, quick-entry parsers |
| `web/src/engine.js` | the app's logic and checks, working on the phone's copy of the data |
| `web/src/sync.js` | two-way offline-first sync with Supabase |
| `web/src/cloud.js` · `organization.jsx` | sign-in, organizations, the Organization screen |
| `supabase/migrations/` | database tables, security rules, paid-month lock |
| `test/` | `npm test` |
