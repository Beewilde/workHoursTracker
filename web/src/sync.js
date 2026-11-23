// Two-way sync between this phone's copy of the data (the engine state) and Supabase.
//
// The app always reads and writes its local copy, so it works with no signal. sync():
//   1. PULL  rows (and deletions) changed on the server since the last sync and merge them in.
//            A row this phone changed and has not uploaded yet is left alone: it wins in step 2.
//   2. PUSH  every local row that differs from what the server last confirmed, and every
//            deletion. The server can refuse a row (e.g. a paid-month lock); then this phone
//            takes the server's version and the refusal is reported.
// "What the server last confirmed" is `base`: a fingerprint per row, kept in the sync meta.
// Conflicts resolve as "the phone that syncs last wins", which is fine for a family of 3–7.

export const ENTRY_COLS = ['status', 'time_in', 'time_out', 'lunch_min', 'ot_hours', 'ot_start', 'ot_end', 'ot_position', 'ot_offer_id', 'rate_override', 'rate_override_reason', 'remark']

// table -> how its rows are keyed, which columns sync, and where they live in the state.
// Order = upload order (parents first; payouts last so a "paid" lock never blocks its own month).
export const TABLES = {
  workers:      { key: ['id'], cols: ['id', 'name', 'color', 'active', 'owner'] },
  worker_rates: { key: ['worker_id', 'effective_from'], cols: ['worker_id', 'effective_from', 'rate'] },
  ot_offers:    { key: ['id'], cols: ['id', 'name', 'start_date', 'end_date', 'cap_hours', 'min_hours', 'qualified_rate', 'below_min_rate', 'tier_mode', 'day_caps', 'notes'] },
  entries:      { key: ['worker_id', 'date'], cols: ['id', 'worker_id', 'date', ...ENTRY_COLS] },
  bonuses:      { key: ['id'], cols: ['id', 'worker_id', 'review_date', 'pay_month', 'reference', 'note', 'chat_time', 'amount'] },
  account_days: { key: ['date'], cols: ['date', 'company_hours', 'lunch_hours', 'note', 'day_off'] },
  schedules:    { key: ['month'], cols: ['month', 'weekdays', 'shift_start', 'shift_end', 'ot_min', 'ot_rate'] },   // month settings
  payouts:      { key: ['month', 'worker_id'], cols: ['worker_id', 'month', 'total', 'snapshot', 'paid_at'] },
}
const NAMES = Object.keys(TABLES)
const TIME_COLS = new Set(['time_in', 'time_out', 'ot_start', 'ot_end', 'chat_time', 'shift_start', 'shift_end'])
const NUM_COLS = new Set(['rate', 'cap_hours', 'min_hours', 'qualified_rate', 'below_min_rate', 'lunch_min', 'ot_hours', 'rate_override', 'amount', 'company_hours', 'lunch_hours', 'total', 'ot_min', 'ot_rate'])
const LOCAL_ONLY_SETTINGS = []          // every setting is shared by the family

const keyOf = (t, r) => TABLES[t].key.map((k) => String(r[k])).join('|')
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v
// one canonical shape for a row, whether it came from this phone or from Postgres
export function normalize(t, r) {
  const o = {}
  for (const c of TABLES[t].cols) {
    let v = r[c]
    if (v === undefined || v === '') v = null
    if (v != null && TIME_COLS.has(c)) v = String(v).slice(0, 5)             // Postgres sends 16:00:00
    if (v != null && NUM_COLS.has(c)) v = Number(v)
    if (c === 'active') v = v !== false
    if (c === 'owner') v = !!v
    if (c === 'day_caps' || c === 'snapshot') v = sortKeys(v || {})
    if (c === 'weekdays') v = [...(v || [])].map(Number).sort()
    if (c === 'paid_at' && v) v = new Date(v).toISOString()
    o[c] = v
  }
  return o
}
const fp = (t, r) => JSON.stringify(normalize(t, r))

// state -> { table: Map(key -> normalized row) }
export function localRows(S) {
  const out = Object.fromEntries(NAMES.map((t) => [t, new Map()]))
  const put = (t, r) => { const n = normalize(t, r); out[t].set(keyOf(t, n), n) }
  S.workers.forEach((r) => put('workers', r))
  S.rates.forEach((r) => put('worker_rates', r))
  S.offers.forEach((r) => put('ot_offers', r))
  S.entries.forEach((r) => put('entries', r))
  S.bonuses.forEach((r) => put('bonuses', r))
  Object.values(S.accountDays || {}).forEach((r) => put('account_days', r))
  Object.entries(S.schedules || {}).forEach(([month, v]) => put('schedules', { month, ...(Array.isArray(v) ? { weekdays: v } : v) }))
  for (const [k, v] of Object.entries(S.paid || {})) {
    const [month, worker_id] = k.split('|'), snap = typeof v === 'string' ? { at: v } : v
    put('payouts', { month, worker_id, total: snap.total ?? 0, snapshot: snap, paid_at: snap.at })
  }
  return out
}

