// Pure calculation logic shared by the server (API + Excel export) and the web app.
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
export const toMin = (t) => {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
export const fmtMin = (m) => {
  m = ((Math.round(m) % 1440) + 1440) % 1440
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
}
// minutes from time-in to time-out; a time-out at/before time-in means next day
export const spanMin = (tin, tout) => {
  const a = toMin(tin), b = toMin(tout)
  return a == null || b == null ? 0 : (b - a + 1440) % 1440
}
export const regHours = (e) =>
  e && (e.status === 'worked' || e.status === 'training') ? spanMin(e.time_in, e.time_out) / 60 : 0
// ── Paid lunch ──
// TWO ways a day can be written down (settings.lunch_inside picks one, from settings.lunch_inside_from):
//
// "inside" (current): the logged times already CONTAIN the lunch hour, e.g. 4pm–8:30pm + 8:30pm–1am
//   for a 4pm–1am shift (9 paid hours = 8 work + 1 lunch). The day's total stays exactly the covered
//   time; lunch only decides WHO gets that hour. It is taken out of everyone's time in proportion to
//   how long they covered, then given back by the split the workers agreed on (equal by default,
//   custom minutes per person, or all to one person such as the account owner).
//
// "added" (older records): the times are real work only and the lunch hour is ADDED on top:
// Shared PAID lunch: a full shift is 8 worked hours plus 1 hour of lunch that is paid at the same rate.
// By default the lunch hour is split EQUALLY between the workers who worked that day and ADDED to their time
// (2 workers: +30 min each, 3 workers: +20 min each). Training and rest-day OT get no automatic lunch.
// The owner can also GIVE lunch minutes to specific people (entry.lunch_min, even someone who did not work):
// those minutes are taken out of the day's lunch pool and the rest is split between everyone left on automatic.
//   cfg: { auto, minutes, threshold, from, override, date }; override = lunch hours for the day ('' = automatic)
const hasMan = (e) => e.lunch_min !== null && e.lunch_min !== undefined && e.lunch_min !== '' && Number.isFinite(Number(e.lunch_min))
//   cfg also takes { inside, insideFrom } for the "inside" way.
export const lunchInside = (cfg = {}, date = null) => !!cfg.inside && !(cfg.insideFrom && date && date < cfg.insideFrom)
export function lunchPlan(entries, cfg = {}) {
  const { auto = true, minutes = 60, threshold = 8, from = null, override = null, date = null } = cfg
  const inside = lunchInside(cfg, date)
  const worked = entries.filter((e) => e.status === 'worked' && spanMin(e.time_in, e.time_out) > 0)
  const coveredMin = worked.reduce((s, e) => s + spanMin(e.time_in, e.time_out), 0)
  const elapsed = coveredMin / 60
  const blocked = !inside && !!(from && date && date < from)
  const manualOverride = override !== null && override !== undefined && override !== '' && Number.isFinite(Number(override))
  let pool = 0, source = 'none'
  if (blocked) source = 'before-start'
  else if (manualOverride) { pool = Number(override) * 60; source = 'manual' }
  else if (inside ? auto && worked.length : auto && worked.length && elapsed >= threshold - 1e-9) { pool = minutes; source = 'auto' }
  if (inside) pool = Math.min(pool, coveredMin)          // the lunch can't be longer than the time that was covered
  const givenTo = blocked ? [] : entries.filter(hasMan)
  const given = givenTo.reduce((s, e) => s + Number(e.lunch_min), 0)
  const autoWorkers = worked.filter((e) => !hasMan(e))
  const perMin = autoWorkers.length ? Math.max(0, pool - given) / autoWorkers.length : 0
  // minutes of lunch credited to this person
  const minFor = (e) => (!e || blocked ? 0 : hasMan(e) ? Number(e.lunch_min) : e.status === 'worked' ? perMin : 0)
  // "inside": minutes of lunch taken out of this person's covered time (in proportion to it)
  const deductFor = (e) => (inside && e && e.status === 'worked' && coveredMin > 0 ? (pool * spanMin(e.time_in, e.time_out)) / coveredMin : 0)
  // what lunch changes for this person, in minutes (negative = they covered the lunch and it went to others)
  const adjFor = (e) => minFor(e) - deductFor(e)
  return {
    poolMin: pool, totalMin: given + perMin * autoWorkers.length, perMin, n: worked.length, autoN: autoWorkers.length,
    givenMin: given, givenN: givenTo.length, elapsed, source, inside, overGiven: inside && given > pool + 1e-9, minFor, deductFor, adjFor,
  }
}
// paid hours of one entry = covered time + what the lunch split changes for it
export const paidHours = (e, plan) => {
  const el = e && (e.status === 'worked' || e.status === 'training') ? spanMin(e.time_in, e.time_out) / 60 : 0
  return el + (e && plan ? plan.adjFor(e) / 60 : 0)
}

export const rateOn = (rates = [], date) => {
  let r = rates.length ? rates[0].rate : 0
  for (const x of rates) if (x.effective_from <= date) r = x.rate
  return r
}
export const daysInMonth = (month) => {
  const [y, m] = month.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}
export const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay()

// How the day's regular blocks fit together (the company sees ONE person).
export function coverage(blocks) {
  const bs = blocks
    .map((b) => ({ ...b, s: toMin(b.time_in), d: spanMin(b.time_in, b.time_out) }))
    .filter((b) => b.d > 0)
  if (!bs.length) return { status: 'empty', gap: 0, overlap: 0, start: null, end: null, hours: 0 }
  let best = null
  for (const c of bs) {
    const arr = bs.map((b) => {
      const ns = (b.s - c.s + 1440) % 1440
      return { ...b, ns, ne: ns + b.d }
    })
    const win = Math.max(...arr.map((a) => a.ne))
    if (!best || win < best.win) best = { win, ref: c.s, arr }
  }
  const arr = best.arr.sort((a, b) => a.ns - b.ns)
  let gap = 0, overlap = 0, cursor = arr[0].ne
  for (let i = 1; i < arr.length; i++) {
    if (arr[i].ns > cursor) gap += arr[i].ns - cursor
    else overlap += Math.min(cursor, arr[i].ne) - arr[i].ns
    cursor = Math.max(cursor, arr[i].ne)
  }
  return {
    status: overlap > 0 ? 'overlap' : gap > 0 ? 'gap' : 'ok',
    gap, overlap, start: best.ref, end: best.ref + best.win,
    hours: bs.reduce((s, b) => s + b.d, 0) / 60,
  }
}

// OT continues the account's shift (after) or precedes it (before); slices are in time order.
export function deriveOT(cov, position, hoursList) {
  if (cov.start == null) return hoursList.map(() => ({ ot_start: null, ot_end: null }))
  const total = hoursList.reduce((a, b) => a + b, 0) * 60
  let cursor = position === 'before' ? cov.start - total : cov.end
  return hoursList.map((h) => {
    const s = cursor
    cursor += h * 60
    return { ot_start: fmtMin(s), ot_end: fmtMin(cursor) }
  })
}

// ── Pooled OT ──
// The company sees ONE person (the account), so OT minimums count EVERYONE's OT hours together.
// Each OT hour belongs to one pool:
//   • an OT offer (announcement) that has its OWN minimum → that offer's pool, its minimum and rate
//   • otherwise → the MONTH's pool, with the minimum and OT rate set for that month
// Minimum reached → every hour in the pool is paid the OT rate. Below it → each worker's regular rate
// (or the offer's below_min_rate). Pay stays provisional until the offer / month is over.
//   monthCfg(month) → { ot_min, ot_rate }   (null/0 minimum = no minimum)
const lastDay = (month) => daysInMonth(month).at(-1)
export const hasOwnMin = (o) => o && o.min_hours !== null && o.min_hours !== undefined && o.min_hours !== ''
export function evalOffers(offers, entries, ratesByWorker, today, monthCfg = () => ({})) {
  const stats = {}, monthStats = {}, byEntry = {}, pools = new Map()
  const byId = new Map(offers.map((o) => [o.id, o]))
  for (const e of entries) {
    if (!(e.ot_hours > 0)) continue
    const o = byId.get(e.ot_offer_id)
    const key = hasOwnMin(o) ? 'o:' + o.id : 'm:' + e.date.slice(0, 7)
    if (!pools.has(key)) pools.set(key, [])
    pools.get(key).push(e)
  }
  for (const o of offers) if (hasOwnMin(o) && !pools.has('o:' + o.id)) pools.set('o:' + o.id, [])
  for (const [key, list] of pools) {
    const isOffer = key.startsWith('o:'), id = key.slice(2)
    const o = isOffer ? offers.find((x) => String(x.id) === id) : null
    const cfg = isOffer ? null : monthCfg(id) || {}
    const min = Number(isOffer ? o.min_hours : cfg.ot_min) || 0
    const final = today > (isOffer ? o.end_date : lastDay(id))
    list.sort((a, b) => a.date.localeCompare(b.date) || (toMin(a.ot_start) ?? 0) - (toMin(b.ot_start) ?? 0) || String(a.id).localeCompare(String(b.id)))
    const total = list.reduce((s, e) => s + e.ot_hours, 0)
    const qualified = total >= min - 1e-9
    let cum = 0
    for (const e of list) {
      const eo = byId.get(e.ot_offer_id)                 // an offer without its own minimum can still set the rate
      const otRate = Number(eo?.qualified_rate ?? cfg?.ot_rate ?? 0)
      const base = (isOffer ? o.below_min_rate : eo?.below_min_rate) ?? rateOn(ratesByWorker[e.worker_id], e.date)
      let pay
      if (isOffer && o.tier_mode === 'marginal') {
        const under = Math.max(0, Math.min(e.ot_hours, min - cum))
        pay = under * base + (e.ot_hours - under) * otRate
      } else pay = e.ot_hours * (qualified ? otRate : base)
      cum += e.ot_hours
      byEntry[e.id] = { otPay: r2(pay), otRate: pay / e.ot_hours, provisional: !final, pool: key }
    }
    const st = { total, min, qualified, final, remaining: Math.max(0, min - total) }
    if (isOffer) stats[o.id] = st; else monthStats[id] = { ...st, rate: Number(cfg.ot_rate ?? 0) }
  }
  return { stats, monthStats, byEntry }
}

export function monthReport({ month, workers, rates, entries, offers, bonuses, today, lunch = null, accountDays = {}, monthCfg = () => ({}) }) {
  const { stats, monthStats, byEntry } = evalOffers(offers, entries, rates, today, monthCfg)
  const dates = daysInMonth(month)
  const report = {}
  const byDate = new Map()
  for (const e of entries) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e) }
  const planFor = (date) => lunch && lunchPlan(byDate.get(date) || [], { ...lunch, override: accountDays?.[date]?.lunch_hours, date })
  for (const w of workers) {
    const map = Object.fromEntries(entries.filter((e) => e.worker_id === w.id).map((e) => [e.date, e]))
    const rows = dates.map((date) => {
      const e = map[date]
      const elapsed = regHours(e)
      const lp = e ? planFor(date) : null
      const lunchMin = lp ? lp.adjFor(e) : 0                 // what the lunch split changed, in minutes (can be negative)
      const lunchShare = lp ? lp.minFor(e) : 0
      const hours = elapsed + lunchMin / 60
      const rate = e?.rate_override ?? rateOn(rates[w.id], date)
      const ot = e && byEntry[e.id]
      return {
        date, entryId: e?.id ?? null, status: e ? e.status : 'not_logged',
        time_in: e?.time_in ?? null, time_out: e?.time_out ?? null,
        hours, elapsed, lunchMin, lunchShare, rate, pay: r2(hours * rate),
        ot_hours: e?.ot_hours || 0, ot_start: e?.ot_start ?? null, ot_end: e?.ot_end ?? null,
        otRate: ot?.otRate ?? 0, otPay: ot?.otPay ?? 0, provisional: ot?.provisional ?? false,
        offerId: e?.ot_offer_id ?? null, override: e?.rate_override != null,
        reason: e?.rate_override_reason ?? null, remark: e?.remark ?? null,
      }
    })
    const bs = bonuses.filter((b) => b.worker_id === w.id && b.pay_month === month)
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0)
    const regularPay = r2(sum('pay')), otPay = r2(sum('otPay')), bonusTotal = r2(bs.reduce((s, b) => s + b.amount, 0))
    report[w.id] = {
      rows, bonuses: bs, shifts: rows.filter((r) => r.elapsed > 0).length,
      regularHours: sum('hours'), lunchHours: sum('lunchShare') / 60, otHours: sum('ot_hours'), regularPay, otPay, bonusTotal,
      restDays: rows.filter((r) => r.status === 'rd').length,
      trainingHours: rows.filter((r) => r.status === 'training').reduce((s, r) => s + r.hours, 0),
      notLogged: rows.filter((r) => r.status === 'not_logged').length,
      total: r2(regularPay + otPay + bonusTotal),
    }
  }
  return { report, stats, monthStats }
}
