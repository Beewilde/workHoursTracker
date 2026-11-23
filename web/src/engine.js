// The whole "backend", running inside the browser. Same rules as the server version,
// operating on one plain object (the state) that is saved to the device after every change.
import { monthReport, coverage, deriveOT, evalOffers, rateOn, toMin, spanMin, weekday, daysInMonth, lunchPlan } from '../../shared/calc.js'
import { parseNotes } from '../../shared/parse.js'

const COLORS = ['#4169A1', '#7C6EAB', '#D08B5B', '#4E8E77', '#B5546B', '#5A9BB5']
const STATUSES = ['worked', 'rd', 'not_worked', 'training', 'rdot']
const ISO = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-\d{2}$/
const ENTRY_COLS = ['status', 'lunch_min', 'time_in', 'time_out', 'ot_hours', 'ot_start', 'ot_end', 'ot_position', 'ot_offer_id', 'rate_override', 'rate_override_reason', 'remark']
export const APP_ID = 'work-hours-tracker'
// Record ids are UUIDs so several phones can create records offline without clashing.
export const newId = () => globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16) })
const isUuid = (x) => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)
const paidAt = (v) => (v == null ? null : typeof v === 'string' ? v : v.at)

// Data saved by v1 used numbers from a counter as ids. Give every record a UUID and rewrite
// every reference to it (entries, rates, bonuses, OT links, paid keys). Safe to run twice.
export function migrateIds(S) {
  const map = new Map(), id = (old) => { if (old == null || isUuid(old)) return old; if (!map.has(old)) map.set(old, newId()); return map.get(old) }
  for (const w of S.workers || []) w.id = id(w.id)
  for (const o of S.offers || []) o.id = id(o.id)
  for (const e of S.entries || []) { e.id = id(e.id); e.worker_id = id(e.worker_id); if (e.ot_offer_id != null) e.ot_offer_id = id(e.ot_offer_id) }
  for (const r of S.rates || []) r.worker_id = id(r.worker_id)
  for (const b of S.bonuses || []) { b.id = id(b.id); b.worker_id = id(b.worker_id) }
  const paid = {}
  for (const [k, v] of Object.entries(S.paid || {})) { const [m, w] = k.split('|'); paid[`${m}|${id(isNaN(+w) ? w : +w)}`] = v }
  S.paid = paid
  delete S.seq
  for (const [m, v] of Object.entries(S.schedules || {})) if (Array.isArray(v)) S.schedules[m] = { weekdays: v }
  for (const w of S.workers || []) w.owner = !!w.owner
  S.v = 2
  return S
}

const defaultTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila' } catch { return 'Asia/Manila' } }
export const EMPTY = () => ({
  v: 2, workers: [], rates: [], entries: [], offers: [], bonuses: [], accountDays: {}, schedules: {}, paid: {}, lastBackupAt: null,
  settings: {
    timezone: defaultTz(), default_review_bonus: 10, rd_default: [3, 4], reminder_days: 30,
    lunch_rule: 3, lunch_auto: true, lunch_minutes: 60, lunch_threshold: 8, lunch_from: null, lunch_inside: true, lunch_inside_from: null,
    shift_start: '16:00', shift_end: '01:00', ot_rate: 8, ot_min: null,
    presets: [{ label: 'Evening', time_in: '20:30', time_out: '01:00' }, { label: 'Early', time_in: '16:00', time_out: '20:30' }],
  },
})