// write one server row into the state (or remove it when row is null)
function applyRow(S, t, key, row) {
  const byKey = (arr) => arr.findIndex((x) => keyOf(t, normalize(t, x)) === key)
  const upsert = (name, value) => { const i = byKey(S[name]); if (value == null) { if (i >= 0) S[name].splice(i, 1) } else if (i >= 0) S[name][i] = { ...S[name][i], ...value }; else S[name].push(value) }
  switch (t) {
    case 'workers': return upsert('workers', row)
    case 'worker_rates': return upsert('rates', row)
    case 'ot_offers': return upsert('offers', row)
    case 'entries': return upsert('entries', row)
    case 'bonuses': return upsert('bonuses', row)
    case 'account_days': if (row) S.accountDays[key] = row; else delete S.accountDays[key]; return
    case 'schedules': if (row) { const { month: _m, ...v } = row; S.schedules[key] = v } else delete S.schedules[key]; return
    case 'payouts': if (row) S.paid[key] = { ...row.snapshot, at: row.paid_at }; else delete S.paid[key]; return
  }
}
const settingsOf = (S) => sortKeys(Object.fromEntries(Object.entries(S.settings).filter(([k]) => !LOCAL_ONLY_SETTINGS.includes(k))))

/**
 * createSync({ client, getState, persist, meta, saveMeta })
 *   client   – a supabase-js client (signed in)
 *   getState – () => the engine state object (mutated in place)
 *   persist  – (state) => void, saves the state on the phone and refreshes the screens
 *   meta     – { household_id, cursor, base, settingsFp }  (stored by the caller)
 */
