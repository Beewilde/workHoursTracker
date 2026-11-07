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
// Shared PAID lunch: a full shift is 8 worked hours plus 1 hour of lunch that is paid at the same rate.
// The lunch time is split EQUALLY between the workers who worked that day and ADDED to their time
// (2 workers: +30 min each, 3 workers: +20 min each). Training hours get no lunch.
//   cfg: { auto, minutes, threshold, from, override, date }
//   override = lunch hours entered by hand for that day ('' / null = automatic)
export function lunchPlan(entries, cfg = {}) {
  const { auto = true, minutes = 60, threshold = 8, from = null, override = null, date = null } = cfg
  const worked = entries.filter((e) => e.status === 'worked' && spanMin(e.time_in, e.time_out) > 0)
  const elapsed = worked.reduce((s, e) => s + spanMin(e.time_in, e.time_out), 0) / 60
  const none = { totalMin: 0, perMin: 0, n: worked.length, elapsed, source: 'none' }
  if (!worked.length) return none
  if (from && date && date < from) return { ...none, source: 'before-start' }
  const manual = override !== null && override !== undefined && override !== '' && Number.isFinite(Number(override))
  let totalMin = 0, source = 'none'
  if (manual) { totalMin = Number(override) * 60; source = 'manual' }
  else if (auto && elapsed >= threshold - 1e-9) { totalMin = minutes; source = 'auto' }
  return { totalMin, perMin: totalMin / worked.length, n: worked.length, elapsed, source }
}
// paid hours of one entry = worked time + its share of the paid lunch
export const paidHours = (e, plan) => {
  const el = e && (e.status === 'worked' || e.status === 'training') ? spanMin(e.time_in, e.time_out) / 60 : 0
  return e && e.status === 'worked' && plan ? el + plan.perMin / 60 : el
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

// Pooled OT: the minimum is measured on ALL workers' OT hours in the offer.
export function evalOffers(offers, entries, ratesByWorker, today) {
  const stats = {}, byEntry = {}
  for (const o of offers) {
    const list = entries
      .filter((e) => e.ot_offer_id === o.id && e.ot_hours > 0)
      .sort((a, b) => a.date.localeCompare(b.date) || (toMin(a.ot_start) ?? 0) - (toMin(b.ot_start) ?? 0) || a.id - b.id)
    const total = list.reduce((s, e) => s + e.ot_hours, 0)
    const final = today > o.end_date
    const qualified = total >= o.min_hours
    let cum = 0
    for (const e of list) {
      const base = o.below_min_rate ?? rateOn(ratesByWorker[e.worker_id], e.date)
      let pay
      if (o.tier_mode === 'marginal') {
        const under = Math.max(0, Math.min(e.ot_hours, o.min_hours - cum))
        pay = under * base + (e.ot_hours - under) * o.qualified_rate
      } else pay = e.ot_hours * (qualified ? o.qualified_rate : base)
      cum += e.ot_hours
      byEntry[e.id] = { otPay: r2(pay), otRate: pay / e.ot_hours, provisional: !final }
    }
    stats[o.id] = { total, min: o.min_hours, qualified, final, remaining: Math.max(0, o.min_hours - total) }
  }
  return { stats, byEntry }
}

export function monthReport({ month, workers, rates, entries, offers, bonuses, today, lunch = null, accountDays = {} }) {
  const { stats, byEntry } = evalOffers(offers, entries, rates, today)
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
      const lp = e && e.status === 'worked' ? planFor(date) : null
      const lunchMin = lp ? lp.perMin : 0
      const hours = elapsed + lunchMin / 60
      const rate = e?.rate_override ?? rateOn(rates[w.id], date)
      const ot = e && byEntry[e.id]
      return {
        date, entryId: e?.id ?? null, status: e ? e.status : 'not_logged',
        time_in: e?.time_in ?? null, time_out: e?.time_out ?? null,
        hours, elapsed, lunchMin, rate, pay: r2(hours * rate),
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
      rows, bonuses: bs, shifts: rows.filter((r) => r.hours > 0).length,
      regularHours: sum('hours'), lunchHours: sum('lunchMin') / 60, otHours: sum('ot_hours'), regularPay, otPay, bonusTotal,
      restDays: rows.filter((r) => r.status === 'rd').length,
      trainingHours: rows.filter((r) => r.status === 'training').reduce((s, r) => s + r.hours, 0),
      notLogged: rows.filter((r) => r.status === 'not_logged').length,
      total: r2(regularPay + otPay + bonusTotal),
    }
  }
  return { report, stats }
}