export function createEngine(state, save = () => {}) {
  const S = state
  const err = (status, message, extra) => Object.assign(new Error(message), { status, data: { error: message, ...extra } })
  const need = (c, m) => { if (!c) throw err(400, m) }
  const num = (v, name, { min = 0, max = 1e6, nullable = false } = {}) => {
    if ((v === null || v === undefined || v === '') && nullable) return null
    const x = Number(v)
    if (!Number.isFinite(x) || x < min || x > max) throw err(400, `${name} is invalid`)
    return x
  }
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: S.settings.timezone }).format(new Date())
  const ratesBy = () => { const o = {}; for (const r of [...S.rates].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) (o[r.worker_id] ||= []).push(r); return o }
  const isPaid = (month, wid) => !!S.paid[`${month}|${wid}`]
  const paidMonths = (wid) => Object.keys(S.paid).filter((k) => k.endsWith(`|${wid}`)).map((k) => k.split('|')[0]).sort()
  // every [month, worker] pair that an OT offer's entries fall in and that is already paid
  const paidUsing = (offerId) => S.entries.filter((e) => e.ot_offer_id === offerId && e.ot_hours > 0 && isPaid(e.date.slice(0, 7), e.worker_id))
  const offerFor = (date) => S.offers.find((o) => o.start_date <= date && o.end_date >= date)
  const entriesOn = (date) => S.entries.filter((e) => e.date === date)
  const lunchCfg = () => ({ auto: S.settings.lunch_auto, minutes: S.settings.lunch_minutes, threshold: S.settings.lunch_threshold, from: S.settings.lunch_from || null,
    inside: !!S.settings.lunch_inside, insideFrom: S.settings.lunch_inside_from || null })
  const monthCfg = (m) => schedule(m)
  const report = (month, workers = S.workers) => monthReport({ month, workers, rates: ratesBy(), entries: S.entries, offers: S.offers, bonuses: S.bonuses, today: today(), lunch: lunchCfg(), accountDays: S.accountDays, monthCfg })
  const shiftMin = (m) => { const c = schedule(m); return spanMin(c.shift_start, c.shift_end) }
  const isLeave = (date) => S.accountDays[date]?.day_off === 'leave'
  // Lunch rule 2 = PAID lunch added to the workers' time (8 worked hours -> lunch applies).
  // Older saved data: no lunch settings yet -> start the rule today so existing days keep their numbers;
  // rule 1 (an earlier version that deducted lunch) -> switch to rule 2 but keep its start date.
  // Rule 3 = lunch INSIDE the logged shift times (4pm–1am = 9 paid hours, lunch included).
  // Saved data from rule 2 (lunch added on top of the times) keeps its numbers: rule 3 starts today.
  function ensureLunch() {
    const st = S.settings
    if (st.lunch_rule === 3) return
    if (st.lunch_rule !== 2) {
      if (st.lunch_minutes == null) { st.lunch_auto = true; st.lunch_minutes = 60; st.lunch_from = S.entries.length ? today() : null }
      st.lunch_threshold = 8
    }
    st.lunch_rule = 3; st.lunch_inside = true; st.lunch_inside_from = S.entries.length ? today() : null
    st.shift_end ||= '01:00'; st.ot_rate ??= 8; if (st.ot_min === undefined) st.ot_min = null
    save(S)
  }
  migrateIds(S)
  ensureLunch()
  const active = () => S.workers.filter((w) => w.active)
  const capFor = (o, date) => (o.day_caps && o.day_caps[date] != null ? o.day_caps[date] : o.cap_hours)

  // Month settings: rest days, shift time, OT minimum and OT rate. A month that has not been set
  // yet copies the latest earlier month (shown as "suggested"), or the defaults in Settings.
  const MONTH_KEYS = ['weekdays', 'shift_start', 'shift_end', 'ot_min', 'ot_rate']
  function schedule(month) {
    const st = S.settings
    const base = { weekdays: st.rd_default, shift_start: st.shift_start || '16:00', shift_end: st.shift_end || '01:00', ot_min: st.ot_min ?? null, ot_rate: st.ot_rate ?? 8 }
    const earlier = Object.keys(S.schedules).filter((m) => m < month).sort()
    const from = (m) => Object.fromEntries(MONTH_KEYS.filter((k) => S.schedules[m]?.[k] !== undefined).map((k) => [k, S.schedules[m][k]]))
    let cfg = { ...base }
    for (const m of earlier) cfg = { ...cfg, ...from(m) }
    if (S.schedules[month]) return { ...cfg, ...from(month), confirmed: true }
    return { ...cfg, confirmed: false }
  }
  const workerView = (w) => { const r = ratesBy()[w.id] || []; return { ...w, rates: r, rate: rateOn(r, today()) } }

  function dayView(date) {
    const month = date.slice(0, 7), workers = active(), rep = report(month, workers), sch = schedule(month)
    const entries = entriesOn(date), rates = ratesBy(), offer = offerFor(date)
    const cov = coverage(entries.filter((e) => e.status === 'worked' || e.status === 'training'))
    const ev = evalOffers(S.offers, S.entries, rates, today(), monthCfg), stats = ev.stats
    const ownPool = offer && offer.min_hours != null
    return {
      date, month, schedule: sch, isRestDay: sch.weekdays.includes(weekday(date)), isLeave: isLeave(date),
      shift: { start: sch.shift_start, end: sch.shift_end, minutes: shiftMin(month) },
      // the pool this day's OT counts toward: the offer (if it has its own minimum) or the month
      otPool: ownPool
        ? { kind: 'offer', name: offer.name, rate: offer.qualified_rate, ...(stats[offer.id] || { total: 0, min: offer.min_hours, qualified: false, final: false, remaining: offer.min_hours }) }
        : { kind: 'month', name: month, rate: offer?.qualified_rate ?? sch.ot_rate, ...(ev.monthStats[month] || { total: 0, min: Number(sch.ot_min) || 0, qualified: !(Number(sch.ot_min) > 0), final: today() > daysInMonth(month).at(-1), remaining: Number(sch.ot_min) || 0 }) },
      ownerId: S.workers.find((w) => w.owner)?.id ?? null,
      workers: workers.map((w) => ({
        id: w.id, name: w.name, color: w.color, owner: !!w.owner, rate: rateOn(rates[w.id], date), paid: isPaid(month, w.id),
        entry: entries.find((e) => e.worker_id === w.id) || null, row: rep.report[w.id].rows.find((r) => r.date === date),
      })),
      account: S.accountDays[date] || { date, company_hours: null, lunch_hours: null, note: null, day_off: null },
      coverage: cov,
      offer: offer && { ...offer, stats: stats[offer.id], usedHours: entries.reduce((s, e) => s + (e.ot_hours || 0), 0), cap_today: capFor(offer, date) },
      presets: S.settings.presets, lunchSettings: lunchCfg(), shiftStart: sch.shift_start || '16:00',
    }
  }

  function saveDay(date, body) {
    const month = date.slice(0, 7), wmap = new Map(S.workers.map((w) => [w.id, w]))
    const input = (body.entries || []).filter((e) => e.status).map((e) => ({ ...e }))
    const seen = new Set(), existing = entriesOn(date)
    const locked = new Set(S.workers.map((w) => w.id).filter((id) => isPaid(month, id)))
    // The Daily Log only shows ACTIVE workers, so only they can be cleared by leaving them out.
    // Inactive workers' entries on this day are kept (they used to be deleted here).
    const shown = new Set(S.workers.filter((w) => w.active).map((w) => w.id))
    const keep = (x) => locked.has(x.worker_id) || !shown.has(x.worker_id)
    for (const e of input) {
      const w = wmap.get(String(e.worker_id))
      need(w, 'Unknown worker'); need(!seen.has(w.id), 'Duplicate worker in this day'); seen.add(w.id)
      need(STATUSES.includes(e.status), 'Bad status')
      e.worker_id = w.id
      const timed = e.status === 'worked' || e.status === 'training', rdot = e.status === 'rdot'
      if (timed || rdot) need(toMin(e.time_in) != null && toMin(e.time_out) != null && spanMin(e.time_in, e.time_out) > 0, `${w.name}: enter a valid time in and time out`)
      else { e.time_in = null; e.time_out = null }
      e.lunch_min = num(e.lunch_min, `${w.name}: lunch minutes`, { nullable: true, max: 600 })
      e.ot_hours = num(e.ot_hours || 0, `${w.name}: OT hours`, { max: 24 })
      e.rate_override = num(e.rate_override, `${w.name}: rate override`, { nullable: true })
      if (e.rate_override != null) need(String(e.rate_override_reason || '').trim(), `${w.name}: a reason is required for a rate override`)
      else e.rate_override_reason = null
      if (rdot) {
        // rest-day OT: the whole block is OT and has no regular hours. It counts toward the OT offer
        // of that date if there is one, otherwise toward the month's OT minimum.
        e.ot_hours = spanMin(e.time_in, e.time_out) / 60; e.ot_start = e.time_in; e.ot_end = e.time_out; e.ot_position = 'custom'; e.ot_offer_id = offerFor(date)?.id ?? null
      } else if (e.ot_hours > 0) need(timed, `${w.name}: OT needs a worked shift`)
      if (locked.has(w.id)) {
        const cur = existing.find((x) => x.worker_id === w.id)
        const same = cur && cur.status === e.status && (cur.time_in || null) === (e.time_in || null) && (cur.time_out || null) === (e.time_out || null) && (cur.ot_hours || 0) === e.ot_hours && (cur.lunch_min ?? null) === (e.lunch_min ?? null)
        if (!same) throw err(409, `${w.name}'s ${month} is marked paid and locked. Unmark it as paid to edit.`)
        e.__skip = true
      }
    }
    // locked workers that are not in the payload still count for coverage and the OT cap
    const covInput = [...input, ...existing.filter((x) => keep(x) && !seen.has(x.worker_id)).map((x) => ({ ...x, __skip: true }))]
    const cov = coverage(covInput.filter((e) => e.status === 'worked' || e.status === 'training'))
    const warnings = []
    if (cov.status === 'overlap') {
      if (!body.force) throw err(409, `Two workers overlap by ${cov.overlap} minutes.`, { needsConfirm: true })
      warnings.push({ type: 'overlap', minutes: cov.overlap })
    }
    const acctOverride = body.account ? body.account.lunch_hours : S.accountDays[date]?.lunch_hours
    const lp = lunchPlan(covInput, { ...lunchCfg(), override: acctOverride, date })
    const leave = (body.account ? body.account.day_off : S.accountDays[date]?.day_off) === 'leave'
    if (leave) need(!covInput.some((e) => e.status === 'worked' || e.status === 'training' || e.status === 'rdot'), 'This day is marked as leave (no work). Remove the leave mark to log hours.')
    if (lp.inside) {
      // the logged times already contain the lunch hour: any gap is a real hole, and the day should match the shift
      need(!lp.overGiven, `More lunch was given out (${Math.round(lp.givenMin)} min) than the ${Math.round(lp.poolMin)} min lunch of this day`)
      if (cov.status === 'gap' && cov.gap > 0.5) warnings.push({ type: 'gap', minutes: Math.round(cov.gap) })
      const shift = shiftMin(month), logged = Math.round(cov.hours * 60)
      if (logged > 0 && Math.abs(logged - shift) > 1) warnings.push({ type: 'shift', logged, shift })
    } else {
      // older rule: the lunch is a gap in the times; a gap of up to the lunch length is the lunch itself
      const unexplainedGap = Math.max(0, cov.gap - lp.poolMin)
      if (cov.status === 'gap' && unexplainedGap > 0.5) warnings.push({ type: 'gap', minutes: Math.round(unexplainedGap) })
    }

    const otIn = covInput.filter((e) => e.ot_hours > 0)
    // OT is offered by the supervisor day by day; it needs no announcement. If an OT offer covers the
    // date its cap applies and the hours are linked to it.
    const offer = offerFor(date) || null
    if (otIn.length && offer) {
      const total = otIn.reduce((s, e) => s + e.ot_hours, 0), cap = capFor(offer, date)
      if (cap != null && total > cap + 1e-9) throw err(400, `OT is capped at ${cap} h for ${date} in "${offer.name}" (you entered ${total} h across all workers)`)
    }
    const position = body.ot_position === 'before' ? 'before' : 'after'
    const regOt = otIn.filter((e) => e.status !== 'rdot')
    const ots = deriveOT(cov, position, regOt.map((e) => e.ot_hours))
    regOt.forEach((e, i) => Object.assign(e, ots[i], { ot_position: position, ot_offer_id: offer?.id ?? null }))
    const a = body.account
    if (a && a.company_hours != null && a.company_hours !== '' && cov.hours) {
      // the company shows the whole shift including the paid lunch
      const total = lp.inside ? cov.hours : cov.hours + lp.totalMin / 60
      if (Math.abs(total - Number(a.company_hours)) > 0.01) warnings.push({ type: 'mismatch', siblings: total, company: Number(a.company_hours) })
    }
    const acct = a && { date, company_hours: num(a.company_hours, 'Company hours', { nullable: true, max: 48 }), lunch_hours: num(a.lunch_hours, 'Lunch hours', { nullable: true, max: 12 }), note: a.note || null, day_off: a.day_off === 'leave' ? 'leave' : null }

    // all checks passed: write
    S.entries = S.entries.filter((x) => !(x.date === date && !seen.has(x.worker_id) && !keep(x)))
    for (const e of input.filter((x) => !x.__skip)) {
      const row = { ...Object.fromEntries(ENTRY_COLS.map((k) => [k, e[k] ?? null])), worker_id: e.worker_id, date, ot_hours: e.ot_hours || 0 }
      const i = S.entries.findIndex((x) => x.worker_id === e.worker_id && x.date === date)
      if (i >= 0) S.entries[i] = { ...S.entries[i], ...row }
      else S.entries.push({ id: newId(), ...row })
    }
    if (acct) S.accountDays[date] = acct
    save(S)
    return warnings
  }

  function offersView() {
    const rates = ratesBy(), { stats, byEntry } = evalOffers(S.offers, S.entries, rates, today(), monthCfg)
    return [...S.offers].sort((a, b) => b.start_date.localeCompare(a.start_date)).map((o) => {
      const es = S.entries.filter((e) => e.ot_offer_id === o.id && e.ot_hours > 0)
      const mine = (id) => { const x = es.filter((e) => e.worker_id === id); return { hours: x.reduce((s, e) => s + e.ot_hours, 0), pay: Math.round(x.reduce((s, e) => s + (byEntry[e.id]?.otPay || 0), 0) * 100) / 100 } }
      return {
        ...o, ownMin: o.min_hours != null, stats: stats[o.id] || { total: es.reduce((s, e) => s + e.ot_hours, 0), min: o.min_hours, qualified: o.min_hours == null, final: today() > o.end_date, remaining: o.min_hours ?? 0 }, active: today() <= o.end_date,
        contributions: S.workers.map((w) => ({ id: w.id, name: w.name, color: w.color, ...mine(w.id) })).filter((c) => c.hours > 0),
      }
    })
  }
  function offerBody(b, id) {
    const o = {
      name: String(b.name || '').trim(), start_date: b.start_date, end_date: b.end_date,
      // blank cap = no limit; blank minimum = the hours count toward the MONTH's minimum instead
      cap_hours: num(b.cap_hours, 'Max OT hours per shift', { min: 0.25, max: 24, nullable: true }), min_hours: num(b.min_hours, 'Minimum total OT hours', { nullable: true }),
      qualified_rate: num(b.qualified_rate, 'Qualified rate'), below_min_rate: num(b.below_min_rate, 'Below-minimum rate', { nullable: true }),
      tier_mode: b.tier_mode === 'marginal' ? 'marginal' : 'whole', notes: b.notes || null,
    }
    need(o.name, 'Give the offer a name'); need(ISO.test(o.start_date) && ISO.test(o.end_date) && o.start_date <= o.end_date, 'Check the offer dates')
    const clash = S.offers.find((x) => x.id !== id && x.start_date <= o.end_date && x.end_date >= o.start_date)
    if (clash) throw err(409, `These dates overlap the offer "${clash.name}"`)
    const days = (Date.parse(o.end_date) - Date.parse(o.start_date)) / 864e5 + 1
    return { o, warnings: days > 14 ? [`This offer is ${days} days long. Offers are usually 14 days or less.`] : [] }
  }
  function bonusBody(b) {
    need(S.workers.some((w) => w.id === String(b.worker_id)), 'Choose a worker')
    need(ISO.test(b.review_date || ''), 'Enter the review date')
    const pay_month = b.pay_month || b.review_date.slice(0, 7)
    need(MONTH.test(pay_month), 'Bad pay month')
    if (isPaid(pay_month, String(b.worker_id))) throw err(409, 'That month is marked paid for this worker')
    return { worker_id: String(b.worker_id), review_date: b.review_date, pay_month, reference: b.reference || null, note: b.note || null, chat_time: toMin(b.chat_time) != null ? b.chat_time : null, amount: num(b.amount, 'Bonus amount', { max: 10000 }) }
  }

  const routes = []
  const on = (m, p, h) => routes.push([m, new RegExp('^' + p.replace(/:\w+/g, '([^/]+)') + '$'), h])
  const commit = (v) => { save(S); return v }

  on('GET', '/settings', () => S.settings)
  on('PUT', '/settings', ({ body: b }) => {
    if (b.presets) {
      need(Array.isArray(b.presets) && b.presets.length <= 12, 'Invalid presets')
      for (const p of b.presets) need(p.label && toMin(p.time_in) != null && toMin(p.time_out) != null, 'Each preset needs a label and two times')
      S.settings.presets = b.presets.map(({ label, time_in, time_out }) => ({ label, time_in, time_out }))
    }
    if (b.default_review_bonus != null) S.settings.default_review_bonus = num(b.default_review_bonus, 'Default review bonus')
    if (b.reminder_days != null) S.settings.reminder_days = num(b.reminder_days, 'Reminder days', { min: 1, max: 365 })
    if (b.lunch_auto != null) S.settings.lunch_auto = !!b.lunch_auto
    if (b.lunch_minutes != null) S.settings.lunch_minutes = num(b.lunch_minutes, 'Lunch minutes', { max: 240 })
    if (b.lunch_threshold != null) S.settings.lunch_threshold = num(b.lunch_threshold, 'Full shift hours', { min: 1, max: 24 })
    if ('lunch_from' in b) { need(!b.lunch_from || ISO.test(b.lunch_from), 'Bad date'); S.settings.lunch_from = b.lunch_from || null }
    if (b.shift_start) { need(toMin(b.shift_start) != null, 'Bad time'); S.settings.shift_start = b.shift_start }
    if (b.shift_end) { need(toMin(b.shift_end) != null, 'Bad time'); S.settings.shift_end = b.shift_end }
    if (b.ot_rate != null && b.ot_rate !== '') S.settings.ot_rate = num(b.ot_rate, 'OT rate')
    if ('ot_min' in b) S.settings.ot_min = num(b.ot_min, 'Monthly OT minimum', { nullable: true, max: 744 })
    if (b.lunch_inside != null) S.settings.lunch_inside = !!b.lunch_inside
    if ('lunch_inside_from' in b) { need(!b.lunch_inside_from || ISO.test(b.lunch_inside_from), 'Bad date'); S.settings.lunch_inside_from = b.lunch_inside_from || null }
    if (Array.isArray(b.rd_default)) { need(b.rd_default.every((d) => Number.isInteger(d) && d >= 0 && d <= 6), 'Bad weekdays'); S.settings.rd_default = [...new Set(b.rd_default)].sort() }
    if (b.timezone) { try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }) } catch { throw err(400, 'Unknown timezone') } S.settings.timezone = b.timezone }
    return commit(S.settings)
  })
  on('GET', '/schedule/:m', ({ params: [m] }) => { need(MONTH.test(m), 'Bad month'); return schedule(m) })
  // save a month's settings (anything not sent keeps its current/suggested value)
  on('PUT', '/schedule/:m', ({ params: [m], body }) => {
    need(MONTH.test(m), 'Bad month')
    const cur = schedule(m), next = { weekdays: cur.weekdays, shift_start: cur.shift_start, shift_end: cur.shift_end, ot_min: cur.ot_min, ot_rate: cur.ot_rate }
    if (body.weekdays !== undefined) {
      const wd = body.weekdays
      need(Array.isArray(wd) && wd.every((d) => Number.isInteger(d) && d >= 0 && d <= 6), 'Bad weekdays')
      next.weekdays = [...new Set(wd)].sort()
    }
    for (const k of ['shift_start', 'shift_end']) if (body[k] !== undefined) { need(toMin(body[k]) != null, 'Enter the shift time'); next[k] = body[k] }
    need(spanMin(next.shift_start, next.shift_end) > 0, 'The shift end must differ from its start')
    if (body.ot_min !== undefined) next.ot_min = num(body.ot_min, 'Monthly OT minimum', { nullable: true, max: 744 })
    if (body.ot_rate !== undefined) next.ot_rate = num(body.ot_rate, 'OT rate')
    const ch = ['shift_start', 'shift_end', 'ot_min', 'ot_rate'].some((k) => (cur[k] ?? null) !== (next[k] ?? null))
    if (ch && Object.keys(S.paid).some((k) => k.startsWith(m + '|'))) throw err(409, `${m} is already paid for someone, so its shift time and OT settings are locked.`)
    S.schedules[m] = next
    return commit(schedule(m))
  })

  on('GET', '/workers', () => S.workers.map(workerView))
  on('POST', '/workers', ({ body }) => {
    const name = String(body.name || '').trim()
    need(name && name.length <= 40, 'Enter a worker name')
    const rate = num(body.rate, 'Hourly rate'), from = body.effective_from || '2000-01-01'
    need(ISO.test(from), 'Bad date')
    if (S.workers.some((w) => w.name.toLowerCase() === name.toLowerCase())) throw err(409, 'That name is already used')
    const w = { id: newId(), name, color: COLORS[S.workers.length % COLORS.length], active: true }
    S.workers.push(w); S.rates.push({ worker_id: w.id, effective_from: from, rate })
    return commit(workerView(w))
  })
  on('POST', '/workers/:id/rates', ({ params: [id], body }) => {
    const w = S.workers.find((x) => x.id === id)
    need(w, 'Unknown worker'); need(ISO.test(body.effective_from || ''), 'Bad date')
    const hit = paidMonths(w.id).filter((m) => m >= body.effective_from.slice(0, 7))
    if (hit.length) throw err(409, `${w.name}'s ${hit[0]} is already paid. A new rate can only start after the last paid month.`)
    S.rates = S.rates.filter((r) => !(r.worker_id === w.id && r.effective_from === body.effective_from))
    S.rates.push({ worker_id: w.id, effective_from: body.effective_from, rate: num(body.rate, 'Hourly rate') })
    return commit(workerView(w))
  })
  // the account owner (e.g. the sister whose job it is): default receiver of review bonuses and of the lunch when she takes it
  on('POST', '/workers/:id/owner', ({ params: [id], body }) => {
    const w = S.workers.find((x) => x.id === id)
    need(w, 'Unknown worker')
    for (const x of S.workers) x.owner = body.owner ? x.id === id : x.owner && x.id !== id
    return commit(workerView(w))
  })
  on('POST', '/workers/:id/active', ({ params: [id], body }) => {
    const w = S.workers.find((x) => x.id === id)
    need(w, 'Unknown worker'); w.active = !!body.active
    return commit(workerView(w))
  })

  on('GET', '/day/:d', ({ params: [d] }) => { need(ISO.test(d), 'Bad date'); return dayView(d) })
  on('PUT', '/day/:d', ({ params: [d], body }) => { need(ISO.test(d), 'Bad date'); const warnings = saveDay(d, body); return { ok: true, warnings, day: dayView(d) } })

  on('GET', '/calendar/:m', ({ params: [m] }) => {
    need(MONTH.test(m), 'Bad month')
    const workers = active(), { report: rep } = report(m, workers), days = {}
    for (const d of daysInMonth(m)) days[d] = {}
    for (const w of workers) for (const r of rep[w.id].rows) days[r.date][w.id] = r.status
    const leave = daysInMonth(m).filter(isLeave)
    return { workers: workers.map((w) => ({ id: w.id, name: w.name, color: w.color })), days, today: today(), weekdays: schedule(m).weekdays, leave }
  })
  on('GET', '/summary/:m', ({ params: [month] }) => {
    need(MONTH.test(month), 'Bad month')
    const { report: rep, stats, monthStats } = report(month)
    const rows = S.workers.filter((w) => w.active || rep[w.id].total > 0).map((w) => {
      const { rows: _r, bonuses: _b, ...t } = rep[w.id]
      const p = S.paid[`${month}|${w.id}`]
      const snap = p && typeof p === 'object' ? p : null
      return { worker: { id: w.id, name: w.name, color: w.color, active: w.active }, ...t, paidAt: paidAt(p),
        paidTotal: snap ? snap.total : null, changedSincePaid: !!snap && Math.abs(snap.total - t.total) > 0.004 }
    })
    const sum = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100
    return {
      // workdays (not a rest day, not leave, not in the future) with nobody logged as working
      month, rows, notLogged: missingDays(month).length, missingDays: missingDays(month),
      otMonth: monthStats[month] || { total: 0, min: Number(schedule(month).ot_min) || 0, qualified: !(Number(schedule(month).ot_min) > 0), final: today() > daysInMonth(month).at(-1), remaining: Number(schedule(month).ot_min) || 0 },
      otRate: schedule(month).ot_rate,
      totals: { regularHours: sum('regularHours'), otHours: sum('otHours'), regularPay: sum('regularPay'), otPay: sum('otPay'), bonusTotal: sum('bonusTotal'), total: sum('total') },
      offers: S.offers.filter((o) => o.start_date.slice(0, 7) <= month && o.end_date.slice(0, 7) >= month).map((o) => ({ ...o, stats: stats[o.id] })),
    }
  })
  function missingDays(month) {
    const sch = schedule(month), t = today()
    return daysInMonth(month).filter((d) => d <= t && !sch.weekdays.includes(weekday(d)) && !isLeave(d)
      && !S.entries.some((e) => e.date === d && (e.status === 'worked' || e.status === 'training')))
  }
  on('PUT', '/paid/:m/:w', ({ params: [month, wid], body }) => {
    need(MONTH.test(month) && S.workers.some((w) => w.id === wid), 'Bad request')
    if (body.paid) {
      const open = S.offers.find((o) => o.start_date.slice(0, 7) <= month && o.end_date.slice(0, 7) >= month && o.end_date >= today() && S.entries.some((e) => e.ot_offer_id === o.id && e.worker_id === wid && e.date.startsWith(month)))
      if (open) throw err(409, `"${open.name}" is still running, so OT pay is provisional. Mark paid after ${open.end_date}.`)
      const monthOT = today() <= daysInMonth(month).at(-1) && S.entries.some((e) => e.worker_id === wid && e.date.startsWith(month) && e.ot_hours > 0 && !(S.offers.find((o) => o.id === e.ot_offer_id)?.min_hours != null))
      if (monthOT) throw err(409, `${month} is not over, so OT pay is still provisional (the monthly minimum is checked at month end).`)
      const r = report(month).report[wid]
      // keep what was paid, so later setting changes can be spotted instead of silently changing history
      S.paid[`${month}|${wid}`] = { at: new Date().toISOString(), total: r.total, regularPay: r.regularPay, otPay: r.otPay, bonusTotal: r.bonusTotal, regularHours: r.regularHours, otHours: r.otHours }
    } else delete S.paid[`${month}|${wid}`]
    return commit({ ok: true })
  })

  on('GET', '/offers', () => offersView())
  on('POST', '/offers', ({ body }) => { const { o, warnings } = offerBody(body); const row = { id: newId(), ...o, day_caps: {} }; S.offers.push(row); return commit({ id: row.id, warnings }) })
  on('PUT', '/offers/:id', ({ params: [id], body }) => {
    const i = S.offers.findIndex((o) => o.id === id)
    need(i >= 0, 'Not found')
    const { o, warnings } = offerBody(body, id)
    const cur = S.offers[i], payKeys = ['start_date', 'end_date', 'min_hours', 'qualified_rate', 'below_min_rate', 'tier_mode']
    if (payKeys.some((k) => (cur[k] ?? null) !== (o[k] ?? null)) && paidUsing(id).length)
      throw err(409, `"${cur.name}" has OT in a month that is already paid. Unmark it as paid to change the offer's dates or rates.`)
    const orphan = S.entries.find((e) => e.ot_offer_id === id && e.ot_hours > 0 && (e.date < o.start_date || e.date > o.end_date))
    if (orphan) throw err(409, `There is OT on ${orphan.date} that would fall outside the new dates.`)
    S.offers[i] = { ...S.offers[i], ...o, id, day_caps: S.offers[i].day_caps || {} }
    return commit({ id, warnings })
  })
  on('PUT', '/offers/:id/day-cap', ({ params: [id], body }) => {
    const o = S.offers.find((x) => x.id === id)
    need(o, 'Not found'); need(ISO.test(body.date || '') && body.date >= o.start_date && body.date <= o.end_date, 'That date is outside the offer')
    o.day_caps ||= {}
    if (body.hours === '' || body.hours == null) delete o.day_caps[body.date]
    else o.day_caps[body.date] = num(body.hours, 'Hours available', { min: 0.25, max: 24 })
    return commit({ ok: true })
  })
  on('DELETE', '/offers/:id', ({ params: [id] }) => {
    if (S.entries.some((e) => e.ot_offer_id === id && e.ot_hours > 0)) throw err(409, 'This offer already has OT entries and cannot be deleted')
    S.offers = S.offers.filter((o) => o.id !== id)
    return commit({ ok: true })
  })

  on('GET', '/bonuses', ({ query }) => {
    need(MONTH.test(query.month || ''), 'Bad month')
    return S.bonuses.filter((b) => b.pay_month === query.month).map((b) => { const w = S.workers.find((x) => x.id === b.worker_id); return { ...b, worker_name: w?.name, color: w?.color } })
      .sort((a, b) => b.review_date.localeCompare(a.review_date) || String(b.id).localeCompare(String(a.id)))
  })
  on('GET', '/covered', ({ query: { date, time } }) => {
    const t = toMin(time)
    need(ISO.test(date || '') && t != null, 'Bad request')
    return entriesOn(date).filter((e) => (e.status === 'worked' || e.status === 'training') && (t - toMin(e.time_in) + 1440) % 1440 < spanMin(e.time_in, e.time_out))
      .map((e) => ({ id: e.worker_id, name: S.workers.find((w) => w.id === e.worker_id)?.name }))
  })
  on('POST', '/bonuses', ({ body }) => { const row = { id: newId(), ...bonusBody(body) }; S.bonuses.push(row); return commit({ id: row.id }) })
  on('PUT', '/bonuses/:id', ({ params: [id], body }) => {
    const i = S.bonuses.findIndex((b) => b.id === id)
    need(i >= 0, 'Not found')
    if (isPaid(S.bonuses[i].pay_month, S.bonuses[i].worker_id)) throw err(409, 'That month is marked paid')
    S.bonuses[i] = { ...S.bonuses[i], ...bonusBody(body), id }
    return commit({ ok: true })
  })
  on('DELETE', '/bonuses/:id', ({ params: [id] }) => {
    const old = S.bonuses.find((b) => b.id === id)
    if (old && isPaid(old.pay_month, old.worker_id)) throw err(409, 'That month is marked paid')
    S.bonuses = S.bonuses.filter((b) => b.id !== id)
    return commit({ ok: true })
  })

  on('POST', '/parse', ({ body }) => parseNotes(String(body.text || '').slice(0, 20000), active(), Number(body.year) || +today().slice(0, 4)))
  on('POST', '/apply-notes', ({ body }) => {
    const items = (body.items || []).filter((i) => i.ok), byDate = {}
    for (const i of items) (byDate[i.date] ||= []).push(i)
    let saved = 0
    for (const [date, list] of Object.entries(byDate)) {
      const cur = entriesOn(date).filter((e) => !list.some((i) => i.worker_id === e.worker_id))
      const entries = [...cur.map((e) => ({ ...e })), ...list.map((i) => ({ worker_id: i.worker_id, status: i.status, time_in: i.time_in, time_out: i.time_out, ot_hours: i.ot_hours || 0, lunch_min: i.lunch_min ?? null }))]
      saveDay(date, { entries, force: true })
      saved += list.length
    }
    return { saved }
  })
  on('GET', '/meta', () => ({
    hasData: S.entries.length + S.bonuses.length > 0, lastBackupAt: S.lastBackupAt, reminderDays: S.settings.reminder_days,
    counts: { workers: S.workers.length, entries: S.entries.length, bonuses: S.bonuses.length, offers: S.offers.length },
  }))

  return {
    state: S,
    async handle(method, url, body) {
      const [path, qs] = url.split('?'), query = Object.fromEntries(new URLSearchParams(qs || ''))
      for (const [m, re, h] of routes) {
        if (m !== method) continue
        const x = re.exec(path)
        if (x) return structuredClone(h({ params: x.slice(1), body: body ?? {}, query }))
      }
      throw err(404, 'Not found')
    },
    // data for the Excel builder
    exportCtx(month, workerIds) {
      const workers = S.workers.filter((w) => (workerIds ? workerIds.includes(w.id) : w.active))
      return structuredClone({
        month, workers, rates: ratesBy(), entries: S.entries, offers: S.offers, bonuses: S.bonuses, today: today(),
        paid: Object.fromEntries(workers.filter((w) => S.paid[`${month}|${w.id}`]).map((w) => [w.id, paidAt(S.paid[`${month}|${w.id}`])])),
        accountDays: S.accountDays, lunch: lunchCfg(), months: Object.fromEntries([month].map((m) => [m, schedule(m)])),
      })
    },
    backup() {
      S.lastBackupAt = new Date().toISOString(); save(S)
      return { filename: `work-hours-backup-${S.lastBackupAt.slice(0, 10)}.json`, json: JSON.stringify({ app: APP_ID, version: 1, exported_at: S.lastBackupAt, data: S }, null, 1) }
    },
    restore(text) {
      let o
      try { o = JSON.parse(text) } catch { throw err(400, 'That file is not a valid backup') }
      const d = o?.data
      if (o?.app !== APP_ID || !d || !['workers', 'rates', 'entries', 'offers', 'bonuses'].every((k) => Array.isArray(d[k])) || typeof d.settings !== 'object')
        throw err(400, 'That file is not a Work Hours & Payout backup')
      for (const k of Object.keys(S)) delete S[k]
      Object.assign(S, EMPTY(), d)
      migrateIds(S)
      ensureLunch()
      save(S)
      return { entries: S.entries.length }
    },
    reset() { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, EMPTY(), { settings: { ...EMPTY().settings } }); save(S) },
    loadDemo() {
      need(S.entries.length === 0 && S.workers.length === 0, 'Sample data can only be loaded into an empty app')
      const ids = {}
      for (const [n, c] of [['Alex', COLORS[0]], ['Bo', COLORS[1]], ['Jo', COLORS[2]], ['Sam', COLORS[3]]]) {
        const w = { id: newId(), name: n, color: c, active: true }; S.workers.push(w); S.rates.push({ worker_id: w.id, effective_from: '2026-01-01', rate: 5 }); ids[n] = w.id
      }
      S.schedules['2026-10'] = { weekdays: [3, 4] }
      const d = (n) => `2026-10-${String(n).padStart(2, '0')}`
      const add = (w, n, status, a, b, rate, why) => S.entries.push({ id: newId(), worker_id: ids[w], date: d(n), status, time_in: a || null, time_out: b || null, ot_hours: 0, ot_start: null, ot_end: null, ot_position: null, ot_offer_id: null, rate_override: rate ?? null, rate_override_reason: why ?? null, remark: null })
      ;[1, 6, 7, 8, 13, 14, 15, 20, 21, 22, 27, 28, 29].forEach((n) => add('Alex', n, 'rd'))
      ;[[4, '16:00', '20:30'], [10, '20:30', '01:00'], [11, '20:30', '01:00'], [17, '20:30', '01:00'], [18, '16:00', '20:30'], [25, '20:30', '01:00']].forEach(([n, a, b]) => add('Alex', n, 'worked', a, b))
      add('Alex', 31, 'worked', '16:00', '17:20', 5.5, 'Rate shown on the original sheet')
      ;[6, 7, 8, 13, 14, 15, 20, 21, 22, 27, 28, 29].forEach((n) => add('Bo', n, 'rd'))
      ;[[17, '16:00', '20:30'], [24, '20:30', '01:00'], [25, '16:00', '20:30']].forEach(([n, a, b]) => add('Bo', n, 'worked', a, b))
      add('Bo', 31, 'worked', '21:00', '02:20', 5.5, 'Rate shown on the original sheet')
      save(S)
    },
    meta: () => structuredClone({ hasData: S.entries.length + S.bonuses.length > 0, lastBackupAt: S.lastBackupAt, reminderDays: S.settings.reminder_days }),
  }
}