export function createSync({ client, getState, persist, meta, saveMeta, now = () => Date.now() }) {
  let running = null
  const status = { state: 'idle', lastSyncAt: meta.lastSyncAt || null, error: null, rejected: [] }
  const listeners = new Set()
  const emit = () => listeners.forEach((f) => f({ ...status }))
  meta.base ||= {}; NAMES.forEach((t) => (meta.base[t] ||= {}))
  const hh = () => meta.household_id
  const q = (t) => client.from(t)
  const must = ({ data, error }) => { if (error) throw Object.assign(new Error(error.message), { code: error.code }); return data }

  // Supabase returns at most 1000 rows per request, so read in pages
  async function selectAll(build, orderCol) {
    const out = []
    for (let from = 0; ; from += 1000) {
      const page = must(await build().order(orderCol).range(from, from + 999))
      out.push(...page)
      if (page.length < 1000) return out
    }
  }

  async function fetchRow(t, key) {
    const vals = key.split('|'), cols = TABLES[t].key
    let qb = q(t).select('*').eq('household_id', hh())
    cols.forEach((c, i) => (qb = qb.eq(c, vals[i])))
    return (must(await qb))[0] || null
  }

  async function pull(S) {
    // re-read a minute of overlap: a row committed late with an older timestamp is not missed
    const since = meta.cursor ? new Date(Date.parse(meta.cursor) - 60_000).toISOString() : null
    let maxTs = meta.cursor, changed = false
    const local = localRows(S)
    const seenTs = (ts) => { if (ts && (!maxTs || ts > maxTs)) maxTs = ts }
    for (const t of NAMES) {
      const build = () => { const qb = q(t).select('*').eq('household_id', hh()); return since ? qb.gt('updated_at', since) : qb }
      for (const raw of await selectAll(build, 'updated_at')) {
        seenTs(raw.updated_at)
        const row = normalize(t, raw), k = keyOf(t, row), h = JSON.stringify(row)
        const mine = local[t].get(k), base = meta.base[t][k]
        const pendingEdit = mine && JSON.stringify(mine) !== base
        const pendingDelete = !mine && base !== undefined
        if (pendingEdit || pendingDelete) continue                                   // my unsent change wins
        if (mine && JSON.stringify(mine) === h) { meta.base[t][k] = h; continue }
        applyRow(S, t, k, row); meta.base[t][k] = h; changed = true
      }
    }
    const tomb = () => { const qb = q('tombstones').select('*').eq('household_id', hh()); return since ? qb.gt('deleted_at', since) : qb }
    for (const d of await selectAll(tomb, 'deleted_at')) {
      seenTs(d.deleted_at)
      if (!TABLES[d.tbl]) continue
      const mine = local[d.tbl].get(d.key), base = meta.base[d.tbl][d.key]
      if (mine && base !== undefined && JSON.stringify(mine) !== base) continue      // edited here since: keep it
      if (mine && base === undefined) continue                                       // made here, never uploaded
      if (mine) { applyRow(S, d.tbl, d.key, null); changed = true }
      delete meta.base[d.tbl][d.key]
    }
    // shared settings
    let hq = q('households').select('*').eq('id', hh())
    if (since) hq = hq.gt('updated_at', since)
    const [house] = must(await hq)
    if (house) {
      seenTs(house.updated_at)
      const remote = sortKeys(house.settings || {}), rfp = JSON.stringify(remote)
      const localFp = JSON.stringify(settingsOf(S))
      const pending = meta.settingsFp !== undefined && localFp !== meta.settingsFp
      if (!pending && rfp !== localFp && Object.keys(remote).length) { S.settings = { ...S.settings, ...remote }; changed = true }
      if (!pending) meta.settingsFp = rfp                    // what the server holds; push sends ours if it differs
    }
    meta.cursor = maxTs
    return changed
  }

  async function push(S) {
    const local = localRows(S), rejected = []
    let reverted = false
    const ups = Object.fromEntries(NAMES.map((t) => [t, [...local[t]].filter(([k, r]) => meta.base[t][k] !== JSON.stringify(r))]))
    const dels = Object.fromEntries(NAMES.map((t) => [t, Object.keys(meta.base[t]).filter((k) => !local[t].has(k))]))
    const revert = async (t, k, err) => {
      rejected.push({ table: t, key: k, message: err.message })
      const srv = await fetchRow(t, k)
      applyRow(S, t, k, srv && normalize(t, srv))
      if (srv) meta.base[t][k] = fp(t, srv); else delete meta.base[t][k]
      reverted = true
    }
    const del = async (t, k) => {
      const vals = k.split('|')
      let qb = q(t).delete().eq('household_id', hh())
      TABLES[t].key.forEach((c, i) => (qb = qb.eq(c, vals[i])))
      const { error } = await qb
      if (error) await revert(t, k, error); else delete meta.base[t][k]
    }
    // un-marking "paid" goes first, so edits to that month are allowed afterwards
    for (const k of dels.payouts) await del('payouts', k)
    // children of a deleted row go before it
    for (const t of ['entries', 'bonuses', 'worker_rates', 'account_days', 'schedules']) for (const k of dels[t]) await del(t, k)
    for (const t of NAMES) {
      if (!ups[t].length) continue
      const body = ups[t].map(([, r]) => ({ ...r, household_id: hh() }))
      const { error } = await q(t).upsert(body, { onConflict: TABLES[t].key.join(',') })
      if (!error) { ups[t].forEach(([k, r]) => (meta.base[t][k] = JSON.stringify(r))); continue }
      // one bad row fails the whole batch: retry one by one to find it
      for (const [k, r] of ups[t]) {
        const one = await q(t).upsert([{ ...r, household_id: hh() }], { onConflict: TABLES[t].key.join(',') })
        if (one.error) await revert(t, k, one.error); else meta.base[t][k] = JSON.stringify(r)
      }
    }
    for (const t of ['ot_offers', 'workers']) for (const k of dels[t]) await del(t, k)
    const sfp = JSON.stringify(settingsOf(S))
    if (sfp !== meta.settingsFp) {
      const { error } = await q('households').update({ settings: settingsOf(S), timezone: S.settings.timezone }).eq('id', hh())
      if (error) rejected.push({ table: 'households', key: hh(), message: error.message }); else meta.settingsFp = sfp
    }
    return { rejected, reverted }
  }

  async function run() {
    const S = getState()
    status.state = 'syncing'; status.error = null; emit()
    try {
      const pulled = await pull(S)
      if (pulled) persist(S)
      const { rejected, reverted } = await push(S)
      if (reverted) persist(S)
      status.rejected = rejected
      status.lastSyncAt = meta.lastSyncAt = new Date(now()).toISOString()
      status.state = rejected.length ? 'warning' : 'ok'
    } catch (e) {
      status.state = 'offline'; status.error = e.message
    } finally {
      saveMeta(meta); emit()
    }
    return { ...status }
  }

  return {
    status: () => ({ ...status }),
    onStatus: (f) => { listeners.add(f); return () => listeners.delete(f) },
    // several triggers (typing, timer, app resume) can ask at once: they share one run
    sync: () => (running ||= run().finally(() => { running = null })),
    meta,
  }
}
